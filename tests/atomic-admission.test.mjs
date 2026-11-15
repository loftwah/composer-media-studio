import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, jpeg } from './harness.mjs';
import { withDarkroom } from './support/darkroom-env.mjs';
import { createGeneration, createRender, dispatchGeneration, cancelGeneration, transferReservation, budgetSnapshot, loadGeneration, advanceGeneration } from '../src/lib/jobs.mjs';
const input=(key='request_fixture_1')=>({kind:'image',model:'studio-quick',prompt:'Fictional',aspect:'square',clientRequestId:key});
function stallFirstBatch(env) { let enter,release;const entered=new Promise(r=>enter=r), wait=new Promise(r=>release=r),batch=env.DB.batch.bind(env.DB);let first=true;env.DB.batch=async statements=>{if(first){first=false;enter();await wait;}return batch(statements)};return {entered,release}; }
const fakeComposition={id:'cmp_demo',title:'Demo',spec_json:JSON.stringify({shots:[{assetId:'a'},{assetId:'b'}],audioTracks:[],totalMs:10000})};
test('duplicate generation and render requests cannot dispatch when allowance is insufficient',async()=>{
 for(const kind of ['generation','render']){
  const {env,project}=await setup({allowance:1});const gate=stallFirstBatch(env);
  const create=()=>kind==='generation'?createGeneration(env,project,input()):createRender(env,project,fakeComposition,{model:'studio-assembly',clientRequestId:'request_fixture_1'});
  const first=create().catch(e=>e);await gate.entered;const second=await create().catch(e=>e);gate.release();const initial=await first;
  assert.ok([initial,second].some(v=>v.status===402));const rows=await env.DB.prepare('SELECT status,cost_reserved_micro FROM generations').all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].status,'failed');assert.equal(rows.results[0].cost_reserved_micro,0);assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,0);
 }
});
test('parallel same-key admissions reserve exactly once and reject changed inputs',async()=>{
 const {env,project}=await setup({allowance:10000});const gate=stallFirstBatch(env);const first=createGeneration(env,project,input());await gate.entered;const winner=await createGeneration(env,project,input());gate.release();const replay=await first;
 assert.equal(winner.created,true);assert.equal(replay.created,false);assert.equal(replay.generation.id,winner.generation.id);assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,winner.generation.cost_reserved_micro);
 await assert.rejects(createGeneration(env,project,{...input(),prompt:'different'}),e=>e.code==='idempotency_conflict');
});
test('duplicate ledger transitions do not steal a different job reservation',async()=>{
 const {env,project}=await setup({allowance:10000});const a=(await createGeneration(env,project,input('request_first_1'))).generation,b=(await createGeneration(env,project,input('request_second_1'))).generation;
 await Promise.all([transferReservation(env,a,false),transferReservation(env,a,false)]);let budget=await budgetSnapshot(env,project.id);assert.equal(budget.reservedMicro,b.cost_reserved_micro);assert.equal(budget.spentMicro,0);
 await Promise.all([transferReservation(env,b,true),transferReservation(env,b,true)]);budget=await budgetSnapshot(env,project.id);assert.equal(budget.reservedMicro,0);assert.equal(budget.spentMicro,b.cost_reserved_micro);
});
test('in-flight cancellation and an ambiguous AI error retain the reservation',async()=>{
 const {env,project}=await setup({allowance:10000});let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);let calls=0;withDarkroom(env);
 env.AI={run:async()=>{calls++;enter();await wait;throw new Error('fictional lost reply');}};
 const job=(await createGeneration(env,project,input())).generation;const pending=dispatchGeneration(env,job);await entered;
 const cancelled=await cancelGeneration(env,job);assert.equal(cancelled.status,'submitting');assert.equal(cancelled.error_code,'cancel_unconfirmed');assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,job.cost_reserved_micro);
 release();const finished=await pending;assert.equal(finished.status,'unknown');assert.equal(calls,1);assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,job.cost_reserved_micro);
});
test('unverified legacy admitted jobs are never dispatched or released automatically',async()=>{
 const {env,project}=await setup();await env.DB.prepare("INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES('gen_old',?1,'request_old_1','image','freeform','cloudflare','studio-quick','{}','admitted',700,700,1,1)").bind(project.id).run();
 const old=await loadGeneration(env,'gen_old');await assert.rejects(dispatchGeneration(env,old),e=>e.code==='admission_unverified');await assert.rejects(cancelGeneration(env,old),e=>e.code==='admission_unverified');assert.equal((await loadGeneration(env,'gen_old')).status,'admitted');
});

