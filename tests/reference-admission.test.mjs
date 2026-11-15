import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, jpeg } from './harness.mjs';
import { createGeneration, dispatchGeneration, budgetSnapshot } from '../src/lib/jobs.mjs';

for (const unavailable of ['deleted', 'missing bytes']) {
  test(`a reference ${unavailable} after admission fails safely without dispatch or reservation`, async () => {
    const { env, project } = await setup({ allowance: 100000 });
    const key = 'fixture/reference.jpg';
    const bytes = jpeg(512, 512);
    await env.MEDIA.put(key, bytes);
    await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES(?1,?2,'image',?3,'image/jpeg',?4,512,512,'fixture','Reference','upload',1,1)")
      .bind('asset_reference', project.id, key, bytes.length).run();
    let calls = 0;
    env.AI = { async run() { calls++; throw new Error('unexpected provider dispatch'); } };
    const { generation } = await createGeneration(env, project, {
      kind: 'image', model: 'studio-detail', prompt: 'A fictional scene', aspect: 'square', referenceAssetId: 'asset_reference', clientRequestId: 'reference_fixture_1',
    });
    assert.equal(generation.status, 'admitted');
    assert.ok((await budgetSnapshot(env, project.id)).reservedMicro > 0);
    if (unavailable === 'deleted') await env.DB.prepare('UPDATE assets SET deleted_at=2 WHERE id=?1').bind('asset_reference').run();
    else await env.MEDIA.delete(key);
    const result = await dispatchGeneration(env, generation);
    assert.equal(result.status, 'failed');
    assert.equal(result.error_code, 'reference_unavailable');
    assert.equal(calls, 0);
    assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 0);
  });
}

test('a failed reference lookup cannot release a reservation claimed by another dispatcher', async () => {
  const { env, project } = await setup({ allowance: 100000 });
  const key = 'fixture/concurrent.jpg';
  const bytes = jpeg(512, 512);
  await env.MEDIA.put(key, bytes);
  await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES(?1,?2,'image',?3,'image/jpeg',?4,512,512,'fixture','Reference','upload',1,1)")
    .bind('asset_concurrent', project.id, key, bytes.length).run();
  const { generation } = await createGeneration(env, project, {
    kind: 'image', model: 'studio-detail', prompt: 'A fictional scene', aspect: 'square', referenceAssetId: 'asset_concurrent', clientRequestId: 'reference_fixture_2',
  });
  let releaseLookup, releaseProvider, providerStarted;
  const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const providerEntered = new Promise(resolve => { providerStarted = resolve; });
  const originalGet = env.MEDIA.get.bind(env.MEDIA);
  let lookups = 0;
  env.MEDIA.get = async (...args) => {
    if (++lookups === 1) { await lookupGate; return null; }
    return originalGet(...args);
  };
  let calls = 0;
  env.AI = { async run() { calls++; providerStarted(); await providerGate; throw new Error('lost provider response'); } };
  const first = dispatchGeneration(env, generation);
  // Ensure the first caller is waiting on its reference before starting the second.
  while (lookups === 0) await new Promise(resolve => setImmediate(resolve));
  const second = dispatchGeneration(env, generation);
  await providerEntered;
  releaseLookup();
  assert.equal((await first).status, 'submitting');
  assert.ok((await budgetSnapshot(env, project.id)).reservedMicro > 0);
  releaseProvider();
  assert.equal((await second).status, 'unknown');
  assert.equal(calls, 1);
  assert.ok((await budgetSnapshot(env, project.id)).reservedMicro > 0);
});

for (const unavailable of ['deleted', 'missing bytes']) {
  test(`a mask ${unavailable} after admission fails safely before the edit provider`, async () => {
    const { env, project } = await setup({ allowance: 100000 });
    const bytes = jpeg(512, 512);
    for (const id of ['source', 'mask']) {
      await env.MEDIA.put(`fixture/${id}.jpg`, bytes);
      await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES(?1,?2,'image',?3,'image/jpeg',?4,512,512,'fixture','Still','upload',1,1)")
        .bind(`asset_${id}`, project.id, `fixture/${id}.jpg`, bytes.length).run();
    }
    const { generation } = await createGeneration(env, project, {
      kind: 'image', model: 'studio-fill', prompt: 'A replacement sky', aspect: 'match-reference', referenceAssetId: 'asset_source', maskAssetId: 'asset_mask', clientRequestId: 'mask_fixture_1',
    });
    assert.equal(generation.status, 'admitted');
    assert.ok((await budgetSnapshot(env, project.id)).reservedMicro > 0);
    if (unavailable === 'deleted') await env.DB.prepare('UPDATE assets SET deleted_at=2 WHERE id=?1').bind('asset_mask').run();
    else await env.MEDIA.delete('fixture/mask.jpg');
    // A missing FAL key would also be reported as a provider error if dispatch were attempted.
    const result = await dispatchGeneration(env, generation);
    assert.equal(result.status, 'failed');
    assert.equal(result.error_code, 'reference_unavailable');
    assert.equal((await budgetSnapshot(env, project.id)).reservedMicro, 0);
  });
}
