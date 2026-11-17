// MIT. The chosen-poster derivative: built from the stored still when a film is
// published, served small for first paint, rebuilt on demand, and removed with
// the page or the poster. The full poster stays the share image and download.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { addAsset, jpeg, setup } from "./harness.mjs";
import { storeAssetPreview } from "../src/lib/asset-previews.ts";

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

function posterForm(bytes, { type = "image/jpeg", name = "poster.jpg" } = {}) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return form;
}

/** A 32-byte VP8X WebP header for the given size; enough to read it back. */
function webp(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x20, 0x00, 0x00, 0x00], 4); // size
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16); // chunk size
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

function fakeImages({ output = webp(1024, 768), failure } = {}) {
  return {
    calls: [],
    input(bytes) {
      this.calls.push(bytes);
      return {
        transform: () => ({
          output: () => {
            if (failure) throw failure;
            return { response: () => new Response(output) };
          },
        }),
      };
    },
  };
}

async function owner(env) {
  return "studio_session=" + (await createSession(env, { mode: "owner" }));
}

/** A live image asset whose bytes really exist in the fake R2 bucket. */
async function posterAsset(env, project, { id, width = 1600, height = 1200, sha = "a".repeat(64) } = {}) {
  const asset = await addAsset(env, project, { id, kind: "image" });
  await env.DB.prepare("UPDATE assets SET mime='image/jpeg',width=?2,height=?3,sha256=?4 WHERE id=?1")
    .bind(id, width, height, sha)
    .run();
  await env.MEDIA.put(asset.r2_key, jpeg(width, height), {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { sha256: sha },
  });
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(id).first();
}

async function publishFilm(env, { cookie, assetId, posterId, title = "A film" }) {
  const response = await call(env, `/api/assets/${assetId}/publish`, {
    method: "POST",
    cookie,
    json: { title, ...(posterId ? { posterAssetId: posterId } : {}) },
  });
  assert.equal(response.status, 201);
  return (await response.json()).publication;
}

async function insertThumb(env, project, publicationId, { width = 720, height = 1280 } = {}) {
  const key = `projects/${project.id}/derivatives/${publicationId}/thumb.jpg`;
  const bytes = jpeg(width, height);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare(
    `INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at)
     VALUES(?1,'thumb',?2,'image/jpeg',?3,?4,?5,?6,?7)`,
  )
    .bind(publicationId, key, bytes.byteLength, width, height, "t".repeat(64), Date.now())
    .run();
}

test("publishing a film with a chosen poster builds a page-size WebP and the page paints it before the full poster", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages({ output: webp(1024, 768) });
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 5000 });
  const poster = await posterAsset(env, project, { id: "asset_poster" });

  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id, title: "Poster film" });

  const row = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(row.r2_key, `projects/${project.id}/derivatives/${publication.id}/poster.webp`);
  assert.equal(row.mime, "image/webp");
  assert.equal(row.width, 1024);
  assert.equal(row.height, 768);
  assert.equal(row.bytes, webp(1024, 768).byteLength);
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.equal(row.source_sha256, poster.sha256);
  const object = env.MEDIA.objects.get(row.r2_key);
  assert.deepEqual(object, webp(1024, 768));
  assert.equal(env.MEDIA.meta.get(row.r2_key).httpMetadata.contentType, "image/webp");
  assert.equal(env.MEDIA.meta.get(row.r2_key).customMetadata.source, poster.sha256);

  const served = await call(env, `/p/${publication.path.split("/")[2]}/poster-preview`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/webp");
  assert.equal(served.headers.get("content-length"), String(row.bytes));
  assert.equal(served.headers.get("cache-control"), "public, max-age=60");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.match(served.headers.get("content-security-policy"), /default-src 'self'/);
  const etag = served.headers.get("etag");
  assert.equal(etag, `"${row.sha256.slice(0, 32)}"`);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), webp(1024, 768));

  const cached = await call(env, `/p/${publication.path.split("/")[2]}/poster-preview`, {
    headers: { "if-none-match": etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("etag"), etag);
  const head = await call(env, `/p/${publication.path.split("/")[2]}/poster-preview`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(row.bytes));

  // First paint uses the derivative; the share image and the full poster route
  // keep pointing at the owner's original.
  const slug = publication.path.split("/")[2];
  const html = await (await call(env, `/p/${slug}`)).text();
  assert.match(html, new RegExp(`poster="/p/${slug}/poster-preview"`));
  assert.match(html, new RegExp(`property="og:image" content="https://studio\\.test/p/${slug}/poster"`));
  assert.match(html, /property="og:image:width" content="1600"/);
  assert.doesNotMatch(html, new RegExp(`og:image" content="https://studio\\.test/p/${slug}/poster-preview`));

  const full = await call(env, `/p/${slug}/poster`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), jpeg(1600, 1200));
});

