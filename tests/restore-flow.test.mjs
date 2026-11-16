// MIT. Browser restore flow: a real sealed bundle, bounded reads, honest
// progress and specific errors. Fictional fixtures, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePortableBundle, exportProjectManifest, PORTABLE_MAGIC } from '../src/lib/portable-bundle.mjs';
import { sha256Hex } from '../src/lib/util.mjs';
import { PNG_1x1, setup, wav } from './harness.mjs';
import {
  commitSentence,
  formatBytes,
  openBundle,
  planFacts,
  previewDecision,
  progressFor,
  progressSentence,
  readBundleBlob,
  restoreProblem,
  stageQueue,
} from '../src/frontend/restore-flow.ts';

async function sealedFixture() {
  const { env, project } = await setup();
  const audio = wav({ seconds: 1 });
  const media = [
    { id: 'asset_still', kind: 'image', mime: 'image/png', bytes: PNG_1x1, title: 'Lantern still' },
    { id: 'asset_hum', kind: 'audio', mime: 'audio/wav', bytes: audio, title: 'Lantern hum' },
  ];
  for (const entry of media) {
    await env.MEDIA.put(`projects/${project.id}/assets/${entry.id}/original.${entry.mime === 'image/png' ? 'png' : 'wav'}`, entry.bytes, { httpMetadata: { contentType: entry.mime } });
    await env.DB.prepare(
      "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?10,?11,?12,'','upload',NULL,NULL,1,1,NULL,1)",
    )
      .bind(entry.id, project.id, entry.kind, `projects/${project.id}/assets/${entry.id}/original.x`, entry.mime, entry.bytes.byteLength, entry.kind === 'image' ? 1 : null, entry.kind === 'audio' ? 1000 : null, entry.kind === 'audio' ? 8000 : null, entry.kind === 'audio' ? 1 : null, await sha256Hex(entry.bytes), entry.title)
      .run();
  }
  const source = await env.DB.prepare('SELECT * FROM projects WHERE id=?1').bind(project.id).first();
  const manifest = await exportProjectManifest(env, source);
  const blobs = new Map(media.map((entry) => [entry.mime, entry.bytes]));
  const archive = await encodePortableBundle(
    manifest,
    new Map(manifest.blobs.map((blob) => [blob.sha256, blobs.get(blob.mime)])),
  );
  return { manifest, archive, media };
}

const fileOf = (bytes, name = 'fixture.studio') => new File([bytes], name, { type: 'application/octet-stream' });

test('a sealed bundle opens with exact blob offsets and every file reads back unchanged', async () => {
  const { manifest, archive, media } = await sealedFixture();
  const file = fileOf(archive);
  const bundle = await openBundle(file);
  assert.equal(bundle.manifest.bundleId, manifest.bundleId);
  assert.equal(bundle.verified, true);
  assert.equal(bundle.blobs.length, 2);
  assert.equal(bundle.contentBytes, PNG_1x1.byteLength + wav({ seconds: 1 }).byteLength);
  assert.equal(bundle.blobs[0].offset, PORTABLE_MAGIC.length + 11 + bundle.manifestBytes);
  assert.equal(bundle.blobs[1].offset, bundle.blobs[0].offset + bundle.blobs[0].bytes);
  for (const entry of media) {
    const sha = await sha256Hex(entry.bytes);
    const bytes = await readBundleBlob(file, bundle, { sourceId: entry.id, sha256: sha, bytes: entry.bytes.byteLength, mime: entry.mime, title: entry.title });
    assert.equal(await sha256Hex(bytes), sha);
    assert.equal(bytes.byteLength, entry.bytes.byteLength);
  }
});

test('a wrong file, a truncated bundle, appended bytes and a damaged manifest are named precisely', async () => {
  const { manifest, archive } = await sealedFixture();
  await assert.rejects(openBundle(fileOf(new TextEncoder().encode('{"not":"a bundle"}'))), (error) => error.code === 'not_a_bundle');
  await assert.rejects(openBundle(fileOf(archive.slice(0, archive.byteLength - 10))), (error) => error.code === 'truncated');
  const appended = new Uint8Array(archive.byteLength + 4);
  appended.set(archive);
  await assert.rejects(openBundle(fileOf(appended)), (error) => error.code === 'invalid_bundle' && /extra bytes/.test(error.message));

  // Change one letter of the project name in place: still valid JSON, same
  // length, but the manifest no longer matches the sealed trailer.
  const damaged = new Uint8Array(archive);
  const manifestStart = PORTABLE_MAGIC.length + 11;
  const name = new TextEncoder().encode(manifest.project.name);
  const decoder = new TextDecoder();
  let at = -1;
  for (let index = manifestStart; index < archive.byteLength - name.byteLength; index += 1) {
    if (decoder.decode(damaged.subarray(index, index + name.byteLength)) === manifest.project.name) {
      at = index;
      break;
    }
  }
  assert.ok(at > manifestStart, 'the project name is inside the manifest region');
  damaged[at] ^= 0x20;
  await assert.rejects(openBundle(fileOf(damaged)), (error) => error.code === 'integrity_failed');
});

test('a damaged media byte is caught before it is sent', async () => {
  const { archive, manifest } = await sealedFixture();
  const bundle = await openBundle(fileOf(archive));
  const corrupted = new Uint8Array(archive);
  corrupted[bundle.blobs[0].offset + 1] ^= 0xff;
  const target = {
    sourceId: manifest.assets[0].id,
    sha256: bundle.blobs[0].sha256,
    bytes: bundle.blobs[0].bytes,
    mime: bundle.blobs[0].mime,
    title: 'Lantern still',
  };
  await assert.rejects(
    readBundleBlob(fileOf(corrupted), bundle, target),
    (error) => error.code === 'integrity_failed' && /Lantern still/.test(error.message),
  );
});

