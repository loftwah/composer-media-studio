import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionsForScene } from '../src/frontend/scene-caption-context.ts';

test('uses overlapping source-song times without losing boundary-crossing cues', () => {
  const cues = [{id:'later',startMs:1900,endMs:2400},{id:'before',startMs:0,endMs:1000},{id:'cross',startMs:900,endMs:1200},{id:'after',startMs:2000,endMs:2500},{id:'invalid',startMs:1600,endMs:1600}];
  const original = structuredClone(cues);
  assert.deepEqual(captionsForScene({startMs:1000,endMs:2000},cues).map(c=>c.id), ['cross','later']);
  assert.deepEqual(cues, original);
  assert.deepEqual(captionsForScene({startMs:2000,endMs:2000},cues), []);
});
