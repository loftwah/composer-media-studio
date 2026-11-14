import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExportSnapshot } from '../src/frontend/footage-scene-validation.ts';
const scene={id:'scene_a',sourceStartMs:500,sourceEndMs:2500};
const plan={id:'foot_a',revision:1,sourceAssetId:'asset_a',sourceSha256:'hash',rightsConfirmed:true,scenes:[scene]};
const asset={id:'asset_a',kind:'video',sha256:'hash',durationMs:4000};
test('requires current saved rights, source, revision and exact scene range',()=>{
 assert.equal(validateExportSnapshot(plan,scene,plan,[asset]),asset);
 for(const changed of [{...plan,revision:2},{...plan,rightsConfirmed:false},{...plan,sourceSha256:'other'},{...plan,scenes:[{...scene,sourceEndMs:2600}]}]) assert.throws(()=>validateExportSnapshot(plan,scene,changed,[asset]));
 for(const bad of [[],[{...asset,sha256:'other'}],[{...asset,kind:'image'}],[{...asset,durationMs:180001}]]) assert.throws(()=>validateExportSnapshot(plan,scene,plan,bad));
});
