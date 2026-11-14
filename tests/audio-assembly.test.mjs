// MIT. Focused checks for the two later capabilities: audio as a saved asset
// with real format/duration, and the bounded composition render.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCompositionSpec,
  cacheSlateOnComposition,
  createComposition,
  createGeneration,
  createRender,
  saveGeneration,
  updateComposition,
} from "../src/lib/jobs.mjs";
import { getModel, publicModels, validateSettings } from "../src/lib/providers.mjs";
import { signRenderLink, verifyRenderLink } from "../src/lib/render-links.mjs";
import { audioInfo, sniffMedia } from "../src/lib/util.mjs";
import { addAsset, jpeg, mp3FrameHeader, setup, wav } from "./harness.mjs";

test("audio duration and format come from the bytes", () => {
  const wavBytes = wav({ seconds: 3, sampleRate: 22050, channels: 2, bits: 16 });
  assert.equal(sniffMedia(wavBytes, "").mime, "audio/wav");
  const info = audioInfo(wavBytes);
  assert.equal(info.format, "wav");
  assert.equal(info.sampleRate, 22050);
  assert.equal(info.channels, 2);
  assert.equal(info.durationMs, 3000);

  const mp3 = new Uint8Array(64000);
  mp3.set(mp3FrameHeader(), 0);
  assert.equal(sniffMedia(mp3, "").kind, "audio");
  const mp3Info = audioInfo(mp3);
  assert.equal(mp3Info.format, "mp3");
  assert.equal(mp3Info.sampleRate, 44100);
  assert.equal(mp3Info.channels, 2);
  assert.equal(mp3Info.durationMs, 4000);
});

test("sound is a first-class kind with its own validated models", () => {
  const score = getModel("studio-score");
  const voice = getModel("studio-voice");
  assert.equal(score.kind, "audio");
  assert.equal(voice.audio.mode, "speech");
  assert.deepEqual(validateSettings(score, { prompt: " slow strings " }), {
    prompt: "slow strings",
    durationSeconds: 30,
  });
  assert.throws(() => validateSettings(voice, { prompt: "x".repeat(1300) }), /characters/);
  assert.ok(publicModels().some((model) => model.kind === "audio"));
  assert.ok(publicModels().some((model) => model.render === "assembly"));
});

test("a saved audio result keeps its own kind, duration and channel count", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, {
    kind: "audio",
    model: "studio-score",
    recipeId: "freeform",
    prompt: "A quiet tide of warm strings",
    clientRequestId: "req_audiotrack1",
  });
  const mp3 = new Uint8Array(64000);
  mp3.set(mp3FrameHeader(), 0);
  const saved = await saveGeneration(env, generation, mp3, "mp3");
  assert.equal(saved.status, "saved");
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(saved.output_asset_id).first();
  assert.equal(asset.kind, "audio");
  assert.equal(asset.mime, "audio/mpeg");
  assert.equal(asset.duration_ms, 4000);
  assert.equal(asset.channels, 2);
});

test("a composition only accepts this project's bounded clips", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip03", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_still1", kind: "image" });
  await addAsset(env, project, { id: "asset_audio1", kind: "audio", durationMs: 30000 });

  await assert.rejects(buildCompositionSpec(env, project, { title: "One", shots: [{ assetId: "asset_clip01" }] }), /two saved clips/);
  await assert.rejects(
    buildCompositionSpec(env, project, {
      title: "Still",
      shots: [{ assetId: "asset_clip01" }, { assetId: "asset_still1" }],
    }),
    /saved clip/,
  );
  await assert.rejects(
    buildCompositionSpec(env, project, {
      title: "Other project",
      shots: [{ assetId: "asset_clip01" }, { assetId: "asset_unknown" }],
    }),
    /saved clip/,
  );

  const spec = await buildCompositionSpec(env, project, {
    title: "Field notes",
    shots: [{ assetId: "asset_clip02" }, { assetId: "asset_clip01" }, { assetId: "asset_clip03" }],
    audioAssetId: "asset_audio1",
  });
  assert.equal(spec.totalMs, 18000);
  assert.equal(spec.audioAssetId, "asset_audio1");
  assert.deepEqual(spec.shots.map((shot) => shot.assetId), ["asset_clip02", "asset_clip01", "asset_clip03"]);
});

test("a 15-second H3 take with its documented overrun remains assemblable, with a hard clip bound", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_h3_long", kind: "video", durationMs: 15_700 });
  await addAsset(env, project, { id: "asset_short", kind: "video", durationMs: 5_000 });
  await addAsset(env, project, { id: "asset_too_long", kind: "video", durationMs: 16_001 });
  const shots = [{ assetId: "asset_h3_long" }, { assetId: "asset_short" }];
  const result = await buildCompositionSpec(env, project, { title: "H3 cut", shots });
  assert.equal(result.shots[0].durationMs, 15_700);
  await assert.rejects(buildCompositionSpec(env, project, { title: "Too long", shots: [{ assetId: "asset_too_long" }, { assetId: "asset_short" }] }), /bounded clip/);
});

