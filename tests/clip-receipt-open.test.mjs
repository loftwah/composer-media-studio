// A Clip receipt is data only: these checks cover reopening one against the
// already-accepted source, without any fetch, persistence or export change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_RECEIPT_BYTES, parseClipReceipt } from '../src/frontend/clip-receipt-open.ts';
import { MAX_CAPTION_OFFSET_SECONDS } from '../src/frontend/clip-captions.ts';

const sha = 'a'.repeat(64);
const captionSha = 'd'.repeat(64);
const proof = { duration: 180, maxSeconds: 60, sourceBytes: 1000, sourceSha256: sha };
const edit = { startSeconds: 2, endSeconds: 8, frame: 'landscape', quality: 'hd', fit: 'cover', muteRequested: true };
const receipt = () => ({
  schema: 'media-studio/video-clip-receipt',
  version: 1,
  source: { name: 'clip.mp4', bytes: 1000, watchUrl: null, sha256: sha },
  edit: { ...edit },
  output: { width: 1280, height: 720, mime: 'video/mp4', bytes: 100, sha256: 'b'.repeat(64) },
});
const withCaptions = (offsetMs, sourceSha256 = captionSha) => {
  const value = receipt();
  value.captions = {
    sourceName: 'watch.vtt', included: true, sourceSha256,
    ...(offsetMs === undefined ? {} : { offsetMs }),
  };
  return value;
};
const text = (value = receipt()) => JSON.stringify(value);
const restore = (value = receipt(), currentProof = proof) => parseClipReceipt(text(value), currentProof);
const fails = (value = receipt(), currentProof = proof) =>
  assert.throws(() => parseClipReceipt(text(value), currentProof));

test('a matching v1 receipt restores only the editable visual settings', () => {
  assert.deepEqual(restore(), { edit });
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
  assert.deepEqual(restore(receipt(), { ...proof, duration: 8 }), restore());
});

test('a valid caption extension returns a separate, bounded caption-only setting', () => {
  const bound = MAX_CAPTION_OFFSET_SECONDS * 1000;
  for (const offsetMs of [-bound, -1500, 0, 1500, bound])
    assert.deepEqual(restore(withCaptions(offsetMs)), { edit, captions: { sourceSha256: captionSha, offsetMs } });
  // An absent offset means the original timing: zero, still a signed setting.
  assert.deepEqual(restore(withCaptions(undefined)), { edit, captions: { sourceSha256: captionSha, offsetMs: 0 } });
});

test('malformed supplementary caption fields never supply an offset', () => {
  const bound = MAX_CAPTION_OFFSET_SECONDS * 1000;
  for (const value of [
    withCaptions(bound + 1), withCaptions(-bound - 1), withCaptions(1500.5),
    withCaptions('1.5'), withCaptions(null), withCaptions(1500, 'short'),
    withCaptions(1500, 'D'.repeat(64)),
  ]) assert.deepEqual(restore(value), { edit }, JSON.stringify(value.captions));
  // Old v1 files, and a captions block without a vetted hash, keep trim/frame.
  assert.deepEqual(restore(receipt()), { edit });
  const noHash = receipt();
  noHash.captions = { sourceName: 'watch.vtt', included: true, offsetMs: 1500 };
  assert.deepEqual(restore(noHash), { edit });
  for (const captions of [null, 'watch.vtt', 7, []]) {
    const value = receipt(); value.captions = captions;
    assert.deepEqual(restore(value), { edit });
  }
});
