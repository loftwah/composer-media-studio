// MIT. Darkroom image generation over the studio's own R2 bucket. The provider,
// the Images binding and the operation store are fakes: no network, no paid call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeKey, darkroomOutputKey } from "../src/lib/darkroom.mjs";
import { budgetSnapshot, createGeneration, dispatchGeneration } from "../src/lib/jobs.mjs";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { PNG_1x1, jpeg, setup } from "./harness.mjs";
import { withDarkroom } from "./support/darkroom-env.mjs";

const OUTPUT = Uint8Array.from(PNG_1x1);

async function studio() {
  const { env, project } = await setup();
  withDarkroom(env);
  env.aiCalls = [];
  env.AI = {
    async run(model, input) {
      env.aiCalls.push({ model, input });
      return { image: Buffer.from(OUTPUT).toString("base64") };
    },
  };
  return { env, project };
}

async function addStill(env, project, id, key, projectId = project.id, { bytes = PNG_1x1, mime = "image/png" } = {}) {
  await env.MEDIA.put(key, bytes);
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES(?1,?2,'image',?3,?4,?5,512,512,'hash','Still','upload',1,1)",
  ).bind(id, projectId, key, mime, bytes.byteLength).run();
}

async function admit(env, project, input) {
  const { generation } = await createGeneration(env, project, { kind: "image", ...input });
  return generation;
}

test("a Studio Print still is generated through Darkroom and saved to R2", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-print", prompt: "A paper-cut greenhouse", aspect: "square", clientRequestId: "req_print" });
  const saved = await dispatchGeneration(env, generation);

  assert.equal(saved.status, "saved", saved.error_detail);
  assert.equal(env.aiCalls.length, 1);
  assert.equal(env.aiCalls[0].model, "@cf/leonardo/lucid-origin");
  assert.deepEqual(env.aiCalls[0].input, { prompt: "A paper-cut greenhouse", width: 1024, height: 1024, guidance: 5 });
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE generation_id=?1").bind(generation.id).first();
  assert.equal(asset.r2_key, saved.retained_key);
  assert.deepEqual(env.MEDIA.objects.get(asset.r2_key), OUTPUT);
  assert.deepEqual(env.MEDIA.objects.get(saved.retained_key), OUTPUT);
  assert.deepEqual(env.APP_ARTIFACTS.objects.get(`media-output/v1/media:${generation.id}`), OUTPUT);
  assert.deepEqual(env.MEDIA.puts, [asset.r2_key], "only one copy reached R2; no prompt-bearing handoff");
});

test("a reference already inside the catalogue rule is sent without the Images binding", async () => {
  const { env, project } = await studio();
  await addStill(env, project, "asset_ref", "projects/prj_test/assets/asset_ref/original.png");
  const generation = await admit(env, project, { model: "studio-detail", prompt: "Vary this", aspect: "square", referenceAssetId: "asset_ref", clientRequestId: "req_detail" });
  const saved = await dispatchGeneration(env, generation);

  assert.equal(saved.status, "saved", saved.error_detail);
  // Studio Detail fits references to 512 px PNG. These bytes already are that,
  // so the request is sent as stored: no Images dependency, same result.
  assert.equal(env.darkroom.imageReads, 0, "an already-fitting reference needs no transform");
  assert.equal(env.aiCalls[0].model, "@cf/black-forest-labs/flux-2-klein-4b");
  assert.ok(env.aiCalls[0].input.multipart, "the reference travels in the multipart body");
});

test("a key outside the project or without a live asset is refused before any provider call", async () => {
  const { env, project } = await studio();
  await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','slug-other','','private','{}',1,1)").run();
  await addStill(env, project, "asset_other", "projects/prj_other/assets/asset_other/original.png", "prj_other");
  const generation = { id: "gen_1", project_id: project.id };
  const authorize = authorizeKey(env, generation);

  await assert.rejects(authorize("projects/prj_other/assets/asset_other/original.png"), { status: 403 });
  await assert.rejects(authorize("projects/prj_test/assets/missing/original.png"), { status: 403 });
  await assert.doesNotReject(authorize(darkroomOutputKey(generation)));
  await assert.rejects(authorize("projects/prj_test/generations/gen_2/darkroom-output"), { status: 403 });
});

test("a reference deleted while the job dispatches is refused before Workers AI is called", async () => {
  const { env, project } = await studio();
  await addStill(env, project, "asset_ref", "projects/prj_test/assets/asset_ref/original.png");
  const generation = await admit(env, project, { model: "studio-detail", prompt: "Vary this", aspect: "square", referenceAssetId: "asset_ref", clientRequestId: "req_race" });
  // The owner deletes the still after the studio read it and before Darkroom does.
  const get = env.MEDIA.get.bind(env.MEDIA);
  env.MEDIA.get = async (key) => {
    const object = await get(key);
    await env.DB.prepare("UPDATE assets SET deleted_at=2 WHERE id='asset_ref'").run();
    return object;
  };
  const failed = await dispatchGeneration(env, generation);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "reference_unavailable");
  assert.equal(env.aiCalls.length, 0, "Workers AI was never called");
  assert.equal(env.MEDIA.puts.some((key) => key.endsWith("darkroom-output")), false);
});

