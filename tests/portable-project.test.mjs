// MIT. Fictional fixtures only. Proves the portable bundle round trip, hash
// verification, idempotent restore, refusal paths and read-only dry run against
// an in-memory D1/R2 stand-in. No network, provider, credential or production
// binding is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { sha256Hex, extensionFor } from '../src/lib/util.mjs';
import { createSongPlan, listSongPlans, updateSongPlan } from '../src/lib/song-plans.mjs';
import { saveSubject, listSubjects } from '../src/lib/subjects.mjs';
import { createComposition } from '../src/lib/jobs.mjs';
import { createPromoBrief } from '../src/lib/promo-briefs.mjs';
import { createFootagePlan, listFootagePlans } from '../src/lib/footage-plans.mjs';
import {
  MAX_PORTABLE_ASSET_BYTES,
  PORTABLE_FORMAT,
  PortableError,
  beginPortableImport,
  cleanupPortableImport,
  commitPortableImport,
  decodePortableBundle,
  encodePortableBundle,
  exportProjectManifest,
  portableInventory,
  previewPortableImport,
  stagePortableAsset,
  validateManifest,
} from '../src/lib/portable-bundle.mjs';
import { FakeBucket, PNG_1x1, SqliteD1, jpeg, setup, wav } from './harness.mjs';

const now = 1_760_000_000_000;
const mp4 = (value = 1) => new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, value, 0, 0, 0, 0, 0, 0, 0]);

function emptyEnv() {
  return {
    DB: new SqliteD1(),
    MEDIA: new FakeBucket(),
    PUBLIC_ORIGIN: 'https://fresh.studio.test',
    SESSION_SECRET: 'fresh-session-secret-that-is-long-enough',
  };
}

async function putAsset(env, project, { id, kind, bytes, mime, title = '', source = 'upload', parentAssetId = null, generationId = null, durationMs = null, width = null, height = null, deletedAt = null }) {
  const sha = await sha256Hex(bytes);
  const key = `projects/${project.id}/assets/${id}/original.${extensionFor(mime)}`;
  if (!deletedAt) await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    'INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18,?19,1)',
  ).bind(id, project.id, kind, key, mime, bytes.byteLength, width, height, durationMs, kind === 'audio' ? 8000 : null, kind === 'audio' ? 1 : null, sha, title, '', source, parentAssetId, generationId, now, deletedAt).run();
  return env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(id).first();
}

async function insertGeneration(env, project, row) {
  await env.DB.prepare(
    'INSERT INTO generations(id,project_id,composition_id,client_request_id,kind,recipe_id,provider,model,model_version,request_json,provider_request_id,provider_status_url,provider_response_url,status,error_code,error_detail,retained_key,retained_mime,retained_bytes,output_asset_id,cost_estimate_micro,cost_reserved_micro,cost_allocated_micro,provider_charged_micro,created_at,updated_at,submitted_at,completed_at,cancelled_at,deleted_at,delete_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,NULL,1)',
  ).bind(
    row.id, project.id, row.compositionId ?? null, row.clientRequestId ?? `req_${row.id}`, row.kind, row.recipeId ?? 'builtin:editorial-still', row.provider ?? 'fal', row.model ?? 'studio-fill', row.modelVersion ?? 'test-v1', JSON.stringify(row.request ?? {}), row.providerRequestId ?? null, row.providerStatusUrl ?? null, row.providerResponseUrl ?? null, row.status ?? 'saved', row.errorCode ?? null, row.errorDetail ?? null, row.retainedKey ?? null, row.retainedMime ?? null, row.retainedBytes ?? null, row.outputAssetId ?? null, row.costEstimateMicro ?? 1000, row.costReservedMicro ?? 1000, row.costAllocatedMicro ?? 1000, null, now, now, row.submittedAt ?? null, row.completedAt ?? now, row.cancelledAt ?? null,
  ).run();
}

