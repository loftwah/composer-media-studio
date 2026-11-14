import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { createComposition } from '../src/lib/jobs.mjs';
import { createSongPlan, updateSongPlan, updateSongCaptions } from '../src/lib/song-plans.mjs';
import { setup, addAsset } from './harness.mjs';

const sha='a'.repeat(64);
const mp4 = value => new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,value,0,0,0]);
async function fixture() {
  const {env,project}=await setup();
  for (let i=1;i<=6;i++) await addAsset(env,project,{id:`asset_clip0${i}`,kind:'video',durationMs:3000});
  await addAsset(env,project,{id:'asset_song1',kind:'audio',durationMs:12000});
  await env.DB.prepare('UPDATE assets SET sha256=?1').bind(sha).run();
  const shots=Array.from({length:6},(_,i)=>({assetId:`asset_clip0${i+1}`,trimStartMs:0,trimEndMs:2000}));
  const composition=await createComposition(env,project,{title:'Six clips',shots});
  composition.updatedAt=composition.createdAt;
  const cookie='studio_session='+await createSession(env);
  const call=(path,{method='GET',body,cookie:auth=cookie}={})=>worker.fetch(new Request('https://studio.test'+path,{method,headers:{...(auth?{cookie:auth}:{}),...(body instanceof FormData?{}:{'content-type':'application/json'}),origin:'https://studio.test'},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env);
  const start=(extra={})=>call(`/api/projects/${project.id}/compositions/${composition.id}/local-render-receipts`,{method:'POST',body:{expectedUpdatedAt:composition.updatedAt,includeCaptions:false,framing:{aspect:'source',fit:'contain'},...extra}});
  return {env,project,composition,cookie,call,start};
}
function upload(receipt, bytes=mp4(1)) { const f=new FormData(); f.set('file',new File([bytes],'render.mp4',{type:'video/mp4'})); f.set('title','Test render'); f.set('localRenderReceiptId',receipt); return f; }

test('six-shot receipt is private, bound once to server-hashed bytes, and replay is idempotent',async()=>{
  const {env,project,call,start}=await fixture();
  const created=await start(); assert.equal(created.status,201); const {receipt}=await created.json();
  const first=await call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id)}); assert.equal(first.status,201); const {asset}=await first.json();
  assert.equal(asset.caption,''); assert.equal(asset.hasLocalRenderReceipt,true);
  const replay=await call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id)}); assert.equal(replay.status,200); assert.equal((await replay.json()).asset.id,asset.id);
  const different=await call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id,mp4(2))}); assert.equal(different.status,409);
  const read=await call(`/api/assets/${asset.id}/local-render-receipt`); assert.equal(read.status,200); const saved=(await read.json()).receipt;
  assert.equal(saved.evidence.snapshot,'server_verified'); assert.equal(saved.evidence.render,'browser_reported'); assert.equal(saved.shots.length,6); assert.equal(saved.shots[5].endMs,2000); assert.equal(saved.output.sha256,asset.sha256);
  assert.equal((await call(`/api/assets/${asset.id}/local-render-receipt`,{cookie:''})).status,401);
  const other='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read']});
  assert.equal((await call(`/api/assets/${asset.id}/local-render-receipt`,{cookie:other})).status,403);
  assert.equal((await call(`/api/projects/${project.id}/compositions/${saved.storyboard.id}/local-render-receipts`,{method:'POST',cookie:other,body:{}})).status,403);
  const readOnly='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']});
  assert.equal((await call(`/api/assets/${asset.id}/local-render-receipt`,{cookie:readOnly})).status,200);
  assert.equal((await call(`/api/projects/${project.id}/compositions/${saved.storyboard.id}/local-render-receipts`,{method:'POST',cookie:readOnly,body:{}})).status,403);
  const ordinary=await call(`/api/assets/${asset.id}`); const assetData=await ordinary.json(); assert.equal(assetData.asset.hasLocalRenderReceipt,true); assert.equal(JSON.stringify(assetData).includes('snapshot'),false);
  const projectData=await (await call(`/api/projects/${project.id}`)).json(); assert.equal(projectData.assets.find(a=>a.id===asset.id).hasLocalRenderReceipt,true);
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at) VALUES('pub_test',?1,?2,'receipt-film','Public film','Safe description',1,1)").bind(project.id,asset.id).run();
  const publicPage=await (await call('/p/receipt-film',{cookie:''})).text();
  assert.equal(publicPage.includes('asset_clip01'),false); assert.equal(publicPage.includes('server_verified'),false); assert.equal(publicPage.includes(sha),false);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets WHERE id=?1').bind(asset.id).first()).n,1);
});

test('simultaneous distinct uploads cannot bind more than one output to a receipt',async()=>{
  const {env,project,call,start}=await fixture(); const receipt=(await (await start()).json()).receipt;
  const results=await Promise.all([call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id,mp4(1))}),call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id,mp4(2))})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,8);
  assert.equal(env.MEDIA.objects.size,1);
});

