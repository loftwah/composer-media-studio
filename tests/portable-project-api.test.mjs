// MIT. End-to-end HTTP wiring for the owner API and CLI-facing routes.
// Fictional fixtures, in-memory D1/R2, no provider calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { sha256Hex, extensionFor } from '../src/lib/util.mjs';
import { FakeBucket, PNG_1x1, SqliteD1, jpeg, setup, wav } from './harness.mjs';

const mp4 = () => new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 9, 0, 0, 0, 0, 0, 0, 0]);

async function addMedia(env, project, id, kind, bytes, mime) {
  const sha = await sha256Hex(bytes);
  const key = `projects/${project.id}/assets/${id}/original.${extensionFor(mime)}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare('INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) VALUES(?1,?2,?3,?4,?5,?6,1,1,?7,?8,?9,?10,?11,\'\',\'upload\',NULL,NULL,1,1,NULL,1)')
    .bind(id, project.id, kind, key, mime, bytes.byteLength, kind === 'video' ? 3000 : kind === 'audio' ? 4000 : null, kind === 'audio' ? 8000 : null, kind === 'audio' ? 1 : null, sha, id).run();
}

test('owner export route and restore routes work end to end without exposing secrets', async () => {
  const { env, project } = await setup();
  env.FAL_KEY = 'http-provider-key-must-not-leave';
  await env.DB.prepare("UPDATE projects SET references_json=?2 WHERE id=?1").bind(project.id, JSON.stringify([{ id: 'r1', title: 'Board', url: 'https://example.test/board' }])).run();
  await addMedia(env, project, 'asset_still', 'image', PNG_1x1, 'image/png');
  await addMedia(env, project, 'asset_still2', 'image', jpeg(2, 2), 'image/jpeg');
  await addMedia(env, project, 'asset_video', 'video', mp4(), 'video/mp4');
  await addMedia(env, project, 'asset_audio', 'audio', wav({ seconds: 4 }), 'audio/wav');
  const source = await env.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(project.id).first();
  const cookie = `studio_session=${await createSession(env)}`;
  const getExport = await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/portable-export`, { headers: { cookie } }), env);
  assert.equal(getExport.status, 200);
  assert.match(getExport.headers.get('cache-control'), /no-store/);
  const manifest = await getExport.json();
  assert.equal(manifest.format, 'studio-project-bundle/v1');
  assert.equal(manifest.blobs.length, 4);
  assert.doesNotMatch(JSON.stringify(manifest), /http-provider-key-must-not-leave/);
  const legacy = await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/export`, { headers: { cookie } }), env);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).format, 'media-studio.export/v1');

  const fresh = { DB: new SqliteD1(), MEDIA: new FakeBucket(), PUBLIC_ORIGIN: 'https://fresh.studio.test', SESSION_SECRET: 'fresh-session-secret-that-is-long-enough' };
  const freshCookie = `studio_session=${await createSession(fresh)}`;
  const anonymous = await worker.fetch(new Request('https://fresh.studio.test/api/studio/restore/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) }), fresh);
  assert.equal(anonymous.status, 401);
  const authorised = await worker.fetch(new Request('https://fresh.studio.test/api/studio/restore/preview', { method: 'POST', headers: { cookie: freshCookie, 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) }), fresh);
  assert.equal(authorised.status, 200);
  assert.equal((await authorised.json()).status, 'ready');
  const start = await worker.fetch(new Request('https://fresh.studio.test/api/studio/restore', { method: 'POST', headers: { cookie: freshCookie, 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) }), fresh);
  assert.equal(start.status, 202);
  const started = await start.json();
  for (const entry of started.assets) {
    const original = await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(entry.sourceId).first();
    const object = await env.MEDIA.get(original.r2_key);
    const bytes = new Uint8Array(await object.arrayBuffer());
    const staged = await worker.fetch(new Request(`https://fresh.studio.test/api/studio/restore/${started.importId}/assets/${entry.sourceId}`, { method: 'POST', headers: { cookie: freshCookie, 'content-type': 'application/octet-stream' }, body: bytes }), fresh);
    assert.equal(staged.status, 200);
    assert.equal((await staged.json()).status, 'staged');
  }
  const commit = await worker.fetch(new Request(`https://fresh.studio.test/api/studio/restore/${started.importId}/commit`, { method: 'POST', headers: { cookie: freshCookie, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) }), fresh);
  assert.equal(commit.status, 200);
  const committed = await commit.json();
  assert.equal(committed.status, 'committed');
  const reopened = await worker.fetch(new Request(`https://fresh.studio.test/api/projects/${committed.projectId}`, { headers: { cookie: freshCookie } }), fresh);
  assert.equal(reopened.status, 200);
  const view = await reopened.json();
  assert.equal(view.assets.length, 4);
  const restoredProject = await fresh.DB.prepare('SELECT references_json FROM projects WHERE id=?1').bind(committed.projectId).first();
  assert.equal(JSON.parse(restoredProject.references_json)[0].url, 'https://example.test/board');
  const inventory = await worker.fetch(new Request('https://fresh.studio.test/api/studio/imports', { headers: { cookie: freshCookie } }), fresh);
  assert.equal(inventory.status, 200);
  assert.equal((await inventory.json()).imports[0].status, 'committed');
  const repeat = await worker.fetch(new Request('https://fresh.studio.test/api/studio/restore', { method: 'POST', headers: { cookie: freshCookie, 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) }), fresh);
  assert.equal(repeat.status, 202);
  assert.equal((await repeat.json()).status, 'already_imported');
});
