import test from 'node:test';
import assert from 'node:assert/strict';
import { directorHandoff, currentDirectorHandoff } from '../src/frontend/director-handoff.mjs';
const plan={id:'plan_1',revision:3,scenes:[{id:'scene_1',direction:'Keep the lantern',referenceAssetId:'asset_ref'},{id:'scene_2',direction:'Private other scene',referenceAssetId:null}]};
test('brief includes only selected saved context and preserves a deliberate no-spend instruction',()=>{
 const result=directorHandoff('project_1',plan,['scene_1'],'Brighten this scene');
 assert.match(result,/"sceneId": "scene_1"/);assert.doesNotMatch(result,/Private other scene|scene_2/);assert.match(result,/untrusted creative data/);assert.match(result,/Do not apply, generate, publish or spend/);assert.match(result,/"expectedRevision": 3/);
});
test('empty, oversized, unknown or duplicated requests are not prepared',()=>{
 for(const [ids,intent] of [[[], 'Change'],[['scene_1'],' '],[['scene_1'],'x'.repeat(1201)],[['scene_unknown'],'Change'],[['scene_1','scene_1'],'Change']]) assert.equal(directorHandoff('project_1',plan,ids,intent),null);
});

test('a changed draft or changed saved context hides a prepared brief',()=>{ const brief={text:'private',fingerprint:'old'}; assert.equal(currentDirectorHandoff(brief,'old',false),'private'); assert.equal(currentDirectorHandoff(brief,'old',true),''); assert.equal(currentDirectorHandoff(brief,'new',false),''); });
