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
