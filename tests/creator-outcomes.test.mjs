// MIT. Focused, offline D1 harness checks for the private creator-outcomes
// slice. Real migration SQL, in-memory SQLite, no provider and no routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutcomeWindow, readCreatorOutcomes } from '../src/lib/creator-outcomes.ts';
import { setup } from './harness.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0); // 2026-11-19T12:00:00Z
const source = { producer: 'test-harness', revision: 'abc123', now: NOW };
const iso = (millis) => new Date(millis).toISOString();

function asset(env, projectId, { id, at, source: kind = 'generated', bytes = 100, generationId = null, deletedAt = null }) {
  return env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,sha256,source,generation_id,created_at,updated_at,deleted_at)
     VALUES(?1,?2,'image',?3,'image/png',?4,?5,?6,?7,?8,?8,?9)`,
  )
    .bind(id, projectId, `secret-key-${id}`, bytes, 'h'.repeat(64), kind, generationId, at, deletedAt)
    .run();
}

// Insert with a null output link: the real schema makes it a foreign key to an
// asset, so fixtures link the two only after both rows exist.
function generation(env, projectId, { id, at, status = 'saved', completedAt = at, provider = 'fal', deletedAt = null }) {
  return env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,
       cost_estimate_micro,cost_reserved_micro,created_at,updated_at,completed_at,deleted_at)
     VALUES(?1,?2,?3,'image','recipe',?4,'model','{"prompt":"SECRET PROMPT"}',?5,0,0,?6,?6,?7,?8)`,
  )
    .bind(id, projectId, `request-${id}`, provider, status, at, completedAt, deletedAt)
    .run();
}

function linkGeneration(env, generationId, assetId) {
  return env.DB.prepare('UPDATE generations SET output_asset_id=?1 WHERE id=?2').bind(assetId, generationId).run();
}

function localReceipt(env, projectId, { id, outputAssetId, createdAt, expiresAt }) {
  return env.DB.prepare(
    'INSERT INTO local_render_receipts(id,project_id,output_asset_id,snapshot_json,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6)',
  )
    .bind(id, projectId, outputAssetId, '{"secret":"snapshot"}', createdAt, expiresAt)
    .run();
}

function footageReceipt(env, projectId, { id, outputAssetId, createdAt, expiresAt }) {
  return env.DB.prepare(
    `INSERT INTO footage_export_receipts(id,project_id,output_asset_id,plan_id,plan_revision,source_asset_id,source_sha256,snapshot_json,created_at,expires_at)
     VALUES(?1,?2,?3,'plan',1,'source','h','{"secret":"snapshot"}',?4,?5)`,
  )
    .bind(id, projectId, outputAssetId, createdAt, expiresAt)
    .run();
}

function audit(env, projectId, { id, action, previous, resulting, at }) {
  return env.DB.prepare(
    `INSERT INTO publication_audit(id,project_id,publication_id,asset_id,actor,session_mode,action,previous_state,resulting_state,created_at)
     VALUES(?1,?2,'pub','asset','SECRET ACTOR','owner',?3,?4,?5,?6)`,
  )
    .bind(id, projectId, action, previous, resulting, at)
    .run();
}

function otherProject(env) {
  const id = 'prj_other';
  return env.DB.prepare('INSERT INTO projects(id,name,slug,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)')
    .bind(id, 'Other', 'slug-other', NOW)
    .run();
}

function window(params = new URLSearchParams(), now = NOW) {
  const parsed = parseOutcomeWindow(params, now);
  assert.ok(parsed, 'expected a valid window');
  return parsed;
}

