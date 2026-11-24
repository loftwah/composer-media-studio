import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { clipCaptionCues, serializeClipCaptions, sourceCaptionCues, sourcePreviewVtt } from '../src/frontend/clip-captions.ts';
import {
  MAX_MANUAL_CAPTION_CUES,
  appendManualClipCue,
  canMergeClipDraftCues,
  canSplitClipDraftCue,
  clipCueSplitParts,
  defaultClipCueSplit,
  manualCaptionSourceName,
  manualCaptionTrackVtt,
  mergeClipDraftCues,
  nudgeManualCueTimes,
  removeClipDraftCue,
  replaceClipDraftCue,
  splitClipDraftCue,
} from '../src/frontend/clip-manual-cue.ts';

const cue = (startMs, endMs, text = 'Line') => ({ startMs, endMs, text, speaker: '' });
const add = (cues, text, startSeconds, endSeconds, durationMs = 10_000) =>
  appendManualClipCue(cues, { text, startSeconds, endSeconds }, durationMs);
const replace = (cues, sourceIndex, text, startSeconds, endSeconds, durationMs = 10_000) =>
  replaceClipDraftCue(cues, sourceIndex, { text, startSeconds, endSeconds }, durationMs);
const split = (cues, sourceIndex, atSeconds, wordBoundary, durationMs = 10_000) =>
  splitClipDraftCue(cues, sourceIndex, { atSeconds, wordBoundary }, durationMs);
const accepted = result => {
  assert.ok(!('problem' in result), result.problem);
  return result.cues;
};
const problem = result => {
  assert.ok('problem' in result);
  return result.problem;
};

test('one plain-text cue becomes an exact millisecond cue in the current draft', () => {
  const cues = accepted(add([], 'Fresh & <new>', '2.5', '4.25'));
  assert.deepEqual(cues, [{ startMs: 2500, endMs: 4250, text: 'Fresh & <new>', speaker: '' }]);
  assert.equal(manualCaptionTrackVtt(cues), 'WEBVTT\n\n00:02.500 --> 00:04.250\nFresh &amp; &lt;new&gt;\n');
});

test('a new cue is inserted in time order and leaves existing cues intact', () => {
  const existing = [cue(1000, 2000, 'First'), cue(5000, 6000, 'Last')];
  assert.deepEqual(accepted(add(existing, 'Middle', '2.5', '3')), [
    existing[0], { startMs: 2500, endMs: 3000, text: 'Middle', speaker: '' }, existing[1],
  ]);
  // Adjacent cues do not overlap; an earlier cue sorts before the imported one.
  assert.deepEqual(accepted(add(existing, 'Earlier', '0.5', '1')), [
    { startMs: 500, endMs: 1000, text: 'Earlier', speaker: '' }, existing[0], existing[1],
  ]);
});

test('invalid seconds, out-of-video bounds, overlaps and the 100-cue cap are refused without cues', () => {
  for (const [text, start, end] of [
    ['', '0', '1'],
    ['Words', '', '1'],
    ['Words', '0', ''],
    ['Words', 'abc', '1'],
    ['Words', '0', '1.2345'],
    ['Words', '-1', '1'],
    ['Words', '0', '10.001'],
    ['Words', '2', '2'],
    ['Words', '2', '1'],
  ]) assert.ok(problem(add([], text, start, end)).length);
  assert.match(problem(add([], 'Two\nlines', '0', '1')), /one line/);
  assert.match(problem(add([], 'Words', '0', '10.001')), /within this video/);
  assert.match(problem(add([], 'Words', '2', '2')), /after the start/);
  assert.match(problem(add([cue(1000, 2000)], 'Overlap', '1.5', '2.5')), /overlaps another cue/);
  assert.equal(problem(add([], 'x'.repeat(301), '0', '1')), 'Use plain text up to 300 characters without control characters.');
  assert.equal(problem(add([], 'A\u0000B', '0', '1')), 'Use plain text up to 300 characters without control characters.');
  assert.match(problem(add([], 'A\n\n00:03.000 --> 00:04.000\nB', '0', '1')), /one line/);

  const full = Array.from({ length: MAX_MANUAL_CAPTION_CUES }, (_, index) => cue(index * 1000, (index + 1) * 1000));
  assert.match(problem(add(full, 'One too many', '0', '1', 100_000)), /already has 100 cues/);
  assert.equal(accepted(add(full.slice(0, -1), 'Hundredth', '99', '100', 100_000)).length, 100);
  const multibyte = full.slice(0, 70).map(item => ({ ...item, text: '界'.repeat(300) }));
  assert.match(problem(add(multibyte, '界'.repeat(300), '70', '71', 100_000)), /64 KB/);
});

