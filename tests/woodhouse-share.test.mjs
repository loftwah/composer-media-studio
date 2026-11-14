import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { sha256Hex } from "../src/lib/util.mjs";
import { PNG_1x1, setup, addAsset } from "./harness.mjs";
import { woodhouseGallery } from "../src/lib/ui.mjs";

test("publication text edits preserve public identity and require scoped publish access", async (t) => {
  const { env, project } = await setup();
  env.COMPOSER_ORIGIN = 'https://composer.test'; env.BRIDGE_SECRET = 'fixture-bridge-secret-at-least-32-bytes';
  let grantActive = true;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const claim = JSON.parse(options.body);
    return Response.json({ ok:grantActive, actor:claim.actor, workspace:claim.workspace, actions:claim.actions });
  });
  const asset = await addAsset(env, project, { id: "asset_edit_page", kind: "image" });
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,attribution_json) VALUES(?1,?2,?3,'edit-piece','Old','Old credit',1,1,1,0,?4)")
    .bind("pub_edit", project.id, asset.id, '[{"name":"credit"}]').run();
  const cookie = async (projectId, actions) => 'studio_session=' + await createSession(env, { mode:'bridge', actor:'fixture', workspace:'fixture', project:projectId, actions });
  const patch = (auth, value) => worker.fetch(new Request('https://studio.test/api/publications/pub_edit', { method:'PATCH', headers:{ cookie:auth, origin:'https://studio.test', 'content-type':'application/json' }, body:JSON.stringify(value) }), env);
  const edit = { title:'New <title>', description:'Credit <script>alert(1)</script> https://example.test/source', expectedTitle:'Old', expectedDescription:'Old credit' };
  const owner = await cookie(project.id, ['read','publish']);
  assert.equal((await patch(await cookie('prj_other', ['read','publish']), edit)).status, 403);
  assert.equal((await patch(await cookie(project.id, ['read']), edit)).status, 403);
  grantActive = false;
  assert.equal((await patch(owner, edit)).status, 403);
  grantActive = true;
  assert.equal((await patch(owner, { ...edit, title:'' })).status, 400);
  assert.equal((await patch(owner, { ...edit, description:'x'.repeat(301) })).status, 400);
  assert.equal((await patch(owner, { ...edit, listed:false })).status, 400);
  assert.equal((await patch(owner, edit)).status, 200);
  const row = await env.DB.prepare('SELECT * FROM publications WHERE id=?1').bind('pub_edit').first();
  assert.equal(row.slug, 'edit-piece'); assert.equal(row.listed, 1); assert.equal(row.hidden, 0);
  assert.equal(row.revoked_at, null); assert.equal(row.attribution_json, '[{"name":"credit"}]');
  assert.equal((await patch(owner, edit)).status, 409);
  const page = await worker.fetch(new Request('https://studio.test/p/edit-piece'), env);
  const html = await page.text();
  assert.match(html, /New &lt;title&gt;/); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  await env.DB.prepare('UPDATE publications SET revoked_at=1 WHERE id=?1').bind('pub_edit').run();
  assert.equal((await patch(owner, { ...edit, expectedTitle:row.title, expectedDescription:row.description })).status, 404);
});

test("artwork links retain the current search and page when returning to the catalogue", () => {
  const asset = { id: "first-print", title: "Print", project: "fighter" };
  const context = { query: "ring & bell", project: "fighter", after: "earlier-print" };
  const gallery = woodhouseGallery({ assets: [asset], ...context });
  assert.match(gallery, /<a href="\/studio">Open Studio<\/a>/);
  assert.match(gallery, /q=ring\+%26\+bell&amp;project=fighter&amp;after=earlier-print&amp;asset=first-print/);
  const detail = woodhouseGallery({ asset, ...context });
  assert.match(detail, /<a href="\/studio">Open Studio<\/a>/);
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

test("home examples include only configured, live published videos and explicit posters", async () => {
  const { env, project } = await setup();
  const video = await addAsset(env, project, {
    id: "asset_home_video",
    kind: "video",
  });
  const poster = await addAsset(env, project, {
    id: "asset_home_poster",
    kind: "image",
  });
  env.PUBLIC_SHOWCASE_SLUGS = "home-film,withdrawn-film,hidden-film";
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,1)",
  )
    .bind(
      "pub_home",
      project.id,
      video.id,
      poster.id,
      "home-film",
      "Public work",
      "Public description",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,1,1,1)",
  )
    .bind(
      "pub_hidden",
      project.id,
      video.id,
      "withdrawn-film",
      "Withdrawn",
      "Private",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,hidden) VALUES(?1,?2,?3,?4,?5,?6,1,1,1)",
  )
    .bind(
      "pub_home_hidden",
      project.id,
      video.id,
      "hidden-film",
      "Hidden",
      "Not listed",
    )
    .run();
  const cookie = "studio_session=" + (await createSession(env));
  const state = await worker.fetch(
    new Request("https://studio.test/api/state", { headers: { cookie } }),
    env,
  );
  const result = await state.json();
  assert.deepEqual(result.showcase, [
    {
      slug: "home-film",
      title: "Public work",
      description: "Public description",
      mime: "video/mp4",
      hasPoster: true,
    },
  ]);
  await env.DB.prepare("UPDATE assets SET deleted_at=1 WHERE id=?1")
    .bind(poster.id)
    .run();
  const without = await (
    await worker.fetch(
      new Request("https://studio.test/api/state", { headers: { cookie } }),
      env,
    )
  ).json();
  assert.equal(without.showcase[0].hasPoster, false);
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

