import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCaptionFile } from '../src/frontend/caption-import.ts';
import { clipCaptionCues, serializeClipCaptions, sourcePreviewVtt } from '../src/frontend/clip-captions.ts';
import {
  MAX_MANUAL_CAPTION_CUES,
  appendManualClipCue,
  manualCaptionSourceName,
  manualCaptionTrackVtt,
} from '../src/frontend/clip-manual-cue.ts';

const cue = (startMs, endMs, text = 'Line') => ({ startMs, endMs, text, speaker: '' });
const add = (cues, text, startSeconds, endSeconds, durationMs = 10_000) =>
  appendManualClipCue(cues, { text, startSeconds, endSeconds }, durationMs);
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
    { from: 0, to: 500, sourceStartMs: 2000, text: 'A' },
    { from: 1000, to: 2750, sourceStartMs: 3000, text: 'B & <C>' },
  ]);
  const vtt = serializeClipCaptions(cues, 2, 5, 500);
  assert.equal(vtt, 'WEBVTT\n\n00:00.000 --> 00:00.500\nA\n\n00:01.000 --> 00:02.750\nB &amp; &lt;C&gt;\n');
  // The draft SRT path reparses that exact export without inventing timing.
  assert.deepEqual(parseCaptionFile(vtt, 0, 3000), [
    { startMs: 0, endMs: 500, text: 'A', speaker: '' },
    { startMs: 1000, endMs: 2750, text: 'B & <C>', speaker: '' },
  ]);
});

test('a manual or edited track is named as a local source, not the imported file', () => {
  assert.equal(manualCaptionSourceName(null), 'Manual cues in Video Clip');
  assert.equal(manualCaptionSourceName({ name: 'watch.vtt', local: false }), 'watch.vtt (edited in Video Clip)');
  assert.equal(manualCaptionSourceName({ name: 'Manual cues in Video Clip', local: true }), 'Manual cues in Video Clip');
});