test('an accepted cue follows the existing clamp, rebase, preview and export projection', () => {
  const cues = accepted(add([cue(1000, 2000, 'A')], 'B & <C>', '2.5', '4.25'));
  assert.equal(sourcePreviewVtt(cues, 10, 0),
    'WEBVTT\n\n00:01.000 --> 00:02.000\nA\n\n00:02.500 --> 00:04.250\nB &amp; &lt;C&gt;\n');
  assert.deepEqual(clipCaptionCues(cues, 2, 5, 500), [
    { from: 0, to: 500, sourceStartMs: 2000, text: 'A', speaker: '', sourceIndex: 0 },
    { from: 1000, to: 2750, sourceStartMs: 3000, text: 'B & <C>', speaker: '', sourceIndex: 1 },
  ]);
  const vtt = serializeClipCaptions(cues, 2, 5, 500);
  assert.equal(vtt, 'WEBVTT\n\n00:00.000 --> 00:00.500\nA\n\n00:01.000 --> 00:02.750\nB &amp; &lt;C&gt;\n');
  // The draft SRT path reparses that exact export without inventing timing.
  assert.deepEqual(parseCaptionFile(vtt, 0, 3000), [
    { startMs: 0, endMs: 500, text: 'A', speaker: '' },
    { startMs: 1000, endMs: 2750, text: 'B & <C>', speaker: '' },
  ]);
});

test('a clamped or shifted review row removes its exact draft cue and preserves excluded cues', () => {
  const before = cue(500, 900, 'Before');
  const clamped = cue(1000, 3000, 'Trimmed');
  const shifted = cue(6000, 8000, 'Shifted');
  const after = cue(9000, 9800, 'After');
  const cues = [before, clamped, shifted, after];
  const projected = clipCaptionCues(cues, 2, 7, 500);
  // The clamped row starts at the trim, and the shifted row starts 500 ms later.
  assert.deepEqual(projected, [
    { from: 0, to: 1500, sourceStartMs: 2000, text: 'Trimmed', speaker: '', sourceIndex: 1 },
    { from: 4500, to: 5000, sourceStartMs: 6500, text: 'Shifted', speaker: '', sourceIndex: 2 },
  ]);
  // Either row deletes exactly its own source cue, including the cues outside
  // the trim, so the offset keeps the same meaning for every untouched cue.
  assert.deepEqual(removeClipDraftCue(cues, projected[1].sourceIndex), [before, clamped, after]);
  assert.deepEqual(removeClipDraftCue(cues, projected[0].sourceIndex), [before, shifted, after]);
  const remaining = removeClipDraftCue(cues, projected[1].sourceIndex);
  assert.equal(manualCaptionTrackVtt(remaining),
    'WEBVTT\n\n00:00.500 --> 00:00.900\nBefore\n\n00:01.000 --> 00:03.000\nTrimmed\n\n00:09.000 --> 00:09.800\nAfter\n');
  assert.equal(manualCaptionSourceName({ name: 'watch.vtt', local: false }), 'watch.vtt (edited in Video Clip)');
  // A stale or invented identity changes nothing.
  for (const index of [-1, cues.length, 1.5]) assert.equal(removeClipDraftCue(cues, index), null);
});

test('editing one cue replaces only its sourceIndex and preserves every other cue', () => {
  const before = cue(0, 500, 'Before');
  const selected = cue(1000, 2000, 'Wrong line');
  const after = cue(3000, 4000, 'After');
  const cues = [before, selected, after];
  const next = accepted(replace(cues, 1, 'Corrected & <new>', '1.25', '2.75'));
  assert.deepEqual(next, [
    before, { startMs: 1250, endMs: 2750, text: 'Corrected & <new>', speaker: '' }, after,
  ]);
  // The edited track is the canonical full-source VTT used for its receipt digest.
  assert.equal(manualCaptionTrackVtt(next),
    'WEBVTT\n\n00:00.000 --> 00:00.500\nBefore\n\n00:01.250 --> 00:02.750\nCorrected &amp; &lt;new&gt;\n\n00:03.000 --> 00:04.000\nAfter\n');
  // Moving the cue within a free gap re-sorts the same cue set.
  assert.deepEqual(accepted(replace(cues, 1, 'Moved', '2.1', '2.9')), [
    before, { startMs: 2100, endMs: 2900, text: 'Moved', speaker: '' }, after,
  ]);
  // Atomic: the caller's draft and the excluded cues are never mutated.
  assert.deepEqual(cues, [before, selected, after]);
  assert.equal(selected.text, 'Wrong line');
});