test("shot trim bounds persist without permitting unsupported provider rendering or silent loss", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 5000 });
  const shots = [{ assetId: "asset_clip01", trimStartMs: 1000, trimEndMs: 4500 }, { assetId: "asset_clip02" }];
  const composition = await createComposition(env, project, { title: "Trim proof", shots });
  assert.equal(composition.totalMs, 8500);
  assert.deepEqual(composition.shots[0], { assetId: "asset_clip01", title: "Asset asset_clip01", durationMs: 3500, trimStartMs: 1000, trimEndMs: 4500 });
  assert.equal('trimStartMs' in composition.shots[1], false);
  let row = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1").bind(composition.id).first();
  assert.equal(JSON.parse(row.spec_json).shots[0].trimEndMs, 4500);
  await assert.rejects(createRender(env, project, row, { model: "studio-assembly", clientRequestId: "req_trim_test" }), e => e.code === "provider_shot_trim_unsupported");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM generations").first()).n, 0);
  await assert.rejects(updateComposition(env, project, row, { title: "No silent loss", expectedUpdatedAt: row.updated_at, shots: shots.map(s => ({ assetId: s.assetId })) }), e => e.code === "shot_trim_required");
  const edited = await updateComposition(env, project, row, { title: "Retained", expectedUpdatedAt: row.updated_at, shots: composition.shots });
  assert.equal(edited.shots[0].trimStartMs, 1000);
  await assert.rejects(updateComposition(env, project, row, { title: "Stale edit", expectedUpdatedAt: row.updated_at, shots: composition.shots }), e => e.status === 409 && e.code === "revision_conflict");
  row = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1").bind(composition.id).first();
  const reset = await updateComposition(env, project, row, { title: "Full again", expectedUpdatedAt: row.updated_at, shots: [{ assetId: "asset_clip01", trimStartMs: 0, trimEndMs: 6000 }, shots[1]] });
  assert.equal(reset.totalMs, 11000);
  assert.equal('trimStartMs' in reset.shots[0], false);
  assert.equal(reset.trimVersioned, true);
  const resetRow = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1").bind(composition.id).first();
  await assert.rejects(updateComposition(env, project, resetRow, { title: "Legacy overwrite", shots: shots.map(s => ({ assetId: s.assetId })) }), e => e.code === "revision_conflict");
});

test("rejects partial, noninteger, out-of-range and reversed shot trims", async () => {
  const { env, project } = await setup();
  for (const id of ['asset_clip01', 'asset_clip02']) await addAsset(env, project, { id, kind: 'video', durationMs: 6000 });
  for (const trim of [{trimStartMs: 1}, {trimEndMs: 3}, {trimStartMs: -1,trimEndMs: 4}, {trimStartMs: 1,trimEndMs: 6001}, {trimStartMs: 1.5,trimEndMs: 4}, {trimStartMs: 4,trimEndMs: 4}, {trimStartMs: 5,trimEndMs: 4}, {trimStartMs: '1',trimEndMs: 4}]) {
    await assert.rejects(buildCompositionSpec(env, project, { title: 'Invalid trim', shots: [{assetId:'asset_clip01',...trim}, {assetId:'asset_clip02'}] }), e => e.code === 'invalid_shot_trim');
  }
});

test("stale and legacy clients cannot overwrite trim versions or replay an old provider request", async () => {
  const { env, project } = await setup();
  for (const id of ['asset_clip01', 'asset_clip02']) await addAsset(env, project, { id, kind:'video', durationMs:6000 });
  const shots = [{assetId:'asset_clip01'}, {assetId:'asset_clip02'}];
  const made = await createComposition(env, project, {title:'Versioned cut', shots});
  const original = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.id).first();
  await createRender(env, project, original, {model:'studio-assembly',clientRequestId:'req_before_trim'});
  const trimShots = [{...shots[0],trimStartMs:0,trimEndMs:4000}, shots[1]];
  const edited = await updateComposition(env, project, original, {title:'Trimmed',shots:trimShots,expectedUpdatedAt:original.updated_at});
  assert.ok(edited.updatedAt > original.updated_at);
  const current = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.id).first();
  assert.equal(await cacheSlateOnComposition(env, original, 'asset_slate_video'), false);
  const afterStaleCache = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.id).first();
  assert.equal(afterStaleCache.spec_json, current.spec_json);
  assert.equal(afterStaleCache.updated_at, current.updated_at);
  await assert.rejects(updateComposition(env,project,current,{title:'Stale',shots,expectedUpdatedAt:original.updated_at}),e=>e.status===409 && e.code==='revision_conflict');
  await assert.rejects(updateComposition(env,project,current,{title:'Old client',shots:[shots[1],shots[0]]}),e=>e.status===409 && e.code==='revision_conflict');
  await assert.rejects(createRender(env,project,current,{model:'studio-assembly',clientRequestId:'req_before_trim'}),e=>e.code==='provider_shot_trim_unsupported');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,1);
  const competing=await Promise.allSettled(['Writer A','Writer B'].map(title=>updateComposition(env,project,current,{title,shots:trimShots,expectedUpdatedAt:current.updated_at})));
  assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(competing.filter(result=>result.status==='rejected' && result.reason.code==='revision_conflict').length,1);
});

