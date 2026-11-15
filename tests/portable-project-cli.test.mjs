// MIT. CLI smoke test: inspect verifies the archive and refuses a tampered one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportProjectManifest, encodePortableBundle } from '../src/lib/portable-bundle.mjs';
import { sha256Hex } from '../src/lib/util.mjs';
import { PNG_1x1, setup } from './harness.mjs';

const run = promisify(execFile);

test('CLI inspect verifies a bundle and rejects a tampered file', async () => {
  const { env, project } = await setup();
  const key = `projects/${project.id}/assets/asset_one/original.png`;
  await env.MEDIA.put(key, PNG_1x1, { httpMetadata: { contentType: 'image/png' } });
  await env.DB.prepare('INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) VALUES(?1,?2,\'image\',?3,\'image/png\',?4,1,1,NULL,NULL,NULL,?5,\'One\',\'\',\'upload\',NULL,NULL,1,1,NULL,1)')
    .bind('asset_one', project.id, key, PNG_1x1.byteLength, await sha256Hex(PNG_1x1)).run();
  const source = await env.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(project.id).first();
  const manifest = await exportProjectManifest(env, source);
  const archive = await encodePortableBundle(manifest, new Map([[manifest.blobs[0].sha256, PNG_1x1]]));
  const root = await mkdtemp(join(tmpdir(), 'studio-portable-cli-'));
  try {
    const file = join(root, 'fixture.studio');
    await writeFile(file, archive);
    const inspected = await run(process.execPath, ['scripts/studio-project.mjs', 'inspect', '--bundle', file, '--json'], { cwd: new URL('..', import.meta.url).pathname });
    const report = JSON.parse(inspected.stdout);
    assert.equal(report.status, 'verified');
    assert.equal(report.bundleId, manifest.bundleId);
    assert.equal(report.stats.mediaAssets, 1);

    const tampered = new Uint8Array(archive);
    tampered[tampered.length - 140] ^= 0xff;
    const bad = join(root, 'tampered.studio');
    await writeFile(bad, tampered);
    await assert.rejects(run(process.execPath, ['scripts/studio-project.mjs', 'inspect', '--bundle', bad], { cwd: new URL('..', import.meta.url).pathname }), (error) => /integrity|media|manifest/i.test(error.stderr));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