test('All source cues corrects a cue outside the trim without changing either export', () => {
  const outside = cue(1000, 2000, 'Out of trim');
  const inside = cue(5000, 6000, 'In trim');
  const cues = [outside, inside];
  const trimmedBefore = serializeClipCaptions(cues, 5, 7);
  // The current in-trim list cannot reach the cue that starts before the trim.
  assert.deepEqual(clipCaptionCues(cues, 5, 7)?.map(row => row.sourceIndex), [1]);
  const rows = sourceCaptionCues(cues);
  assert.deepEqual(rows, [
    { startMs: 1000, endMs: 2000, text: 'Out of trim', speaker: '', sourceIndex: 0 },
    { startMs: 5000, endMs: 6000, text: 'In trim', speaker: '', sourceIndex: 1 },
  ]);
  // Edit the exact source row. Only that cue's text and original times change;
  // the selected speaker, the other cue, the trim and the offset are untouched.
  const corrected = accepted(replace(cues, rows[0].sourceIndex, 'Corrected outside', '1.25', '2.25'));
  assert.deepEqual(corrected, [cue(1250, 2250, 'Corrected outside'), inside]);
  // The trimmed VTT the MP4, receipt and SRT sidecar read stays byte-identical
  // because the corrected cue still does not intersect this trim.
  assert.equal(serializeClipCaptions(corrected, 5, 7), trimmedBefore);
  // The full-source VTT carries the corrected text at the same original time.
  assert.equal(manualCaptionTrackVtt(corrected),
    'WEBVTT\n\n00:01.250 --> 00:02.250\nCorrected outside\n\n00:05.000 --> 00:06.000\nIn trim\n');
  // Removing that same source row is equally trim-neutral.
  assert.equal(serializeClipCaptions(removeClipDraftCue(cues, rows[0].sourceIndex), 5, 7), trimmedBefore);
  // Once the cue moves into the trim it appears in the trimmed export as usual.
  const movedInside = accepted(replace(cues, rows[0].sourceIndex, 'Moved inside', '6', '6.5'));
  assert.equal(serializeClipCaptions(movedInside, 5, 7),
    'WEBVTT\n\n00:00.000 --> 00:01.000\nIn trim\n\n00:01.000 --> 00:01.500\nMoved inside\n');
  // No step mutated the source draft.
  assert.deepEqual(cues, [outside, inside]);
});

test('a clamped or shifted review row edits its exact draft cue and preserves excluded cues', () => {
  const before = cue(500, 900, 'Before');
  const clamped = cue(1000, 3000, 'Trimmed');
  const shifted = cue(6000, 8000, 'Shifted');
  const after = cue(9000, 9800, 'After');
  const cues = [before, clamped, shifted, after];
  const projected = clipCaptionCues(cues, 2, 7, 500);
  // The shifted row only shows 4500–5000 after clipping, but its sourceIndex
  // still names the original 6000–8000 cue and its unshifted seconds.
  assert.deepEqual(projected[1], {
    from: 4500, to: 5000, sourceStartMs: 6500, text: 'Shifted', speaker: '', sourceIndex: 2,
  });
  const next = accepted(replace(cues, projected[1].sourceIndex, 'Shifted corrected', '5.75', '8.25'));
  assert.deepEqual(next, [
    before, clamped, { startMs: 5750, endMs: 8250, text: 'Shifted corrected', speaker: '' }, after,
  ]);
  // The untouched cues keep their original times, so the same trim and offset
  // project them exactly as before.
  assert.deepEqual(clipCaptionCues(next, 2, 7, 500), [
    { from: 0, to: 1500, sourceStartMs: 2000, text: 'Trimmed', speaker: '', sourceIndex: 1 },
    { from: 4250, to: 5000, sourceStartMs: 6250, text: 'Shifted corrected', speaker: '', sourceIndex: 2 },
  ]);
});

test('two visible adjacent cues merge with their exact texts and original outer times', () => {
  const before = cue(0, 500, 'Before');
  const first = cue(1000, 2000, 'Hello & <one>');
  const next = cue(2000, 3200, 'world');
  const after = cue(5000, 6000, 'After');
  const cues = [before, first, next, after];
  const snapshot = structuredClone(cues);
  assert.equal(canMergeClipDraftCues(cues, 1, 2), true);
  const nextCues = accepted(mergeClipDraftCues(cues, 1, 2, 10_000));
  assert.deepEqual(nextCues, [
    before, { startMs: 1000, endMs: 3200, text: 'Hello & <one> world', speaker: '' }, after,
  ]);
  // The exact edited track is the canonical full-source VTT used for its digest.
  assert.equal(manualCaptionTrackVtt(nextCues),
    'WEBVTT\n\n00:00.000 --> 00:00.500\nBefore\n\n00:01.000 --> 00:03.200\nHello &amp; &lt;one&gt; world\n\n00:05.000 --> 00:06.000\nAfter\n');
  // Atomic: neither the caller's cues nor the merged source texts were changed.
  assert.deepEqual(cues, snapshot);
  assert.equal(first.text, 'Hello & <one>');
});