async function fixture() {
  const { env, project } = await setup();
  env.FAL_KEY = 'fictional-provider-key-must-not-export';
  env.BRIDGE_SECRET = 'fictional-bridge-secret-must-not-export';
  env.SESSION_SECRET = 'fictional-session-secret-must-not-export';
  await env.DB.prepare("UPDATE projects SET creative_direction=?2,references_json=?3,defaults_json=?4,updated_at=?5 WHERE id=?1")
    .bind(project.id, 'A private studio direction', JSON.stringify([{ id: 'ref1', title: 'Owner board', url: 'https://example.test/board', note: 'palette' }]), JSON.stringify({ aspect: '1:1', style: 'print' }), now).run();
  const fresh = await env.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(project.id).first();

  const still = await putAsset(env, fresh, { id: 'asset_still', kind: 'image', bytes: PNG_1x1, mime: 'image/png', title: 'Opening still', width: 1, height: 1 });
  const variant = await putAsset(env, fresh, { id: 'asset_variant', kind: 'image', bytes: jpeg(4, 4), mime: 'image/jpeg', title: 'Generated variant', source: 'variant', parentAssetId: still.id, generationId: 'gen_image', width: 4, height: 4 });
  const video = await putAsset(env, fresh, { id: 'asset_video', kind: 'video', bytes: mp4(1), mime: 'video/mp4', title: 'Take one', durationMs: 3000 });
  const video2 = await putAsset(env, fresh, { id: 'asset_video2', kind: 'video', bytes: mp4(2), mime: 'video/mp4', title: 'Take two', durationMs: 3000 });
  const audio = await putAsset(env, fresh, { id: 'asset_audio', kind: 'audio', bytes: wav({ seconds: 4 }), mime: 'audio/wav', title: 'Song bed', durationMs: 4000 });
  await putAsset(env, fresh, { id: 'asset_deleted', kind: 'image', bytes: PNG_1x1, mime: 'image/png', title: 'Removed still', deletedAt: now - 1 });

  await insertGeneration(env, fresh, { id: 'gen_image', kind: 'image', recipeId: 'rcp_custom', status: 'saved', outputAssetId: variant.id, request: { prompt: 'A private fictional prompt', referenceAssetId: still.id, maskAssetId: still.id, settings: { aspect: '1:1' } }, providerStatusUrl: 'https://provider.test/status/private', providerResponseUrl: 'https://provider.test/result/private' });
  await insertGeneration(env, fresh, { id: 'gen_pending', kind: 'video', status: 'running', request: { prompt: 'Never replay this provider job', referenceAssetId: still.id }, providerStatusUrl: 'https://provider.test/status/pending', providerRequestId: 'prov_pending' });

  await env.DB.prepare('UPDATE assets SET generation_id=?2 WHERE id=?1').bind(variant.id, 'gen_image').run();
  await env.DB.prepare("INSERT INTO recipes(id,project_id,slug,title,description,kind,prompt_template,controls_json,version,created_at) VALUES('rcp_custom',?1,'fictional-recipe','Fictional recipe','Owner recipe','image','A {subject} plate','[{\"key\":\"subject\"}]',3,?2)")
    .bind(fresh.id, now).run();

  const subject = await saveSubject(env, fresh, { type: 'person', name: 'Fictional Subject', traits: 'round glasses', referenceAssetId: still.id, referenceRole: 'face', rightsConfirmed: true });
  const plan = await createSongPlan(env, fresh, { songAssetId: audio.id, rightsConfirmed: true, title: 'Portable plan', treatment: 'quiet', aspect: '16:9', startMs: 0, endMs: 4000, sceneCount: 2 });
  await updateSongPlan(env, fresh, plan.id, {
    expectedRevision: 1, title: plan.title, treatment: plan.treatment, aspect: plan.aspect, startMs: 0, endMs: 4000,
    scenes: plan.scenes.map((scene, index) => ({ ...scene, direction: index ? 'second beat' : 'first beat', referenceAssetId: still.id, selectedTakeId: index ? video2.id : video.id, ...(index ? {} : { subjectOrigin: { subjectId: subject.id, revision: 1 } }) })),
  });
  await createComposition(env, fresh, { title: 'Portable storyboard', shots: [{ assetId: video.id }, { assetId: video2.id }], audioAssetId: audio.id, audioTracks: [{ assetId: audio.id, role: 'music' }] });
  await createFootagePlan(env, fresh, { sourceAssetId: video.id, rightsConfirmed: true, title: 'Portable cut map', aspect: '16:9', sourceStartMs: 0, sourceEndMs: 3000, sceneCount: 2 });
  await createPromoBrief(env, fresh, { title: 'Portable promo', audience: 'owners', brief: 'private', cta: 'review', aspect: '16:9', targetSeconds: 15, scenes: [{ spoken: 'one', visual: 'a' }, { spoken: 'two', visual: 'b' }] });
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,revoked_at,hidden,listed,attribution_json) VALUES('pub_private',?1,?2,?3,'portablepage','Portable page','was public once',1,?4,NULL,0,1,'[]')").bind(fresh.id, video.id, still.id, now + 1).run();
  await env.DB.prepare("INSERT INTO budgets(project_id,period,allowance_micro,reserved_micro,spent_micro,updated_at) VALUES(?1,'2026-11',5000000,1000,0,?2)").bind(fresh.id, now).run();
  return { env, project: fresh };
}

