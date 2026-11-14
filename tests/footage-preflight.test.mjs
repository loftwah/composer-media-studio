import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup, addAsset } from './harness.mjs';

async function fixture() {
  const {env,project}=await setup(); const bytes=await readFile(new URL('../media/studio-proof/public/ldraw-mountain-hailuo-original.mp4',import.meta.url)); const sha=createHash('sha256').update(bytes).digest('hex');
  await addAsset(env,project,{id:'asset_source1',kind:'video',durationMs:5875}); await env.DB.prepare("UPDATE assets SET sha256=?1,bytes=?2,mime='video/mp4' WHERE id='asset_source1'").bind(sha,bytes.length).run(); await env.MEDIA.put('k-asset_source1',bytes);
  const cookie='studio_session='+await createSession(env); const call=(auth=cookie)=>worker.fetch(new Request('https://studio.test/api/assets/asset_source1/footage-preflight',{headers:auth?{cookie:auth}:{}}),env);
  return {env,project,bytes,call};
}
test('inspects stored MP4 metadata and all video packet timings without a provider call',async()=>{
 const {env,call}=await fixture(); const response=await call(); assert.equal(response.status,200); const result=(await response.json()).measurement;
 assert.equal(result.video.width,768); assert.equal(result.video.height,960); assert.equal(result.video.durationSeconds,5.875); assert.equal(result.video.frames,141); assert.equal(result.video.averageFps,24); assert.equal(result.video.minimumPacketFps,24); assert.equal(result.video.maximumPacketFps,24); assert.match(result.note,/not verified/); assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('requires a permitted session, matching bytes, supported size and a live asset',async()=>{
 const {env,call}=await fixture(); assert.equal((await call('')).status,401); const other='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read']}); assert.equal((await call(other)).status,403);
 await env.DB.prepare("UPDATE assets SET sha256='wrong' WHERE id='asset_source1'").run(); assert.equal((await call()).status,409);
 await env.DB.prepare("UPDATE assets SET bytes=16777217 WHERE id='asset_source1'").run(); assert.equal((await call()).status,400);
 await env.DB.prepare("UPDATE assets SET deleted_at=1 WHERE id='asset_source1'").run(); assert.equal((await call()).status,400);
});
test('malformed bytes fail closed',async()=>{
 const {env,call}=await fixture(); const bytes=Buffer.from('not a valid mp4'); const sha=createHash('sha256').update(bytes).digest('hex'); await env.DB.prepare("UPDATE assets SET sha256=?1,bytes=?2 WHERE id='asset_source1'").bind(sha,bytes.length).run(); await env.MEDIA.put('k-asset_source1',bytes); assert.equal((await call()).status,400);
});
test('out-of-range clip duration is rejected before any result is shown',async()=>{
 const {env,call}=await fixture(); const bytes=await readFile(new URL('../public/films/artwork-to-motion.mp4',import.meta.url)); const sha=createHash('sha256').update(bytes).digest('hex'); await env.DB.prepare("UPDATE assets SET sha256=?1,bytes=?2 WHERE id='asset_source1'").bind(sha,bytes.length).run(); await env.MEDIA.put('k-asset_source1',bytes); const result=await call(); assert.equal(result.status,400); assert.equal((await result.json()).error.code,'unsupported_duration');
});