test('a merge keeps cues hidden by the trim and offset and targets the visible source indexes', () => {
  const before = cue(500, 900, 'Before');
  const first = cue(1000, 3000, 'First');
  const next = cue(3000, 5000, 'Second');
  const after = cue(9000, 9800, 'After');
  const cues = [before, first, next, after];
  const projected = clipCaptionCues(cues, 2, 7, 500);
  assert.deepEqual(projected, [
    { from: 0, to: 1500, sourceStartMs: 2000, text: 'First', speaker: '', sourceIndex: 1 },
    { from: 1500, to: 3500, sourceStartMs: 3500, text: 'Second', speaker: '', sourceIndex: 2 },
  ]);
  const nextCues = accepted(mergeClipDraftCues(cues, projected[0].sourceIndex, projected[1].sourceIndex, 10_000));
  // Hidden cues stay exactly where they were; only the two visible rows merge,
  // and their original start/end survive the clamp and offset.
  assert.deepEqual(nextCues, [before, { startMs: 1000, endMs: 5000, text: 'First Second', speaker: '' }, after]);
  assert.deepEqual(clipCaptionCues(nextCues, 2, 7, 500), [
    { from: 0, to: 3500, sourceStartMs: 2000, text: 'First Second', speaker: '', sourceIndex: 1 },
  ]);
});

test('merge refuses hidden, gapped, mismatched or stale neighbours without changing the draft', () => {
  const cues = [cue(0, 1000, 'A'), cue(1000, 2000, 'B'), cue(2000, 3000, 'C')];
  const snapshot = structuredClone(cues);
  assert.equal(canMergeClipDraftCues(cues, 0, 2), false);
  assert.match(problem(mergeClipDraftCues(cues, 0, 2, 10_000)), /adjacent cues/);
  // Adjacency is the next draft source index, not merely the next row in this
  // trim, so skipping a source cue is refused even when both rows are visible.
  assert.equal(canMergeClipDraftCues(cues, 0, 1), true);
  assert.match(problem(mergeClipDraftCues([cue(0, 1000, 'A'), cue(1001, 2000, 'B')], 0, 1, 10_000)), /no gap/);
  assert.match(problem(mergeClipDraftCues([{ ...cues[0], speaker: 'One' }, { ...cues[1], speaker: 'Two' }], 0, 1, 10_000)), /matching speakers/);
  for (const [firstIndex, nextIndex] of [[-1, 0], [2, 3], [0, 1.5], [0, -1]]) {
    assert.match(problem(mergeClipDraftCues(cues, firstIndex, nextIndex, 10_000)), /no longer in this draft/);
  }
  // The existing overlap check still runs against every cue left in the draft.
  const overlapping = [cue(0, 1000, 'A'), cue(1000, 2000, 'B'), cue(1500, 2500, 'C')];
  assert.match(problem(mergeClipDraftCues(overlapping, 0, 1, 10_000)), /overlaps another cue/);
  assert.deepEqual(cues, snapshot);
});

test('merge reuses the plain-text, duration, size and text limits before changing the draft', () => {
  const exact = [cue(0, 1000, 'a'.repeat(150)), cue(1000, 2000, 'b'.repeat(149))];
  assert.equal(accepted(mergeClipDraftCues(exact, 0, 1, 10_000))[0].text.length, 300);
  const tooLong = [cue(0, 1000, 'a'.repeat(151)), cue(1000, 2000, 'b'.repeat(149))];
  const tooLongSnapshot = structuredClone(tooLong);
  assert.equal(problem(mergeClipDraftCues(tooLong, 0, 1, 10_000)),
    'Use plain text up to 300 characters without control characters.');
  assert.deepEqual(tooLong, tooLongSnapshot);
  // The merged outer end must still fit the real video duration.
  assert.match(problem(mergeClipDraftCues([cue(0, 1000, 'A'), cue(1000, 2000, 'B')], 0, 1, 1500)), /within this video/);
  // The 64 KB edited-track bound still applies to a merge even when the joined
  // text itself is under 300 characters.
  const bulky = Array.from({ length: MAX_MANUAL_CAPTION_CUES }, (_, index) => cue(index * 1000, (index + 1) * 1000, '&'.repeat(149)));
  assert.match(problem(mergeClipDraftCues(bulky, 0, 1, 100_000)), /64 KB/);
});