test('parseOutcomeWindow: default and days presets are complete UTC day windows', () => {
  const w = window();
  assert.deepEqual(
    { from: w.fromInclusive, until: w.toExclusive },
    { from: '2026-11-12', until: '2026-11-19' },
  );
  assert.equal(w.fromMillis, Date.UTC(2026, 10, 12));
  assert.equal(w.toMillis, Date.UTC(2026, 10, 19));
  assert.equal((w.toMillis - w.fromMillis) / DAY, 7);

  const seven = window(new URLSearchParams('days=7'));
  assert.deepEqual(
    { from: seven.fromInclusive, until: seven.toExclusive },
    { from: '2026-11-12', until: '2026-11-19' },
  );
  const thirty = window(new URLSearchParams('days=30'));
  assert.deepEqual(
    { from: thirty.fromInclusive, until: thirty.toExclusive },
    { from: '2026-10-20', until: '2026-11-19' },
  );
  assert.equal((thirty.toMillis - thirty.fromMillis) / DAY, 30);

  // A preset may not be duplicated, given another value, or mixed with dates.
  for (const query of [
    'days=30&days=7',
    'days=1',
    'days=14',
    'days=',
    'days=7&from=2026-11-01&until=2026-11-19',
    'days=30&from=2026-11-01',
  ]) {
    assert.equal(parseOutcomeWindow(new URLSearchParams(query), NOW), null, query);
  }
});

test('parseOutcomeWindow: explicit half-open days, 1 to 30, no future or duplicates', () => {
  const one = window(new URLSearchParams('from=2026-11-18&until=2026-11-19'));
  assert.equal((one.toMillis - one.fromMillis) / DAY, 1);
  const thirty = window(new URLSearchParams('from=2026-10-20&until=2026-11-19'));
  assert.equal((thirty.toMillis - thirty.fromMillis) / DAY, 30);

  for (const query of [
    'from=2026-11-01',
    'until=2026-11-19',
    'from=2026-11-19&until=2026-11-19',
    'from=2026-11-20&until=2026-11-19',
    'from=2026-11-19&until=2026-11-20',
    'from=2026-10-19&until=2026-11-19',
    'from=2026-11-18&until=2026-11-20',
    'from=2026-11-1&until=2026-11-19',
    'from=2026-02-30&until=2026-11-19',
    'from=2026-11-01&from=2026-11-02&until=2026-11-19',
    'from=2026-11-01&until=2026-11-18&until=2026-11-19',
    'from=not-a-day&until=2026-11-19',
  ]) {
    assert.equal(parseOutcomeWindow(new URLSearchParams(query), NOW), null, query);
  }
});