test("without the Images binding publishing still succeeds and the page keeps the full poster", async () => {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const poster = await posterAsset(env, project, { id: "asset_poster" });

  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id });
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal((await call(env, `/p/${publication.path.split("/")[2]}/poster-preview`)).status, 404);
  const html = await (await call(env, publication.path)).text();
  assert.match(html, new RegExp(`poster="/p/${publication.path.split("/")[2]}/poster"`));
  assert.match(html, new RegExp(`og:image" content="https://studio\\.test/p/${publication.path.split("/")[2]}/poster`));
});

test("a film with no chosen poster keeps its stored thumb on both first paint and the share image", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const publication = await publishFilm(env, { cookie, assetId: video.id });
  await insertThumb(env, project, publication.id);
  const slug = publication.path.split("/")[2];

  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 404);
  const html = await (await call(env, `/p/${slug}`)).text();
  assert.match(html, new RegExp(`poster="/p/${slug}/thumb"`));
  assert.match(html, new RegExp(`property="og:image" content="https://studio\\.test/p/${slug}/thumb"`));
});

test("a replaced poster is never served from the old derivative, and the owner can rebuild it in place", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages({ output: webp(1024, 768) });
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const first = await posterAsset(env, project, { id: "asset_poster_a", sha: "a".repeat(64) });
  const second = await posterAsset(env, project, { id: "asset_poster_b", width: 1200, height: 1600, sha: "b".repeat(64) });
  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: first.id });
  const slug = publication.path.split("/")[2];
  const key = `projects/${project.id}/derivatives/${publication.id}/poster.webp`;

  // Point the publication at a different poster without rebuilding: the stale
  // row must not be used or served.
  await env.DB.prepare("UPDATE publications SET poster_asset_id=?2 WHERE id=?1")
    .bind(publication.id, second.id)
    .run();
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 404);
  const stalePage = await (await call(env, `/p/${slug}`)).text();
  assert.match(stalePage, new RegExp(`poster="/p/${slug}/poster"`));

  // The rebuild is owner-only and upload-free.
  assert.equal(
    (await call(env, `/api/studio/publications/${publication.id}/poster-preview`, { method: "POST" })).status,
    401,
  );
  // The real owner experience is the Composer bridge. A bridge session that
  // holds this project may rebuild its own poster preview; a bridge claimed on
  // another project may not.
  const ownBridge = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    workspace: "ws-personal",
    project: project.id,
    actions: ["read", "edit", "publish", "admin"],
  }));
  assert.equal(
    (await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
      method: "POST",
      cookie: ownBridge,
      form: posterForm(jpeg(512, 512)),
    })).status,
    200,
  );
  const otherBridge = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    workspace: "ws-personal",
    project: "prj_other",
    actions: ["read", "edit", "publish", "admin"],
  }));
  assert.equal(
    (await call(env, `/api/studio/publications/${publication.id}/poster-preview`, { method: "POST", cookie: otherBridge })).status,
    403,
  );
  const rebuilt = await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
    method: "POST",
    cookie,
  });
  assert.equal(rebuilt.status, 200);
  const body = await rebuilt.json();
  assert.equal(body.posterPreview.path, `/p/${slug}/poster-preview`);
  assert.equal(body.posterPreview.width, 1024);
  assert.equal(body.posterPreview.height, 768);

  const row = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(row.source_sha256, second.sha256);
  assert.deepEqual(env.MEDIA.objects.get(key), webp(1024, 768));
  const html = await (await call(env, `/p/${slug}`)).text();
  assert.match(html, new RegExp(`poster="/p/${slug}/poster-preview"`));
  assert.match(html, new RegExp(`og:image" content="https://studio\\.test/p/${slug}/poster`));
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 200);

  // A publication with no chosen poster cannot build one from nothing.
  const bare = await publishFilm(env, { cookie, assetId: video.id });
  const bareRebuild = await call(env, `/api/studio/publications/${bare.id}/poster-preview`, {
    method: "POST",
    cookie,
  });
  assert.equal(bareRebuild.status, 404);
});

