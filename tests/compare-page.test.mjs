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
