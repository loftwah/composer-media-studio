import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SPEAKER_CHARS, renameSpeakerCues } from '../src/frontend/caption-speaker.ts';

const cue = (startMs, endMs, text, speaker) => ({ startMs, endMs, text, speaker });

test('speaker rename is exact and full-source, refuses merges, and preserves every other cue field', () => {
  const cues = [
    cue(500, 1800, 'Before the trim', 'Ann'),
    cue(2500, 4200, 'Another speaker', 'Bob'),
    cue(6100, 7800, 'After the trim', 'Ann'),
    cue(9000, 10_000, 'Different case', 'ann'),
    cue(11_000, 12_000, 'Unnamed', ''),
  ];
  const before = structuredClone(cues);
  const renamed = renameSpeakerCues(cues, 'Ann', '  Ana  ');

  assert.ok(!('problem' in renamed));
  assert.equal(renamed.speaker, 'Ana');
  assert.equal(renamed.renamed, 2);
  assert.deepEqual(renamed.cues, [
    { ...cues[0], speaker: 'Ana' },
    cues[1],
    { ...cues[2], speaker: 'Ana' },
    cues[3],
    cues[4],
  ]);
  assert.equal(renamed.cues[1], cues[1]);
  assert.equal(renamed.cues[3], cues[3]);
  assert.equal(renamed.cues[4], cues[4]);
  assert.deepEqual(cues, before);

  const blank = renameSpeakerCues(cues, 'Ann', '   ');
  assert.ok('problem' in blank);
  assert.match(blank.problem, /Enter a new speaker name/);
  for (const invalid of ['Bad\nName', 'x'.repeat(MAX_SPEAKER_CHARS + 1)]) {
    const result = renameSpeakerCues(cues, 'Ann', invalid);
    assert.ok('problem' in result);
    assert.match(result.problem, /Use one line of up to 80 plain characters/);
  }
  const identical = renameSpeakerCues(cues, 'Ann', ' Ann ');
  assert.ok('problem' in identical);
  assert.match(identical.problem, /already this speaker’s name.*different name/);
  const used = renameSpeakerCues(cues, 'Ann', 'Bob');
  assert.ok('problem' in used);
  assert.match(used.problem, /already belongs to another speaker.*unique name/);

  // A case-only correction is allowed when no exact other speaker owns it.
  const caseCues = [cue(0, 1000, 'One', 'ann'), cue(1000, 2000, 'Two', 'ANN'), cue(2000, 3000, 'Three', '')];
  const corrected = renameSpeakerCues(caseCues, 'ann', 'Ann');
  assert.ok(!('problem' in corrected));
  assert.deepEqual(corrected.cues.map(item => item.speaker), ['Ann', 'ANN', '']);
  const collision = renameSpeakerCues([...caseCues, cue(3000, 4000, 'Four', 'Ann')], 'ann', 'Ann');
  assert.ok('problem' in collision);
  assert.match(collision.problem, /already belongs to another speaker/);

  const missing = renameSpeakerCues(cues, 'Missing', 'Ana');
  assert.ok('problem' in missing);
  assert.match(missing.problem, /no longer in this draft.*Choose another speaker/);
});
