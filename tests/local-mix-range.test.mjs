import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMixRange } from '../src/frontend/local-mix-range.ts';
test('source audio is clipped and aligned to a nonzero video timeline', () => {
  assert.deepEqual(localMixRange(1.5, 1, 2, 3), { start: 0, skip: 0.5, duration: 0.5 });
  assert.deepEqual(localMixRange(3, 1, 2, 3), { start: 1, skip: 0, duration: 1 });
  assert.deepEqual(localMixRange(4.5, 1, 2, 3), { start: 2.5, skip: 0, duration: 0.5 });
  assert.equal(localMixRange(0, 1, 2, 3), null);
  assert.equal(localMixRange(5, 1, 2, 3), null);
  assert.throws(() => localMixRange(NaN, 1, 2, 3));
});
