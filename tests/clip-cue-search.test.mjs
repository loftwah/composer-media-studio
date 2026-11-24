import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CUE_SEARCH_CHARS, cueMergeVisibility, cueSearchQuery, filterCuesByText } from '../src/frontend/clip-cue-search.ts';
import { sourceCaptionCues } from '../src/frontend/clip-captions.ts';

const reviewed = (sourceIndex, text) => ({ from: sourceIndex * 1000, to: sourceIndex * 1000 + 900, sourceStartMs: sourceIndex * 1000, text, sourceIndex });
const cue = (startMs, endMs, text, speaker = '') => ({ startMs, endMs, text, speaker });

test('the review search is plain, bounded, case-insensitive Unicode substring matching', () => {
  const rows = [
    reviewed(0, 'Café open'), reviewed(1, 'CAFÉ close'), reviewed(2, 'A & B <tag>'),
    reviewed(3, 'Γειά σου'), reviewed(4, 'Open [bracket]'),
  ];
  const indexes = query => filterCuesByText(rows, query).map(row => row.sourceIndex);
  assert.deepEqual(indexes('café'), [0, 1]);
  assert.deepEqual(indexes('  CAFÉ  '), [0, 1]);
  assert.deepEqual(indexes('cafe\u0301'), [0, 1]); // NFC canonical equivalence
  assert.deepEqual(indexes('ΓΕΙΆ'), [3]); // Unicode case folding, not ASCII-only
  assert.deepEqual(indexes('&'), [2]); // plain text, not regex punctuation
  assert.deepEqual(indexes('['), [4]); // regex-special characters stay literal
  assert.deepEqual(indexes('does-not-exist'), []);
  assert.deepEqual(indexes(''), [0, 1, 2, 3, 4]);
  assert.deepEqual(indexes('   '), [0, 1, 2, 3, 4]);
  assert.equal(cueSearchQuery('x'.repeat(MAX_CUE_SEARCH_CHARS + 200)).length, MAX_CUE_SEARCH_CHARS);
  // Filtering copies the projection and never rewrites a cue's text or identity.
  const before = structuredClone(rows);
  assert.notEqual(filterCuesByText(rows, ''), rows);
  assert.deepEqual(rows, before);
});

test('a filtered row keeps the source index and time used by jump, edit and remove', () => {
  const rows = [reviewed(0, 'One'), reviewed(1, 'Needle here'), reviewed(2, 'Three')];
  const shown = filterCuesByText(rows, 'needle');
  assert.deepEqual(shown, [
    { from: 1000, to: 1900, sourceStartMs: 1000, text: 'Needle here', sourceIndex: 1 },
  ]);
  assert.equal(shown[0].sourceIndex, 1);
  assert.equal(shown[0].sourceStartMs, 1000);
});

test('merge adjacency follows the full trimmed list, never neighbouring search matches', () => {
  const draft = [
    cue(0, 1000, 'Alpha common'), cue(1000, 2000, 'Alpha pair'), cue(2000, 3000, 'Middle'),
    cue(3000, 4000, 'Omega common'), cue(5000, 6000, 'Gap'),
  ];
  const full = draft.map((item, sourceIndex) => reviewed(sourceIndex, item.text));
  const [one, two, , four] = full;

  // No filter: the genuine next row is visible and truly adjacent.
  assert.deepEqual(cueMergeVisibility(full, one, full, draft), { next: two, mergeWith: two, hiddenMergeWith: null });

  // Two matches at opposite ends of the list must never merge across the cues
  // the query hides between them.
  const shown = filterCuesByText(full, 'common');
  assert.deepEqual(shown.map(row => row.sourceIndex), [0, 3]);
  assert.deepEqual(cueMergeVisibility(full, one, shown, draft), { next: two, mergeWith: null, hiddenMergeWith: two });

  // A hidden neighbour that is not actually mergeable (the gap before 'Gap')
  // is not reported as a hidden merge opportunity.
  assert.deepEqual(cueMergeVisibility(full, four, shown, draft), {
    next: full[4], mergeWith: null, hiddenMergeWith: null,
  });

  // When both genuine neighbours are visible, the merge button returns.
  const pair = filterCuesByText(full, 'Alpha');
  assert.equal(cueMergeVisibility(full, one, pair, draft).mergeWith, two);

  // The last trimmed cue has no genuine next cue at all.
  assert.deepEqual(cueMergeVisibility(full, full[4], [full[4]], draft), {
    next: null, mergeWith: null, hiddenMergeWith: null,
  });
});

test('gapped, mismatched-speaker and non-consecutive draft cues never offer a merge', () => {
  const draft = [
    { ...cue(0, 1000, 'A'), speaker: 'Ann' },
    { ...cue(1000, 2000, 'B'), speaker: 'Bob' },
    cue(3000, 4000, 'C'),
  ];
  const full = [reviewed(0, 'A'), reviewed(1, 'B'), reviewed(2, 'C')];
  assert.equal(cueMergeVisibility(full, full[0], full, draft).mergeWith, null); // speaker mismatch
  assert.equal(cueMergeVisibility(full, full[1], full, draft).mergeWith, null); // gap in draft time
  assert.equal(cueMergeVisibility(full, full[0], [full[0], full[2]], draft).hiddenMergeWith, null);
});

test('All source cues merges a genuinely adjacent cue outside the trim but never skips a hidden one', () => {
  const draft = [
    { ...cue(0, 1000, 'Intro line'), speaker: 'Ann' },
    { ...cue(1000, 2000, 'Outside trim'), speaker: 'Ann' },
    { ...cue(2500, 3000, 'Gap cue'), speaker: 'Ann' },
  ];
  const full = sourceCaptionCues(draft);
  // The source view lists every original cue, so cue 0's genuine neighbour is
  // cue 1 even when the current trim shows only one of them.
  assert.deepEqual(cueMergeVisibility(full, full[0], full, draft), {
    next: full[1], mergeWith: full[1], hiddenMergeWith: null,
  });
  // A query hiding that neighbour offers the clear-search recovery instead of
  // merging across an intermediate cue.
  const shown = filterCuesByText(full, 'intro');
  assert.deepEqual(cueMergeVisibility(full, full[0], shown, draft), {
    next: full[1], mergeWith: null, hiddenMergeWith: full[1],
  });
  // An original time gap is never offered, even with both rows visible.
  assert.equal(cueMergeVisibility(full, full[1], full, draft).mergeWith, null);
});
