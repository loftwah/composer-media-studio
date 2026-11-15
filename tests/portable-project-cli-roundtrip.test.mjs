// MIT. Real owner CLI round trip over a local HTTP server backed by the Worker
// and in-memory D1/R2. No network, provider or production binding is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { sha256Hex, extensionFor } from '../src/lib/util.mjs';
import { FakeBucket, PNG_1x1, SqliteD1, setup } from './harness.mjs';

const run = promisify(execFile);
const cwd = new URL('..', import.meta.url).pathname;

async function serve(env) {
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = {};
      if (request.headers.cookie) headers.cookie = request.headers.cookie;
      if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
      const forwarded = new Request(`http://127.0.0.1:${server.address().port}${request.url}`, {
        method: request.method, headers, ...(body.length ? { body } : {}),
      });
      const result = await worker.fetch(forwarded, env);
      response.statusCode = result.status;
      for (const [name, value] of result.headers) if (name.toLowerCase() !== 'set-cookie') response.setHeader(name, value);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('owner CLI exports and restores through the real Worker routes', async () => {
  const { env, project } = await setup();
  const key = `projects/${project.id}/assets/asset_one/original.png`;
  await env.MEDIA.put(key, PNG_1x1, { httpMetadata: { contentType: 'image/png' } });
  await env.DB.prepare('INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) VALUES(?1,?2,\'image\',?3,\'image/png\',?4,1,1,NULL,NULL,NULL,?5,\'CLI still\',\'\',\'upload\',NULL,NULL,1,1,NULL,1)')
    .bind('asset_one', project.id, key, PNG_1x1.byteLength, await sha256Hex(PNG_1x1)).run();
  const fresh = { DB: new SqliteD1(), MEDIA: new FakeBucket(), PUBLIC_ORIGIN: 'http://127.0.0.1', SESSION_SECRET: 'fresh-session-secret-that-is-long-enough' };
  const source = await serve(env);
  const target = await serve(fresh);
  const root = await mkdtemp(join(tmpdir(), 'studio-portable-roundtrip-'));
  try {
    const file = join(root, 'project.studio');
    const cookie = `studio_session=${await createSession(env)}`;
    const exported = await run(process.execPath, ['scripts/studio-project.mjs', 'export', '--studio', source.origin, '--project', project.id, '--out', file, '--confirm', '--cookie', cookie, '--json'], { cwd });
    const exportedReport = JSON.parse(exported.stdout);
    assert.equal(exportedReport.status, 'exported');
    assert.equal(exportedReport.stats.mediaAssets, 1);
    assert.equal(exportedReport.archiveSha256.length, 64);

    const freshCookie = `studio_session=${await createSession(fresh)}`;
    const imported = await run(process.execPath, ['scripts/studio-project.mjs', 'import', '--studio', target.origin, '--bundle', file, '--confirm', '--cookie', freshCookie, '--json'], { cwd });
    const importedReport = JSON.parse(imported.stdout);
    assert.equal(importedReport.status, 'restored');
    assert.equal(importedReport.projectId.startsWith('prj_'), true);
    const restored = await fresh.DB.prepare('SELECT * FROM assets').first();
    assert.equal(restored.sha256, await sha256Hex(PNG_1x1));
    assert.equal(restored.bytes, PNG_1x1.byteLength);
    assert.equal(restored.r2_key, `projects/${importedReport.projectId}/assets/${restored.id}/original.${extensionFor('image/png')}`);
    const object = await fresh.MEDIA.get(restored.r2_key);
    assert.deepEqual(Buffer.from(new Uint8Array(await object.arrayBuffer())), Buffer.from(PNG_1x1));

    const again = await run(process.execPath, ['scripts/studio-project.mjs', 'import', '--studio', target.origin, '--bundle', file, '--confirm', '--cookie', freshCookie, '--json'], { cwd });
    assert.equal(JSON.parse(again.stdout).status, 'already_imported');
    assert.equal((await fresh.DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
    const inventory = await run(process.execPath, ['scripts/studio-project.mjs', 'inventory', '--studio', target.origin, '--cookie', freshCookie, '--json'], { cwd });
    assert.equal(JSON.parse(inventory.stdout).readOnly, true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await new Promise((resolve) => source.server.close(resolve));
    await new Promise((resolve) => target.server.close(resolve));
  }
});
