import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCaptionSlot } from '../src/frontend/caption-slot.ts';

test('suggests a non-overlapping window and keeps it within the segment', () => {
  assert.deepEqual(nextCaptionSlot(1000, 6000, []), { startMs: 1000, endMs: 3000 });
  assert.deepEqual(nextCaptionSlot(1000, 6000, [{ startMs: 1000, endMs: 3000 }]), { startMs: 3000, endMs: 5000 });
  assert.deepEqual(nextCaptionSlot(1000, 6000, [{ startMs: 1000, endMs: 5500 }]), { startMs: 5500, endMs: 6000 });
  assert.deepEqual(nextCaptionSlot(1000, 6000, [{ startMs: 4000, endMs: 6000 }]), { startMs: 1000, endMs: 3000 });
  assert.equal(nextCaptionSlot(1000, 6000, [{ startMs: 1000, endMs: 6000 }]), null);
});

test('handles unordered and overlapping cues without filling their occupied time', () => {
  assert.deepEqual(nextCaptionSlot(0, 9000, [{ startMs: 7000, endMs: 9000 }, { startMs: 0, endMs: 2000 }, { startMs: 1000, endMs: 3000 }]), { startMs: 3000, endMs: 5000 });
  assert.equal(nextCaptionSlot(0, 1000, [{ startMs: -5, endMs: 500 }, { startMs: 400, endMs: 2000 }]), null);
  assert.equal(nextCaptionSlot(2000, 1000, []), null);
});
