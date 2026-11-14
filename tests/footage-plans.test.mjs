import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFootagePlan, listFootagePlans, updateFootagePlan } from '../src/lib/footage-plans.mjs';
import { setup, addAsset } from './harness.mjs';
const input = { sourceAssetId:'asset_source1', rightsConfirmed:true, title:'Fictional walkthrough', aspect:'16:9', sourceStartMs:1000, sourceEndMs:21000, sceneCount:4 };
test('source cut map preserves footage and supports selective takes without provider activity', async () => {
  const {env,project}=await setup();
  await addAsset(env,project,{id:'asset_source1',kind:'video',durationMs:40000});
  await addAsset(env,project,{id:'asset_take01',kind:'video',durationMs:5000});
  await addAsset(env,project,{id:'asset_still1',kind:'image'});
  const original=await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind('asset_source1').first();
  const plan=await createFootagePlan(env,project,input);
  assert.equal(plan.sourceSha256,'hash'); assert.equal(plan.revision,1);
  assert.deepEqual(plan.scenes.map(s=>[s.sourceStartMs,s.sourceEndMs]),[[1000,6000],[6000,11000],[11000,16000],[16000,21000]]);
  const edit={...plan,expectedRevision:1,scenes:plan.scenes.map((scene,i)=>i===1?{...scene,direction:'Warmer',referenceAssetId:'asset_still1',selectedTakeId:'asset_take01'}:scene)};
  const revised=await updateFootagePlan(env,project,plan.id,edit);
  assert.equal(revised.revision,2); assert.deepEqual(revised.scenes[0],plan.scenes[0]); assert.equal(revised.scenes[1].selectedTakeId,'asset_take01');
  await assert.rejects(updateFootagePlan(env,project,plan.id,edit),e=>e.status===409 && e.code==='revision_conflict');
  assert.deepEqual((await listFootagePlans(env,project))[0],revised);
  assert.deepEqual(await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind('asset_source1').first(),original);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('cut maps reject missing rights, invalid ranges and non-project assets', async () => {
  const {env,project}=await setup(); await addAsset(env,project,{id:'asset_source1',kind:'video',durationMs:120000});
  await assert.rejects(createFootagePlan(env,project,{...input,rightsConfirmed:false}),/permission/);
  await assert.rejects(createFootagePlan(env,project,{...input,sourceEndMs:62000}),/60 seconds/);
  await assert.rejects(createFootagePlan(env,project,{...input,sourceAssetId:'asset_other'}),/this project/);
  const plan=await createFootagePlan(env,project,input);
  await assert.rejects(updateFootagePlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i===0?{...s,selectedTakeId:'asset_other'}:s)}),/this project/);
  await assert.rejects(updateFootagePlan(env,project,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i===0?{...s,sourceEndMs:7000}:s)}),/non-overlapping/);
  assert.equal((await listFootagePlans(env,project))[0].revision,1);
});
test('concurrent cut-map edits cannot overwrite one another',async()=>{
  const {env,project}=await setup(); await addAsset(env,project,{id:'asset_source1',kind:'video',durationMs:40000});
  const plan=await createFootagePlan(env,project,input);
  const results=await Promise.allSettled(['First','Second'].map(title=>updateFootagePlan(env,project,plan.id,{...plan,title,expectedRevision:1})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
});
