import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_CUE_SPEAKERS, MAX_CUE_SEARCH_CHARS, UNNAMED_CUE_SPEAKER, cueMergeVisibility, cueSearchQuery, cueSpeakerFilterForDraft, cueSpeakerName, cueSpeakerOptionValue, cueSpeakerOptions, filterCuesByText, filterCuesByTextAndSpeaker } from '../src/frontend/clip-cue-search.ts';
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

test('speaker choices contain only distinct exact draft names with collision-safe values', () => {
  const draft = [
    cue(0, 1000, 'One', ''),
    cue(1000, 2000, 'Two', 'Ann'),
    cue(2000, 3000, 'Three', 'Ann'),
    cue(3000, 4000, 'Four', 'Unnamed'),
    cue(4000, 5000, 'Five', 'All speakers'),
    cue(5000, 6000, 'Six', 'ann'),
  ];
  const options = cueSpeakerOptions(draft);
  assert.deepEqual(options, [
    cueSpeakerOptionValue('Ann'),
    cueSpeakerOptionValue('Unnamed'),
    cueSpeakerOptionValue('All speakers'),
    cueSpeakerOptionValue('ann'),
  ]);
  assert.equal(new Set(options).size, options.length);
  assert.notEqual(cueSpeakerOptionValue('All speakers'), ALL_CUE_SPEAKERS);
  assert.notEqual(cueSpeakerOptionValue('Unnamed'), UNNAMED_CUE_SPEAKER);
  assert.equal(cueSpeakerName(ALL_CUE_SPEAKERS), null);
  assert.equal(cueSpeakerName(UNNAMED_CUE_SPEAKER), '');
  assert.equal(cueSpeakerName(cueSpeakerOptionValue('All speakers')), 'All speakers');
  assert.equal(cueSpeakerName(cueSpeakerOptionValue('Unnamed')), 'Unnamed');
});

test('exact speaker and text filters combine without changing row order, identity or timing', () => {
  const rows = [
    { ...reviewed(4, 'Café opening'), speaker: 'Ann' },
    { ...reviewed(1, 'Café opening'), speaker: 'ann' },
    { ...reviewed(7, 'Café opening'), speaker: '' },
    { ...reviewed(2, 'Café opening'), speaker: 'All speakers' },
    { ...reviewed(9, 'Café opening'), speaker: 'Unnamed' },
    { ...reviewed(3, 'Other line'), speaker: 'Ann' },
  ];
  const before = structuredClone(rows);
  const indexes = (text, speaker) => filterCuesByTextAndSpeaker(rows, text, speaker).map(row => row.sourceIndex);
  assert.deepEqual(indexes('cafe\u0301', ALL_CUE_SPEAKERS), [4, 1, 7, 2, 9]);
  assert.deepEqual(indexes('CAFÉ', cueSpeakerOptionValue('Ann')), [4]);
  assert.deepEqual(indexes('café', cueSpeakerOptionValue('ann')), [1]);
  assert.deepEqual(indexes('café', UNNAMED_CUE_SPEAKER), [7]);
  assert.deepEqual(indexes('café', cueSpeakerOptionValue('All speakers')), [2]);
  assert.deepEqual(indexes('café', cueSpeakerOptionValue('Unnamed')), [9]);
  assert.deepEqual(indexes('other', cueSpeakerOptionValue('Ann')), [3]);
  assert.deepEqual(indexes('missing', cueSpeakerOptionValue('Ann')), []);
  assert.deepEqual(filterCuesByTextAndSpeaker(rows, 'café', cueSpeakerOptionValue('Ann')), [rows[0]]);
  assert.deepEqual(rows, before);
});

test('a selected speaker retires only when its exact name leaves the current draft', () => {
  const named = cueSpeakerOptionValue('Ann');
  assert.equal(cueSpeakerFilterForDraft(named, [cue(0, 1000, 'A', 'Ann')]), named);
  assert.equal(cueSpeakerFilterForDraft(named, [cue(0, 1000, 'A', 'ann')]), ALL_CUE_SPEAKERS);
  assert.equal(cueSpeakerFilterForDraft(named, []), ALL_CUE_SPEAKERS);
  assert.equal(cueSpeakerFilterForDraft(ALL_CUE_SPEAKERS, []), ALL_CUE_SPEAKERS);
  assert.equal(cueSpeakerFilterForDraft(UNNAMED_CUE_SPEAKER, []), UNNAMED_CUE_SPEAKER);
  const literal = cueSpeakerOptionValue('Unnamed');
  assert.equal(cueSpeakerFilterForDraft(literal, [cue(0, 1000, 'A', 'Unnamed')]), literal);
  assert.equal(cueSpeakerFilterForDraft(literal, [cue(0, 1000, 'A', '')]), ALL_CUE_SPEAKERS);
});

test('combined filters keep merge adjacency tied to the full list', () => {
  const draft = [
    cue(0, 1000, 'Alpha common', 'Ann'),
    cue(1000, 2000, 'Alpha pair', 'Ann'),
    cue(2000, 3000, 'Middle', 'Bob'),
    cue(3000, 4000, 'Omega common', 'Ann'),
  ];
  const full = draft.map((item, sourceIndex) => ({ ...reviewed(sourceIndex, item.text), speaker: item.speaker }));
  const ann = cueSpeakerOptionValue('Ann');
  const pair = filterCuesByTextAndSpeaker(full, 'Alpha', ann);
  assert.deepEqual(pair.map(row => row.sourceIndex), [0, 1]);
  assert.equal(cueMergeVisibility(full, full[0], pair, draft).mergeWith, full[1]);
  const common = filterCuesByTextAndSpeaker(full, 'common', ann);
  assert.deepEqual(common.map(row => row.sourceIndex), [0, 3]);
  assert.deepEqual(cueMergeVisibility(full, full[0], common, draft), {
    next: full[1], mergeWith: null, hiddenMergeWith: full[1],
  });
});