test('slate cache updates only the version it read and advances the version', async () => {
  const { env, project } = await setup();
  for (const id of ['asset_clip01','asset_clip02']) await addAsset(env,project,{id,kind:'video',durationMs:6000});
  const made = await createComposition(env,project,{title:'Slate',shots:[{assetId:'asset_clip01'},{assetId:'asset_clip02'}]});
  const before = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.id).first();
  assert.equal(await cacheSlateOnComposition(env,before,'asset_slate_video'),true);
  const after = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.id).first();
  assert.equal(JSON.parse(after.spec_json).slateVideoAssetId,'asset_slate_video');
  assert.ok(after.updated_at > before.updated_at);
});

test("an edited composition keeps the manifest its earlier render used", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 6000 });
  const composition = await createComposition(env, project, {
    title: "Cut one",
    shots: [{ assetId: "asset_clip01" }, { assetId: "asset_clip02" }],
  });
  const created = await createRender(env, project, { id: composition.id, ...composition, spec_json: JSON.stringify(composition) }, {
    model: "studio-assembly",
    clientRequestId: "req_render0001",
  });
  assert.equal(created.created, true);
  const firstManifest = JSON.parse(created.generation.request_json);
  assert.equal(firstManifest.totalMs, 12000);

  await updateComposition(env, project, { id: composition.id }, {
    title: "Cut one, tightened",
    shots: [{ assetId: "asset_clip02" }, { assetId: "asset_clip01" }],
  });
  const render = await env.DB.prepare("SELECT * FROM generations WHERE id=?1").bind(created.generation.id).first();
  const manifest = JSON.parse(render.request_json);
  assert.equal(manifest.totalMs, 12000);
  assert.equal(manifest.title, "Cut one");
  assert.deepEqual(manifest.shots.map((shot) => shot.assetId), ["asset_clip01", "asset_clip02"]);
  const edited = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1").bind(composition.id).first();
  assert.equal(edited.title, "Cut one, tightened");
  assert.deepEqual(JSON.parse(edited.spec_json).shots.map((shot) => shot.assetId), ["asset_clip02", "asset_clip01"]);
});

test("the same render request replays instead of dispatching twice", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 6000 });
  const composition = await createComposition(env, project, {
    title: "Cut",
    shots: [{ assetId: "asset_clip01" }, { assetId: "asset_clip02" }],
  });
  const row = { id: composition.id, ...composition, spec_json: JSON.stringify(composition) };
  const first = await createRender(env, project, row, { model: "studio-assembly", clientRequestId: "req_render0002" });
  const second = await createRender(env, project, row, { model: "studio-assembly", clientRequestId: "req_render0002" });
  assert.equal(second.created, false);
  assert.equal(second.generation.id, first.generation.id);
  const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM generations WHERE composition_id=?1").bind(composition.id).all();
  assert.equal(results[0].n, 1);
});

test("a 9:16 cut keeps the selected order and needs no portrait take", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_slate1", kind: "image" });
  const composition = await createComposition(env, project, {
    title: "Cut",
    shots: [{ assetId: "asset_clip02" }, { assetId: "asset_clip01" }],
    slateAssetId: "asset_slate1",
  });
  const row = { id: composition.id, ...composition, spec_json: JSON.stringify(composition) };
  const created = await createRender(env, project, row, {
    model: "studio-social",
    clientRequestId: "req_social0001",
  });
  assert.equal(created.created, true);
  const manifest = JSON.parse(created.generation.request_json);
  assert.deepEqual(manifest.shots.map((shot) => shot.assetId), ["asset_clip02", "asset_clip01"]);
  assert.equal(manifest.stage, "slate");
  assert.equal(manifest.slateAssetId, "asset_slate1");

  // The old helper must no longer reorder the edit.
  const { orderShotsForSocial } = await import("../src/lib/providers.mjs");
  const ordered = orderShotsForSocial([
    { assetId: "asset_clip02", portrait: false },
    { assetId: "asset_clip01", portrait: true },
  ]);
  assert.deepEqual(ordered.map((shot) => shot.assetId), ["asset_clip02", "asset_clip01"]);
});

