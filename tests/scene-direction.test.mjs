import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewSceneDirections } from '../src/frontend/scene-direction.ts';

const scenes=[{id:'s1',direction:'Opening',selectedTakeId:'take1',startMs:0,endMs:1000},{id:'s2',direction:'Chorus',selectedTakeId:'take2',startMs:1000,endMs:2000},{id:'s3',direction:'Final shot',selectedTakeId:'take3',startMs:2000,endMs:3000}];
test('preview targets stable scene IDs without mutating takes, timing or original drafts',()=>{
 const before=structuredClone(scenes); const preview=previewSceneDirections(scenes,['s2','s3'],'Brighter light','append');
 assert.deepEqual(preview.edits,[{id:'s2',before:'Chorus',after:'Chorus\nBrighter light'},{id:'s3',before:'Final shot',after:'Final shot\nBrighter light'}]);
 assert.equal(preview.error,''); assert.deepEqual(scenes,before);
});
test('replacement is explicit and stale, empty or oversized proposals are refused',()=>{
 assert.equal(previewSceneDirections(scenes,['s3'],'Close-up','replace').edits[0].after,'Close-up');
 assert.match(previewSceneDirections(scenes,[],'x','append').error,/Choose/);
 assert.match(previewSceneDirections(scenes,['missing'],'x','append').error,/changed/);
 assert.match(previewSceneDirections(scenes,['s2'],'   ','append').error,/Write/);
 assert.match(previewSceneDirections(scenes,['s2'],'x'.repeat(1200),'append').error,/1,200/);
});
