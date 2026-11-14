import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSongPlan, listSongPlans, updateSongPlan } from '../src/lib/song-plans.mjs';
import { setup, addAsset } from './harness.mjs';

const input = { songAssetId:'asset_song1', rightsConfirmed:true, title:'A film', aspect:'16:9', startMs:1000, endMs:31000, sceneCount:4 };
test('song plans persist measured source, stable contiguous scenes and conflict-safe edits without spend', async () => {
  const {env,project}=await setup();
  await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:40000});
  await addAsset(env,project,{id:'asset_ref01',kind:'image'});
  await addAsset(env,project,{id:'asset_take1',kind:'video',durationMs:6000});
  const plan=await createSongPlan(env,project,input);
  assert.equal(plan.songSha256,'hash'); assert.equal(plan.revision,1); assert.equal(plan.scenes.length,4);
  assert.deepEqual(plan.scenes.map(s=>[s.startMs,s.endMs]),[[1000,8500],[8500,16000],[16000,23500],[23500,31000]]);
  const edit={...plan,expectedRevision:1,scenes:plan.scenes.map((scene,i)=>i===1?{...scene,direction:'Warm the light',referenceAssetId:'asset_ref01',selectedTakeId:'asset_take1'}:scene)};
  const changed=await updateSongPlan(env,project,plan.id,edit);
  assert.equal(changed.revision,2); assert.deepEqual(changed.scenes[0],plan.scenes[0]); assert.equal(changed.scenes[1].selectedTakeId,'asset_take1');
  await assert.rejects(updateSongPlan(env,project,plan.id,edit),e=>e.status===409 && e.code==='revision_conflict');
  assert.deepEqual((await listSongPlans(env,project))[0],changed);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('song plans refuse missing rights, excessive segments, cross-project assets and invalid scenes', async () => {
  const {env,project}=await setup(); await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:120000});
  await assert.rejects(createSongPlan(env,project,{...input,rightsConfirmed:false}),/permission/);
  await assert.rejects(createSongPlan(env,project,{...input,endMs:62000}),/2–60 second/);
  await assert.rejects(createSongPlan(env,project,{...input,songAssetId:'asset_other'}),/this project/);
  const plan=await createSongPlan(env,project,input);
  const edit={...plan,expectedRevision:1,scenes:plan.scenes.map((scene,i)=>i===0?{...scene,referenceAssetId:'asset_other'}:scene)};
  await assert.rejects(updateSongPlan(env,project,plan.id,edit),/this project/);
  await assert.rejects(updateSongPlan(env,project,plan.id,{...edit,scenes:plan.scenes.map((scene,i)=>i===0?{...scene,endMs:9000}:scene)}),/gaps or overlaps/);
  assert.equal((await listSongPlans(env,project))[0].revision,1);
});

test('simultaneous edits on the same revision admit only one writer', async () => {
  const {env,project}=await setup(); await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:40000});
  const plan=await createSongPlan(env,project,input);
  const outcomes=await Promise.allSettled(['First','Second'].map(title=>updateSongPlan(env,project,plan.id,{...plan,title,expectedRevision:1})));
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(result=>result.status==='rejected' && result.reason.status===409).length,1);
  assert.equal((await listSongPlans(env,project))[0].revision,2);
});
