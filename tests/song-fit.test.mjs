import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewTakeFit } from '../src/frontend/song-fit.ts';
const scenes=[{id:'one',startMs:1000,endMs:3000,selectedTakeId:'a'},{id:'two',startMs:3000,endMs:6000,selectedTakeId:'b'}];
const plan={startMs:1000,endMs:6000,scenes};
const videos=[{id:'a',kind:'video',durationMs:2101},{id:'b',kind:'video',durationMs:2899}];

test('preview fits measured durations without mutating directions or boundaries', () => {
  const before=structuredClone(plan); const fit=previewTakeFit(plan,videos,[],[]);
  assert.equal(fit.status,'exact'); assert.deepEqual(fit.scenes.map(s=>[s.startMs,s.endMs]),[[1000,3101],[3101,6000]]);
  assert.deepEqual(plan,before);
});
test('shorter segment is explicit and captions on either saved or draft state block shortening', () => {
  const shorter=previewTakeFit({...plan,endMs:7000},videos,[],[]);
  assert.equal(shorter.status,'shorter'); assert.equal(shorter.endMs,6000); assert.equal(shorter.differenceMs,1000);
  assert.equal(previewTakeFit({...plan,endMs:7000},videos,[{startMs:5500,endMs:6500}],[]).status,'captions');
  assert.equal(previewTakeFit({...plan,endMs:7000},videos,[],[{startMs:5500,endMs:6500}]).status,'captions');
});
test('overflow, missing, repeated and unmeasured takes cannot be applied', () => {
  assert.equal(previewTakeFit({...plan,endMs:5999},videos,[],[]).status,'overflow');
  assert.equal(previewTakeFit(plan,videos.slice(0,1),[],[]).status,'missing');
  assert.equal(previewTakeFit({...plan,scenes:[scenes[0],{...scenes[1],selectedTakeId:'a'}]},videos,[],[]).status,'duplicate');
  assert.equal(previewTakeFit(plan,[videos[0],{...videos[1],durationMs:null}],[],[]).status,'duration');
  assert.equal(previewTakeFit(plan,[videos[0],{...videos[1],durationMs:16001}],[],[]).status,'duration');
});
