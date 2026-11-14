import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenePlanChanged } from '../src/frontend/song-plan-dirty.ts';

test('caption saves do not dirty scenes, but real scene edits stay dirty', () => {
  const scene = { id: 'scene_1', startMs: 0, endMs: 5000, direction: 'Wide', referenceAssetId: null, selectedTakeId: 'take_1' };
  const draft = { title: 'A cut', treatment: '', aspect: '16:9', startMs: 0, endMs: 5000, scenes: [scene], revision: 1, updatedAt: 100 };
  const afterCaptionSave = { ...draft, revision: 2, updatedAt: 200, captions: { cues: [{ text: 'Words' }] } };
  assert.equal(scenePlanChanged(draft, afterCaptionSave), false);
  assert.equal(scenePlanChanged({ ...draft, title: 'Edited' }, afterCaptionSave), true);
  assert.equal(scenePlanChanged({ ...draft, scenes: [{ ...scene, direction: 'Close' }] }, afterCaptionSave), true);
  const withOrigin = { ...scene, subjectOrigin: {subjectId:'sub_example', revision:1, name:'Moss'} };
  assert.equal(scenePlanChanged({ ...draft, scenes: [withOrigin] }, afterCaptionSave), true);
  assert.equal(scenePlanChanged({ ...draft, scenes: [{ ...withOrigin, subjectOrigin:null }] }, { ...draft, scenes:[withOrigin] }), true);
});
