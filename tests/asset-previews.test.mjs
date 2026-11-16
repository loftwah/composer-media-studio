// MIT. Private library previews: owner-only serving, bounded idempotent
// backfill, stale-source handling and erasure with the asset.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { addAsset, jpeg, setup } from "./harness.mjs";

const base = "https://studio.test";

function call(env, path, { method = "GET", cookie, json } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) } };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  return worker.fetch(new Request(base + path, init), env);
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

function fakeImages({ output = webp(1024, 768) } = {}) {
  return {
    calls: [],
    input(bytes) {
      this.calls.push(bytes);
      return {
        transform: () => ({
          output: () => ({ response: () => new Response(output) }),
        }),
      };
    },
  };
}

async function owner(env) {
  return "studio_session=" + (await createSession(env, { mode: "owner" }));
}

async function imageAsset(env, project, { id, width = 1600, height = 1200, sha = "a".repeat(64) }) {
  const asset = await addAsset(env, project, { id, kind: "image" });
  await env.DB.prepare("UPDATE assets SET mime='image/jpeg',width=?2,height=?3,sha256=?4 WHERE id=?1")
    .bind(id, width, height, sha)
    .run();
  await env.MEDIA.put(asset.r2_key, jpeg(width, height), { httpMetadata: { contentType: "image/jpeg" } });
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(id).first();
}

