// Pure crop math and v1 receipt compatibility. No encoder, DOM or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipCropRectangle, cropObjectPosition, isCropAnchor } from '../src/frontend/clip-crop.ts';
import { parseClipReceipt } from '../src/frontend/clip-receipt-open.ts';

const square = { width: 640, height: 640 };

test('centre keeps the original behaviour with no crop rectangle', () => {
  assert.equal(clipCropRectangle({ width: 1920, height: 1080 }, square, 'center'), null);
  assert.equal(cropObjectPosition('center', 'cover'), undefined);
  assert.equal(cropObjectPosition('topLeft', 'contain'), undefined, 'contain always fits the full frame');
});

test('crop is the largest output-aspect rectangle at the chosen corner', () => {
  const display = { width: 1920, height: 1080 };
  assert.deepEqual(clipCropRectangle(display, square, 'topLeft'), { left: 0, top: 0, width: 1080, height: 1080 });
  assert.deepEqual(clipCropRectangle(display, square, 'bottomRight'), { left: 840, top: 0, width: 1080, height: 1080 });
  // Post-rotation order decides which axis is free.
  const rotated = { width: 1080, height: 1920 };
  assert.deepEqual(clipCropRectangle(rotated, square, 'topLeft'), { left: 0, top: 0, width: 1080, height: 1080 });
  assert.deepEqual(clipCropRectangle(rotated, square, 'bottomRight'), { left: 0, top: 840, width: 1080, height: 1080 });
  assert.equal(cropObjectPosition('topLeft', 'cover'), '0% 0%');
  assert.equal(cropObjectPosition('bottomRight', 'cover'), '100% 100%');
  assert.equal(isCropAnchor('topLeft'), true);
  assert.equal(isCropAnchor('middle'), false);
});

test('unproven dimensions fall back to centre and every crop stays bounded', () => {
  for (const bad of [{ width: 0, height: 1080 }, { width: NaN, height: 1080 }, { width: 1920.5, height: 1080 }]) {
    assert.equal(clipCropRectangle(bad, square, 'bottomRight'), null);
  }
  assert.equal(clipCropRectangle({ width: 1920, height: 1080 }, { width: 0, height: 0 }, 'topLeft'), null);
  for (const display of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 300, height: 200 }]) {
    for (const anchor of ['topLeft', 'bottomRight']) {
      const crop = clipCropRectangle(display, { width: 640, height: 360 }, anchor);
      assert.ok(crop.left >= 0 && crop.top >= 0);
      assert.ok(crop.left + crop.width <= display.width && crop.top + crop.height <= display.height);
    }
  }
});

const sha = 'a'.repeat(64);
const proof = { duration: 180, maxSeconds: 60, sourceBytes: 1000, sourceSha256: sha };
const oldReceipt = {
  schema: 'media-studio/video-clip-receipt',
  version: 1,
  source: { name: 'clip.mp4', bytes: 1000, watchUrl: null, sha256: sha },
  edit: { startSeconds: 2, endSeconds: 8, frame: 'landscape', quality: 'hd', fit: 'cover', muteRequested: true },
  output: { width: 1280, height: 720, mime: 'video/mp4', bytes: 100, sha256: 'b'.repeat(64) },
};

test('an old v1 receipt still reopens to the exact original editable settings', () => {
  const restored = parseClipReceipt(JSON.stringify(oldReceipt), proof);
  assert.deepEqual(restored, oldReceipt.edit);
  assert.equal(Object.hasOwn(restored, 'cropAnchor'), false);
});

test('an explicit anchor reopens, while centre and unknown anchors are refused', () => {
  const receipt = structuredClone(oldReceipt);
  receipt.edit.cropAnchor = 'topLeft';
  assert.equal(parseClipReceipt(JSON.stringify(receipt), proof).cropAnchor, 'topLeft');
  for (const invalid of ['center', 'middle', 1]) {
    receipt.edit.cropAnchor = invalid;
    assert.throws(() => parseClipReceipt(JSON.stringify(receipt), proof));
  }
});