test("withdrawing a page or deleting its poster removes the poster derivative row and bytes", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const poster = await posterAsset(env, project, { id: "asset_poster" });
  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id });
  const slug = publication.path.split("/")[2];
  const key = `projects/${project.id}/derivatives/${publication.id}/poster.webp`;
  assert.ok(env.MEDIA.objects.has(key));

  assert.equal((await call(env, `/api/publications/${publication.id}`, { method: "DELETE", cookie })).status, 200);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal(env.MEDIA.objects.has(key), false);
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 404);
  assert.equal((await call(env, `/p/${slug}`)).status, 404);

  // Deleting the poster itself withdraws the page and cleans every kind.
  const second = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id, title: "Second" });
  await insertThumb(env, project, second.id);
  const secondSlug = second.path.split("/")[2];
  assert.equal((await call(env, `/p/${secondSlug}/poster-preview`)).status, 200);
  assert.equal((await call(env, `/p/${secondSlug}/thumb`)).status, 200);
  assert.equal((await call(env, `/api/assets/${poster.id}`, { method: "DELETE", cookie })).status, 200);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal((await call(env, `/p/${secondSlug}/poster-preview`)).status, 404);
  assert.equal((await call(env, `/p/${secondSlug}/thumb`)).status, 404);
  assert.equal((await call(env, `/p/${secondSlug}`)).status, 404);
});

test("the poster backfill is owner-only, bounded, idempotent and skips pages that already match", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const one = await posterAsset(env, project, { id: "asset_poster_one", sha: "1".repeat(64) });
  const two = await posterAsset(env, project, { id: "asset_poster_two", sha: "2".repeat(64) });
  const first = await publishFilm(env, { cookie, assetId: video.id, posterId: one.id });
  const second = await publishFilm(env, { cookie, assetId: video.id, posterId: two.id });
  await env.DB.prepare("DELETE FROM publication_derivatives").run();

  assert.equal((await call(env, "/api/studio/previews/backfill", { method: "POST" })).status, 401);
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "posters", limit: 0 } })).status,
    400,
  );
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "posters", limit: 21 } })).status,
    400,
  );
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "other", limit: 5 } })).status,
    400,
  );

  const firstRun = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "posters", limit: 1 },
  });
  assert.equal(firstRun.status, 200);
  assert.deepEqual(await firstRun.json(), { kind: "posters", processed: 1, remaining: 1, failed: 0 });
  const secondRun = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "posters", limit: 1 },
  });
  assert.deepEqual(await secondRun.json(), { kind: "posters", processed: 1, remaining: 0, failed: 0 });
  const again = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "posters", limit: 20 },
  });
  assert.deepEqual(await again.json(), { kind: "posters", processed: 0, remaining: 0, failed: 0 });

  const rows = await env.DB.prepare("SELECT * FROM publication_derivatives WHERE kind='poster' ORDER BY publication_id").all();
  assert.equal(rows.results.length, 2);
  const byPublication = new Map(rows.results.map((row) => [row.publication_id, row]));
  assert.equal(byPublication.get(first.id).source_sha256, one.sha256);
  assert.equal(byPublication.get(second.id).source_sha256, two.sha256);
  assert.ok(env.MEDIA.objects.has(byPublication.get(first.id).r2_key));
  assert.ok(env.MEDIA.objects.has(byPublication.get(second.id).r2_key));
});

