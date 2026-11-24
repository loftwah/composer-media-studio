import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipCaptionCues } from '../src/frontend/clip-captions.ts';
import { cueAuditionWindow } from '../src/frontend/clip-cue-audition.ts';

test('a reviewed cue plays exactly the intersection the trim and offset projection produced', () => {
  const cues = [
    { startMs: 0, endMs: 1500, text: 'starts before the trim', speaker: '' },
    { startMs: 4000, endMs: 6000, text: 'fully inside', speaker: '' },
    { startMs: 8000, endMs: 12000, text: 'runs past the trim', speaker: '' },
  ];
  // Trim 1s–10s with +1s offset: the first cue is clamped at the trim start,
  // the last one is clamped at the trim end, and the middle stays whole.
  const kept = clipCaptionCues(cues, 1, 10, 1000);
  assert.deepEqual(kept.map(cue => [cue.from, cue.to, cue.sourceStartMs]), [
    [0, 1500, 1000],
    [4000, 6000, 5000],
    [8000, 9000, 9000],
  ]);
  for (const cue of kept) {
    assert.deepEqual(cueAuditionWindow(cue, 15_000), {
      startMs: cue.sourceStartMs,
      endMs: cue.sourceStartMs + (cue.to - cue.from),
    });
  }
});

test('the audition window uses the clamped cue end, not the original cue end', () => {
  const cues = [{ startMs: 5000, endMs: 30_000, text: 'long cue', speaker: '' }];
  const [cue] = clipCaptionCues(cues, 2, 8, 0);
  assert.equal(cue.sourceStartMs, 5000);
  assert.equal(cue.to - cue.from, 3000);
  assert.deepEqual(cueAuditionWindow(cue, 20_000), { startMs: 5000, endMs: 8000 });
});

test('invalid, missing and out-of-range windows are refused rather than clamped', () => {
  const cue = { sourceStartMs: 2000, from: 250, to: 1500 };
  assert.deepEqual(cueAuditionWindow(cue, 10_000), { startMs: 2000, endMs: 3250 });
  assert.equal(cueAuditionWindow(null, 10_000), null);
  assert.equal(cueAuditionWindow(undefined, 10_000), null);
  assert.equal(cueAuditionWindow(cue, 0), null);
  assert.equal(cueAuditionWindow(cue, Number.NaN), null);
  assert.equal(cueAuditionWindow(cue, 3000), null);
  assert.equal(cueAuditionWindow({ ...cue, sourceStartMs: -1 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, from: -1 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, to: 250 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, to: 249 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, sourceStartMs: 1.5 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, from: 250.5 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, to: 1500.5 }, 10_000), null);
  assert.equal(cueAuditionWindow({ ...cue, sourceStartMs: Number.MAX_SAFE_INTEGER }, 10_000), null);
});