async function bundleOf(env, project) {
  const manifest = await exportProjectManifest(env, project);
  const blobs = new Map();
  for (const blob of manifest.blobs) {
    const asset = manifest.assets.find((entry) => entry.content === 'media' && entry.blobSha256 === blob.sha256);
    const object = await env.MEDIA.get(asset.r2_key ?? `projects/${project.id}/assets/${asset.id}/original.${extensionFor(asset.mime)}`);
    blobs.set(blob.sha256, new Uint8Array(await object.arrayBuffer()));
  }
  return { manifest, blobs, archive: await encodePortableBundle(manifest, blobs) };
}

function snapshot(env) {
  const tables = ['projects', 'assets', 'generations', 'compositions', 'recipes', 'subject_versions', 'song_plans', 'footage_plans', 'publications', 'promo_briefs', 'budgets', 'project_bundle_imports'];
  return {
    counts: Object.fromEntries(tables.map((table) => [table, env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n])),
    keys: [...env.MEDIA.objects.keys()].sort(),
  };
}

async function restore(fresh, manifest, blobs) {
  const started = await beginPortableImport(fresh, manifest);
  for (const entry of started.assets) {
    const source = manifest.assets.find((asset) => asset.id === entry.sourceId);
    await stagePortableAsset(fresh, started.importId, entry.sourceId, blobs.get(source.blobSha256));
  }
  return { started, committed: await commitPortableImport(fresh, started.importId, { confirm: true }) };
}

test('portable export is deterministic and round-trips exact media bytes and hashes', async () => {
  const { env, project } = await fixture();
  const first = await bundleOf(env, project);
  const second = await bundleOf(env, project);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  assert.equal(first.manifest.format, PORTABLE_FORMAT);
  assert.equal(first.manifest.bundleId, first.manifest.integrity.contentSha256);
  assert.equal(first.manifest.stats.mediaAssets, 5);
  assert.equal(first.manifest.stats.tombstones, 1);
  assert.equal(first.manifest.blobs.length, 5);
  assert.equal(first.manifest.assets.find((asset) => asset.id === 'asset_deleted').blobSha256, null);
  const decoded = await decodePortableBundle(first.archive);
  assert.equal(decoded.validated.bundleId, first.manifest.bundleId);
  for (const blob of decoded.manifest.blobs) {
    assert.equal(await sha256Hex(decoded.blobs.get(blob.sha256)), blob.sha256);
    assert.equal(decoded.blobs.get(blob.sha256).byteLength, blob.bytes);
  }
  assert.match(JSON.stringify(decoded.manifest), /A private fictional prompt/);
  assert.doesNotMatch(JSON.stringify(decoded.manifest), /fictional-provider-key-must-not-export|fictional-bridge-secret-must-not-export|fictional-session-secret-must-not-export/);
  assert.doesNotMatch(Buffer.from(first.archive).toString('latin1'), /fictional-provider-key-must-not-export/);
  assert.deepEqual(decoded.manifest.excluded[0].includes('provider keys'), true);
});

