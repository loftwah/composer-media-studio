// MIT. Bounded, fictional D1 fixture proving the sitemap overflow boundary.
// In-memory SQLite, no media bytes, no provider, no production records.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { SITEMAP_LIMIT, PUBLIC_CACHE_SECONDS } from "../src/lib/sitemap.mjs";
import { setup } from "./harness.mjs";

const base = "https://studio.test";

function get(env, path) {
  return worker.fetch(new Request(base + path), env);
}

function locs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

/** Insert exactly `eligible` public publications plus one of each excluded kind. */
async function scaleFixture(eligible) {
  const { env, project } = await setup();
  const statements = [];
  const now = Date.now();

  const addAsset = (assetId, { projectId = project.id, deletedAt = null } = {}) => {
    statements.push(env.DB.prepare(
      `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,caption,source,created_at,updated_at,deleted_at)
       VALUES(?1,?2,'image',?3,'image/png',10,1,1,NULL,'hash','Public asset title','PRIVATE CAPTION',?4,?5,?5,?6)`,
    ).bind(assetId, projectId, `k-${assetId}`, "upload", now, deletedAt));
  };
  const addPublication = (id, assetId, slug, { projectId = project.id, listed = 1, hidden = 0, revokedAt = null, createdAt = now } = {}) => {
    statements.push(env.DB.prepare(
      `INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at)
       VALUES(?1,?2,?3,?4,'Public title','PRIVATE DESCRIPTION',1,?5,?6,?7,?8)`,
    ).bind(id, projectId, assetId, slug, createdAt, listed, hidden, revokedAt));
  };

  for (let i = 0; i < eligible; i++) {
    addAsset(`scale_asset_${i}`);
    addPublication(`scale_pub_${i}`, `scale_asset_${i}`, `scale-page-${i}`, { createdAt: 1_000_000 + i });
  }

  // Every excluded row sorts ahead of the eligible ones if a predicate regresses.
  addAsset("ex_unlisted");
  addPublication("ex_unlisted_pub", "ex_unlisted", "scale-excluded-unlisted", { listed: 0, createdAt: 9_000_000 });
  addAsset("ex_hidden");
  addPublication("ex_hidden_pub", "ex_hidden", "scale-excluded-hidden", { hidden: 1, createdAt: 9_000_001 });
  addAsset("ex_withdrawn");
  addPublication("ex_withdrawn_pub", "ex_withdrawn", "scale-excluded-withdrawn", { revokedAt: now, createdAt: 9_000_002 });
  addAsset("ex_deleted", { deletedAt: now });
  addPublication("ex_deleted_pub", "ex_deleted", "scale-excluded-deleted", { createdAt: 9_000_003 });
  addAsset("ex_private"); // No publication row: private media is never listed.
  statements.push(env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','slug-other','','private','{}',?1,?1)",
  ).bind(now));
  addAsset("ex_cross", { projectId: "prj_other" });
  addPublication("ex_cross_pub", "ex_cross", "scale-excluded-cross-project", { projectId: project.id, createdAt: 9_000_004 });

  for (let i = 0; i < statements.length; i += 1000) await env.DB.batch(statements.slice(i, i + 1000));
  return { env, project, expectedSlugs: Array.from({ length: eligible }, (_, i) => `scale-page-${i}`) };
}

