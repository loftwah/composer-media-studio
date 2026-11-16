// MIT. The scheduled preview sweep: work that was published or uploaded before
// renditions existed must stop serving its originals without an owner click.
// Posters go first because they are the public first paint.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { addAsset, jpeg, setup } from "./harness.mjs";

const base = "https://studio.test";

function webp(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x20, 0x00, 0x00, 0x00], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

function fakeImages(output = webp(1024, 768)) {
  return {
    input() {
      return { transform: () => ({ output: () => ({ response: () => new Response(output) }) }) };
    },
  };
}

/** Run one scheduled tick and wait for everything it asked to finish. */
async function tick(env) {
  const pending = [];
  await worker.scheduled(null, env, { waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
}

async function imageAsset(env, project, { id, width = 1600, height = 1200, sha }) {
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

async function insertPublication(env, project, { id, assetId, posterId, slug }) {
  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,revoked_at,listed,hidden)
     VALUES(?1,?2,?3,?4,?5,?6,'A public page',1,?7,NULL,1,0)`,
  )
    .bind(id, project.id, assetId, posterId, slug, `Page ${slug}`, Date.now())
    .run();
}

test("a scheduled tick builds the poster derivative an existing page never had", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const poster = await imageAsset(env, project, { id: "asset_poster", sha: "b".repeat(64) });
  await insertPublication(env, project, { id: "pub_sweep", assetId: poster.id, posterId: poster.id, slug: "sweeppage" });

  const before = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id='pub_sweep' AND kind='poster'",
  ).first();
  assert.equal(before, null);

  await tick(env);

  const row = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id='pub_sweep' AND kind='poster'",
  ).first();
  assert.ok(row, "the sweep built the poster derivative");
  assert.equal(row.source_sha256, poster.sha256);
  assert.equal(row.width, 1024);

  const served = await worker.fetch(new Request(base + "/p/sweeppage/poster-preview"), env);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/webp");
});

test("the sweep builds library previews once no poster is waiting, and settles", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const still = await imageAsset(env, project, { id: "asset_still", sha: "c".repeat(64) });

  await tick(env);
  const preview = await env.DB.prepare("SELECT * FROM asset_previews WHERE asset_id=?1").bind(still.id).first();
  assert.ok(preview, "the sweep built the library preview");
  assert.equal(preview.source_sha256, still.sha256);
  assert.match(preview.r2_key, /asset-previews\/asset_still\.webp$/);

  // A second tick with nothing outstanding does no work and removes nothing.
  await tick(env);
  const again = await env.DB.prepare("SELECT * FROM asset_previews WHERE asset_id=?1").bind(still.id).first();
  assert.equal(again.sha256, preview.sha256);
});

test("the sweep rebuilds a poster derivative whose source bytes changed", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const poster = await imageAsset(env, project, { id: "asset_reposter", sha: "d".repeat(64) });
  await insertPublication(env, project, { id: "pub_change", assetId: poster.id, posterId: poster.id, slug: "changepage" });
  await tick(env);
  const first = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id='pub_change' AND kind='poster'",
  ).first();

  // The owner replaces the artwork behind the same asset id.
  await env.DB.prepare("UPDATE assets SET sha256=?2 WHERE id=?1").bind(poster.id, "e".repeat(64)).run();
  await tick(env);

  const second = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id='pub_change' AND kind='poster'",
  ).first();
  assert.equal(second.source_sha256, "e".repeat(64));
  // The fake binding returns one fixed image, so the rendered bytes are equal;
  // what matters is that the row now describes the new source and still points
  // at real stored bytes.
  assert.ok(second.bytes > 0);
  assert.ok(env.MEDIA.objects.get(second.r2_key), "the rebuilt preview bytes are stored");
});

test("the sweep never touches a withdrawn page", async () => {
  const { env, project } = await setup();
  env.IMAGES = fakeImages();
  const poster = await imageAsset(env, project, { id: "asset_withdrawn", sha: "f".repeat(64) });
  await insertPublication(env, project, { id: "pub_gone", assetId: poster.id, posterId: poster.id, slug: "gonepage" });
  await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE id=?1").bind("pub_gone", Date.now()).run();

  await tick(env);

  const row = await env.DB.prepare(
    "SELECT * FROM publication_derivatives WHERE publication_id='pub_gone' AND kind='poster'",
  ).first();
  assert.equal(row, null);
});
