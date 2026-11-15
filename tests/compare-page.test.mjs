import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup } from './harness.mjs';

async function fixture() {
  const { env, project } = await setup();
  const owner = 'studio_session=' + await createSession(env);
  const call = (path, auth = owner) => worker.fetch(new Request(`https://studio.test${path}`, {
    headers: { origin: 'https://studio.test', ...(auth ? { cookie: auth } : {}) },
  }), env);
  return { env, project, owner, call };
}

test('compare keeps the project the owner is working in', async () => {
  const { project, call } = await fixture();
  const response = await call(`/compare?project=${encodeURIComponent(project.id)}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(`project=${project.id}&amp;job=|project=${project.id}&job=`));
  assert.match(html, new RegExp(project.name));
  assert.match(html, new RegExp(`/#/p/${project.id}/history`));
});

test('a project the session cannot read is not shown by guessing', async () => {
  const { env, project } = await fixture();
  const bridge = 'studio_session=' + await createSession(env, { mode: 'bridge', workspace: 'ws-personal', project: 'prj_other', actions: ['read'] });
  const response = await worker.fetch(new Request(`https://studio.test/compare?project=${encodeURIComponent(project.id)}`, {
    headers: { origin: 'https://studio.test', cookie: bridge },
  }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, new RegExp(project.name));
  assert.match(html, /No project yet/);
});

test('the no-project comparison offers each accessible studio instead of a dead end', async () => {
  const { env, project } = await fixture();
  const bridge = 'studio_session=' + await createSession(env, { mode: 'bridge', workspace: 'ws-personal', actions: ['read'] });
  const response = await worker.fetch(new Request('https://studio.test/compare', {
    headers: { origin: 'https://studio.test', cookie: bridge },
  }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Choose a studio/);
  assert.match(html, new RegExp(`href="/compare\\?project=${project.id}"`));
  assert.match(html, new RegExp(project.name));
  assert.match(html, /No project yet/);
});

test('a comparison starts blind and keeps model names and costs behind a choice', async () => {
  const { comparePage } = await import('../src/lib/ui.mjs');
  const html = comparePage({
    revision: 'test',
    job: { id: 'still', label: 'A still image', purpose: 'Compare stills.', settings: 'Same brief and aspect.', models: [] },
    entries: [
      {
        model: 'studio-film', generationId: 'gen_a', briefKey: 'brief_a', createdAt: 1, kind: 'image',
        previewUrl: null, prompt: 'a quiet desk', settings: { aspect: 'square' },
        cost: { estimateMicro: 20000, allocatedMicro: 20000, providerChargedMicro: null },
      },
      {
        model: 'studio-print', generationId: 'gen_b', briefKey: 'brief_b', createdAt: 1, kind: 'image',
        previewUrl: null, prompt: 'a quiet desk', settings: { aspect: 'square' },
        cost: { estimateMicro: 25000, allocatedMicro: 25000, providerChargedMicro: null },
      },
    ],
    models: { 'studio-film': { label: 'Studio Film' }, 'studio-print': { label: 'Studio Print' } },
  });
  assert.match(html, /data-blind-mode checked/);
  assert.match(html, /Blind review: hide model names and costs/);
  assert.match(html, /class="cmp-grid is-blind"/);
  assert.match(html, /Take A/);
  assert.match(html, /Take B/);
  assert.match(html, /class="cmp-model-name"/);
  assert.equal((html.match(/class="cmp-cost"/g) ?? []).length, 6);
});

test('the chooser lands on a job that already has a saved take', async () => {
  const { env, project, call } = await fixture();
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,source,created_at,updated_at) VALUES('asset_motion',?1,'video','motion','video/mp4',1000,768,1344,5000,'hash-motion','A saved clip','generated',1,1)",
  ).bind(project.id).run();
  await env.DB.prepare(
    "INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,output_asset_id,cost_estimate_micro,cost_reserved_micro,cost_allocated_micro,created_at,completed_at,updated_at) VALUES('gen_motion',?1,'request_motion','video','motion','fal','hailuo-standard',?2,'saved','asset_motion',240000,240000,240000,1,2,2)",
  )
    .bind(project.id, JSON.stringify({ prompt: 'She blinks once as the lantern glows.', durationSeconds: 5, referenceAssetId: 'asset_source' }))
    .run();
  const response = await call(`/compare?project=${encodeURIComponent(project.id)}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  // The landing tab is the job with evidence, not the first comparable job.
  assert.match(html, /Motion from a still<\/h2>/);
  assert.doesNotMatch(html, /No saved takes for this job yet/);
  // An explicit request still wins, so a shared link never moves under the reader.
  const explicit = await (await call(`/compare?project=${encodeURIComponent(project.id)}&job=still`)).text();
  assert.match(explicit, /No saved takes for this job yet/);
});
