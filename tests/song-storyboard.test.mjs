import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSongPlan, updateSongPlan } from '../src/lib/song-plans.mjs';
import { createStoryboardFromSongPlan, createRender, updateComposition } from '../src/lib/jobs.mjs';
import { setup, addAsset } from './harness.mjs';

async function fixture(startMs = 5000) {
  const { env, project } = await setup();
  await addAsset(env, project, {id:'asset_song1',kind:'audio',durationMs:40000});
  for (let n=1;n<=4;n++) await addAsset(env, project, {id:`asset_take0${n}`,kind:'video',durationMs:5000});
  const plan = await createSongPlan(env, project, {songAssetId:'asset_song1',rightsConfirmed:true,title:'Fictional film',aspect:'16:9',startMs,endMs:startMs+20000,sceneCount:4});
  const ready = await updateSongPlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>({...s,selectedTakeId:`asset_take0${i+1}`}))});
  return {env,project,plan:ready};
}
test('song plan yields one idempotent storyboard with exact song segment and immutable origin', async () => {
  const {env,project,plan}=await fixture();
  const copies=await Promise.all([createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2}),createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2})]);
  assert.deepEqual(copies.map(c=>c.created).sort(),[false,true]);
  const composition=copies[0].composition;
  assert.deepEqual(composition.shots.map(s=>s.assetId),['asset_take01','asset_take02','asset_take03','asset_take04']);
  assert.equal(composition.audioTracks[0].trimStartMs,5000); assert.equal(composition.audioTracks[0].trimEndMs,25000);
  assert.equal(composition.originSongPlan.revision,2);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM compositions').first()).n,1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(composition.id).first();
  await assert.rejects(createRender(env,project,row,{clientRequestId:'req_test_mix'}),e=>e.code==='mix_required');
  const edited=await updateComposition(env,project,row,{title:'Another title',shots:composition.shots,audioTracks:composition.audioTracks});
  assert.deepEqual(edited.originSongPlan,composition.originSongPlan);
});
test('bridge rejects stale plans, unavailable or mis-timed takes, cross-project access and unmixed end trims',async()=>{
  const {env,project,plan}=await fixture(0);
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:1}),e=>e.status===409);
  await assert.rejects(createStoryboardFromSongPlan(env,{id:'prj_other'},plan.id,{expectedRevision:2}),e=>e.status===404);
  await env.DB.prepare('UPDATE assets SET duration_ms=5200 WHERE id=?1').bind('asset_take01').run();
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2}),e=>e.code==='take_duration_mismatch');
  await env.DB.prepare('UPDATE assets SET duration_ms=5000 WHERE id=?1').bind('asset_take01').run();
  const result=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2});
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(result.composition.id).first();
  await assert.rejects(createRender(env,project,row,{clientRequestId:'req_end_trim'}),e=>e.code==='mix_required');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