test('restore into a fresh installation preserves bytes, references and editable state', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs, archive } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const preview = await previewPortableImport(fresh, manifest);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.plan.contentBytes, manifest.stats.contentBytes);
  const tooSmall = await previewPortableImport(fresh, manifest, { storageLimitBytes: 1 }).catch((error) => error);
  assert.equal(tooSmall.code, 'insufficient_storage');
  assert.deepEqual(snapshot(fresh), { counts: { projects: 0, assets: 0, generations: 0, compositions: 0, recipes: 0, subject_versions: 0, song_plans: 0, footage_plans: 0, publications: 0, promo_briefs: 0, budgets: 0, project_bundle_imports: 0 }, keys: [] });
  const { started, committed } = await restore(fresh, manifest, blobs);
  assert.equal(started.status, 'staging');
  assert.equal(committed.status, 'committed');
  const projectId = committed.projectId;
  const restored = await fresh.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(projectId).first();
  assert.equal(restored.name, project.name);
  assert.equal(restored.creative_direction, 'A private studio direction');
  assert.deepEqual(JSON.parse(restored.references_json), JSON.parse(project.references_json));
  assert.deepEqual(JSON.parse(restored.defaults_json), JSON.parse(project.defaults_json));
  assert.equal(restored.workspace_id, null);

  for (const asset of manifest.assets.filter((entry) => entry.content === 'media')) {
    const newId = committed.map.assets[asset.id];
    const row = await fresh.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(newId).first();
    assert.equal(row.project_id, projectId);
    assert.equal(row.sha256, asset.sha256);
    assert.equal(row.bytes, asset.bytes);
    assert.notEqual(row.r2_key, `projects/${project.id}/assets/${asset.id}/original.${extensionFor(asset.mime)}`);
    const object = await fresh.MEDIA.get(row.r2_key);
    const bytes = new Uint8Array(await object.arrayBuffer());
    assert.equal(bytes.byteLength, asset.bytes);
    assert.equal(await sha256Hex(bytes), asset.sha256);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(blobs.get(asset.blobSha256)));
  }
  const tombstone = await fresh.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(committed.map.assets.asset_deleted).first();
  assert.ok(tombstone.deleted_at);
  assert.equal(await fresh.MEDIA.get(tombstone.r2_key), null);

  const generation = await fresh.DB.prepare('SELECT * FROM generations WHERE id=?1').bind(committed.map.generations.gen_image).first();
  assert.equal(generation.output_asset_id, committed.map.assets.asset_variant);
  assert.equal(generation.status, 'saved');
  assert.equal(generation.provider_status_url, null);
  assert.match(generation.request_json, new RegExp(committed.map.assets.asset_still));
  assert.doesNotMatch(generation.request_json, /asset_still/);
  const pending = await fresh.DB.prepare('SELECT * FROM generations WHERE id=?1').bind(committed.map.generations.gen_pending).first();
  assert.equal(pending.status, 'failed');
  assert.equal(pending.error_code, 'restored_not_dispatched');
  assert.equal(pending.provider_request_id, null);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM budgets').first()).n, 0);

  const publication = await fresh.DB.prepare('SELECT * FROM publications WHERE id=?1').bind(committed.map.publications.pub_private).first();
  assert.equal(publication.asset_id, committed.map.assets.asset_video);
  assert.ok(publication.revoked_at);
  assert.equal(publication.hidden, 1);
  assert.equal(publication.listed, 0);

  const plans = await listSongPlans(fresh, { id: projectId });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].scenes[0].referenceAssetId, committed.map.assets.asset_still);
  assert.equal(plans[0].scenes[1].selectedTakeId, committed.map.assets.asset_video2);
  assert.equal(plans[0].captions, undefined);
  const subjects = await listSubjects(fresh, { id: projectId }, true);
  assert.equal(subjects[0].referenceAssetId, committed.map.assets.asset_still);
  assert.equal(subjects[0].name, 'Fictional Subject');
  assert.equal((await listFootagePlans(fresh, { id: projectId }))[0].sourceAssetId, committed.map.assets.asset_video);

  // Editable work reopens through the ordinary project API after restore.
  const cookie = `studio_session=${await createSession(fresh)}`;
  const get = await worker.fetch(new Request(`https://fresh.studio.test/api/projects/${projectId}`, { headers: { cookie } }), fresh);
  assert.equal(get.status, 200);
  const view = await get.json();
  assert.equal(view.assets.length, 5);
  assert.equal(view.compositions.length, 1);
  assert.equal(view.compositions[0].shots[0].assetId, committed.map.assets.asset_video);
  assert.equal(view.compositions[0].audioAssetId, committed.map.assets.asset_audio);
  assert.equal(view.publications.length, 0);
  const edited = await updateSongPlan(fresh, { id: projectId }, plans[0].id, {
    expectedRevision: plans[0].revision, title: 'Edited after restore', treatment: plans[0].treatment, aspect: plans[0].aspect, startMs: plans[0].startMs, endMs: plans[0].endMs,
    scenes: plans[0].scenes.map((scene) => ({ id: scene.id, startMs: scene.startMs, endMs: scene.endMs, direction: `${scene.direction} edited`, referenceAssetId: scene.referenceAssetId, selectedTakeId: scene.selectedTakeId, subjectOrigin: scene.subjectOrigin ?? null })),
  });
  assert.equal(edited.revision, 3);
  assert.equal(edited.title, 'Edited after restore');
  const patched = await worker.fetch(new Request(`https://fresh.studio.test/api/projects/${projectId}`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ references: [{ id: 'ref2', title: 'Restored board', url: 'https://example.test/restored' }] }) }), fresh);
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).project.id, projectId);

  // The archive is still verifiable after restore.
  assert.equal((await decodePortableBundle(archive)).manifest.bundleId, manifest.bundleId);
});

