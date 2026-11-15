// MIT. Darkroom image generation over the studio's own R2 bucket. The provider,
// the Images binding and the operation store are fakes: no network, no paid call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeKey, darkroomOutputKey } from "../src/lib/darkroom.mjs";
import { createGeneration, dispatchGeneration } from "../src/lib/jobs.mjs";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { PNG_1x1, setup } from "./harness.mjs";
import { withDarkroom } from "./support/darkroom-env.mjs";

const OUTPUT = Uint8Array.from(PNG_1x1);

async function studio({ fit = true } = {}) {
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

async function addStill(env, project, id, key, projectId = project.id) {
  await env.MEDIA.put(key, PNG_1x1);
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES(?1,?2,'image',?3,'image/png',?4,512,512,'hash','Still','upload',1,1)",
  ).bind(id, projectId, key, PNG_1x1.byteLength).run();
}

async function admit(env, project, input) {
  const { generation } = await createGeneration(env, project, { kind: "image", ...input });
  return generation;
}

test("a Studio Print still is generated through Darkroom and saved to R2", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-print", prompt: "A paper-cut greenhouse", aspect: "square", clientRequestId: "req_print" });
  const written = new Map();
  const put = env.MEDIA.put.bind(env.MEDIA);
  env.MEDIA.put = async (key, bytes, options) => { written.set(key, new Uint8Array(bytes)); return put(key, bytes, options); };
  const saved = await dispatchGeneration(env, generation);

  assert.equal(saved.status, "saved", saved.error_detail);
  assert.equal(env.aiCalls.length, 1);
  assert.equal(env.aiCalls[0].model, "@cf/leonardo/lucid-origin");
  assert.equal(env.aiCalls[0].input.prompt, "A paper-cut greenhouse");
  // Darkroom wrote the result into the studio's bucket at the generation's own key...
  assert.ok(env.MEDIA.puts.includes(darkroomOutputKey(generation)));
  // ...and the studio retained exact bytes and an asset from them.
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE generation_id=?1").bind(generation.id).first();
  const result = written.get(darkroomOutputKey(generation));
  assert.ok(result.byteLength > 0);
  assert.deepEqual([...env.MEDIA.objects.get(asset.r2_key)], [...result]);
  assert.deepEqual([...env.MEDIA.objects.get(saved.retained_key)], [...result]);
  // The hand-off copy is not left behind.
  assert.equal(env.MEDIA.objects.has(darkroomOutputKey(generation)), false);
});

test("a reference is read from R2 through Darkroom for Studio Detail", async () => {
  const { env, project } = await studio();
  await addStill(env, project, "asset_ref", "projects/prj_test/assets/asset_ref/original.png");
  const generation = await admit(env, project, { model: "studio-detail", prompt: "Vary this", aspect: "square", referenceAssetId: "asset_ref", clientRequestId: "req_detail" });
  const saved = await dispatchGeneration(env, generation);

  assert.equal(saved.status, "saved");
  assert.equal(env.darkroom.imageReads > 0, true, "the Images binding fitted the reference read from R2");
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

test("Studio Draft keeps its direct Workers AI call", async () => {
  const { env, project } = await studio();
  const generation = await admit(env, project, { model: "studio-draft", prompt: "A product plate", aspect: "square", clientRequestId: "req_draft" });
  env.AI.run = async (model) => { env.aiCalls.push({ model }); return { image: Buffer.alloc(300, 1).toString("base64") }; };
  await dispatchGeneration(env, generation);
  assert.equal(env.aiCalls[0].model, "@cf/bytedance/stable-diffusion-xl-lightning");
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
