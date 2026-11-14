import test from 'node:test';
import assert from 'node:assert/strict';
import { joinCaptions } from '../src/frontend/caption-join.ts';

const first = { id: 'one', startMs: 1000, endMs: 2000, text: 'Hello', speaker: 'Singer' };
const next = { id: 'two', startMs: 2000, endMs: 3000, text: 'world', speaker: 'Singer' };
test('joins contiguous same-speaker cues without changing their covered interval', () => {
  assert.deepEqual(joinCaptions(first, next), { ...first, endMs: 3000, text: 'Hello world' });
  assert.equal(first.endMs, 2000);
});
test('refuses changed coverage, different speakers and oversized text', () => {
  for (const candidate of [undefined, { ...next, startMs: 2001 }, { ...next, startMs: 1999 }, { ...next, speaker: 'Other' }, { ...next, text: 'x'.repeat(300) }, { ...next, endMs: 2000 }, { ...next, id: 'one' }]) assert.equal(joinCaptions(first, candidate), null);
});