test("public gallery requires explicit listing and honors removal, deletion and withdrawal", async () => {
  const { env, project } = await setup();
  const image = await addAsset(env, project, { id: "asset_gallery_image", kind: "image" });
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,1,1)")
    .bind("pub_gallery", project.id, image.id, "gallery-piece", "A <piece>", "Public description").run();
  const read = async (path = "/gallery") => (await worker.fetch(new Request(`https://studio.test${path}`), env)).text();
  assert.doesNotMatch(await read(), /gallery-piece/);
  assert.doesNotMatch(await read("/"), /gallery-piece/);
  const unlistedPage = await worker.fetch(new Request("https://studio.test/p/gallery-piece"), env);
  assert.equal(unlistedPage.status, 200);
  assert.match(await unlistedPage.text(), /<meta name="robots" content="noindex">/);
  const cookie = "studio_session=" + (await createSession(env));
  const patch = (listed) => worker.fetch(new Request("https://studio.test/api/publications/pub_gallery", { method: "PATCH", headers: { cookie, "content-type": "application/json", origin: "https://studio.test" }, body: JSON.stringify({ listed }) }), env);
  assert.equal((await patch(true)).status, 200);
  assert.match(await read(), /href="\/p\/gallery-piece"/);
  assert.doesNotMatch(await (await worker.fetch(new Request("https://studio.test/p/gallery-piece"), env)).text(), /<meta name="robots" content="noindex">/);
  assert.match(await read("/"), /A &lt;piece&gt;/);
  const back = encodeURIComponent('/gallery?q=Bubbles&kind=video&order=oldest&page=2');
  const piece = await read(`/p/gallery-piece?back=${back}`);
  assert.match(piece, /href="https:\/\/studio\.test\/gallery\?q=Bubbles&amp;kind=video&amp;order=oldest&amp;page=2"/);
  const malicious = await read(`/p/gallery-piece?back=${encodeURIComponent('https://example.com')}`);
  assert.match(malicious, /href="https:\/\/studio\.test\/gallery">← Back to gallery/);
  assert.equal((await patch(false)).status, 200);
  assert.doesNotMatch(await read(), /gallery-piece/);
  assert.equal((await worker.fetch(new Request("https://studio.test/p/gallery-piece"), env)).status, 200);
  await patch(true);
  await env.DB.prepare("UPDATE publications SET hidden=1 WHERE id=?1").bind("pub_gallery").run();
  assert.doesNotMatch(await read(), /gallery-piece/);
  assert.match(await (await worker.fetch(new Request("https://studio.test/p/gallery-piece"), env)).text(), /<meta name="robots" content="noindex">/);
  const addHidden = await worker.fetch(new Request("https://studio.test/api/publications/pub_gallery", { method: "PATCH", headers: { cookie, "content-type": "application/json", origin: "https://studio.test" }, body: JSON.stringify({ listed: true, hidden: false }) }), env);
  assert.equal(addHidden.status, 200);
  assert.match(await read(), /href="\/p\/gallery-piece"/);
  const afterAdd = await env.DB.prepare("SELECT listed,hidden FROM publications WHERE id=?1").bind("pub_gallery").first();
  assert.equal(afterAdd.listed, 1);
  assert.equal(afterAdd.hidden, 0);
  await env.DB.prepare("UPDATE publications SET hidden=0,revoked_at=1 WHERE id=?1").bind("pub_gallery").run();
  assert.doesNotMatch(await read(), /gallery-piece/);
  assert.equal((await worker.fetch(new Request("https://studio.test/p/gallery-piece"), env)).status, 404);
});

