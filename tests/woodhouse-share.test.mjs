import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { sha256Hex } from "../src/lib/util.mjs";
import { PNG_1x1, setup, addAsset } from "./harness.mjs";
import { woodhouseGallery } from "../src/lib/ui.mjs";

test("artwork links retain the current search and page when returning to the catalogue", () => {
  const asset = { id: "first-print", title: "Print", project: "fighter" };
  const context = { query: "ring & bell", project: "fighter", after: "earlier-print" };
  const gallery = woodhouseGallery({ assets: [asset], ...context });
  assert.match(gallery, /q=ring\+%26\+bell&amp;project=fighter&amp;after=earlier-print&amp;asset=first-print/);
  const detail = woodhouseGallery({ asset, ...context });
  assert.match(detail, /href="\/portfolio\?q=ring\+%26\+bell&amp;project=fighter&amp;after=earlier-print#artwork-first-print"/);
  assert.match(woodhouseGallery({ asset }), /href="\/portfolio#artwork-first-print"/);
});

test("showcase lists only currently published live videos and honours withdrawal", async (t) => {
  const { env, project } = await setup();
  env.WOODHOUSE_SHARE = "true";
  env.PUBLIC_SHOWCASE_SLUGS = "example-film";
  const asset = await addAsset(env, project, { id: "asset_film", kind: "video" });
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,1,1)")
    .bind("pub_film", project.id, asset.id, "example-film", "A real film", "A saved clip.").run();
  t.mock.method(globalThis, "fetch", async () => Response.json({ version: 1, assets: [], nextAfter: null }));
  const read = () => worker.fetch(new Request("https://studio.test/portfolio"), env);
  const visible = await read();
  assert.equal(visible.headers.get("cache-control"), "no-store");
  const withoutPoster = await visible.text();
  assert.match(withoutPoster, /class="film-placeholder"/);
  assert.match(withoutPoster, /No preview still provided/);
  assert.match(withoutPoster, /href="\/p\/example-film"/);
  assert.doesNotMatch(withoutPoster, /\/p\/example-film\/(?:media|poster)/);
  const poster = await addAsset(env, project, { id: "asset_public_poster", kind: "image" });
  await env.DB.prepare("UPDATE publications SET poster_asset_id=?2 WHERE id=?1").bind("pub_film", poster.id).run();
  const withPoster = await (await read()).text();
  assert.match(withPoster, /poster="\/p\/example-film\/poster"/);
  assert.match(withPoster, /preload="none"/);
  await env.DB.prepare("UPDATE assets SET deleted_at=1 WHERE id=?1").bind(poster.id).run();
  assert.match(await (await read()).text(), /class="film-placeholder"/);
  await env.DB.prepare("UPDATE publications SET revoked_at=1 WHERE id=?1").bind("pub_film").run();
  assert.doesNotMatch(await (await read()).text(), /example-film/);
});

test("Share browsing and imports preserve source boundaries and deduplicate concurrent saves", async (t) => {
  const { env, project } = await setup();
  env.WOODHOUSE_SHARE = "true";
  const origin = "https://woodhouse.loftwah.com";
  const hash = await sha256Hex(PNG_1x1);
  const asset = {
    id: "first-print",
    title: "Workshop <print>",
    project: "app-composer",
    visibility: "public",
    thumbnailUrl: origin + "/campaign/preview.webp",
    sourceUrl: origin + "/campaign/source.txt",
    credit: "Woodhouse · first-party art",
    original: { url: origin + "/campaign/source.png", sha256: hash },
  };
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(String(url));
    assert.equal(options.redirect, "manual");
    if (String(url) === asset.original.url) return new Response(PNG_1x1);
    if (String(url).endsWith("/first-print")) return Response.json({ version: 1, asset });
    return Response.json({ version: 1, assets: [asset], nextAfter: "second-print" });
  });
  const gallery = await worker.fetch(new Request("https://studio.test/portfolio?project=app-composer"), env);
  assert.equal(gallery.status, 200);
  assert.match(gallery.headers.get("content-security-policy"), /img-src [^;]*woodhouse\.loftwah\.com/);
  const html = await gallery.text();
  assert.match(html, /Workshop &lt;print&gt;/);
  assert.match(html, /project=app-composer&amp;after=second-print/);
  assert.doesNotMatch(html, /<print>/);

  const cookie = "studio_session=" + await createSession(env);
  const path = `https://studio.test/api/projects/${project.id}/assets/woodhouse`;
  const submit = (data, authenticated = true) => worker.fetch(new Request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authenticated ? { cookie } : {}) },
    body: JSON.stringify(data),
  }), env);
  assert.equal((await submit({ assetId: asset.id, reuseConfirmed: true }, false)).status, 401);
  assert.equal((await submit({ assetId: asset.id })).status, 400);
  assert.equal(requests.length, 1);

  const payload = { assetId: asset.id, reuseConfirmed: true };
  const results = await Promise.all([submit(payload), submit(payload)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 201]);
  const saved = await Promise.all(results.map((response) => response.json()));
  assert.equal(saved[0].asset.id, saved[1].asset.id);
  assert.equal(saved[0].asset.reuseStillId, saved[0].asset.id);
  assert.equal(saved[1].asset.reuseStillId, saved[1].asset.id);
  assert.equal(env.MEDIA.objects.size, 1);
  const upload = new FormData();
  upload.set('file', new File([PNG_1x1], 'direct.png', { type: 'image/png' }));
  const uploaded = await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/assets`, {
    method: 'POST', headers: { cookie }, body: upload,
  }), env);
  assert.equal(uploaded.status, 201);
  const direct = await uploaded.json();
  assert.equal(direct.asset.reuseStillId, direct.asset.id);
  assert.equal(saved[0].asset.source, "upload");
  assert.equal(saved[0].asset.sha256, hash);
  assert.match(saved[0].asset.caption, /first-print\n.*source\.txt\nWoodhouse/);

  asset.original.url = "https://other.example/source.png";
  assert.equal((await submit(payload)).status, 422);
  assert.ok(requests.every((url) => url.startsWith(origin + "/")));
});