test('an invalid or stale edit is refused without changing the cue list', () => {
  const cues = [cue(0, 1000, 'A'), cue(2000, 3000, 'B'), cue(4000, 5000, 'C')];
  const snapshot = structuredClone(cues);
  // Overlap is checked against every other cue, not the cue being replaced.
  assert.match(problem(replace(cues, 1, 'Overlap', '0.5', '2.5')), /overlaps another cue/);
  assert.equal(accepted(replace(cues, 1, 'Adjacent', '1', '2')).length, 3);
  // Source range, ordering, plain text and one-line limits match Add cue.
  assert.match(problem(replace(cues, 1, 'Outside', '2', '10.001')), /within this video/);
  assert.match(problem(replace(cues, 1, 'Negative', '-1', '1')), /within this video/);
  assert.match(problem(replace(cues, 1, 'Reversed', '3', '2')), /after the start/);
  assert.match(problem(replace(cues, 1, '  ', '2', '2.5')), /plain caption text/);
  assert.match(problem(replace(cues, 1, 'Two\nlines', '2', '2.5')), /one line/);
  assert.equal(problem(replace(cues, 1, 'x'.repeat(301), '2', '2.5')),
    'Use plain text up to 300 characters without control characters.');
  // A stale index from a replaced or imported draft cannot target a new cue.
  for (const index of [-1, cues.length, 1.5]) assert.match(problem(replace(cues, index, 'B', '2', '2.5')), /no longer in this draft/);
  // A replacement at the 100-cue ceiling is allowed because it adds no cue.
  const full = Array.from({ length: MAX_MANUAL_CAPTION_CUES }, (_, index) => cue(index * 1000, (index + 1) * 1000));
  assert.equal(accepted(replace(full, 50, 'Edited', '50', '51', 100_000)).length, 100);
  // The 64 KB edited-track bound still applies to a replacement.
  const multibyte = full.slice(0, 80).map(item => ({ ...item, text: '界'.repeat(300) }));
  assert.match(problem(replace(multibyte, 0, '界'.repeat(300), '0', '1', 100_000)), /64 KB/);
  assert.deepEqual(cues, snapshot);
});

test('splitting one cue uses the entered original-video time and chosen word boundary', () => {
  const before = cue(500, 900, 'Before');
  const selected = { startMs: 1000, endMs: 4000, text: 'Hello bright world', speaker: 'Singer' };
  const after = cue(5000, 6000, 'After');
  const cues = [before, selected, after];
  const snapshot = structuredClone(cues);
  const next = accepted(split(cues, 1, '2.250', 1));
  assert.deepEqual(next, [
    before,
    { startMs: 1000, endMs: 2250, text: 'Hello', speaker: 'Singer' },
    { startMs: 2250, endMs: 4000, text: 'bright world', speaker: 'Singer' },
    after,
  ]);
  // The exact edited track is the canonical full-source VTT used for its digest.
  assert.equal(manualCaptionTrackVtt(next),
    'WEBVTT\n\n00:00.500 --> 00:00.900\nBefore\n\n00:01.000 --> 00:02.250\n<v Singer>Hello</v>\n\n00:02.250 --> 00:04.000\n<v Singer>bright world</v>\n\n00:05.000 --> 00:06.000\nAfter\n');
  // Atomic: the caller's draft and the selected cue are unchanged.
  assert.deepEqual(cues, snapshot);
  assert.equal(selected.text, 'Hello bright world');
  // The other interior boundary keeps the same outer start and end.
  assert.deepEqual(accepted(split(cues, 1, '2.250', 2)).slice(1, 3), [
    { startMs: 1000, endMs: 2250, text: 'Hello bright', speaker: 'Singer' },
    { startMs: 2250, endMs: 4000, text: 'world', speaker: 'Singer' },
  ]);
});

test('split defaults are only offered for a real multi-word cue', () => {
  const selected = { startMs: 1000, endMs: 4501, text: 'Hello, bright world!', speaker: 'Singer' };
  assert.deepEqual(defaultClipCueSplit(selected), { atSeconds: '2.750', wordBoundary: 2 });
  assert.equal(canSplitClipDraftCue(selected), true);
  assert.equal(canSplitClipDraftCue({ ...selected, text: 'Single' }), false);
  assert.equal(canSplitClipDraftCue({ ...selected, text: '   ' }), false);
  assert.equal(canSplitClipDraftCue({ ...selected, endMs: 1001 }), false);
  assert.equal(canSplitClipDraftCue(null), false);
  assert.equal(canSplitClipDraftCue(undefined), false);
  // Only the chosen whitespace divides the words; the exact parts stay intact.
  assert.deepEqual(clipCueSplitParts('Hello  bright world', 1), { first: 'Hello', second: 'bright world' });
  assert.equal(clipCueSplitParts('Hello  bright world', 0), null);
  assert.equal(clipCueSplitParts('Hello  bright world', 3), null);
});