test('tampered manifest or media is refused without creating a project', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs, archive } = await bundleOf(env, project);
  const tamperedManifest = structuredClone(manifest);
  tamperedManifest.project.name = 'Tampered name';
  await assert.rejects(validateManifest(tamperedManifest), (error) => error instanceof PortableError && error.code === 'integrity_failed');

  const manifestByteFlip = new Uint8Array(archive);
  const magicLength = Buffer.byteLength('STUDIO-PROJECT-BUNDLE/1\n');
  manifestByteFlip[magicLength + 11 + 20] ^= 0xff;
  await assert.rejects(decodePortableBundle(manifestByteFlip), (error) => ['integrity_failed', 'invalid_bundle'].includes(error.code));

  const assetFlip = new Uint8Array(archive);
  const manifestLength = Number(new TextDecoder().decode(assetFlip.subarray(magicLength, magicLength + 11)).slice(0, 10));
  assetFlip[magicLength + 11 + manifestLength] ^= 0xff;
  await assert.rejects(decodePortableBundle(assetFlip), (error) => error.code === 'integrity_failed');

  const fresh = emptyEnv();
  const before = snapshot(fresh);
  await assert.rejects(validateManifest({ ...manifest, schemaVersion: 2 }), (error) => error.code === 'integrity_failed' || error.code === 'incompatible_schema');
  const pathTamper = structuredClone(manifest);
  pathTamper.blobs[0].path = '../escape';
  // Re-sealing a path-traversal manifest must still fail the path rule.
  const { sealManifest } = await import('../src/lib/portable-bundle.mjs');
  const { bundleId, integrity, ...content } = pathTamper;
  const resealed = await sealManifest(content);
  await assert.rejects(validateManifest(resealed), (error) => error.code === 'path_traversal');
  const duplicate = structuredClone(manifest);
  duplicate.assets.push({ ...duplicate.assets[0] });
  const { bundleId: _b, integrity: _i, ...duplicateContent } = duplicate;
  await assert.rejects(validateManifest(await sealManifest(duplicateContent)), (error) => error.code === 'duplicate_entry');
  const oversized = structuredClone(manifest);
  oversized.blobs[0].bytes = MAX_PORTABLE_ASSET_BYTES + 1;
  const { bundleId: _ob, integrity: _oi, ...oversizedContent } = oversized;
  await assert.rejects(validateManifest(await sealManifest(oversizedContent)), (error) => error.code === 'invalid_bundle');
  assert.deepEqual(snapshot(fresh), before);
});

