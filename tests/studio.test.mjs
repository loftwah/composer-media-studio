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
import { getModel, validateSettings, publicModels, publicRetiredModels, estimateCost, submitAudio } from "../src/lib/providers.mjs";
import { imageSize, videoInfo, sniffMedia } from "../src/lib/util.mjs";
import { PNG_1x1, jpeg, setup } from "./harness.mjs";

function imageRequest(overrides = {}) {
  return {
    kind: "image",
    model: "studio-craft",
    recipeId: "editorial-still",
    prompt: "A quiet paper landscape with a single burnt orange sun.",
    aspect: "portrait",
    clientRequestId: "req_abcdefgh",
    ...overrides,
  };
}

test("model settings are validated on the server", () => {
  assert.throws(() => validateSettings(getModel("studio-craft"), { prompt: "x", aspect: "tall" }), /frame/);
  assert.throws(() => validateSettings(getModel("hailuo-standard"), { prompt: "x", durationSeconds: 7 }), /second/);
  const settings = validateSettings(getModel("studio-detail"), { prompt: " change the light ", aspect: "square" });
  assert.equal(settings.prompt, "change the light");
  assert.ok(publicModels().every((model) => model.costMicro > 0 && model.costBasis.length > 20));
});

test("the retiring draft model is withdrawn but keeps its exact attribution", () => {
  assert.equal(publicModels().some((model) => model.id === "studio-draft"), false);
  assert.equal(publicModels().some((model) => model.id === "studio-craft"), true);
  assert.equal(getModel("studio-craft").endpoint, "@cf/black-forest-labs/flux-2-klein-9b");
  assert.throws(() => getModel("studio-draft"), (error) => {
    assert.equal(error.status, 410);
    assert.equal(error.code, "model_retired");
    assert.equal(error.replacement, "studio-craft");
    return true;
  });
  const retired = publicRetiredModels().find((model) => model.id === "studio-draft");
  assert.equal(retired.endpoint, "@cf/bytedance/stable-diffusion-xl-lightning");
  assert.equal(retired.retiredAt, "2026-11-20");
});

test("Studio Effect uses the current fal sound-effects endpoint and request shape", async () => {
  const original = globalThis.fetch;
  let url;
  let body;
  globalThis.fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      request_id: "request_effect",
      status_url: "https://queue.fal.run/request_effect/status",
      response_url: "https://queue.fal.run/request_effect",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await submitAudio({ FAL_KEY: "fictional-test-key" }, getModel("studio-effect"), {
      prompt: "a soft ceramic chime",
      durationSeconds: 4,
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.match(url, /fal-ai\/elevenlabs\/sound-effects\/v3$/);
  assert.equal(body.text, "a soft ceramic chime");
  assert.equal(body.duration_seconds, 4);
  assert.equal(body.enable_safety_checker, true);
});

test("image and video bytes are read without trusting the client", () => {
  assert.deepEqual(imageSize(PNG_1x1), { width: 1, height: 1, format: "png" });
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480, format: "jpeg" });
  assert.equal(sniffMedia(new TextEncoder().encode("<svg></svg>"), "image/svg+xml").kind, null);
  assert.equal(sniffMedia(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "").mime, "image/jpeg");
});

test("imageSize reads WebP variants, sliced views and rejects truncated bytes", () => {
  const webp = (kind, width, height) => {
    const bytes = new Uint8Array(30);
    bytes.set([...Buffer.from("RIFF")], 0);
    bytes.set([...Buffer.from("WEBP")], 8);
    bytes.set([...Buffer.from(kind)], 12);
    if (kind === "VP8X") {
      bytes[24] = (width - 1) & 0xff;
      bytes[25] = ((width - 1) >> 8) & 0xff;
      bytes[26] = ((width - 1) >> 16) & 0xff;
      bytes[27] = (height - 1) & 0xff;
      bytes[28] = ((height - 1) >> 8) & 0xff;
      bytes[29] = ((height - 1) >> 16) & 0xff;
    } else if (kind === "VP8L") {
      const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
      bytes[21] = bits & 0xff;
      bytes[22] = (bits >> 8) & 0xff;
      bytes[23] = (bits >> 16) & 0xff;
      bytes[24] = (bits >> 24) & 0xff;
    } else {
      bytes[26] = width & 0xff;
      bytes[27] = (width >> 8) & 0xff;
      bytes[28] = height & 0xff;
      bytes[29] = (height >> 8) & 0xff;
    }
    return bytes;
  };

  assert.deepEqual(imageSize(webp("VP8X", 640, 480)), { width: 640, height: 480, format: "webp" });
  assert.deepEqual(imageSize(webp("VP8L", 100, 50)), { width: 100, height: 50, format: "webp" });
  assert.deepEqual(imageSize(webp("VP8 ", 320, 240)), { width: 320, height: 240, format: "webp" });

  // A typed-array view with a non-zero byteOffset reads relative to the view.
  const paddedWebp = new Uint8Array(36);
  paddedWebp.set(webp("VP8X", 17, 9), 6);
  assert.deepEqual(imageSize(paddedWebp.subarray(6)), { width: 17, height: 9, format: "webp" });
  const paddedPng = new Uint8Array(PNG_1x1.length + 4);
  paddedPng.set(PNG_1x1, 4);
  assert.deepEqual(imageSize(paddedPng.subarray(4)), { width: 1, height: 1, format: "png" });

  assert.deepEqual(imageSize(PNG_1x1.subarray(0, 12)), { width: null, height: null, format: null });
  assert.deepEqual(imageSize(new Uint8Array([0, 1, 2, 3])), { width: null, height: null, format: null });
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
  const { env, project } = await setup({ allowance: 20_000 });
  const first = await createGeneration(env, project, imageRequest());
  assert.equal(first.created, true);
  await assert.rejects(createGeneration(env, project, imageRequest({ clientRequestId: "req_second1" })), (error) => {
    assert.equal(error.status, 402);
    assert.equal(error.code, "budget_exhausted");
    return true;
  });
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 16_000);
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
  assert.equal(budget.spentMicro, estimateCost(getModel("studio-craft")));
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
  assert.equal(budget.reservedMicro, 16_000);
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
