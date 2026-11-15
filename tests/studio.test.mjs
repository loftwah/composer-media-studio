// MIT. Focused checks for the studio's real risk boundaries:
// specification validation, idempotency, one budget authority, save recovery,
// tombstones and byte parsing. Uses node:sqlite with the real migration SQL.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGeneration,
  cancelGeneration,
  loadGeneration,
  saveGeneration,
  advanceGeneration,
  budgetSnapshot,
} from "../src/lib/jobs.mjs";
import { getModel, validateSettings, publicModels, estimateCost } from "../src/lib/providers.mjs";
import { imageSize, videoInfo, sniffMedia } from "../src/lib/util.mjs";
import { PNG_1x1, jpeg, setup } from "./harness.mjs";

function imageRequest(overrides = {}) {
  return {
    kind: "image",
    model: "studio-draft",
    recipeId: "editorial-still",
    prompt: "A quiet paper landscape with a single burnt orange sun.",
    aspect: "portrait",
    clientRequestId: "req_abcdefgh",
    ...overrides,
  };
}

test("model settings are validated on the server", () => {
  assert.throws(() => validateSettings(getModel("studio-draft"), { prompt: "x", aspect: "tall" }), /frame/);
  assert.throws(() => validateSettings(getModel("hailuo-standard"), { prompt: "x", durationSeconds: 7 }), /second/);
  const settings = validateSettings(getModel("studio-detail"), { prompt: " change the light ", aspect: "square" });
  assert.equal(settings.prompt, "change the light");
  assert.ok(publicModels().every((model) => model.costMicro > 0 && model.costBasis.length > 20));
});

test("image and video bytes are read without trusting the client", () => {
  assert.deepEqual(imageSize(PNG_1x1), { width: 1, height: 1, format: "png" });
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480, format: "jpeg" });
  assert.equal(sniffMedia(new TextEncoder().encode("<svg></svg>"), "image/svg+xml").kind, null);
  assert.equal(sniffMedia(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "").mime, "image/jpeg");
});

test("video duration and frame come from the MP4 boxes", () => {
  const box = (type, payload) => {
    const bytes = new Uint8Array(8 + payload.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, bytes.length);
    bytes.set([...Buffer.from(type)], 4);
    bytes.set(payload, 8);
    return bytes;
  };
  const mvhdPayload = new Uint8Array(20);
  const mvhdView = new DataView(mvhdPayload.buffer);
  mvhdView.setUint32(12, 1000);
  mvhdView.setUint32(16, 5000);
  const tkhdPayload = new Uint8Array(84);
  const tkhdView = new DataView(tkhdPayload.buffer);
  tkhdView.setUint32(76, 1280 * 65536);
  tkhdView.setUint32(80, 720 * 65536);
  const moov = box("moov", new Uint8Array([
    ...box("mvhd", mvhdPayload),
    ...box("trak", new Uint8Array([...box("tkhd", tkhdPayload)])),
  ]));
  const mdat = box("mdat", new Uint8Array(4096));
  const bytes = new Uint8Array(mdat.length + moov.length);
  bytes.set(mdat, 0);
  bytes.set(moov, mdat.length);
  assert.deepEqual(videoInfo(bytes), { durationMs: 5000, width: 1280, height: 720 });
});

test("the same client request can only create one generation", async () => {
  const { env, project } = await setup();
  const first = await createGeneration(env, project, imageRequest());
  assert.equal(first.created, true);
  const second = await createGeneration(env, project, imageRequest());
  assert.equal(second.created, false);
  assert.equal(second.generation.id, first.generation.id);
  const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM generations").all();
  assert.equal(results[0].n, 1);
});

test("one atomic admission prevents oversubscribing the allowance", async () => {
  const { env, project } = await setup({ allowance: 2_000 });
  const first = await createGeneration(env, project, imageRequest());
  assert.equal(first.created, true);
  await assert.rejects(createGeneration(env, project, imageRequest({ clientRequestId: "req_second1" })), (error) => {
    assert.equal(error.status, 402);
    assert.equal(error.code, "budget_exhausted");
    return true;
  });
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 1_200);
  const row = await env.DB.prepare("SELECT status FROM generations WHERE client_request_id='req_second1'").first();
  assert.equal(row.status, "failed");
});

test("H3 video reserves its conservative duration estimate before dispatch", async () => {
  const { env, project } = await setup({ allowance: 440_000 });
  await env.MEDIA.put("source", PNG_1x1);
  await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES('asset_ref',?1,'image','source','image/png',1,1,1,'hash','Still','upload',1,1)").bind(project.id).run();
  const input = { kind: "video", model: "h3-max-turbo", prompt: "Move the light", durationSeconds: 10, referenceAssetId: "asset_ref", clientRequestId: "request_h3_1" };
  const first = await createGeneration(env, project, input);
  assert.equal(first.generation.cost_reserved_micro, 440_000);
  assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 440_000);
  await assert.rejects(createGeneration(env, project, { ...input, clientRequestId: "request_h3_2" }), (error) => error.code === "budget_exhausted");
});

test("saving retains one owned asset and a retry never generates again", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  const saved = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(saved.status, "saved");
  assert.ok(saved.output_asset_id);
  const again = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(again.status, "saved");
  assert.equal(again.output_asset_id, saved.output_asset_id);
  const assets = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").all();
  assert.equal(assets.results[0].n, 1);
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.spentMicro, estimateCost(getModel("studio-draft")));
  assert.equal(budget.reservedMicro, 0);
});

test("a late save cannot resurrect a deleted job or asset", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  await env.DB.prepare("UPDATE generations SET deleted_at=?2 WHERE id=?1").bind(generation.id, Date.now()).run();
  const result = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(result.status, "discarded_after_delete");
  const assets = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").all();
  assert.equal(assets.results[0].n, 0);
  const advance = await advanceGeneration(env, generation);
  assert.equal(advance.status, "discarded_after_delete");
});

test("cancelling before dispatch releases the reservation", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest({ model: "studio-quick", aspect: "square" }));
  const cancelled = await cancelGeneration(env, generation);
  assert.equal(cancelled.status, "cancelled");
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 0);
  assert.equal(budget.spentMicro, 0);
});

test("a lost dispatch reply is unknown and keeps its reservation", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  await env.DB.prepare("UPDATE generations SET status='submitting', updated_at=?2 WHERE id=?1")
    .bind(generation.id, Date.now() - 600_000)
    .run();
  const advanced = await advanceGeneration(env, generation);
  assert.equal(advanced.status, "unknown");
  assert.equal(advanced.error_code, "dispatch_unknown");
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 1_200);
  const fresh = await loadGeneration(env, generation.id);
  assert.equal(fresh.cost_allocated_micro, null);
});

test("a reference must belong to the same project and be a still", async () => {
  const { env, project } = await setup();
  const timestamp = Date.now();
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',?1,?1)",
  )
    .bind(timestamp)
    .run();
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES('asset_other','prj_other','image','k','image/png',1,1,1,'h','Other','upload',?1,?1)",
  )
    .bind(timestamp)
    .run();
  await assert.rejects(
    createGeneration(env, project, imageRequest({ model: "studio-detail", aspect: "square", referenceAssetId: "asset_other" })),
    /not in this project/,
  );
});