test('a split keeps cues hidden by the trim and the same offset projection', () => {
  const before = cue(500, 900, 'Before');
  const selected = { startMs: 3000, endMs: 5000, text: 'Hello bright world', speaker: '' };
  const after = cue(9000, 9800, 'After');
  const cues = [before, selected, after];
  const next = accepted(split(cues, 1, '4.000', 1));
  assert.deepEqual(next, [
    before,
    { startMs: 3000, endMs: 4000, text: 'Hello', speaker: '' },
    { startMs: 4000, endMs: 5000, text: 'bright world', speaker: '' },
    after,
  ]);
  // Untouched cues keep their original times, so the selected trim and offset
  // still project the split pair into the same review window.
  assert.deepEqual(clipCaptionCues(next, 2, 7, 500), [
    { from: 1500, to: 2500, sourceStartMs: 3500, text: 'Hello', speaker: '', sourceIndex: 1 },
    { from: 2500, to: 3500, sourceStartMs: 4500, text: 'bright world', speaker: '', sourceIndex: 2 },
  ]);
});

test('a split refuses an invalid time, boundary, count, overlap or size without changing the draft', () => {
  const selected = { startMs: 1000, endMs: 4000, text: 'Hello bright world', speaker: '' };
  const cues = [cue(0, 900, 'Before'), selected, cue(5000, 6000, 'After')];
  const snapshot = structuredClone(cues);
  assert.match(problem(split(cues, 1, '', 1)), /three decimal places/);
  assert.match(problem(split(cues, 1, 'abc', 1)), /three decimal places/);
  assert.match(problem(split(cues, 1, '1.2345', 1)), /three decimal places/);
  assert.match(problem(split(cues, 1, '10.001', 1)), /within this video/);
  // The entered time must be strictly inside the cue, not at either edge.
  assert.match(problem(split(cues, 1, '1', 1)), /after the cue start and before its end/);
  assert.match(problem(split(cues, 1, '4', 1)), /after the cue start and before its end/);
  assert.match(problem(split(cues, 1, '0.5', 1)), /after the cue start and before its end/);
  assert.match(problem(split(cues, 1, '2', 0)), /between two words/);
  assert.match(problem(split(cues, 1, '2', 3)), /between two words/);
  assert.match(problem(split(cues, 1, '2', 1.5)), /between two words/);
  assert.match(problem(split([cue(0, 1000, 'Single')], 0, '0.5', 1)), /between two words/);
  assert.equal(problem(split([{ ...selected, startMs: 0, endMs: 2000, text: 'Two\u0000words' }], 0, '1', 1)),
    'Use plain text up to 300 characters without control characters.');
  for (const index of [-1, cues.length, 1.5])
    assert.match(problem(split(cues, index, '2', 1)), /no longer in this draft/);
  assert.match(problem(split(cues, 1, '2', 1, 0)), /no usable duration/);
  const full = [
    { startMs: 0, endMs: 1000, text: 'Two words', speaker: '' },
    ...Array.from({ length: 99 }, (_, index) => cue((index + 1) * 1000, (index + 2) * 1000)),
  ];
  assert.match(problem(split(full, 0, '0.5', 1, 100_000)), /already has 100 cues/);
  // A final track that would overlap is still read back through the importer.
  const overlapping = [cue(0, 3000, 'Hello bright'), cue(2000, 4000, 'Other')];
  assert.match(problem(split(overlapping, 0, '1', 1)), /overlaps another cue/);
  // The 64 KB edited-track bound applies even though each text part is short.
  const bulky = Array.from({ length: 90 }, (_, index) =>
    cue(index * 2000, (index + 1) * 2000, '界'.repeat(300)))
    .map((item, index) => index === 0 ? { ...item, text: `${'界'.repeat(149)} ${'界'.repeat(149)}` } : item);
  assert.match(problem(split(bulky, 0, '1', 1, 200_000)), /64 KB/);
  assert.deepEqual(cues, snapshot);
});

test('a manual or edited track is named as a local source, not the imported file', () => {
  assert.equal(manualCaptionSourceName(null), 'Manual cues in Video Clip');
  assert.equal(manualCaptionSourceName({ name: 'watch.vtt', local: false }), 'watch.vtt (edited in Video Clip)');
  assert.equal(manualCaptionSourceName({ name: 'Manual cues in Video Clip', local: true }), 'Manual cues in Video Clip');
});