test("Studio Draft uses Darkroom's multipart FLUX.2 Klein 9B call", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-craft", prompt: "A product plate", aspect: "square", clientRequestId: "req_draft" });
  const saved = await dispatchGeneration(env, generation);
  assert.equal(saved.status, "saved", saved.error_detail);
  assert.equal(env.aiCalls[0].model, "@cf/black-forest-labs/flux-2-klein-9b");
  assert.ok(env.aiCalls[0].input.multipart, "the replacement model travels in the multipart body");
  const stored = await env.DB.prepare("SELECT request_json FROM generations WHERE id=?1").bind(generation.id).first();
  assert.equal(JSON.parse(stored.request_json).modelEndpoint, "@cf/black-forest-labs/flux-2-klein-9b");
  assert.equal(env.MEDIA.puts.some((key) => key.endsWith("darkroom-output")), false);
});

test("deleting a generated still also erases Darkroom's retained copy", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-print", prompt: "A paper-cut greenhouse", aspect: "square", clientRequestId: "req_erase" });
  await dispatchGeneration(env, generation);
  const retained = `media-output/v1/media:${generation.id}`;
  assert.ok(await env.APP_ARTIFACTS.head(retained), "Darkroom retained the output");
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE generation_id=?1").bind(generation.id).first();

  const cookie = `studio_session=${await createSession(env)}`;
  const response = await worker.fetch(new Request(`https://studio.test/api/assets/${asset.id}`, { method: "DELETE", headers: { cookie } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(await env.APP_ARTIFACTS.head(retained), null, "Darkroom's copy is gone");
  assert.equal(env.MEDIA.objects.has(asset.r2_key), false);
});

test("a still deleted while its job runs is erased when the job is discarded", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-print", prompt: "A paper-cut greenhouse", aspect: "square", clientRequestId: "req_discard" });
  // The owner deletes the job while Workers AI is still working on it.
  const run = env.AI.run;
  env.AI.run = async (...input) => {
    await env.DB.prepare("UPDATE generations SET deleted_at=2 WHERE id=?1").bind(generation.id).run();
    return run(...input);
  };
  const discarded = await dispatchGeneration(env, generation);
  assert.equal(discarded.status, "discarded_after_delete");
  assert.equal(await env.APP_ARTIFACTS.head(`media-output/v1/media:${generation.id}`), null);
  assert.equal(env.MEDIA.objects.has(darkroomOutputKey(generation)), false);
  assert.equal(await env.DB.prepare("SELECT id FROM assets WHERE generation_id=?1").bind(generation.id).first(), null);
});

test("Film and Quick keep their previously qualified provider arguments", async () => {
  for (const [model, guidance] of [["studio-film", 3], ["studio-quick", undefined]]) {
    const { env, project } = await studio();
    const generation = await admit(env, project, { model, prompt: "Test frame", aspect: "square", clientRequestId: "req_defaults" });
    const result = await dispatchGeneration(env, generation);
    assert.equal(result.status, "saved", result.error_detail);
    assert.deepEqual(env.aiCalls[0].input, { prompt: "Test frame", width: 1024, height: 1024,
      ...(guidance === undefined ? {} : { guidance }) });
  }
});

test("missing reference-fitting binding releases the reservation before inference", async () => {
  const { env, project } = await studio();
  const key = "projects/prj_test/assets/asset_ref/original.jpg";
  // A 1024 x 1280 still is outside the model's 512 px reference rule, so the
  // Images fitter is genuinely required and its absence is a preflight refusal.
  await addStill(env, project, "asset_ref", key, project.id, { bytes: jpeg(1024, 1280), mime: "image/jpeg" });
  delete env.IMAGES;
  const generation = await admit(env, project, { model: "studio-detail", prompt: "Test frame", aspect: "square", referenceAssetId: "asset_ref", clientRequestId: "req_missing_binding" });
  assert.ok((await budgetSnapshot(env, project.id)).reservedMicro > 0);
  const failed = await dispatchGeneration(env, generation);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "provider_unconfigured");
  assert.equal(env.aiCalls.length, 0);
  assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 0);
});

test("saving a retained original after a lost result read does not dispatch twice", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-print", prompt: "Test frame", aspect: "square", clientRequestId: "req_recover" });
  const get = env.APP_ARTIFACTS.get.bind(env.APP_ARTIFACTS);
  env.APP_ARTIFACTS.get = async () => { throw new Error("Transient result read failure"); };
  const unknown = await dispatchGeneration(env, generation);
  assert.equal(unknown.status, "unknown");
  assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 25_000);
  assert.match(unknown.error_detail, /recover|again|unavailable/);
  env.APP_ARTIFACTS.get = get;
  const cookie = `studio_session=${await createSession(env)}`;
  const path = `https://studio.test/api/generations/${generation.id}/save-retry`;
  const response = await worker.fetch(new Request(path, { method: "POST", headers: { cookie } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.generation.status, "saved");
  assert.equal(saved.budget.reservedMicro, 0);
  assert.equal(saved.budget.spentMicro, 25_000);
  assert.equal(env.aiCalls.length, 1);
});

test("a lost paid reply does not suggest a fresh request or issue Darkroom's capacity retry", async () => {
  const { env, project } = await studio();
  let calls = 0;
  env.AI.run = async () => { calls += 1; throw new Error("3040: Capacity temporarily exceeded"); };
  const generation = await admit(env, project, { model: "studio-print", prompt: "Test frame", aspect: "square", clientRequestId: "req_unknown" });
  const pending = await dispatchGeneration(env, generation);
  assert.equal(pending.status, "unknown");
  assert.match(pending.error_detail, /Check this job/);
  assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 25_000);
  assert.equal(calls, 1);
});