test("a fill rejects a mask that does not match the still", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_sourceimg", kind: "image", r2Key: "source.png" });
  await addAsset(env, project, { id: "asset_maskimg", kind: "image", r2Key: "mask.png" });
  await env.DB.prepare("UPDATE assets SET mime='image/png', width=1024, height=1024 WHERE id='asset_sourceimg'").run();
  await env.DB.prepare("UPDATE assets SET mime='image/png', width=1280, height=720 WHERE id='asset_maskimg'").run();
  await env.MEDIA.put("source.png", jpeg(1024, 1024));
  await env.MEDIA.put("mask.png", jpeg(1280, 720));
  await assert.rejects(
    createGeneration(env, project, {
      kind: "image",
      model: "studio-fill",
      recipeId: "freeform",
      prompt: "A replacement sky",
      aspect: "match-reference",
      referenceAssetId: "asset_sourceimg",
      maskAssetId: "asset_maskimg",
      clientRequestId: "req_fill000001",
    }),
    /same width and height/,
  );
});

test("trim, gain and fades need a saved mix instead of being silently ignored", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_clip01", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_clip02", kind: "video", durationMs: 6000 });
  await addAsset(env, project, { id: "asset_audio1", kind: "audio", durationMs: 30000 });
  const draft = await createComposition(env, project, {
    title: "Mix",
    shots: [{ assetId: "asset_clip01" }, { assetId: "asset_clip02" }],
    audioTracks: [
      { assetId: "asset_audio1", role: "music", gainDb: -4, fadeInMs: 500, trimEndMs: 12000 },
    ],
  });
  await assert.rejects(
    createRender(env, project, { id: draft.id, ...draft, spec_json: JSON.stringify(draft) }, {
      model: "studio-assembly",
      clientRequestId: "req_mix000001",
    }),
    /rendered mix/,
  );
  const spec = await buildCompositionSpec(env, project, {
    title: "Mix with a bed",
    shots: [{ assetId: "asset_clip01" }, { assetId: "asset_clip02" }],
    audioAssetId: "asset_audio1",
    audioTracks: [
      { assetId: "asset_audio1", role: "music", gainDb: -4, fadeInMs: 500, fadeOutMs: 800, trimEndMs: 12000 },
    ],
  });
  assert.equal(spec.audioTracks.length, 1);
  assert.equal(spec.audioTracks[0].gainDb, -4);
  assert.equal(spec.audioTracks[0].fadeOutMs, 800);
});

test("render links use the provider-readable origin when one is configured", async () => {
  const { env } = await setup();
  const link = await signRenderLink(
    { ...env, RENDER_ORIGIN: "https://studio-worker.example.workers.dev" },
    { assetId: "asset_clip01", projectId: "prj_test" },
  );
  assert.equal(new URL(link).origin, "https://studio-worker.example.workers.dev");
  // The public address is unchanged for everything else.
  assert.equal(new URL(await signRenderLink(env, { assetId: "asset_clip01", projectId: "prj_test" })).origin, "https://studio.test");
});

test("render links are short-lived and bound to one asset and project", async () => {
  const { env } = await setup();
  const link = await signRenderLink(env, { assetId: "asset_clip01", projectId: "prj_test" });
  const url = new URL(link);
  assert.equal(url.hostname, "studio.test");
  assert.equal(url.pathname, "/render-input/asset_clip01");
  const query = Object.fromEntries(url.searchParams);
  assert.equal(
    await verifyRenderLink(env, {
      assetId: "asset_clip01",
      projectId: query.p,
      expires: query.e,
      signature: query.s,
    }),
    true,
  );
  assert.equal(
    await verifyRenderLink(env, {
      assetId: "asset_clip02",
      projectId: query.p,
      expires: query.e,
      signature: query.s,
    }),
    false,
  );
  assert.equal(
    await verifyRenderLink(env, {
      assetId: "asset_clip01",
      projectId: query.p,
      expires: String(Number(query.e) - 10_000_000),
      signature: query.s,
    }),
    false,
  );
  assert.equal(
    await verifyRenderLink(env, {
      assetId: "asset_clip01",
      projectId: "prj_other",
      expires: query.e,
      signature: query.s,
    }),
    false,
  );
});

test("a missing provider key fails definitively instead of becoming unknown", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, {
    kind: "audio",
    model: "studio-score",
    recipeId: "freeform",
    prompt: "A slow tide",
    clientRequestId: "req_nokey00001",
  });
  const { dispatchGeneration } = await import("../src/lib/jobs.mjs");
  const failed = await dispatchGeneration(env, generation);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "provider_not_configured");
  const budget = await env.DB.prepare("SELECT * FROM budgets WHERE project_id=?1").bind(project.id).first();
  assert.equal(budget.reserved_micro, 0);
});
