import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPromoScenes } from '../src/frontend/promo-scene-preview.ts';
const scenes=[{id:'scene_a',direction:'Old one',startMs:100,endMs:5000,referenceAssetId:'ref_a',selectedTakeId:'take_a'},{id:'scene_b',direction:'Old two',startMs:5000,endMs:10000,referenceAssetId:null,selectedTakeId:'take_b'}];
test('preview copies visual ideas only without changing timing, source references or takes',()=>{
 const before=structuredClone(scenes);const result=previewPromoScenes(scenes,[{visual:'Light changes'},{visual:'  '}],'append');
 assert.deepEqual(result.edits,[{id:'scene_a',index:0,before:'Old one',after:'Old one\nLight changes'}]);assert.deepEqual(scenes,before);
 assert.equal(previewPromoScenes(scenes,[{visual:'New'},{visual:'Another'}],'replace').edits[1].after,'Another');
});
test('scene-count mismatch, empty ideas and oversized directions do not produce edits',()=>{
 assert.match(previewPromoScenes(scenes,[{visual:'one'}],'append').error,/same number/);
 assert.match(previewPromoScenes(scenes,[{visual:''},{visual:' '}],'append').error,/visual idea/);
 assert.match(previewPromoScenes(scenes,[{visual:'x'.repeat(1200)},{visual:''}],'append').error,/1,200/);
 assert.match(previewPromoScenes([{...scenes[0]}, {...scenes[1],id:'scene_a'}],[{visual:'a'},{visual:'b'}],'replace').error,/changed/);
});