test("the derivatives table keeps thumb rows and rejects an unknown kind", async () => {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const publication = await publishFilm(env, { cookie, assetId: video.id });
  await insertThumb(env, project, publication.id);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_derivatives WHERE kind='thumb'").first()).n,
    1,
  );
  await assert.rejects(
    env.DB.prepare(
      `INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,sha256,created_at)
       VALUES(?1,'other','k','image/webp',1,'x',1)`,
    )
      .bind(publication.id)
      .run(),
  );
});

test("an owner upload stores the browser's poster preview against the chosen poster's own hash", async () => {
  const { env, project } = await setup();
  // No Images binding: on this account the owner's canvas is the only path.
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const poster = await posterAsset(env, project, { id: "asset_poster", sha: "a".repeat(64) });
  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id });
  const slug = publication.path.split("/")[2];
  const key = `projects/${project.id}/derivatives/${publication.id}/poster.webp`;
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 404);

  const bytes = jpeg(1024, 768);
  const uploaded = await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
    method: "POST",
    cookie,
    form: posterForm(bytes),
  });
  assert.equal(uploaded.status, 200);
  const body = await uploaded.json();
  assert.equal(body.posterPreview.path, `/p/${slug}/poster-preview`);
  assert.equal(body.posterPreview.bytes, bytes.byteLength);
  assert.equal(body.posterPreview.width, 1024);
  assert.equal(body.posterPreview.height, 768);

  const row = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(row.r2_key, key);
  assert.equal(row.mime, "image/jpeg");
  assert.equal(row.width, 1024);
  assert.equal(row.height, 768);
  assert.equal(row.bytes, bytes.byteLength);
  assert.equal(row.source_sha256, poster.sha256);
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.equal(env.MEDIA.meta.get(key).customMetadata.source, poster.sha256);
  assert.equal(env.MEDIA.meta.get(key).httpMetadata.contentType, "image/jpeg");
  assert.deepEqual(env.MEDIA.objects.get(key), bytes);

  const served = await call(env, `/p/${slug}/poster-preview`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.equal(served.headers.get("etag"), `"${row.sha256.slice(0, 32)}"`);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);

  // The film page paints the upload; the share image and full poster stay the
  // owner's original artwork.
  const html = await (await call(env, `/p/${slug}`)).text();
  assert.match(html, new RegExp(`poster="/p/${slug}/poster-preview"`));
  assert.match(html, new RegExp(`property="og:image" content="https://studio\\.test/p/${slug}/poster"`));
  const full = await call(env, `/p/${slug}/poster`);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), jpeg(1600, 1200));

  const projectState = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.equal(projectState.publications.find((item) => item.id === publication.id).hasPosterPreview, true);

  // A later upload replaces the same row and key rather than accumulating.
  const replacement = jpeg(768, 1024);
  const replaced = await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
    method: "POST",
    cookie,
    form: posterForm(replacement),
  });
  assert.equal(replaced.status, 200);
  const reRow = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(reRow.r2_key, key);
  assert.equal(reRow.width, 768);
  assert.equal(reRow.height, 1024);
  assert.equal(reRow.bytes, replacement.byteLength);
  assert.equal(reRow.source_sha256, poster.sha256);
  assert.deepEqual(env.MEDIA.objects.get(key), replacement);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM publication_derivatives WHERE publication_id=?1").bind(publication.id).first()).n,
    1,
  );

  // Sending the same capture twice changes nothing.
  const again = await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
    method: "POST",
    cookie,
    form: posterForm(replacement),
  });
  assert.equal(again.status, 200);
  const settled = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(settled.sha256, reRow.sha256);
  assert.equal(settled.created_at >= reRow.created_at, true);
});