test('readCreatorOutcomes: counted only from qualified saved, receipt-bound and audited rows', async () => {
  const { env } = await setup();
  const projectId = 'prj_test';
  const t1 = NOW - 5 * DAY;
  const t2 = NOW - 4 * DAY;
  const t3 = NOW - 1 * DAY;

  // Two jobs with exact two-way links count. A saved row without an output link does not.
  await generation(env, projectId, { id: 'gen_a', at: t1 });
  await asset(env, projectId, { id: 'asset_a', at: t1, source: 'generated', generationId: 'gen_a' });
  await linkGeneration(env, 'gen_a', 'asset_a');

  await generation(env, projectId, { id: 'gen_b', at: t1 }); // no output link
  await asset(env, projectId, { id: 'asset_b', at: t1, source: 'variant', generationId: 'gen_b' });

  await generation(env, projectId, { id: 'gen_c', at: t2 });
  await asset(env, projectId, { id: 'asset_c', at: t2, source: 'assembled', generationId: 'gen_c' });
  await linkGeneration(env, 'gen_c', 'asset_c');

  // Two exact receipts, saved inside their validity and inside the window.
  await localReceipt(env, projectId, { id: 'lr1', outputAssetId: 'lr_out', createdAt: t1 - 1000, expiresAt: t1 + 1000 });
  await asset(env, projectId, { id: 'lr_out', at: t1, source: 'upload' });
  await footageReceipt(env, projectId, { id: 'fr1', outputAssetId: 'fr_out', createdAt: t2 - 1000, expiresAt: t2 + 1000 });
  await asset(env, projectId, { id: 'fr_out', at: t2, source: 'upload' });

  // Three real publication transitions.
  await audit(env, projectId, { id: 'audit_p', action: 'publish', previous: '{"listed":false}', resulting: '{"listed":true}', at: t3 });
  await audit(env, projectId, { id: 'audit_u', action: 'unlist', previous: '{"listed":true,"hidden":false}', resulting: '{"listed":true,"hidden":true}', at: t3 });
  await audit(env, projectId, { id: 'audit_w', action: 'withdraw', previous: '{"withdrawn":false}', resulting: '{"withdrawn":true}', at: t3 });

  const result = await readCreatorOutcomes(env.DB, projectId, window(), source);
  const values = Object.fromEntries(result.metrics.map((m) => [m.key, m.value]));
  assert.deepEqual(values, {
    saved_provider_outputs: 2,
    saved_local_exports: 2,
    publication_published: 1,
    publication_unlisted: 1,
    publication_withdrawn: 1,
  });
  assert.equal(result.format, 'media-studio.creator-outcomes/v1');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.projectId, projectId);
  assert.deepEqual(result.window, { fromInclusive: '2026-11-12', toExclusive: '2026-11-19', timezone: 'UTC' });
  assert.equal(result.generatedAt, iso(NOW));
  assert.deepEqual(result.source, { producer: 'test-harness', revision: 'abc123', watermark: iso(t3) });
  for (const metric of result.metrics) {
    assert.equal(metric.status, 'partial');
    assert.ok(metric.coverage.length > 0);
    assert.equal(metric.definitionVersion, 1);
    assert.equal(typeof metric.definition, 'string');
    assert.equal(typeof metric.evidenceLevel, 'string');
  }
  assert.deepEqual(
    result.metrics.map((m) => m.unit),
    ['saved_outputs', 'saved_exports', 'publication_transitions', 'publication_transitions', 'publication_transitions'],
  );

  // Only aggregate fields: no R2 keys, prompts, actors, snapshots or file names.
  const wire = JSON.stringify(result);
  for (const secret of ['SECRET', 'secret-key', 'image/png', 'snapshot', 'r2_key', 'asset_a', 'req_']) {
    assert.ok(!wire.includes(secret), `leaked ${secret}`);
  }
});

