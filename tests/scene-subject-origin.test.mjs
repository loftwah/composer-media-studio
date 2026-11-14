import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, addAsset } from './harness.mjs';
import { createSongPlan, listSongPlans, updateSongPlan, updateSongCaptions } from '../src/lib/song-plans.mjs';
import { saveSubject } from '../src/lib/subjects.mjs';

async function fixture() {
 const {env,project}=await setup();
 await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:30000});
 await addAsset(env,project,{id:'asset_image1',kind:'image'});
 await addAsset(env,project,{id:'asset_take1',kind:'video',durationMs:3000});
 await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('a'.repeat(64),'asset_image1').run();
 const subject=await saveSubject(env,project,{type:'person',name:'Fictional subject',traits:'Blue coat',referenceAssetId:'asset_image1',referenceRole:'face',rightsConfirmed:true});
 const plan=await createSongPlan(env,project,{songAssetId:'asset_song1',rightsConfirmed:true,title:'Test',treatment:'',aspect:'16:9',startMs:0,endMs:4000,sceneCount:2});
 return {env,project,subject,plan};
}
test('scene history survives legacy omission, captions and unrelated edits; explicit null removes it',async()=>{
 const {env,project,subject,plan}=await fixture();
 const first=await updateSongPlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i? s:{...s,selectedTakeId:'asset_take1',subjectOrigin:{subjectId:subject.id,revision:1,name:'untrusted'}})});
 assert.deepEqual(first.scenes[0].subjectOrigin,{subjectId:subject.id,revision:1,name:'Fictional subject'});
 const captioned=await updateSongCaptions(env,project,plan.id,{expectedRevision:2,rightsConfirmed:true,cues:[{id:'cue_001',startMs:0,endMs:1000,text:'Hello',speaker:''}]});
 await env.DB.prepare('UPDATE assets SET deleted_at=1 WHERE id=?1').bind('asset_image1').run();
 const legacy=captioned.scenes.map(({subjectOrigin,...scene})=>scene);
 const edited=await updateSongPlan(env,project,plan.id,{...captioned,title:'Other edit',expectedRevision:3,scenes:legacy});
 assert.deepEqual(edited.scenes[0].subjectOrigin,first.scenes[0].subjectOrigin); assert.equal(edited.scenes[0].selectedTakeId,'asset_take1'); assert.deepEqual(edited.captions,captioned.captions);
 const cleared=await updateSongPlan(env,project,plan.id,{...edited,expectedRevision:4,scenes:edited.scenes.map((s,i)=>i?s:{...s,subjectOrigin:null})}); assert.equal(cleared.scenes[0].subjectOrigin,undefined);
 assert.equal((await listSongPlans(env,project))[0].scenes[0].subjectOrigin,undefined);
});
test('new subject reference must stay live at the atomic plan write',async()=>{
 const {env,project,subject,plan}=await fixture(); const prepare=env.DB.prepare.bind(env.DB); let raced=false;
 env.DB.prepare=sql=>{if(sql.startsWith('UPDATE song_plans SET spec_json=')&&!raced){raced=true;env.DB.exec("UPDATE assets SET deleted_at=1 WHERE id='asset_image1'");}return prepare(sql)};
 await assert.rejects(updateSongPlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i?s:{...s,subjectOrigin:{subjectId:subject.id,revision:1}})}),e=>e.status===409);
 assert.equal((await listSongPlans(env,project))[0].revision,1);
});
test('missing or other-project subjects fail and competing plan edits cannot overwrite',async()=>{
 const {env,project,subject,plan}=await fixture();
 await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',1,1)").run();
 const other={id:'prj_other'}; await addAsset(env,other,{id:'asset_otherimage',kind:'image'});
 await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('b'.repeat(64),'asset_otherimage').run();
 const foreign=await saveSubject(env,other,{type:'person',name:'Other private subject',traits:'',referenceAssetId:'asset_otherimage',referenceRole:'face',rightsConfirmed:true});
 await assert.rejects(updateSongPlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i?s:{...s,subjectOrigin:{subjectId:foreign.id,revision:1}})}),/available subject version/);
 const write=name=>updateSongPlan(env,project,plan.id,{...plan,title:name,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i?s:{...s,subjectOrigin:{subjectId:subject.id,revision:1}})});
 const results=await Promise.allSettled([write('One'),write('Two')]); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
});