test("a poster preview upload refuses non-images, over-edge stills and oversized bytes, and leaves the thumb bound alone", async () => {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const poster = await posterAsset(env, project, { id: "asset_poster" });
  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id });
  const path = `/api/studio/publications/${publication.id}/poster-preview`;
  const upload = (bytes, options) =>
    call(env, path, { method: "POST", cookie, form: posterForm(bytes, options) });
  const rows = () =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM publication_derivatives").first().then((row) => row.n);

  assert.equal((await upload(new TextEncoder().encode("not an image"), { type: "image/jpeg" })).status, 415);
  assert.equal((await upload(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).status, 415);
  const over = await upload(jpeg(1025, 400));
  assert.equal(over.status, 400);
  assert.equal((await over.json()).error.code, "invalid_dimensions");
  assert.equal(await rows(), 0);

  // 1024 on the long edge is the poster bound, even when the page is a film.
  assert.equal((await upload(jpeg(1024, 1024))).status, 200);

  const oversize = new Uint8Array(MAX + 1);
  oversize.set([0xff, 0xd8, 0xff], 0);
  const tooLarge = await upload(oversize);
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "too_large");

  // The gallery thumb still stops at 800, so the poster bound did not loosen it.
  const thumb = (bytes) =>
    call(env, `/api/publications/${publication.id}/derivative`, {
      method: "POST",
      cookie,
      form: posterForm(bytes, { name: "thumb.jpg" }),
    });
  assert.equal((await thumb(jpeg(801, 400))).status, 400);
  assert.equal((await thumb(jpeg(800, 400))).status, 200);
  assert.equal(await rows(), 2);
});

test("a poster preview belongs to one publication and only the owner session can write it", async () => {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const one = await posterAsset(env, project, { id: "asset_poster_one", sha: "1".repeat(64) });
  const two = await posterAsset(env, project, { id: "asset_poster_two", sha: "2".repeat(64) });
  const first = await publishFilm(env, { cookie, assetId: video.id, posterId: one.id, title: "First" });
  const second = await publishFilm(env, { cookie, assetId: video.id, posterId: two.id, title: "Second" });
  const firstSlug = first.path.split("/")[2];
  const secondSlug = second.path.split("/")[2];

  // Uploading bytes for one page records that page's own poster hash and never
  // creates a row for its sibling.
  const uploaded = await call(env, `/api/studio/publications/${first.id}/poster-preview`, {
    method: "POST",
    cookie,
    form: posterForm(jpeg(512, 512)),
  });
  assert.equal(uploaded.status, 200);
  assert.equal(
    (await env.DB.prepare("SELECT source_sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'").bind(first.id).first())
      .source_sha256,
    one.sha256,
  );
  assert.equal(
    await env.DB.prepare("SELECT publication_id FROM publication_derivatives WHERE publication_id=?1").bind(second.id).first(),
    null,
  );
  assert.equal((await call(env, `/p/${secondSlug}/poster-preview`)).status, 404);
  assert.equal((await call(env, `/p/${firstSlug}/poster-preview`)).status, 200);

  // A project-scoped bridge may write its own page's preview; a bridge claimed
  // on another project, or a session without a grant, may not.
  const ownBridge = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    workspace: "ws-personal",
    project: project.id,
    actions: ["read", "edit", "publish", "admin"],
  }));
  assert.equal(
    (await call(env, `/api/studio/publications/${first.id}/poster-preview`, {
      method: "POST",
      cookie: ownBridge,
      form: posterForm(jpeg(512, 512)),
    })).status,
    200,
  );
  for (const session of [
    { mode: "bridge", actor: "member", workspace: "ws-personal", project: "prj_other", actions: ["read", "publish"] },
  ]) {
    const bridge = "studio_session=" + (await createSession(env, session));
    assert.equal(
      (await call(env, `/api/studio/publications/${first.id}/poster-preview`, {
        method: "POST",
        cookie: bridge,
        form: posterForm(jpeg(512, 512)),
      })).status,
      403,
    );
  }
  assert.equal(
    (await call(env, `/api/studio/publications/${first.id}/poster-preview`, {
      method: "POST",
      form: posterForm(jpeg(512, 512)),
    })).status,
    401,
  );

  // A withdrawn page accepts no new capture.
  await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE id=?1").bind(second.id, Date.now()).run();
  assert.equal(
    (await call(env, `/api/studio/publications/${second.id}/poster-preview`, {
      method: "POST",
      cookie,
      form: posterForm(jpeg(512, 512)),
    })).status,
    404,
  );
});