test("a library preview is owner-only, never public and only served once it exists", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const asset = await imageAsset(env, project, { id: "asset_image" });

  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`)).status, 401);
  const bridge = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    workspace: "ws-personal",
    project: project.id,
    actions: ["read", "edit", "generate", "publish", "admin"],
  }));
  // The owner's real session is the Composer handoff. It is project-scoped, so
  // it is not refused: before a preview exists it simply has nothing to serve.
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie: bridge })).status, 404);
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie })).status, 404);
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie, method: "POST" })).status, 405);

  // The public surface has no route that resolves these bytes.
  assert.equal((await call(env, `/assets/${asset.id}/preview`)).status, 404);
  assert.equal((await call(env, `/p/${asset.id}/preview`)).status, 404);

  const backfill = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "assets", limit: 5 },
  });
  assert.equal(backfill.status, 200);
  assert.deepEqual(await backfill.json(), { kind: "assets", processed: 1, remaining: 0, failed: 0 });

  const row = await env.DB.prepare("SELECT * FROM asset_previews WHERE asset_id=?1").bind(asset.id).first();
  assert.equal(row.project_id, project.id);
  assert.equal(row.r2_key, `projects/${project.id}/asset-previews/${asset.id}.webp`);
  assert.equal(row.mime, "image/webp");
  assert.equal(row.bytes, webp(1024, 768).byteLength);
  assert.equal(row.width, 1024);
  assert.equal(row.height, 768);
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.equal(row.source_sha256, asset.sha256);
  assert.deepEqual(env.MEDIA.objects.get(row.r2_key), webp(1024, 768));
  assert.equal(env.MEDIA.meta.get(row.r2_key).customMetadata.source, asset.sha256);

  const served = await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie });
  assert.equal(served.status, 200);
  // The bridged owner sees the same private preview, because the library grid
  // they actually use is the bridged session.
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie: bridge })).status, 200);
  assert.equal(served.headers.get("content-type"), "image/webp");
  assert.equal(served.headers.get("content-length"), String(row.bytes));
  assert.equal(served.headers.get("cache-control"), "private, max-age=0, no-store");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal(served.headers.get("etag"), `"${row.sha256.slice(0, 32)}"`);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), webp(1024, 768));
  const head = await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie, method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(row.bytes));

  // The project read tells the library which stills already have a preview.
  const state = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.equal(state.assets.find((item) => item.id === asset.id).hasPreview, true);

  // A repeated backfill does no work and never rewrites the row.
  const again = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "assets", limit: 5 },
  });
  assert.deepEqual(await again.json(), { kind: "assets", processed: 0, remaining: 0, failed: 0 });
  const after = await env.DB.prepare("SELECT created_at FROM asset_previews WHERE asset_id=?1").bind(asset.id).first();
  assert.equal(after.created_at, row.created_at);
});

test("the backfill is bounded, skips non-stills and stops at zero", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  await imageAsset(env, project, { id: "asset_one", sha: "1".repeat(64) });
  await imageAsset(env, project, { id: "asset_two", sha: "2".repeat(64) });
  await imageAsset(env, project, { id: "asset_three", sha: "3".repeat(64) });
  await addAsset(env, project, { id: "asset_video", kind: "video", durationMs: 3000 });
  await addAsset(env, project, { id: "asset_audio", kind: "audio", durationMs: 3000 });

  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets", limit: 0 } })).status,
    400,
  );
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets", limit: 21 } })).status,
    400,
  );
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets", limit: 1.5 } })).status,
    400,
  );
  assert.equal(
    (await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "nope" } })).status,
    400,
  );

  const first = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "assets", limit: 1 },
  });
  assert.deepEqual(await first.json(), { kind: "assets", processed: 1, remaining: 2, failed: 0 });
  const second = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "assets", limit: 1 },
  });
  assert.deepEqual(await second.json(), { kind: "assets", processed: 1, remaining: 1, failed: 0 });

  // The default limit is 10, so the last row plus nothing else.
  const third = await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets" } });
  assert.deepEqual(await third.json(), { kind: "assets", processed: 1, remaining: 0, failed: 0 });
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM asset_previews").first()).n,
    3,
  );

  // A non-still never gains a preview, even when named directly.
  const video = await env.DB.prepare("SELECT id FROM assets WHERE id='asset_video'").first();
  assert.equal((await call(env, `/api/studio/assets/${video.id}/preview`, { cookie })).status, 404);
});

test("changing an asset's source bytes invalidates its preview until a backfill rebuilds it", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const asset = await imageAsset(env, project, { id: "asset_image", sha: "a".repeat(64) });
  await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets" } });
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie })).status, 200);

  await env.DB.prepare("UPDATE assets SET sha256=?2 WHERE id=?1").bind(asset.id, "b".repeat(64)).run();
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie })).status, 404);
  const state = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.equal(state.assets.find((item) => item.id === asset.id).hasPreview, false);

  const rebuilt = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "assets", limit: 1 },
  });
  assert.deepEqual(await rebuilt.json(), { kind: "assets", processed: 1, remaining: 0, failed: 0 });
  const row = await env.DB.prepare("SELECT source_sha256 FROM asset_previews WHERE asset_id=?1").bind(asset.id).first();
  assert.equal(row.source_sha256, "b".repeat(64));
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie })).status, 200);
});

test("another project's asset is never served to a project-scoped session", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',1,1)",
  ).run();
  const otherProject = { id: "prj_other" };
  const foreign = await imageAsset(env, otherProject, { id: "asset_foreign", sha: "f".repeat(64) });
  await imageAsset(env, project, { id: "asset_own", sha: "o".repeat(64) });
  await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets" } });
  assert.equal((await call(env, `/api/studio/assets/${foreign.id}/preview`, { cookie })).status, 200);

  // A workspace member whose link names this project cannot reach the other
  // project's preview at all, even with every action granted.
  const scoped = "studio_session=" + (await createSession(env, {
    mode: "bridge",
    workspace: "ws-personal",
    project: project.id,
    actions: ["read", "edit", "generate", "publish", "admin"],
  }));
  const refused = await call(env, `/api/studio/assets/${foreign.id}/preview`, { cookie: scoped });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, "forbidden");

  // The project read does not name the foreign preview either.
  const state = await (await call(env, `/api/projects/${project.id}`, { cookie })).json();
  assert.deepEqual(state.assets.map((item) => item.id), ["asset_own"]);
});

test("deleting an asset removes its preview row and bytes in the same erasure step", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const cookie = await owner(env);
  const asset = await imageAsset(env, project, { id: "asset_image" });
  await call(env, "/api/studio/previews/backfill", { method: "POST", cookie, json: { kind: "assets" } });
  const key = (await env.DB.prepare("SELECT r2_key FROM asset_previews WHERE asset_id=?1").bind(asset.id).first()).r2_key;
  assert.ok(env.MEDIA.objects.has(key));

  assert.equal((await call(env, `/api/assets/${asset.id}`, { method: "DELETE", cookie })).status, 200);
  assert.equal(await env.DB.prepare("SELECT asset_id FROM asset_previews").first(), null);
  assert.equal(env.MEDIA.objects.has(key), false);
  assert.equal((await call(env, `/api/studio/assets/${asset.id}/preview`, { cookie })).status, 404);
  assert.equal((await call(env, `/api/studio/assets/asset_missing/preview`, { cookie })).status, 404);
});