test('missing media fails clearly and a resumed restore converges without duplicates', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const started = await beginPortableImport(fresh, manifest);
  const only = started.assets[0];
  const source = manifest.assets.find((asset) => asset.id === only.sourceId);
  await stagePortableAsset(fresh, started.importId, only.sourceId, blobs.get(source.blobSha256));
  await assert.rejects(commitPortableImport(fresh, started.importId, { confirm: true }), (error) => error.code === 'missing_media' && error.report.missing.length === started.assets.length - 1);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 0);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n, 0);
  assert.equal((await fresh.DB.prepare('SELECT status FROM project_bundle_imports WHERE id=?1').bind(started.importId).first()).status, 'staging');
  const resumed = await beginPortableImport(fresh, manifest);
  assert.equal(resumed.importId, started.importId);
  assert.equal(resumed.resumed, true);
  for (const entry of resumed.assets.slice(1)) {
    const asset = manifest.assets.find((item) => item.id === entry.sourceId);
    await stagePortableAsset(fresh, resumed.importId, entry.sourceId, blobs.get(asset.blobSha256));
  }
  const committed = await commitPortableImport(fresh, resumed.importId, { confirm: true });
  assert.equal(committed.status, 'committed');
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n, manifest.assets.length);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM project_bundle_imports').first()).n, 1);
  const status = await worker.fetch(new Request(`https://fresh.studio.test/api/studio/restore/${started.importId}`, { headers: { cookie: `studio_session=${await createSession(fresh)}` } }), fresh);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).status, 'committed');
});

test('duplicate import is idempotent and dry run writes nothing', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const before = snapshot(fresh);
  const preview = await previewPortableImport(fresh, manifest);
  assert.equal(preview.dryRun, true);
  assert.deepEqual(snapshot(fresh), before);
  const first = await restore(fresh, manifest, blobs);
  assert.equal(first.committed.status, 'committed');
  const after = snapshot(fresh);
  const second = await beginPortableImport(fresh, manifest);
  assert.equal(second.status, 'already_imported');
  assert.equal(second.projectId, first.committed.projectId);
  assert.deepEqual(snapshot(fresh), after);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM project_bundle_imports').first()).n, 1);
  const replayed = await commitPortableImport(fresh, first.started.importId, { confirm: true });
  assert.equal(replayed.status, 'already_imported');
  assert.deepEqual(snapshot(fresh), after);
});

test('conflicting project identity is refused and a different bundle does not overwrite it', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  const fresh = emptyEnv();
  await restore(fresh, manifest, blobs);
  const other = structuredClone(manifest);
  other.project.name = 'A different owner bundle';
  other.excluded = [...other.excluded, 'A different bundle'];
  const { bundleId: _otherId, integrity: _otherIntegrity, ...otherContent } = other;
  const { sealManifest } = await import('../src/lib/portable-bundle.mjs');
  const resealed = await sealManifest(otherContent);
  const preview = await previewPortableImport(fresh, resealed).catch((error) => error);
  assert.equal(preview.code, 'project_slug_exists');
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
});

test('cleanup is opt-in and never deletes referenced originals', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const started = await beginPortableImport(fresh, manifest);
  const only = started.assets[0];
  const source = manifest.assets.find((asset) => asset.id === only.sourceId);
  await stagePortableAsset(fresh, started.importId, only.sourceId, blobs.get(source.blobSha256));
  const stagedKey = only.key;
  assert.ok(await fresh.MEDIA.get(stagedKey));
  await assert.rejects(cleanupPortableImport(fresh, started.importId), (error) => error.code === 'confirmation_required');
  assert.ok(await fresh.MEDIA.get(stagedKey));
  const cleaned = await cleanupPortableImport(fresh, started.importId, { confirm: true });
  assert.equal(cleaned.deleted.length, 1);
  assert.equal(await fresh.MEDIA.get(stagedKey), null);
  assert.equal(cleaned.originalAssetsTouched, 0);
  assert.ok(await env.MEDIA.get(`projects/${project.id}/assets/asset_still/original.png`));

  const completed = await restore(fresh, manifest, blobs);
  const keysBefore = [...fresh.MEDIA.objects.keys()].sort();
  const kept = await cleanupPortableImport(fresh, completed.started.importId, { confirm: true });
  assert.equal(kept.deleted.length, 0);
  assert.deepEqual([...fresh.MEDIA.objects.keys()].sort(), keysBefore);
  assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n, manifest.assets.length);
});

