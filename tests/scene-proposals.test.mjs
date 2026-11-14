import { test } from 'node:test'; import assert from 'node:assert/strict';
import worker from '../src/worker.mjs'; import {createSession} from '../src/lib/auth.mjs'; import {createSongPlan,updateSongPlan,updateSongCaptions,listSongPlans} from '../src/lib/song-plans.mjs'; import {setup,addAsset} from './harness.mjs';
async function fixture(){
 const {env,project}=await setup(); await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:30000}); await addAsset(env,project,{id:'asset_image1',kind:'image'}); await addAsset(env,project,{id:'asset_take01',kind:'video'});
 let plan=await createSongPlan(env,project,{songAssetId:'asset_song1',rightsConfirmed:true,title:'Fictional',aspect:'16:9',startMs:0,endMs:12000,sceneCount:3});
 plan=await updateSongPlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((scene,i)=>i===1?{...scene,selectedTakeId:'asset_take01'}:scene)});
 plan=await updateSongCaptions(env,project,plan.id,{expectedRevision:2,rightsConfirmed:true,cues:[{id:'cue_test1',startMs:500,endMs:1500,text:'Fictional words'}]});
 const cookie='studio_session='+await createSession(env), base=`/api/projects/${project.id}/song-plans/${plan.id}/scene-proposal/`;
 const call=(action,payload,auth=cookie)=>worker.fetch(new Request('https://studio.test'+base+action,{method:'POST',headers:{cookie:auth,origin:'https://studio.test','content-type':'application/json'},body:JSON.stringify(payload)}),env);
 const changes=[{sceneId:plan.scenes[1].id,direction:'Brighter light'},{sceneId:plan.scenes[2].id,referenceAssetId:'asset_image1'}];return {env,project,plan,changes,call};
}
test('preview is stateless and accepted exact edits preserve unrelated scenes, takes and captions',async()=>{
 const {env,project,plan,changes,call}=await fixture(); const input={expectedRevision:plan.revision,changes}; const preview=await call('preview',input); assert.equal(preview.status,200); const data=await preview.json(); assert.equal(data.proposal.changes.length,2); assert.equal(data.proposal.changes[0].before.direction,''); assert.equal(data.proposal.changes[0].after.direction,'Brighter light'); assert.equal((await listSongPlans(env,project))[0].revision,plan.revision);
 assert.equal((await call('apply',{...input,reviewDigest:data.reviewDigest,approved:false})).status,400);
 const result=await call('apply',{...input,reviewDigest:data.reviewDigest,approved:true}); assert.equal(result.status,200); const saved=(await result.json()).plan; assert.equal(saved.revision,4); assert.deepEqual(saved.scenes[0],plan.scenes[0]); assert.equal(saved.scenes[1].selectedTakeId,'asset_take01'); assert.equal(saved.scenes[1].direction,'Brighter light'); assert.equal(saved.scenes[2].referenceAssetId,'asset_image1'); assert.deepEqual(saved.captions,plan.captions); assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('changed proposals, revisions, sources, or permissions cannot be applied',async()=>{
 const {env,project,plan,changes,call}=await fixture(); const input={expectedRevision:plan.revision,changes}; const digest=(await (await call('preview',input)).json()).reviewDigest;
 assert.equal((await call('apply',{...input,changes:[{sceneId:plan.scenes[1].id,direction:'Different'}],reviewDigest:digest,approved:true})).status,409);
 assert.equal((await call('preview',{...input,changes:[{sceneId:plan.scenes[0].id,referenceAssetId:'asset_missing'}]})).status,400);
 const readOnly='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']}); assert.equal((await call('preview',input,readOnly)).status,200); assert.equal((await call('apply',{...input,reviewDigest:digest,approved:true},readOnly)).status,403);
 const wrongProject='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read']}); assert.equal((await call('preview',input,wrongProject)).status,403);
 await env.DB.prepare("UPDATE assets SET sha256='changed' WHERE id='asset_image1'").run(); assert.equal((await call('apply',{...input,reviewDigest:digest,approved:true})).status,409);
 await env.DB.prepare('UPDATE song_plans SET revision=revision+1 WHERE id=?1').bind(plan.id).run(); assert.equal((await call('apply',{...input,reviewDigest:digest,approved:true})).status,409);
});

test('a reference removed at the final write cannot be silently applied',async()=>{
 const {env,project,plan,changes,call}=await fixture(); const input={expectedRevision:plan.revision,changes}; const digest=(await (await call('preview',input)).json()).reviewDigest; const prepare=env.DB.prepare.bind(env.DB); let raced=false;
 env.DB.prepare=sql=>{if(sql.startsWith('UPDATE song_plans SET spec_json=')&&!raced){raced=true;env.DB.exec("UPDATE assets SET deleted_at=1 WHERE id='asset_image1'");}return prepare(sql);};
 const result=await call('apply',{...input,reviewDigest:digest,approved:true}); assert.equal(result.status,409); const current=(await listSongPlans(env,project))[0]; assert.equal(current.revision,plan.revision); assert.deepEqual(current.scenes,plan.scenes);
});
