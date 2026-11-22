import test from 'node:test';
import assert from 'node:assert/strict';
import { captionDraftProblem } from '../src/frontend/caption-draft.ts';

const cue = (startMs, endMs, text = 'Words', speaker = '') => ({ startMs, endMs, text, speaker });

test('a draft the caption save would accept has no problem', () => {
  assert.equal(captionDraftProblem([], 0, 10_000), null);
  assert.equal(captionDraftProblem([cue(0, 1000), cue(1000, 2000, 'More')], 0, 10_000), null);
  // The save sorts by time; it does not reject overlapping cues.
  assert.equal(captionDraftProblem([cue(0, 5000), cue(1000, 2000)], 0, 10_000), null);
});

test('the first cue that would be refused is named', () => {
  assert.equal(captionDraftProblem([cue(0, 1000, '')], 0, 10_000), 'Caption 1 needs words.');
  assert.equal(captionDraftProblem([cue(0, 1000), cue(9000, 12000)], 0, 10_000), 'Caption 2 must stay inside the saved song segment.');
  assert.equal(captionDraftProblem([cue(2000, 2000)], 0, 10_000), 'Caption 1 must end after it starts.');
  assert.equal(captionDraftProblem([cue(0, 1000, 'x'.repeat(301))], 0, 10_000), 'Caption 1 needs a single line of up to 300 characters.');
  assert.equal(captionDraftProblem([cue(0, 1000, 'Words', 's'.repeat(81))], 0, 10_000), 'Caption 1 has a speaker label that needs to fit in a single line of up to 80 characters.');
  assert.equal(captionDraftProblem([cue(0, Number.NaN)], 0, 10_000), 'Caption 1 needs a start and end accurate to a millisecond.');
});

test('a cue before the segment start or beyond 100 cues is refused', () => {
  assert.equal(captionDraftProblem([cue(1999, 3000)], 2000, 10_000), 'Caption 1 must stay inside the saved song segment.');
  const many = Array.from({ length: 101 }, (_, i) => cue(i * 10, i * 10 + 5));
  assert.equal(captionDraftProblem(many, 0, 10_000), 'Keep at most 100 captions in this plan.');
});