test('progress counts only server acknowledgements and resume skips staged files', () => {
  const assets = [
    { sourceId: 'a1', sha256: 'x', bytes: 100, mime: 'image/png', title: 'One' },
    { sourceId: 'a2', sha256: 'y', bytes: 300, mime: 'video/mp4', title: 'Two' },
    { sourceId: 'a3', sha256: 'z', bytes: 50, mime: 'audio/wav', title: 'Three' },
  ];
  const empty = progressFor(assets, {});
  assert.deepEqual(empty, { done: 0, total: 3, bytesDone: 0, bytesTotal: 450, percent: 0 });
  const partial = progressFor(assets, { a1: 'staged', a2: 'already_staged' });
  assert.deepEqual(partial, { done: 2, total: 3, bytesDone: 400, bytesTotal: 450, percent: 67 });
  assert.match(progressSentence(partial, { title: 'Three', index: 3 }), /^Staging “Three” \(3 of 3\)\. 2 of 3 files staged · 400 B of 450 B verified\.$/);
  assert.match(progressSentence(progressFor(assets, { a1: 'staged', a2: 'staged', a3: 'staged' })), /^All 3 files are staged\./);
  assert.deepEqual(stageQueue(assets, ['a1']).map((asset) => asset.sourceId), ['a2', 'a3']);
  assert.equal(stageQueue(assets, ['a1', 'a2', 'a3']).length, 0);
});

test('preview decides between restore, resume, already imported and blocked', () => {
  assert.equal(previewDecision({ status: 'ready' }), 'start');
  assert.equal(previewDecision({ status: 'resume_staging', importId: 'imp_1' }), 'resume');
  assert.equal(previewDecision({ status: 'ready', importStatus: 'failed', importId: 'imp_1' }), 'start');
  assert.equal(previewDecision({ status: 'already_imported', projectId: 'prj_1' }), 'already');
  assert.equal(previewDecision({ status: 'ready', conflicts: [{ code: 'project_slug_exists', message: 'taken' }] }), 'blocked');
  assert.equal(previewDecision({ status: 'ready', blockers: ['insufficient_storage'] }), 'blocked');
  assert.equal(previewDecision(null), 'start');
});

test('preview facts name bytes, skipped deletions, private publications and unrestored budgets', () => {
  const facts = planFacts({
    assets: 6,
    mediaAssets: 5,
    tombstones: 1,
    blobs: 5,
    contentBytes: 610072,
    records: 7,
    generations: 2,
    compositions: 1,
    subjects: 2,
    songPlans: 1,
    publications: 1,
  });
  const byLabel = Object.fromEntries(facts.map((fact) => [fact.label, fact]));
  assert.equal(byLabel['Media to restore'].value, '5 files · 596 KB');
  assert.match(byLabel['Asset records'].note ?? '', /1 deleted asset skipped/);
  assert.equal(byLabel['Records'].value, '7 records');
  assert.match(byLabel['Records'].note ?? '', /2 generations · 1 storyboard · 2 subject versions · 1 song plan/);
  assert.match(byLabel['Publications'].note ?? '', /withdrawn, hidden and unlisted/);
  assert.match(byLabel['Monthly budget'].value, /Not restored/);
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1534), '1 KB');
  assert.equal(formatBytes(620635), '606 KB');
  assert.equal(formatBytes(158616199), '151.3 MB');
});

test('errors are specific for the crash window, duplicates, the wrong file and storage limits', () => {
  const crash = restoreProblem({ code: 'missing_media', message: 'The restore is incomplete. Stage every media file before committing.' });
  assert.match(crash.title, /have not reached storage/);
  assert.match(crash.action ?? '', /Retry continues the same restore/);
  assert.equal(crash.retryable, true);

  const duplicate = restoreProblem({ code: 'already_imported', message: 'Already imported' });
  assert.match(duplicate.title, /already in this studio/);
  assert.match(duplicate.action ?? '', /Open the studio it restored/);

  const wrong = restoreProblem({ code: 'not_a_bundle', message: 'That file is not a Studio project bundle.' });
  assert.match(wrong.action ?? '', /\.studio file/);
  assert.match(wrong.action ?? '', /metadata-only JSON export/);

  const storage = restoreProblem({ code: 'insufficient_storage', message: 'This bundle cannot be imported without changing an existing project.' });
  assert.match(storage.title, /Not enough storage/);
  assert.match(storage.action ?? '', /STUDIO_PORTABLE_STORAGE_LIMIT_BYTES/);

  const owner = restoreProblem({ code: 'owner_required', message: 'Portable project restore and inventory are installation-owner actions.' });
  assert.match(owner.title, /installation owner/);
  assert.match(owner.action ?? '', /owner passphrase/);

  const offline = restoreProblem(new TypeError('Failed to fetch'));
  assert.equal(offline.code, 'network');
  assert.equal(offline.retryable, true);
  assert.match(offline.action ?? '', /Retrying continues the same restore/);

  const blocked = restoreProblem({ code: 'project_slug_exists', message: 'Another project already uses this slug.' });
  assert.match(blocked.title, /already uses that address/);
  assert.match(blocked.action ?? '', /fresh installation/);
});

test('the success line is built from the counts the server returned at commit', () => {
  const line = commitSentence(
    { assets: 5, mediaAssets: 5, contentBytes: 610072, generations: 2, compositions: 1, subjects: 2, songPlans: 1, publications: 1 },
    'Fictional Lantern Study',
  );
  assert.equal(
    line,
    '“Fictional Lantern Study” was restored with 5 files, 596 KB, 2 generations, 1 storyboard, 2 subject versions, 1 song plan, 1 private publication.',
  );
});