test("5001 eligible publications: same-origin index, two numbered children, every URL exactly once", async () => {
  const { env, expectedSlugs } = await scaleFixture(5001);

  const root = await get(env, "/sitemap.xml");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type"), /^application\/xml/);
  assert.equal(root.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  const indexXml = await root.text();
  assert.match(indexXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(indexXml, /<urlset|<lastmod>/);
  assert.deepEqual(locs(indexXml), [`${base}/sitemap-1.xml`, `${base}/sitemap-2.xml`]);
  assert.ok(locs(indexXml).every((loc) => loc.startsWith(base + "/")));
  assert.ok(Buffer.byteLength(indexXml) < 50 * 1024 * 1024);

  const robots = await (await get(env, "/robots.txt")).text();
  assert.match(robots, /^Sitemap: https:\/\/studio\.test\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/studio$/m);

  const children = [];
  for (const number of [1, 2]) {
    const response = await get(env, `/sitemap-${number}.xml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/xml/);
    assert.equal(response.headers.get("cache-control"), `public, max-age=${PUBLIC_CACHE_SECONDS}`);
    const xml = await response.text();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.doesNotMatch(xml, /<sitemapindex|<lastmod>/);
    assert.ok(locs(xml).length <= SITEMAP_LIMIT);
    assert.ok(locs(xml).every((loc) => loc.startsWith(base + "/")));
    assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024);
    children.push(locs(xml));
  }

  assert.deepEqual(children[0].slice(0, 2), [`${base}/`, `${base}/gallery`]);
  assert.equal(children[0].length, SITEMAP_LIMIT); // 2 static + 4998 publications.
  assert.deepEqual(children[1], [
    `${base}/p/scale-page-2`,
    `${base}/p/scale-page-1`,
    `${base}/p/scale-page-0`,
  ]);

  const publicationLocs = children.flat().filter((loc) => loc.startsWith(`${base}/p/`));
  assert.equal(publicationLocs.length, 5001);
  assert.equal(new Set(publicationLocs).size, 5001);
  assert.deepEqual(new Set(publicationLocs), new Set(expectedSlugs.map((slug) => `${base}/p/${slug}`)));
  assert.ok(!children.flat().some((loc) => /excluded|PRIVATE/i.test(loc)));

  const missing = await get(env, "/sitemap-3.xml");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
});

test("below the cap /sitemap.xml stays byte-for-byte the flat urlset and children 404", async () => {
  const { env } = await scaleFixture(3);
  const xml = await (await get(env, "/sitemap.xml")).text();
  const expectedLocs = [
    `${base}/`,
    `${base}/gallery`,
    `${base}/p/scale-page-2`,
    `${base}/p/scale-page-1`,
    `${base}/p/scale-page-0`,
  ];
  const legacyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${expectedLocs
    .map((loc) => `  <url><loc>${loc}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  assert.equal(xml, legacyXml);
  assert.doesNotMatch(xml, /<sitemapindex|scale-excluded|PRIVATE|lastmod/);
  for (const path of ["/sitemap-0.xml", "/sitemap-1.xml", "/sitemap-01.xml", "/sitemap-900719925474099999999999.xml"]) {
    assert.equal((await get(env, path)).status, 404, path);
  }
});

test("the current-sized catalogue (17 publications = 19 URLs) stays a single flat urlset", async () => {
  const { env } = await scaleFixture(17);
  const response = await get(env, "/sitemap.xml");
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset /);
  assert.doesNotMatch(xml, /<sitemapindex/);
  assert.equal(locs(xml).length, 19);
  assert.deepEqual(locs(xml).slice(0, 2), [`${base}/`, `${base}/gallery`]);
  assert.equal((await get(env, "/sitemap-1.xml")).status, 404);
});

test("a withdrawal at overflow collapses the index back to one complete flat urlset", async () => {
  const { env } = await scaleFixture(5001);
  await env.DB.prepare("UPDATE publications SET revoked_at=?1 WHERE slug='scale-page-5000'").bind(Date.now()).run();

  const xml = await (await get(env, "/sitemap.xml")).text();
  assert.match(xml, /<urlset/);
  assert.doesNotMatch(xml, /<sitemapindex/);
  const publicationLocs = locs(xml).filter((loc) => loc.startsWith(`${base}/p/`));
  assert.equal(publicationLocs.length, 5000);
  assert.ok(!publicationLocs.includes(`${base}/p/scale-page-5000`));
  assert.equal((await get(env, "/sitemap-1.xml")).status, 404);
});