async function submitted(env,project,{id='gen_pending',model='studio-assembly',status='submitted',request={}}={}) {
 const now=Date.now(), period=new Date(now).toISOString().slice(0,7);
 await env.DB.prepare("INSERT INTO budgets(project_id,period,allowance_micro,reserved_micro,spent_micro,updated_at) VALUES(?1,?2,5000000,20000,0,?3) ON CONFLICT(project_id,period) DO UPDATE SET reserved_micro=reserved_micro+20000").bind(project.id,period,now).run();
 await env.DB.prepare("INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,provider_request_id,provider_status_url,provider_response_url,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES(?1,?2,?3,'video','composition','fal',?4,?5,?6,'req_x','https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_x/status','https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_x',20000,20000,?7,?7)").bind(id,project.id,`request_${id}`,model,JSON.stringify(request),status,now).run();return loadGeneration(env,id);
}
test('late accepted provider cancellation cannot overwrite a completed job',async()=>{
 const {env,project}=await setup();env.FAL_KEY='fictional';const job=await submitted(env,project);let ready,finish;const entered=new Promise(r=>ready=r),wait=new Promise(r=>finish=r),original=globalThis.fetch;globalThis.fetch=async()=>{ready();await wait;return new Response('',{status:200});};
 try{const pending=cancelGeneration(env,job);await entered;await env.DB.prepare("UPDATE generations SET status='saved' WHERE id=?1").bind(job.id).run();finish();const result=await pending;assert.equal(result.status,'saved');}finally{globalThis.fetch=original;}
});
test('a completed social slate after accepted cancellation never starts the next paid stage',async()=>{
 const {env,project}=await setup();env.FAL_KEY='fictional';const job=await submitted(env,project,{model:'studio-social',status:'cancel_requested',request:{stage:'slate'}});let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({status:'COMPLETED',response_url:'https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_x'});};
 try{const result=await advanceGeneration(env,job);assert.equal(result.status,'unknown');assert.equal(result.error_code,'cancel_completed_stage');assert.equal(calls,1);assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,20000);}finally{globalThis.fetch=original;}
});
test('a late provider failure cannot overwrite a saved job or release its budget',async()=>{
 const {env,project}=await setup();env.FAL_KEY='fictional';const job=await submitted(env,project);let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r),original=globalThis.fetch;globalThis.fetch=async()=>{enter();await wait;return Response.json({status:'FAILED'});};
 try{const pending=advanceGeneration(env,job);await entered;await env.DB.prepare("UPDATE generations SET status='saved' WHERE id=?1").bind(job.id).run();release();const result=await pending;assert.equal(result.status,'saved');assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,20000);}finally{globalThis.fetch=original;}
});
test('social render replay survives provider stage and automatically cached slate changes',async()=>{
 const {env,project}=await setup();const composition={id:'cmp_social',title:'Fictional',spec_json:JSON.stringify({shots:[{assetId:'a'},{assetId:'b'}],audioTracks:[],totalMs:10000,slateAssetId:'asset_slate'})};const args={model:'studio-social',clientRequestId:'request_social_1'};
 const first=await createRender(env,project,composition,args);const request=JSON.parse(first.generation.request_json);request.stage='compose';request.totalMs=11000;request.slateVideoAssetId='asset_generated_slate';
 await env.DB.prepare('UPDATE generations SET request_json=?2 WHERE id=?1').bind(first.generation.id,JSON.stringify(request)).run();
 const modified={...composition,spec_json:JSON.stringify({...JSON.parse(composition.spec_json),slateVideoAssetId:'asset_generated_slate'})};const replay=await createRender(env,project,modified,args);assert.equal(replay.created,false);assert.equal(replay.generation.id,first.generation.id);
});
test('cancellation intent blocks a completed social slate while provider cancellation is pending',async()=>{
 const {env,project}=await setup();env.FAL_KEY='fictional';const job=await submitted(env,project,{model:'studio-social',request:{stage:'slate'}});let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r),original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options={})=>{calls.push([String(url),options.method??'GET']);if(options.method==='PUT'){enter();await wait;return new Response('',{status:200});}return Response.json({status:'COMPLETED',response_url:'https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_x'});};
 try{const cancel=cancelGeneration(env,job);await entered;const advanced=await advanceGeneration(env,job);assert.equal(advanced.status,'unknown');assert.equal(advanced.error_code,'cancel_completed_stage');release();assert.equal((await cancel).status,'unknown');assert.deepEqual(calls.map(x=>x[1]).sort(),['GET','PUT']);assert.equal((await budgetSnapshot(env,project.id)).reservedMicro,20000);}finally{globalThis.fetch=original;}
});