test('readCreatorOutcomes: exclusions do not become counts or a watermark', async () => {
  const { env } = await setup();
  const projectId = 'prj_test';
  const other = 'prj_other';
  await otherProject(env);
  const inside = NOW - 2 * DAY;
  const outside = NOW - 9 * DAY;

  // Saved generation, but no completed job / deleted / empty or deleted asset.
  await generation(env, projectId, { id: 'g_no_complete', at: inside, completedAt: null });
  await asset(env, projectId, { id: 'a_no_complete', at: inside, generationId: 'g_no_complete' });
  await linkGeneration(env, 'g_no_complete', 'a_no_complete');

  await generation(env, projectId, { id: 'g_deleted', at: inside, deletedAt: inside });
  await asset(env, projectId, { id: 'a_deleted_gen', at: inside, generationId: 'g_deleted' });
  await linkGeneration(env, 'g_deleted', 'a_deleted_gen');

  await generation(env, projectId, { id: 'g_zero', at: inside });
  await asset(env, projectId, { id: 'a_zero', at: inside, bytes: 0 });
  await linkGeneration(env, 'g_zero', 'a_zero');

  await generation(env, projectId, { id: 'g_live', at: inside });
  await asset(env, projectId, { id: 'a_deleted', at: inside, deletedAt: inside });
  await linkGeneration(env, 'g_live', 'a_deleted');

  await generation(env, projectId, { id: 'g_upload', at: inside });
  await asset(env, projectId, { id: 'a_upload', at: inside, source: 'upload', generationId: 'g_upload' });

  await generation(env, projectId, { id: 'g_old', at: outside });
  await asset(env, projectId, { id: 'a_old', at: outside });
  await linkGeneration(env, 'g_old', 'a_old');

  // A different project's otherwise identical rows.
  await generation(env, other, { id: 'g_other', at: inside });
  await asset(env, other, { id: 'a_other', at: inside });
  await linkGeneration(env, 'g_other', 'a_other');

  // An unbound asset is not a provider output on its own.
  await asset(env, projectId, { id: 'a_orphan', at: inside });

  // Receipt exists but the asset save is outside receipt validity or the window.
  await localReceipt(env, projectId, { id: 'lr_before', outputAssetId: 'lr_before_out', createdAt: inside, expiresAt: inside + 2000 });
  await asset(env, projectId, { id: 'lr_before_out', at: inside - 1, source: 'upload' });
  await footageReceipt(env, projectId, { id: 'fr_after', outputAssetId: 'fr_after_out', createdAt: inside - 2000, expiresAt: inside });
  await asset(env, projectId, { id: 'fr_after_out', at: inside + 1, source: 'upload' });
  await localReceipt(env, projectId, { id: 'lr_no_asset', outputAssetId: 'never_saved', createdAt: inside, expiresAt: inside + 2000 });
  await localReceipt(env, projectId, { id: 'lr_old', outputAssetId: 'lr_old_out', createdAt: outside, expiresAt: outside + 2000 });
  await asset(env, projectId, { id: 'lr_old_out', at: outside, source: 'upload' });

  // No-op and out-of-scope audit entries are not real publication changes.
  await audit(env, projectId, { id: 'audit_noop', action: 'publish', previous: '{"listed":true}', resulting: '{"listed":true}', at: inside });
  await audit(env, other, { id: 'audit_other_project', action: 'publish', previous: '{"listed":false}', resulting: '{"listed":true}', at: inside });
  await audit(env, projectId, { id: 'audit_old', action: 'withdraw', previous: '{"withdrawn":false}', resulting: '{"withdrawn":true}', at: outside });

  const result = await readCreatorOutcomes(env.DB, projectId, window(), source);
  assert.deepEqual(
    result.metrics.map((m) => m.value),
    [0, 0, 0, 0, 0],
  );
  assert.equal(result.source.watermark, null);
  assert.ok(result.metrics.every((m) => m.status === 'partial'));
});

test('readCreatorOutcomes: committed bundle imports are explicitly unavailable, staging is not', async () => {
  const { env } = await setup();
  const projectId = 'prj_test';
  const at = NOW - 2 * DAY;
  await generation(env, projectId, { id: 'gen_restored', at });
  await asset(env, projectId, { id: 'asset_restored', at, source: 'generated', generationId: 'gen_restored' });
  await linkGeneration(env, 'gen_restored', 'asset_restored');
  await audit(env, projectId, { id: 'audit_restored', action: 'publish', previous: '{"listed":false}', resulting: '{"listed":true}', at });

  await env.DB.prepare(
    `INSERT INTO project_bundle_imports(id,bundle_id,bundle_sha256,source_project_id,project_id,manifest_json,id_map_json,status,asset_count,byte_count,created_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,'{}','{}',?6,1,100,?7,?7)`,
  )
    .bind('imp1', 'bundle1', 'sha', 'prj_source', projectId, 'committed', at)
    .run();

  const restored = await readCreatorOutcomes(env.DB, projectId, window(), source);
  assert.deepEqual(restored.metrics.map((m) => m.value), [null, null, null, null, null]);
  assert.ok(restored.metrics.every((m) => m.status === 'unavailable'));
  assert.ok(restored.metrics.every((m) => m.coverage.includes('restored projects')));
  assert.equal(restored.source.watermark, null);

  await env.DB.prepare("UPDATE project_bundle_imports SET status='staging' WHERE id='imp1'").run();
  const staged = await readCreatorOutcomes(env.DB, projectId, window(), source);
  assert.deepEqual(staged.metrics.map((m) => m.value), [1, 0, 1, 0, 0]);
  assert.ok(staged.metrics.every((m) => m.status === 'partial'));
  assert.equal(staged.source.watermark, iso(at));
});
