import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { clipCueSplitFromPlayhead, splitClipDraftCue } from '../src/frontend/clip-manual-cue.ts';

const component = readFileSync(new URL('../src/frontend/video-clip.tsx', import.meta.url), 'utf8');
const savedCue = { startMs: 1000, endMs: 4000, text: 'Hello bright world', speaker: 'Singer' };

test('a split playhead sample stages exact milliseconds for the existing split path', () => {
  assert.deepEqual(clipCueSplitFromPlayhead(savedCue, 2.3456), { atSeconds: '2.346' });
  assert.deepEqual(clipCueSplitFromPlayhead(savedCue, 1.0006), { atSeconds: '1.001' });
  assert.deepEqual(clipCueSplitFromPlayhead(savedCue, 3.9994), { atSeconds: '3.999' });

  const before = { startMs: 500, endMs: 900, text: 'Before', speaker: '' };
  const after = { startMs: 5000, endMs: 6000, text: 'After', speaker: '' };
  const staged = clipCueSplitFromPlayhead(savedCue, 2.3456);
  assert.ok(!('problem' in staged));
  const result = splitClipDraftCue([before, savedCue, after], 1, {
    atSeconds: staged.atSeconds,
    wordBoundary: 2,
  }, 10_000);
  assert.ok(!('problem' in result), result.problem);
  assert.deepEqual(result.cues, [
    before,
    { startMs: 1000, endMs: 2346, text: 'Hello bright', speaker: 'Singer' },
    { startMs: 2346, endMs: 4000, text: 'world', speaker: 'Singer' },
    after,
  ]);
  // Sampling is pure: the saved cue and its imported speaker are untouched.
  assert.deepEqual(savedCue, { startMs: 1000, endMs: 4000, text: 'Hello bright world', speaker: 'Singer' });
});

test('a missing clock or a sample outside the saved cue interior is refused clearly', () => {
  assert.deepEqual(clipCueSplitFromPlayhead(null, 2), {
    problem: 'The saved cue is no longer available. Choose Edit again.',
  });
  for (const currentTime of [undefined, null, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    assert.match(clipCueSplitFromPlayhead(savedCue, currentTime).problem, /playhead is unavailable/);
  }
  for (const currentTime of [0.999, 1, 1.0004, 3.9996, 4, 4.001]) {
    const result = clipCueSplitFromPlayhead(savedCue, currentTime);
    assert.ok('problem' in result);
    assert.match(result.problem, /after 00:01\.000 and before 00:04\.000/);
    assert.match(result.problem, /Enter a split time manually/);
  }
});

test('the accessible split playhead action stages only the split field', () => {
  const handler = component.match(/  function fillCueSplitFromPlayhead\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.match(handler, /clipCueSplitFromPlayhead\(editingCue, sourceVideo\.current\?\.currentTime\)/);
  assert.match(handler, /if \("problem" in split\) \{ setManualCueMessage\(split\.problem\); return; \}/);
  assert.match(handler, /setCueSplitAt\(split\.atSeconds\)/);
  assert.match(handler, /Choose Split cue to save/);
  assert.doesNotMatch(handler, /\.pause\(|\.play\(|currentTime\s*=|setCaptionDraft|setCaptionHistory|setStart\(|setEnd\(|setCaptionOffsetRaw/);

  const button = component.match(/<button type="button" className="secondary"\s*aria-label="Fill split seconds from the original video playhead"[\s\S]*?onClick=\{fillCueSplitFromPlayhead\}>Use playhead<\/button>/)?.[0] ?? '';
  assert.match(button, /aria-describedby="cue-split-help"/);
  assert.match(button, /disabled=\{!file \|\| busy \|\| checking \|\| importing \|\| receiptLoading \|\| captionLoading \|\| captionFileLoading\}/);

  // The existing commit still protects unsaved manual edits and records Undo.
  const splitHandler = component.match(/  async function splitEditedCue\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.match(splitHandler, /Save your cue edits with Update cue before splitting/);
  assert.match(splitHandler, /setCaptionHistory\(cueEditHistory\(previousDraft\)\)/);
});
