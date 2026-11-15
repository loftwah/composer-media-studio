// MIT. Fast public gallery previews: validated owner uploads, public serving,
// withdrawal cleanup and the gallery's fallback order.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { addAsset, jpeg, PNG_1x1, setup } from "./harness.mjs";

const base = "https://studio.test";
const MAX = 1024 * 1024;

function call(env, path, { method = "GET", cookie, json, form, headers = {} } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  } else if (form !== undefined) {
    init.body = form;
  }
  return worker.fetch(new Request(base + path, init), env);
}

function previewForm(bytes, { type = "image/jpeg", name = "thumb.jpg" } = {}) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return form;
}

async function owner(env) {
  return "studio_session=" + (await createSession(env, { mode: "owner" }));
}

async function publish(env, project, { id, assetId, slug, posterAssetId = null, listed = 1, revokedAt = null }) {
  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,revoked_at,listed,hidden)
     VALUES(?1,?2,?3,?4,?5,?6,'A public page',1,?7,?8,?9,0)`,
  )
    .bind(id, project.id, assetId, posterAssetId, slug, `Page ${slug}`, Date.now(), revokedAt, listed)
    .run();
}

async function insertDerivative(env, project, publicationId, { width = 720, height = 480, bytes = jpeg(width, height) } = {}) {
  const key = `projects/${project.id}/derivatives/${publicationId}/thumb.jpg`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { sha256: "a".repeat(64) },
  });
  await env.DB.prepare(
    `INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at)
     VALUES(?1,'thumb',?2,'image/jpeg',?3,?4,?5,?6,?7)`,
  )
    .bind(publicationId, key, bytes.byteLength, width, height, "a".repeat(64), Date.now())
    .run();
  return key;
}

async function fixture() {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const image = await addAsset(env, project, { id: "asset_image", kind: "image" });
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const audio = await addAsset(env, project, { id: "asset_audio", kind: "audio", durationMs: 3000 });
  const poster = await addAsset(env, project, { id: "asset_poster", kind: "image" });
  return { env, project, cookie, image, video, audio, poster };
}

test("an owner uploads one preview, replaces it in place and the public route serves it with an ETag", async () => {
  const { env, project, cookie, image } = await fixture();
  await publish(env, project, { id: "pub_image", assetId: image.id, slug: "public-still" });
  const bytes = jpeg(720, 480);

  const response = await call(env, "/api/publications/pub_image/derivative", {
    method: "POST",
    cookie,
    form: previewForm(bytes),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    thumb: { path: "/p/public-still/thumb", bytes: bytes.byteLength, width: 720, height: 480 },
  });

  const row = await env.DB.prepare("SELECT * FROM publication_derivatives WHERE publication_id='pub_image'").first();
  assert.equal(row.kind, "thumb");
  assert.equal(row.r2_key, `projects/${project.id}/derivatives/pub_image/thumb.jpg`);
  assert.equal(row.mime, "image/jpeg");
  assert.equal(row.bytes, bytes.byteLength);
  assert.equal(row.width, 720);
  assert.equal(row.height, 480);
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  const metadata = env.MEDIA.meta.get(row.r2_key);
  assert.equal(metadata.httpMetadata.contentType, "image/jpeg");
  assert.equal(metadata.customMetadata.sha256, row.sha256);

  const served = await call(env, "/p/public-still/thumb");
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.equal(served.headers.get("content-length"), String(bytes.byteLength));
  assert.equal(served.headers.get("cache-control"), "public, max-age=60");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.match(served.headers.get("content-security-policy"), /default-src 'self'/);
  const etag = served.headers.get("etag");
  assert.equal(etag, `"${row.sha256.slice(0, 32)}"`);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);

  const cached = await call(env, "/p/public-still/thumb", { headers: { "if-none-match": etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("etag"), etag);
  const head = await call(env, "/p/public-still/thumb", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.byteLength));

  const projectState = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.equal(projectState.publications.find((item) => item.id === "pub_image").hasThumb, true);

  // Replacing a JPEG with a PNG writes a new key, keeps one row and removes the
  // old object, so a re-run cannot accumulate derivatives.
  const replaced = await call(env, "/api/publications/pub_image/derivative", {
    method: "POST",
    cookie,
    form: previewForm(PNG_1x1, { type: "image/png", name: "thumb.png" }),
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(await replaced.json(), {
    thumb: { path: "/p/public-still/thumb", bytes: PNG_1x1.byteLength, width: 1, height: 1 },
  });
  const rows = await env.DB.prepare(
    "SELECT r2_key,mime FROM publication_derivatives WHERE publication_id='pub_image'",
  ).all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].mime, "image/png");
  assert.equal(rows.results[0].r2_key, `projects/${project.id}/derivatives/pub_image/thumb.png`);
  assert.equal(env.MEDIA.objects.has(`projects/${project.id}/derivatives/pub_image/thumb.jpg`), false);
  const png = await call(env, "/p/public-still/thumb");
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await png.arrayBuffer()), PNG_1x1);

  // A re-run of the backfill sends the same bytes again; the row is replaced,
  // never duplicated, and the page keeps one preview.
  const again = await call(env, "/api/publications/pub_image/derivative", {
    method: "POST",
    cookie,
    form: previewForm(PNG_1x1, { type: "image/png", name: "thumb.png" }),
  });
  assert.equal(again.status, 200);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_derivatives WHERE publication_id='pub_image'").first()).n,
    1,
  );
  const projectAgain = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.equal(projectAgain.publications.find((item) => item.id === "pub_image").hasThumb, true);
});

test("uploads refuse other projects, read-only links, non-images, audio pages and oversized or over-edge previews", async () => {
  const { env, project, cookie, image, audio } = await fixture();
  await publish(env, project, { id: "pub_image", assetId: image.id, slug: "public-still" });
  await publish(env, project, { id: "pub_audio", assetId: audio.id, slug: "public-sound" });
  const upload = (cookieValue, bytes, options) =>
    call(env, "/api/publications/pub_image/derivative", {
      method: "POST",
      cookie: cookieValue,
      form: previewForm(bytes, options),
    });

  assert.equal((await upload(undefined, jpeg(720, 480))).status, 401);
  const reader = "studio_session=" + (await createSession(env, { mode: "bridge", workspace: "ws-personal", project: project.id, actions: ["read"] }));
  assert.equal((await upload(reader, jpeg(720, 480))).status, 403);
  const otherProject = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    actor: "member",
    workspace: "ws-personal",
    project: "prj_other",
    actions: ["read", "publish"],
  }));
  assert.equal((await upload(otherProject, jpeg(720, 480))).status, 403);

  assert.equal((await upload(cookie, new TextEncoder().encode("not an image"), { type: "image/jpeg" })).status, 415);
  assert.equal((await upload(cookie, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).status, 415);
  assert.equal((await upload(cookie, jpeg(801, 400))).status, 400);
  const oversize = new Uint8Array(MAX + 1);
  oversize.set([0xff, 0xd8, 0xff], 0);
  const tooLarge = await upload(cookie, oversize);
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "too_large");

  const audioUpload = await call(env, "/api/publications/pub_audio/derivative", {
    method: "POST",
    cookie,
    form: previewForm(jpeg(720, 480)),
  });
  assert.equal(audioUpload.status, 415);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_derivatives").first()).n, 0);

  // Only live publications with a live parent asset accept a preview.
  await env.DB.prepare("UPDATE publications SET revoked_at=1 WHERE id='pub_image'").run();
  assert.equal((await upload(cookie, jpeg(720, 480))).status, 404);
  assert.equal((await call(env, "/p/public-still/thumb")).status, 404);
});

test("a published film with no chosen poster still shares its stored preview", async () => {
  const { env, project, video, poster, image } = await fixture();
  await publish(env, project, { id: "pub_video", assetId: video.id, slug: "public-film" });
  await insertDerivative(env, project, "pub_video", { width: 720, height: 1280 });
  const page = await call(env, "/p/public-film");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /poster="\/p\/public-film\/thumb"/);
  assert.match(html, /property="og:image" content="https:\/\/studio\.test\/p\/public-film\/thumb"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.match(html, /property="og:image:width" content="720"/);
  assert.match(html, /property="og:image:height" content="1280"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:video" content="https:\/\/studio\.test\/p\/public-film\/media"/);
  assert.equal((await call(env, "/p/public-film/thumb")).status, 200);

  // A chosen image poster still wins over the gallery preview.
  await publish(env, project, { id: "pub_poster", assetId: video.id, posterAssetId: poster.id, slug: "public-film-poster" });
  await insertDerivative(env, project, "pub_poster", { width: 720, height: 480 });
  const withPoster = await (await call(env, "/p/public-film-poster")).text();
  assert.match(withPoster, /poster="\/p\/public-film-poster\/poster"/);
  assert.match(withPoster, /property="og:image" content="https:\/\/studio\.test\/p\/public-film-poster\/poster"/);
  assert.match(withPoster, /property="og:image:width" content="\d+"/);

  // An image publication still shares the image itself.
  await publish(env, project, { id: "pub_image_page", assetId: image.id, slug: "public-still" });
  const still = await (await call(env, "/p/public-still")).text();
  assert.match(still, /property="og:image" content="https:\/\/studio\.test\/p\/public-still\/media"/);
});

test("withdrawal and asset deletion stop the preview immediately and remove its bytes", async () => {
  const { env, project, cookie, image } = await fixture();
  await publish(env, project, { id: "pub_image", assetId: image.id, slug: "public-still" });
  const first = await call(env, "/api/publications/pub_image/derivative", {
    method: "POST",
    cookie,
    form: previewForm(jpeg(720, 480)),
  });
  assert.equal(first.status, 200);
  const key = (await env.DB.prepare("SELECT r2_key FROM publication_derivatives WHERE publication_id='pub_image'").first()).r2_key;
  assert.equal((await call(env, "/p/public-still/thumb")).status, 200);

  assert.equal((await call(env, "/api/publications/pub_image", { method: "DELETE", cookie })).status, 200);
  assert.equal((await call(env, "/p/public-still/thumb")).status, 404);
  assert.equal((await call(env, "/p/public-still")).status, 404);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal(env.MEDIA.objects.has(key), false);

  await publish(env, project, { id: "pub_deleted", assetId: image.id, slug: "deleted-still" });
  const second = await call(env, "/api/publications/pub_deleted/derivative", {
    method: "POST",
    cookie,
    form: previewForm(jpeg(640, 480)),
  });
  assert.equal(second.status, 200);
  const deletedKey = (await env.DB.prepare("SELECT r2_key FROM publication_derivatives WHERE publication_id='pub_deleted'").first()).r2_key;
  assert.equal((await call(env, `/api/assets/${image.id}`, { method: "DELETE", cookie })).status, 200);
  assert.equal((await call(env, "/p/deleted-still/thumb")).status, 404);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal(env.MEDIA.objects.has(deletedKey), false);
});

test("gallery cards prefer a stored preview, then the original, then a poster, then a placeholder", async () => {
  const { env, project, image, video, poster } = await fixture();
  const extraImage = await addAsset(env, project, { id: "asset_plain", kind: "image" });
  await publish(env, project, { id: "pub_thumb_image", assetId: image.id, slug: "thumb_image" });
  await publish(env, project, { id: "pub_plain_image", assetId: extraImage.id, slug: "plain_image" });
  await publish(env, project, { id: "pub_thumb_video", assetId: video.id, posterAssetId: poster.id, slug: "thumb_video" });
  await publish(env, project, { id: "pub_poster_video", assetId: video.id, posterAssetId: poster.id, slug: "poster_video" });
  await publish(env, project, { id: "pub_plain_video", assetId: video.id, slug: "plain_video" });
  await insertDerivative(env, project, "pub_thumb_image", { width: 720, height: 480 });
  await insertDerivative(env, project, "pub_thumb_video", { width: 720, height: 405 });

  const response = await call(env, "/gallery");
  assert.equal(response.status, 200);
  const html = await response.text();
  const card = (slug) => {
    const match = html.match(new RegExp(`<li><a class="gallery-card" href="/p/${slug}[^"]*">[\\s\\S]*?</a></li>`));
    assert.ok(match, `missing card for ${slug}`);
    return match[0];
  };

  const thumbImage = card("thumb_image");
  assert.match(thumbImage, /src="\/p\/thumb_image\/thumb" alt="" width="720" height="480" loading="lazy" decoding="async"/);
  assert.doesNotMatch(thumbImage, /\/p\/thumb_image\/media"/);

  const plainImage = card("plain_image");
  assert.match(plainImage, /src="\/p\/plain_image\/media" alt="" width="1280" height="720" loading="lazy"/);

  const thumbVideo = card("thumb_video");
  assert.match(thumbVideo, /src="\/p\/thumb_video\/thumb" alt="" width="720" height="405"/);
  assert.doesNotMatch(thumbVideo, /\/p\/thumb_video\/poster"/);

  assert.match(card("poster_video"), /src="\/p\/poster_video\/poster" alt="" width="1280" height="720" loading="lazy"/);
  assert.match(card("plain_video"), /class="gallery-placeholder"/);
  assert.doesNotMatch(card("plain_video"), /<img/);
  assert.equal((await call(env, "/p/plain_image/thumb")).status, 404);
});

test("the home hero and home query use a stored preview when one exists", async () => {
  const { env, project, image } = await fixture();
  await publish(env, project, { id: "pub_home", assetId: image.id, slug: "home_still" });
  await insertDerivative(env, project, "pub_home", { width: 720, height: 480 });
  const response = await call(env, "/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /class="gallery-hero-art" href="\/p\/home_still"><img src="\/p\/home_still\/thumb" alt="" width="720" height="480" decoding="async" fetchpriority="high"/);
});
