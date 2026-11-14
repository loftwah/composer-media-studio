import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftCaptionTimes } from '../src/frontend/caption-shift.ts';
const cues = [{ id:'a', startMs:1000, endMs:2000, text:'one', speaker:'A' }, { id:'b', startMs:3000, endMs:4000, text:'two', speaker:'' }];
test('shifts the entire draft without mutating text, speaker, gaps or originals', () => {
  assert.deepEqual(shiftCaptionTimes(cues, '-0.5', 0, 5000), [{...cues[0],startMs:500,endMs:1500},{...cues[1],startMs:2500,endMs:3500}]);
  assert.equal(cues[0].startMs,1000);
  assert.equal(shiftCaptionTimes(cues, '1', 0, 5000)[1].endMs,5000);
});
test('refuses invalid, out-of-segment or empty shifts without clamping', () => {
  for (const offset of ['', '0', '1.0001', '1e3', '-1.001', '1.001']) assert.equal(shiftCaptionTimes(cues, offset, 0, 5000), null);
  assert.equal(shiftCaptionTimes([], '1', 0, 5000), null);
  assert.equal(shiftCaptionTimes([{...cues[0],endMs:1000}], '1', 0, 5000), null);
});
