import test from 'node:test';
import assert from 'node:assert/strict';
import { captionPlayheadProposal as capture } from '../src/frontend/caption-playhead.mjs';
const cue = { startMs: 1000, endMs: 3000 };
test('playhead capture suggests millisecond timing inside the segment', () => {
  assert.deepEqual(capture(cue, 'startMs', 1.2354, 500, 5000), {edge:'startMs',value:1235,startMs:1235,endMs:3000});
  assert.deepEqual(capture(cue, 'endMs', 4.1, 500, 5000), {edge:'endMs',value:4100,startMs:1000,endMs:4100});
});
test('playhead capture rejects invalid, equal, reversed and out-of-segment positions', () => {
  for (const [edge,time] of [['startMs',3],['endMs',1],['startMs',0.4],['endMs',5.001],['endMs',NaN],['endMs',Infinity]]) assert.equal(capture(cue,edge,time,500,5000),null);
});