test("withdrawing a page removes its uploaded poster preview row and bytes", async () => {
  const { env, project } = await setup();
  const cookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  const poster = await posterAsset(env, project, { id: "asset_poster" });
  const publication = await publishFilm(env, { cookie, assetId: video.id, posterId: poster.id });
  const slug = publication.path.split("/")[2];
  const key = `projects/${project.id}/derivatives/${publication.id}/poster.webp`;
  assert.equal(
    (await call(env, `/api/studio/publications/${publication.id}/poster-preview`, {
      method: "POST",
      cookie,
      form: posterForm(jpeg(900, 600)),
    })).status,
    200,
  );
  assert.ok(env.MEDIA.objects.has(key));
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 200);

  assert.equal((await call(env, `/api/publications/${publication.id}`, { method: "DELETE", cookie })).status, 200);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
  assert.equal(env.MEDIA.objects.has(key), false);
  assert.equal((await call(env, `/p/${slug}/poster-preview`)).status, 404);
  assert.equal((await call(env, `/p/${slug}`)).status, 404);
});

test("a bridged owner keeps their own previews and still cannot run installation-wide work", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages({ output: webp(1024, 768) });
  const ownerCookie = await owner(env);
  const video = await addAsset(env, project, { id: "asset_bridge_video", kind: "video", durationMs: 4000 });
  const poster = await posterAsset(env, project, { id: "asset_bridge_poster", sha: "9".repeat(64) });
  const publication = await publishFilm(env, { cookie: ownerCookie, assetId: video.id, posterId: poster.id, title: "Bridged film" });

  // The real owner experience is the Composer bridge, not the standalone passphrase.
  const bridge = "studio_session=" + (await createSession(env, { mode: "bridge", actor: "dean", workspace: "ws_bridge", actions: ["read", "edit", "publish", "admin"] }));

  const form = new FormData();
  form.set("file", new File([webp(1024, 768)], "poster.webp", { type: "image/webp" }));
  const uploaded = await worker.fetch(
    new Request(base + `/api/studio/publications/${publication.id}/poster-preview`, {
      method: "POST",
      headers: { cookie: bridge },
      body: form,
    }),
    env,
  );
  assert.equal(uploaded.status, 200);
  const body = await uploaded.json();
  assert.equal(body.posterPreview.width, 1024);
  const storedRow = await env.DB.prepare(
    "SELECT source_sha256,mime FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  assert.equal(storedRow.source_sha256, poster.sha256);
  assert.equal(storedRow.mime, "image/webp");

  // The private library preview is project-scoped too: a bridge owner must see
  // their own small still instead of falling back to the original.
  const posterRow = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(poster.id).first();
  await storeAssetPreview(env, posterRow);
  const preview = await worker.fetch(
    new Request(base + `/api/studio/assets/${poster.id}/preview`, { headers: { cookie: bridge } }),
    env,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), "private, max-age=0, no-store");

  // Installation-wide work stays standalone-owner only.
  const backfill = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie: bridge,
    json: { kind: "posters", limit: 5 },
  });
  assert.equal(backfill.status, 403);
});
