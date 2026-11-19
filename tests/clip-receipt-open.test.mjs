// A Clip receipt is data only: these checks cover reopening one against the
// already-accepted source, without any fetch, persistence or export change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_RECEIPT_BYTES, parseClipReceipt } from '../src/frontend/clip-receipt-open.ts';

const sha = 'a'.repeat(64);
const proof = { duration: 180, maxSeconds: 60, sourceBytes: 1000, sourceSha256: sha };
const receipt = () => ({
  schema: 'media-studio/video-clip-receipt',
  version: 1,
  source: { name: 'clip.mp4', bytes: 1000, watchUrl: null, sha256: sha },
  edit: { startSeconds: 2, endSeconds: 8, frame: 'landscape', quality: 'hd', fit: 'cover', muteRequested: true },
  output: { width: 1280, height: 720, mime: 'video/mp4', bytes: 100, sha256: 'b'.repeat(64) },
});
const text = (value = receipt()) => JSON.stringify(value);
const fails = (value = receipt(), currentProof = proof) =>
  assert.throws(() => parseClipReceipt(text(value), currentProof));

test('a matching v1 receipt restores only the editable settings', () => {
  assert.deepEqual(parseClipReceipt(text(), proof), {
    startSeconds: 2, endSeconds: 8, frame: 'landscape', quality: 'hd', fit: 'cover', muteRequested: true,
  });
});

test('a different source, malformed input or wrong schema is rejected', () => {
  const different = receipt(); different.source.sha256 = 'c'.repeat(64); fails(different);
  const otherBytes = receipt(); otherBytes.source.bytes = 1001; fails(otherBytes);
  assert.throws(() => parseClipReceipt('{not json', proof));
  const wrongSchema = receipt(); wrongSchema.schema = 'other'; fails(wrongSchema);
  const wrongVersion = receipt(); wrongVersion.version = 2; fails(wrongVersion);
  assert.throws(() => parseClipReceipt('x'.repeat(MAX_RECEIPT_BYTES + 1), proof));
});

test('trim, framing, quality and mute values are bounded by local duration and 60s', () => {
  for (const change of [
    { startSeconds: -1 }, { startSeconds: Number.NaN }, { startSeconds: 200 },
    { endSeconds: 2 }, { endSeconds: Number.POSITIVE_INFINITY }, { endSeconds: 200 },
    { startSeconds: 5, endSeconds: 70 },
    { frame: 'wide' }, { quality: '4k' }, { fit: 'stretch' }, { muteRequested: 'yes' },
  ]) {
    const value = receipt(); Object.assign(value.edit, change); fails(value);
  }
  fails(receipt(), { ...proof, duration: 5 });
  assert.deepEqual(parseClipReceipt(text(), { ...proof, duration: 8 }), parseClipReceipt(text(), proof));
});
