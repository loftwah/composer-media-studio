// MIT. The public sitemap, the cache boundary and the withdrawal proof.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { PUBLIC_CACHE_SECONDS } from "../src/lib/sitemap.ts";
import { PNG_1x1, setup, addAsset } from "./harness.mjs";
import { sha256Hex } from "../src/lib/util.mjs";

const base = "https://studio.test";

async function publishedAsset(env, project, { id, slug, listed = 1, hidden = 0, revoked = null, deleted = null }) {
  const asset = await addAsset(env, project, { id, kind: "image", source: "upload" });
  await env.MEDIA.put(asset.r2_key, PNG_1x1);
  await env.DB.prepare("UPDATE assets SET mime='image/png',bytes=?2,sha256=?3,title='A page asset',caption='PRIVATE CAPTION AND PROMPT',deleted_at=?4 WHERE id=?1")
    .bind(asset.id, PNG_1x1.byteLength, await sha256Hex(PNG_1x1), deleted)
    .run();
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at) VALUES(?1,?2,?3,?4,'Public title','',1,1,?5,?6,?7)",
  )
    .bind(`pub_${id}`, project.id, asset.id, slug, listed, hidden, revoked)
    .run();
  return asset;
}

function get(env, path) {
  return worker.fetch(new Request(base + path), env);
}

function locs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

test("sitemap.xml lists exactly the public publications and robots points at it", async () => {
  const { env, project } = await setup();
  await publishedAsset(env, project, { id: "asset_public", slug: "page-public" });
  await publishedAsset(env, project, { id: "asset_unlisted", slug: "page-unlisted", listed: 0 });
  await publishedAsset(env, project, { id: "asset_hidden", slug: "page-hidden", hidden: 1 });
  await publishedAsset(env, project, { id: "asset_withdrawn", slug: "page-withdrawn", revoked: 1 });
  await publishedAsset(env, project, { id: "asset_deleted", slug: "page-deleted", deleted: 2 });
  const privateAsset = await addAsset(env, project, { id: "asset_private", kind: "image", source: "upload" });
  await env.DB.prepare("UPDATE assets SET sha256='private-sha' WHERE id=?1").bind(privateAsset.id).run();

  const sitemapResponse = await get(env, "/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemapResponse.headers.get("content-type"), /^application\/xml/);
  assert.equal(sitemapResponse.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  const sitemap = await sitemapResponse.text();
  assert.deepEqual(locs(sitemap).sort(), [
    "https://studio.test/",
    "https://studio.test/gallery",
    "https://studio.test/p/page-public",
  ]);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(sitemap, /PRIVATE|PROMPT|page-unlisted|page-hidden|page-withdrawn|page-deleted/);
  assert.doesNotMatch(sitemap, /<lastmod>/);

  // Editing the public copy leaves the original creation time unchanged.
  await env.DB.prepare(
    "UPDATE publications SET title='Edited public title',description='Edited public description' WHERE slug='page-public'",
  ).run();
  const editedSitemap = await (await get(env, "/sitemap.xml")).text();
  assert.deepEqual(locs(editedSitemap).sort(), locs(sitemap).sort());
  assert.doesNotMatch(editedSitemap, /<lastmod>/);

  const robotsResponse = await get(env, "/robots.txt");
  assert.equal(robotsResponse.status, 200);
  assert.match(robotsResponse.headers.get("content-type"), /^text\/plain/);
  const robots = await robotsResponse.text();
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/studio$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/studio\.test\/sitemap\.xml$/m);

  const gallery = await (await get(env, "/gallery")).text();
  assert.match(gallery, /href="\/p\/page-public"/);
  assert.doesNotMatch(gallery, /page-unlisted|page-hidden|page-withdrawn|page-deleted/);

  const unlisted = await (await get(env, "/p/page-unlisted")).text();
  assert.match(unlisted, /<meta name="robots" content="noindex">/);
  const hidden = await (await get(env, "/p/page-hidden")).text();
  assert.match(hidden, /<meta name="robots" content="noindex">/);
});

test("withdrawing a publication removes it from the gallery and sitemap within the cache boundary and stops its URLs", async () => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + (await createSession(env));
  await publishedAsset(env, project, { id: "asset_live", slug: "page-live" });
  await env.DB.prepare(
    "INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at) VALUES('pub_asset_live','thumb','derivative-key','image/png',10,1,1,'derivative-sha',1)",
  ).run();
  await env.MEDIA.put("derivative-key", PNG_1x1);

  assert.equal((await get(env, "/p/page-live")).status, 200);
  const page = await get(env, "/p/page-live");
  assert.equal(page.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  const media = await get(env, "/p/page-live/media");
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/png");
  assert.equal(media.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  assert.equal((await get(env, "/p/page-live/download")).status, 200);
  assert.equal((await get(env, "/p/page-live/thumb")).status, 200);
  assert.match(await (await get(env, "/gallery")).text(), /href="\/p\/page-live"/);
  assert.ok(locs(await (await get(env, "/sitemap.xml")).text()).includes("https://studio.test/p/page-live"));

  const withdrawResponse = await worker.fetch(
    new Request(`${base}/api/projects/${project.id}/publications/bulk`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: base },
      body: JSON.stringify({ action: "withdraw", publicationIds: ["pub_asset_live"], confirm: true }),
    }),
    env,
  );
  assert.equal(withdrawResponse.status, 200);
  assert.equal((await withdrawResponse.json()).changed, 1);

  assert.doesNotMatch(await (await get(env, "/gallery")).text(), /page-live/);
  assert.ok(!locs(await (await get(env, "/sitemap.xml")).text()).includes("https://studio.test/p/page-live"));
  assert.equal((await get(env, "/p/page-live")).status, 404);
  assert.equal((await get(env, "/p/page-live/media")).status, 404);
  assert.equal((await get(env, "/p/page-live/download")).status, 404);
  assert.equal((await get(env, "/p/page-live/thumb")).status, 404);
  assert.equal(env.MEDIA.objects.has("derivative-key"), false);

  const audit = await env.DB.prepare(
    "SELECT action,previous_state,resulting_state FROM publication_audit WHERE publication_id='pub_asset_live'",
  ).first();
  assert.equal(audit.action, "withdraw");
  assert.deepEqual(JSON.parse(audit.previous_state), { listed: true, hidden: false, withdrawn: false });
  assert.deepEqual(JSON.parse(audit.resulting_state), { listed: true, hidden: false, withdrawn: true });

  // There is no feed route in this app; nothing else enumerates public works.
  assert.equal((await get(env, "/feed.xml")).status, 404);
  assert.doesNotMatch(await (await get(env, "/sitemap.xml")).text(), /feed/);
});