test('an object staged before a crash is recorded on retry and can be cleaned up', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const started = await beginPortableImport(fresh, manifest);
  const only = started.assets[0];
  const source = manifest.assets.find((asset) => asset.id === only.sourceId);
  const first = await stagePortableAsset(fresh, started.importId, only.sourceId, blobs.get(source.blobSha256));
  // The worker can die after the R2 write and before the staging list is saved.
  // The object is real, but the import no longer remembers it.
  await fresh.DB.prepare("UPDATE project_bundle_imports SET staged_keys_json='[]' WHERE id=?1").bind(started.importId).run();
  const retry = await stagePortableAsset(fresh, started.importId, only.sourceId, blobs.get(source.blobSha256));
  assert.equal(retry.status, 'already_staged');
  assert.equal(retry.key, first.key);
  const row = await fresh.DB.prepare('SELECT staged_keys_json FROM project_bundle_imports WHERE id=?1').bind(started.importId).first();
  assert.deepEqual(JSON.parse(row.staged_keys_json), [first.key]);
  const cleaned = await cleanupPortableImport(fresh, started.importId, { confirm: true });
  assert.deepEqual(cleaned.deleted, [first.key]);
  assert.equal(await fresh.MEDIA.get(first.key), null);
  assert.equal(cleaned.originalAssetsTouched, 0);
});

test('read-only inventory reports imports and duplicate content without mutating', async () => {
  const { env, project } = await fixture();
  const { manifest, blobs } = await bundleOf(env, project);
  await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) SELECT 'asset_dupe',project_id,kind,'projects/'||project_id||'/assets/asset_dupe/original.png',mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,'Duplicate',caption,source,NULL,NULL,created_at,updated_at,NULL,1 FROM assets WHERE id='asset_still'").run();
  const fresh = emptyEnv();
  await restore(fresh, manifest, blobs);
  const before = snapshot(fresh);
  const inventory = await portableInventory(fresh);
  assert.equal(inventory.readOnly, true);
  assert.equal(inventory.imports.length, 1);
  assert.equal(inventory.imports[0].status, 'committed');
  assert.deepEqual(snapshot(fresh), before);
  const sourceInventory = await portableInventory(env, { projectId: project.id });
  assert.ok(sourceInventory.duplicateContent.some((entry) => entry.sha256 === manifest.assets.find((asset) => asset.id === 'asset_still').sha256 && entry.count === 2));
  assert.deepEqual(snapshot(fresh), before);
});

test('a credential-shaped project field refuses export rather than leaking it', async () => {
  const { env, project } = await fixture();
  await env.DB.prepare("UPDATE projects SET defaults_json=?2 WHERE id=?1").bind(project.id, JSON.stringify({ apiKey: 'should-never-leave' })).run();
  await assert.rejects(exportProjectManifest(env, await env.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(project.id).first()), (error) => error.code === 'secret_material_present');
});

test('unsupported or oversized records are rejected before staging', async () => {
  const { env, project } = await fixture();
  const { manifest } = await bundleOf(env, project);
  const fresh = emptyEnv();
  const before = snapshot(fresh);
  const bad = structuredClone(manifest);
  bad.project.slug = '../escape';
  const { bundleId: _b, integrity: _i, ...content } = bad;
  const { sealManifest } = await import('../src/lib/portable-bundle.mjs');
  await assert.rejects(validateManifest(await sealManifest(content)), (error) => error.code === 'invalid_bundle');
  assert.deepEqual(snapshot(fresh), before);
});
