// MIT. The scheduled tick must not attempt a preview rendition.
//
// Building a rendition needs the Cloudflare Images binding. On this
// installation's account that binding answers 9432 (legacy billing), so the
// every-minute sweep that used to live here could never converge: it logged a
// refusal for the same rows every minute. The sweep is gone; the owner-session
// route stays and reports its refusal honestly, and the browser backfill in
// `public/studio.js` renders poster previews with canvas instead.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { addAsset, jpeg, setup } from "./harness.mjs";

const base = "https://studio.test";

function call(env, path, { method = "GET", cookie, json } = {}) {
  const init = { method, headers: cookie ? { cookie } : {} };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  return worker.fetch(new Request(base + path, init), env);
}

/** The same refusal the deployed account sees, counted so silence is provable. */
function refusingImages() {
  const error = Object.assign(new Error("The Images Binding is not available using legacy billing"), {
    code: "9432",
  });
  return {
    calls: 0,
    input() {
      this.calls += 1;
      return {
        transform: () => ({
          output: () => {
            throw error;
          },
        }),
      };
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

test("a scheduled tick does not attempt a rendition the binding would refuse", async () => {
  const { env, project } = await setup();
  const images = refusingImages();
  env.IMAGES = images;
  const poster = await imageAsset(env, project, { id: "asset_poster", sha: "b".repeat(64) });
  await insertPublication(env, project, {
    id: "pub_sweep",
    assetId: poster.id,
    posterId: poster.id,
    slug: "sweeppage",
  });

  // Three consecutive ticks: the old sweep failed once a minute forever.
  await tick(env);
  await tick(env);
  await tick(env);

  assert.equal(images.calls, 0, "the schedule never asked Images for a rendition");
  assert.equal(
    await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(),
    null,
    "no derivative row was fabricated",
  );
  assert.equal(
    await env.DB.prepare("SELECT asset_id FROM asset_previews").first(),
    null,
    "no asset preview row was fabricated",
  );
  // Nothing claims a preview exists, so the page keeps its full-size media.
  const page = await call(env, "/p/sweeppage");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /src="\/p\/sweeppage\/media"/);
  assert.doesNotMatch(html, /\/p\/sweeppage\/poster-preview/);
  assert.equal((await call(env, "/p/sweeppage/poster-preview")).status, 404);
});

test("the owner backfill route reports the binding refusal instead of making progress", async () => {
  const { env, project } = await setup();
  const images = refusingImages();
  env.IMAGES = images;
  const cookie = "studio_session=" + (await createSession(env, { mode: "owner" }));
  const poster = await imageAsset(env, project, { id: "asset_poster", sha: "c".repeat(64) });
  await insertPublication(env, project, {
    id: "pub_route",
    assetId: poster.id,
    posterId: poster.id,
    slug: "routepage",
  });

  const response = await call(env, "/api/studio/previews/backfill", {
    method: "POST",
    cookie,
    json: { kind: "posters", limit: 4 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: "posters", processed: 0, remaining: 1, failed: 1 });
  assert.equal(images.calls, 1);
  assert.equal(await env.DB.prepare("SELECT publication_id FROM publication_derivatives").first(), null);
});
