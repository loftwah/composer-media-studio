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
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2}),e=>e.code==='take_trim_confirmation_required');
  await env.DB.prepare('UPDATE assets SET duration_ms=5000 WHERE id=?1').bind('asset_take01').run();
  const result=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2});
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(result.composition.id).first();
  await assert.rejects(createRender(env,project,row,{clientRequestId:'req_end_trim'}),e=>e.code==='mix_required');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});

test('a longer take requires explicit trim consent and freezes its exact source interval', async () => {
  const {env,project,plan}=await fixture(0);
  await env.DB.prepare('UPDATE assets SET duration_ms=5200 WHERE id=?1').bind('asset_take01').run();
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2}), e=>e.code==='take_trim_confirmation_required');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM compositions').first()).n,0);
  const made=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true});
  assert.equal(made.composition.totalMs,20000);
  assert.deepEqual({start:made.composition.shots[0].trimStartMs,end:made.composition.shots[0].trimEndMs,duration:made.composition.shots[0].durationMs},{start:0,end:5000,duration:5000});
  assert.equal(made.composition.originSongPlan.revision,2);
  assert.equal(made.composition.originSongPlan.scenes[0].trimStartMs,0);
  assert.equal(made.composition.originSongPlan.scenes[0].trimEndMs,5000);
  assert.equal('trimStartMs' in made.composition.originSongPlan.scenes[1],false);
  const again=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true});
  assert.equal(again.created,false); assert.equal(again.composition.id,made.composition.id);
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(made.composition.id).first();
  await assert.rejects(createRender(env,project,row,{clientRequestId:'req_trim_song'}),e=>e.code==='provider_shot_trim_unsupported');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});

test('a short selected take is refused even when trim is approved', async () => {
  const {env,project,plan}=await fixture(0);
  await env.DB.prepare('UPDATE assets SET duration_ms=4900 WHERE id=?1').bind('asset_take01').run();
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true}),e=>e.code==='take_duration_mismatch');
});

test('scene in-points create distinct idempotent cuts and reject invalid or edited ranges', async () => {
  const {env,project,plan}=await fixture(0);
  await env.DB.prepare('UPDATE assets SET duration_ms=5200 WHERE id=?1').bind('asset_take01').run();
  const sceneStarts=plan.scenes.map((scene,index)=>({sceneId:scene.id,startMs:index===0?100:0}));
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,sceneStarts}),e=>e.code==='take_trim_confirmation_required');
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts:sceneStarts.slice(1)}),e=>e.code==='invalid_scene_starts');
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts:sceneStarts.map((entry,i)=>i===1?sceneStarts[0]:entry)}),e=>e.code==='invalid_scene_starts');
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts:sceneStarts.map((entry,i)=>i===0?{...entry,startMs:201}:entry)}),e=>e.code==='take_duration_mismatch');
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:1,allowTrim:true,sceneStarts}),e=>e.status===409);
  const [first,replay]=await Promise.all([createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts}),createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts})]);
  assert.deepEqual([first.created,replay.created].sort(),[false,true]);
  assert.equal(first.composition.id,replay.composition.id);
  assert.equal(first.composition.shots[0].trimStartMs,100); assert.equal(first.composition.shots[0].trimEndMs,5100);
  assert.equal(first.composition.originSongPlan.scenes[0].trimStartMs,100); assert.equal(first.composition.originSongPlan.scenes[0].trimEndMs,5100);
  const zero=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true});
  assert.notEqual(zero.composition.id,first.composition.id);
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(first.composition.id).first();
  await updateComposition(env,project,row,{title:'Edited',shots:first.composition.shots.map((shot,index)=>index?shot:{...shot,trimStartMs:0,trimEndMs:5000}),audioTracks:first.composition.audioTracks,expectedUpdatedAt:first.composition.updatedAt});
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,allowTrim:true,sceneStarts}),e=>e.code==='storyboard_changed');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});

test('audio role is explicit, isolated and idempotent without rewriting existing storyboards', async () => {
  const {env,project,plan}=await fixture(0);
  const legacy=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2});
  assert.equal(legacy.composition.id,`cmp_song_${plan.id}_2`);
  assert.equal(legacy.composition.audioTracks[0].role,'music');
  const sameMusic=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'music'});
  assert.equal(sameMusic.created,false); assert.equal(sameMusic.composition.id,legacy.composition.id);
  const [voice,replay]=await Promise.all([createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'voice'}),createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'voice'})]);
  assert.deepEqual([voice.created,replay.created].sort(),[false,true]);
  assert.equal(voice.composition.id,replay.composition.id); assert.equal(voice.composition.audioTracks[0].role,'voice');
  const effect=await createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'effect'});
  assert.equal(effect.composition.audioTracks[0].role,'effect');
  assert.equal(new Set([legacy.composition.id,voice.composition.id,effect.composition.id]).size,3);
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'narration'}),e=>e.code==='invalid_audio_role');
  await assert.rejects(createStoryboardFromSongPlan(env,{id:'prj_other'},plan.id,{expectedRevision:2,audioRole:'voice'}),e=>e.status===404);
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(voice.composition.id).first();
  await updateComposition(env,project,row,{title:'Edited',shots:voice.composition.shots,audioTracks:voice.composition.audioTracks.map(track=>({...track,role:'effect'}))});
  await assert.rejects(createStoryboardFromSongPlan(env,project,plan.id,{expectedRevision:2,audioRole:'voice'}),e=>e.code==='storyboard_changed');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
