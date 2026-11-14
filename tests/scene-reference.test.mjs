import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewSceneReferences } from '../src/frontend/scene-reference.ts';
const scenes=[{id:'s1',referenceAssetId:'still_a',selectedTakeId:'take_a',direction:'First',startMs:0,endMs:1000},{id:'s2',referenceAssetId:null,selectedTakeId:'take_b',direction:'Second',startMs:1000,endMs:2000},{id:'s3',referenceAssetId:'still_a',selectedTakeId:'take_c',direction:'Third',startMs:2000,endMs:3000}];
test('preview changes only selected references and leaves source scenes untouched',()=>{
 const original=structuredClone(scenes);
 assert.deepEqual(previewSceneReferences(scenes,['s2','s3'],'set','still_b',['still_a','still_b']).edits,[{id:'s2',before:null,after:'still_b'},{id:'s3',before:'still_a',after:'still_b'}]);
 assert.deepEqual(scenes,original);
 assert.deepEqual(previewSceneReferences(scenes,['s1'],'clear','',['still_a']).edits,[{id:'s1',before:'still_a',after:null}]);
});
test('rejects stale scene and non-project reference IDs',()=>{
 assert.match(previewSceneReferences(scenes,[],'set','still_a',['still_a']).error,/Choose/);
 assert.match(previewSceneReferences(scenes,['s2','missing'],'set','still_a',['still_a']).error,/changed/);
 assert.match(previewSceneReferences(scenes,['s2'],'set','foreign_asset',['still_a']).error,/available still/);
 assert.match(previewSceneReferences(scenes,['s2'],'set','',['still_a']).error,/available still/);
});