test('the manual cue form adds and explicitly edits one plain speaker label', () => {
  // Add accepts an optional name, trims it through the shared normaliser, and
  // blank still means unnamed. An omitted field keeps the prior unnamed shape.
  const named = accepted(appendManualClipCue([], {
    text: 'Hello', startSeconds: '1', endSeconds: '2', speaker: '  Dean & Jane  ',
  }, 10_000));
  assert.deepEqual(named, [{ startMs: 1000, endMs: 2000, text: 'Hello', speaker: 'Dean & Jane' }]);
  assert.equal(manualCaptionTrackVtt(named),
    'WEBVTT\n\n00:01.000 --> 00:02.000\n<v Dean &amp; Jane>Hello</v>\n');
  assert.deepEqual(parseCaptionFile(manualCaptionTrackVtt(named), 0, 10_000, { voices: true }), named);
  assert.deepEqual(accepted(appendManualClipCue([], { text: 'Plain', startSeconds: '1', endSeconds: '2' }, 10_000)),
    [{ startMs: 1000, endMs: 2000, text: 'Plain', speaker: '' }]);
  assert.deepEqual(accepted(appendManualClipCue([], {
    text: 'Blank', startSeconds: '1', endSeconds: '2', speaker: '   ',
  }, 10_000)), [{ startMs: 1000, endMs: 2000, text: 'Blank', speaker: '' }]);

  // Update cue saves a label change explicitly while keeping the entered text
  // and source times, and a blank field removes the name.
  const other = { startMs: 3000, endMs: 4000, text: 'Next', speaker: 'Other' };
  const renamed = accepted(replaceClipDraftCue([...named, other], 0, {
    text: 'Hello', startSeconds: '1', endSeconds: '2', speaker: 'Sam',
  }, 10_000));
  assert.deepEqual(renamed, [
    { startMs: 1000, endMs: 2000, text: 'Hello', speaker: 'Sam' },
    other,
  ]);
  const unnamed = accepted(replaceClipDraftCue(renamed, 0, {
    text: 'Hello', startSeconds: '1', endSeconds: '2', speaker: '',
  }, 10_000));
  assert.deepEqual(unnamed, [
    { startMs: 1000, endMs: 2000, text: 'Hello', speaker: '' },
    other,
  ]);
  // An omitted speaker preserves the saved label exactly as before this field.
  assert.deepEqual(accepted(replaceClipDraftCue(named, 0, {
    text: 'Corrected', startSeconds: '1.25', endSeconds: '2.5',
  }, 10_000)), [{ startMs: 1250, endMs: 2500, text: 'Corrected', speaker: 'Dean & Jane' }]);
});

test('the manual cue form refuses a speaker that is not one plain line of up to 80 characters', () => {
  const existing = [{ startMs: 1000, endMs: 2000, text: 'Hello', speaker: 'Dean' }];
  const snapshot = structuredClone(existing);
  for (const speaker of ['x'.repeat(81), 'Two\nlines', 'Tab\there', 'Null\u0000name']) {
    assert.equal(problem(appendManualClipCue([], {
      text: 'Hello', startSeconds: '1', endSeconds: '2', speaker,
    }, 10_000)), 'A speaker name needs one line of up to 80 plain characters.');
    assert.equal(problem(replaceClipDraftCue(existing, 0, {
      text: 'Hello', startSeconds: '1', endSeconds: '2', speaker,
    }, 10_000)), 'A speaker name needs one line of up to 80 plain characters.');
  }
  // The exact 80-character bound is accepted.
  assert.equal(accepted(appendManualClipCue([], {
    text: 'Hello', startSeconds: '1', endSeconds: '2', speaker: 'x'.repeat(80),
  }, 10_000))[0].speaker.length, 80);
  // Refusals leave the caller's draft untouched.
  assert.deepEqual(existing, snapshot);
});

test('a named cue keeps its speaker through text, time, split and merge edits', () => {
  const named = { startMs: 1000, endMs: 2000, text: 'Hello world', speaker: 'Dean & Jane' };
  const later = { startMs: 2000, endMs: 3000, text: 'Again', speaker: 'Dean & Jane' };
  assert.deepEqual(accepted(replace([named], 0, 'Corrected', '1.25', '2.5')), [
    { startMs: 1250, endMs: 2500, text: 'Corrected', speaker: 'Dean & Jane' },
  ]);
  assert.deepEqual(accepted(split([named], 0, '1.5', 1)), [
    { startMs: 1000, endMs: 1500, text: 'Hello', speaker: 'Dean & Jane' },
    { startMs: 1500, endMs: 2000, text: 'world', speaker: 'Dean & Jane' },
  ]);
  const merged = accepted(mergeClipDraftCues([named, later], 0, 1, 10_000));
  assert.deepEqual(merged, [
    { startMs: 1000, endMs: 3000, text: 'Hello world Again', speaker: 'Dean & Jane' },
  ]);
  // The canonical full-source output escapes the name and reads back exactly.
  assert.equal(manualCaptionTrackVtt(merged),
    'WEBVTT\n\n00:01.000 --> 00:03.000\n<v Dean &amp; Jane>Hello world Again</v>\n');
  assert.deepEqual(parseCaptionFile(manualCaptionTrackVtt(merged), 0, 10_000, { voices: true }), merged);
});

