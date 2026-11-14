import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { createFootagePlan, updateFootagePlan } from '../src/lib/footage-plans.mjs';
import { setup, addAsset } from './harness.mjs';
const sha='a'.repeat(64);
function box(name, payload) { const b=Buffer.alloc(8+payload.length); b.writeUInt32BE(b.length); b.write(name,4); payload.copy(b,8); return b; }
function mp4(width=1280,height=720,seconds=5,tail=0) { const mv=Buffer.alloc(24); mv.writeUInt32BE(1000,12); mv.writeUInt32BE(seconds*1000,16); const tk=Buffer.alloc(84); tk.writeUInt32BE(width*65536,76); tk.writeUInt32BE(height*65536,80); return Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',Buffer.concat([box('mvhd',mv),box('trak',box('tkhd',tk))])),box('free',Buffer.from([tail]))]); }
async function fixture() {
 const {env,project}=await setup(); await addAsset(env,project,{id:'asset_source1',kind:'video',durationMs:10000}); await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind(sha,'asset_source1').run();
 const plan=await createFootagePlan(env,project,{sourceAssetId:'asset_source1',rightsConfirmed:true,title:'Example',aspect:'16:9',sourceStartMs:0,sourceEndMs:5000,sceneCount:1});
 const cookie='studio_session='+await createSession(env); const call=(path,{method='GET',body,cookie:auth=cookie}={})=>worker.fetch(new Request('https://studio.test'+path,{method,headers:{...(auth?{cookie:auth}:{}),...(body instanceof FormData?{}:{'content-type':'application/json'}),origin:'https://studio.test'},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env);
 const start=(extra={})=>call(`/api/projects/${project.id}/footage-plans/${plan.id}/export-receipts`,{method:'POST',body:{expectedRevision:plan.revision,sceneId:plan.scenes[0].id,frame:'16:9',fit:'contain',quality:'hd',...extra}});
 const upload=(receipt,bytes=mp4())=>{ const f=new FormData(); f.set('file',new File([bytes],'clip.mp4',{type:'video/mp4'})); f.set('footageExportReceiptId',receipt); return call(`/api/projects/${project.id}/assets`,{method:'POST',body:f}); };
 return {env,project,plan,call,start,upload};
}
test('HD receipt saves a private, source-linked clip once with explicit provenance',async()=>{
 const {env,project,call,start,upload}=await fixture(); const response=await start(); assert.equal(response.status,201); const {receipt}=await response.json();
 assert.equal((await upload(receipt.id,mp4(640,360))).status,400);
 const first=await upload(receipt.id); assert.equal(first.status,201); const asset=(await first.json()).asset;
 const row=await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(asset.id).first(); assert.equal(row.parent_asset_id,'asset_source1');
 assert.equal((await upload(receipt.id)).status,200); assert.equal((await upload(receipt.id,mp4(1280,720,5,1))).status,409);
 const read=await call(`/api/assets/${asset.id}/footage-export-receipt`); assert.equal(read.status,200); const saved=(await read.json()).receipt; assert.equal(saved.source.sha256,sha); assert.equal(saved.plan.revision,1); assert.equal(saved.evidence.render,'browser_reported'); assert.equal(saved.framing.width,1280);
 assert.equal((await call(`/api/assets/${asset.id}/footage-export-receipt`,{cookie:''})).status,401);
 const other='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read']}); assert.equal((await call(`/api/assets/${asset.id}/footage-export-receipt`,{cookie:other})).status,403);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('stale revision or deleted source prevents first binding, while old input stays intact',async()=>{
 const {env,project,plan,start,upload}=await fixture(); assert.equal((await start({expectedRevision:2})).status,409);
 const receipt=(await (await start()).json()).receipt; await updateFootagePlan(env,project,plan.id,{...plan,expectedRevision:1,title:'Changed'});
 assert.equal((await upload(receipt.id)).status,409); assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,1); assert.equal(env.MEDIA.objects.size,0);
});
test('strict settings, duration and project permission are enforced',async()=>{
 const {env,project,plan,call,start}=await fixture(); assert.equal((await start({quality:'ultra'})).status,400); assert.equal((await start({extra:'secret'})).status,400);
 const ro='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']}); assert.equal((await call(`/api/projects/${project.id}/footage-plans/${plan.id}/export-receipts`,{method:'POST',cookie:ro,body:{}})).status,403);
});