test("gallery pagination shows every listed publication without exposing unlisted work", async () => {
  const { env, project } = await setup();
  const image = await addAsset(env, project, { id: "asset_paged", kind: "image" });
  for (let i = 1; i <= 25; i++) await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed) VALUES(?1,?2,?3,?4,?5,'',1,?6,1)")
    .bind(`pub_page_${i}`, project.id, image.id, `page-piece-${i}`, `Piece ${i}`, i).run();
  const first = await (await worker.fetch(new Request("https://studio.test/gallery"), env)).text();
  const second = await (await worker.fetch(new Request("https://studio.test/gallery?page=2"), env)).text();
  assert.match(first, /href="\/gallery\?page=2"/);
  assert.doesNotMatch(first, /href="\/p\/page-piece-1"/);
  assert.match(second, /href="\/p\/page-piece-1\?back=/);
  assert.match(second, /href="\/gallery\?page=1"/);
  assert.doesNotMatch(second, /href="\/p\/page-piece-25"/);
  const unauthenticated = await worker.fetch(new Request("https://studio.test/api/publications/pub_page_1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ listed: false }) }), env);
  assert.equal(unauthenticated.status, 401);
  await env.DB.prepare("UPDATE assets SET deleted_at=1 WHERE id=?1").bind(image.id).run();
  assert.doesNotMatch(await (await worker.fetch(new Request("https://studio.test/gallery"), env)).text(), /page-piece-/);
});

test("empty public home features only configured, active films until the gallery has listed work", async () => {
  const { env, project } = await setup();
  const video = await addAsset(env, project, { id: "asset_featured_film", kind: "video" });
  const image = await addAsset(env, project, { id: "asset_featured_image", kind: "image" });
  for (const [id, slug, hidden, revoked] of [["pub_featured", "featured-film", 0, null], ["pub_featured_hidden", "hidden-film", 1, null], ["pub_featured_revoked", "revoked-film", 0, 1], ["pub_private", "other-film", 0, null]]) {
    await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,hidden,revoked_at) VALUES(?1,?2,?3,?4,?5,'',1,1,?6,?7)").bind(id, project.id, video.id, slug, slug, hidden, revoked).run();
  }
  env.PUBLIC_SHOWCASE_SLUGS = "featured-film,hidden-film,revoked-film";
  const home = async () => (await worker.fetch(new Request("https://studio.test/"), env)).text();
  const fallback = await home();
  assert.match(fallback, /Selected public films/);
  assert.match(fallback, /href="\/p\/featured-film"/);
  assert.doesNotMatch(fallback, /hidden-film|revoked-film|other-film/);
  assert.doesNotMatch(await (await worker.fetch(new Request("https://studio.test/gallery"), env)).text(), /featured-film/);
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed) VALUES(?1,?2,?3,?4,?5,'',1,1,1)").bind("pub_listed", project.id, image.id, "listed-image", "Listed image").run();
  const populated = await home();
  assert.match(populated, /listed-image/);
  assert.doesNotMatch(populated, /Selected public films|featured-film/);
});

test('public gallery filters only listed live work and keeps filters through pagination', async () => {
  const { env, project } = await setup();
  const video = await addAsset(env, project, { id: 'asset_filter_video', kind: 'video' });
  const image = await addAsset(env, project, { id: 'asset_filter_image', kind: 'image' });
  for (let i = 1; i <= 25; i++) await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed) VALUES(?1,?2,?3,?4,?5,'An ocean study',1,?6,1)")
    .bind(`pub_filter_${i}`, project.id, video.id, `filter-film-${i}`, `Ocean film ${i}`, i).run();
  for (const [id, assetId, listed, hidden, revoked] of [['still',image.id,1,0,null],['private',video.id,0,0,null],['hidden',video.id,1,1,null],['withdrawn',video.id,1,0,1]]) {
    await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at) VALUES(?1,?2,?3,?4,'Ocean secret','',1,100,?5,?6,?7)")
      .bind(`pub_${id}`,project.id,assetId,`filter-${id}`,listed,hidden,revoked).run();
  }
  const get = async path => (await worker.fetch(new Request(`https://studio.test${path}`),env)).text();
  const first = await get('/gallery?q=OcEaN&kind=video&order=oldest');
  assert.match(first, /href="\/p\/filter-film-1\?back=/);
  assert.doesNotMatch(first, /href="\/p\/filter-film-25\?back=/);
  assert.doesNotMatch(first, /href="\/p\/filter-(?:still|private|hidden|withdrawn)"/);
  assert.match(first, /href="\/gallery\?q=OcEaN&amp;kind=video&amp;order=oldest&amp;page=2"/);
  const second = await get('/gallery?q=OcEaN&kind=video&order=oldest&page=2');
  assert.match(second, /href="\/p\/filter-film-25\?back=/);
  assert.doesNotMatch(second, /href="\/p\/filter-film-1\?back=/);
  assert.match(await get('/gallery?q=%25&kind=video'), /No published work matches these filters/);
  assert.doesNotMatch(await get('/gallery?q=%3Cscript%3E'), /<script>/);
});
