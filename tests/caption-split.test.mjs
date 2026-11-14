import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCaption } from '../src/frontend/caption-split.ts';

test('splits words and punctuation into adjacent editable cues without changing the original', () => {
  const cue = { id: 'cue_01', startMs: 1000, endMs: 4501, text: 'Hello, bright world!', speaker: 'Singer' };
  const result = splitCaption(cue, 'cue_02');
  assert.deepEqual(result, [
    { ...cue, endMs: 2750, text: 'Hello, bright' },
    { ...cue, id: 'cue_02', startMs: 2750, text: 'world!' },
  ]);
  assert.equal(result.map(part => part.text).join(' '), cue.text);
  assert.equal(cue.endMs, 4501);
});

test('refuses a single word, blank text, too-short timing or reused IDs', () => {
  const cue = { id: 'cue_01', startMs: 0, endMs: 10, text: 'One', speaker: '' };
  assert.equal(splitCaption(cue, 'cue_02'), null);
  assert.equal(splitCaption({ ...cue, text: '   ' }, 'cue_02'), null);
  assert.equal(splitCaption({ ...cue, text: 'Two words', endMs: 1 }, 'cue_02'), null);
  assert.equal(splitCaption({ ...cue, text: 'Two words' }, 'cue_01'), null);
});