test('stale, expired and cross-project receipt requests cannot bind a new asset',async()=>{
  const {env,project,composition,call,start}=await fixture();
  assert.equal((await start({expectedUpdatedAt:composition.updatedAt-1})).status,409);
  assert.equal((await start({includeCaptions:true})).status,400);
  const receipt=(await (await start()).json()).receipt;
  await env.DB.prepare('UPDATE local_render_receipts SET expires_at=0 WHERE id=?1').bind(receipt.id).run();
  const result=await call(`/api/projects/${project.id}/assets`,{method:'POST',body:upload(receipt.id)}); assert.equal(result.status,409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,7);
});

test('snapshot insert refuses a storyboard changed during verification',async()=>{
  const {env,start}=await fixture(); const prepare=env.DB.prepare.bind(env.DB); let changed=false;
  env.DB.prepare=(sql)=>{ if (sql.startsWith('INSERT INTO local_render_receipts') && !changed) {changed=true; env.DB.exec("UPDATE compositions SET updated_at=updated_at+1");} return prepare(sql); };
  assert.equal((await start()).status,409);
  assert.equal((await prepare('SELECT COUNT(*) AS n FROM local_render_receipts').first()).n,0);
});

test('snapshot insert refuses a source changed during verification',async()=>{
  const {env,start}=await fixture(); const prepare=env.DB.prepare.bind(env.DB); let changed=false;
  env.DB.prepare=(sql)=>{ if (sql.startsWith('INSERT INTO local_render_receipts') && !changed) {changed=true; env.DB.exec("UPDATE assets SET deleted_at=1 WHERE id='asset_clip01'");} return prepare(sql); };
  assert.equal((await start()).status,409);
  assert.equal((await prepare('SELECT COUNT(*) AS n FROM local_render_receipts').first()).n,0);
});

test('unfinished receipts are bounded and expired unbound records are reclaimed',async()=>{
  const {env,start}=await fixture(); let first;
  for (let i=0;i<16;i++) { const r=await start(); assert.equal(r.status,201); const data=await r.json(); first ??= data.receipt.id; }
  const limited=await start(); assert.equal(limited.status,429); assert.equal((await limited.json()).error.code,'receipt_limit');
  await env.DB.prepare('UPDATE local_render_receipts SET expires_at=0 WHERE id=?1').bind(first).run();
  assert.equal((await start()).status,201);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM local_render_receipts').first()).n,16);
});

test('caption snapshot requires matching plan revision and confirmed rights without recording lyric text',async()=>{
  const {env,project,call}=await fixture();
  const original=await createSongPlan(env,project,{songAssetId:'asset_song1',rightsConfirmed:true,title:'Song',aspect:'16:9',startMs:0,endMs:12000,sceneCount:6});
  const plan=await updateSongPlan(env,project,original.id,{...original,expectedRevision:1,scenes:original.scenes.map((s,i)=>({...s,selectedTakeId:`asset_clip0${i+1}`}))});
  const captioned=await updateSongCaptions(env,project,plan.id,{expectedRevision:2,rightsConfirmed:true,cues:[{id:'cue_001',startMs:0,endMs:1000,text:'Private words',speaker:''}]});
  const {createStoryboardFromSongPlan}=await import('../src/lib/jobs.mjs');
  const made=await createStoryboardFromSongPlan(env,project,captioned.id,{expectedRevision:3,allowTrim:true});
  const composition=made.composition;
  const start=()=>call(`/api/projects/${project.id}/compositions/${composition.id}/local-render-receipts`,{method:'POST',body:{expectedUpdatedAt:composition.updatedAt,includeCaptions:true,framing:{aspect:'source',fit:'contain'}}});
  // The local renderer requires a mixed soundtrack before saving provenance.
  assert.equal((await start()).status,400);
  await addAsset(env,project,{id:'asset_mix1',kind:'audio',durationMs:12000}); await env.DB.prepare("UPDATE assets SET sha256=?1,mime='audio/wav' WHERE id=?2").bind(sha,'asset_mix1').run();
  const row=await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(composition.id).first(); const spec=JSON.parse(row.spec_json); spec.audioAssetId='asset_mix1';
  await env.DB.prepare('UPDATE compositions SET spec_json=?2 WHERE id=?1').bind(composition.id,JSON.stringify(spec)).run();
  const res=await start(); assert.equal(res.status,201); const {receipt}=await res.json();
  const stored=await env.DB.prepare('SELECT snapshot_json FROM local_render_receipts WHERE id=?1').bind(receipt.id).first();
  assert.equal(stored.snapshot_json.includes('Private words'),false); assert.equal(JSON.parse(stored.snapshot_json).captions.revision,3);
  await env.DB.prepare('UPDATE song_plans SET revision=revision+1 WHERE id=?1').bind(plan.id).run();
  assert.equal((await start()).status,409);
});