test('a nudge moves both entered times by exactly 100 ms and keeps their duration', () => {
  const input = { startSeconds: '2.5', endSeconds: '4.25' };
  assert.deepEqual(nudgeManualCueTimes(input, 100, 10_000), { startSeconds: '2.600', endSeconds: '4.350' });
  assert.deepEqual(nudgeManualCueTimes(input, -100, 10_000), { startSeconds: '2.400', endSeconds: '4.150' });
  // Repeated steps stay exact whole milliseconds and keep the original gap.
  let fields = input;
  for (let i = 0; i < 3; i++) fields = nudgeManualCueTimes(fields, 100, 10_000);
  assert.deepEqual(fields, { startSeconds: '2.800', endSeconds: '4.550' });
  assert.equal(Math.round(Number(fields.endSeconds) * 1000) - Math.round(Number(fields.startSeconds) * 1000), 1750);
  assert.deepEqual(input, { startSeconds: '2.5', endSeconds: '4.25' });
  // Those draft fields are what the existing Add cue action already applies.
  assert.deepEqual(accepted(add([], 'Line', fields.startSeconds, fields.endSeconds)), [cue(2800, 4550, 'Line')]);
});

test('a nudge refuses to cross either video edge and leaves the fields unchanged', () => {
  const atStart = { startSeconds: '0.000', endSeconds: '1.500' };
  assert.equal(problem(nudgeManualCueTimes(atStart, -100, 10_000)),
    'Cannot move 100 ms earlier: the cue would start before the video (0 to 00:10.000).');
  const atEnd = { startSeconds: '8.500', endSeconds: '10.000' };
  assert.equal(problem(nudgeManualCueTimes(atEnd, 100, 10_000)),
    'Cannot move 100 ms later: the cue would end after the video (0 to 00:10.000).');
  // One step before each edge is still allowed and lands exactly on it.
  assert.deepEqual(nudgeManualCueTimes({ startSeconds: '0.100', endSeconds: '1.000' }, -100, 10_000),
    { startSeconds: '0.000', endSeconds: '0.900' });
  assert.deepEqual(nudgeManualCueTimes({ startSeconds: '8.000', endSeconds: '9.900' }, 100, 10_000),
    { startSeconds: '8.100', endSeconds: '10.000' });
  assert.deepEqual(atStart, { startSeconds: '0.000', endSeconds: '1.500' });
  assert.deepEqual(atEnd, { startSeconds: '8.500', endSeconds: '10.000' });
});

test('a nudge reuses the existing draft time validation before changing a field', () => {
  assert.match(problem(nudgeManualCueTimes({ startSeconds: '', endSeconds: '1' }, 100, 10_000)), /three decimal places/);
  assert.match(problem(nudgeManualCueTimes({ startSeconds: '0.1', endSeconds: 'abc' }, 100, 10_000)), /three decimal places/);
  assert.match(problem(nudgeManualCueTimes({ startSeconds: '0.1', endSeconds: '1.2345' }, 100, 10_000)), /three decimal places/);
  assert.equal(problem(nudgeManualCueTimes({ startSeconds: '-0.1', endSeconds: '1' }, 100, 10_000)),
    'Choose a start and end within this video (0 to 00:10.000).');
  assert.equal(problem(nudgeManualCueTimes({ startSeconds: '0', endSeconds: '10.001' }, -100, 10_000)),
    'Choose a start and end within this video (0 to 00:10.000).');
  assert.equal(problem(nudgeManualCueTimes({ startSeconds: '2', endSeconds: '1' }, 100, 10_000)),
    'The end must be after the start.');
  assert.equal(problem(nudgeManualCueTimes({ startSeconds: '0', endSeconds: '1' }, 100, 0)),
    'This video has no usable duration for captions.');
  assert.equal(problem(nudgeManualCueTimes({ startSeconds: '0', endSeconds: '1' }, 0, 10_000)),
    'Choose a whole-millisecond nudge step.');
});
