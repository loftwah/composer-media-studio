import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { createSongPlan, updateSongCaptions, updateSongPlan } from '../src/lib/song-plans.mjs';
import { saveSubject } from '../src/lib/subjects.mjs';
import { setup, addAsset } from './harness.mjs';

test('private project export includes only its own song plans, captions and subject history', async () => {
 const {env,project}=await setup(); env.FAL_KEY='fictional-provider-key-do-not-export';
 await env.DB.prepare('UPDATE projects SET creative_direction=?1 WHERE id=?2').bind('User-entered sensitive token marker',project.id).run();
 await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',1,1)").run();
 const other={id:'prj_other'};
 for (const [owner,song,image] of [[project,'asset_song1','asset_image1'],[other,'asset_song2','asset_image2']]) {
  await addAsset(env,owner,{id:song,kind:'audio',durationMs:4000}); await addAsset(env,owner,{id:image,kind:'image'});
  await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('a'.repeat(64),image).run();
  const subject=await saveSubject(env,owner,{type:'person',name:owner===project?'Private One':'Private Other',traits:'',referenceAssetId:image,referenceRole:'face',rightsConfirmed:true});
  const plan=await createSongPlan(env,owner,{songAssetId:song,rightsConfirmed:true,title:owner===project?'Plan One':'Plan Other',treatment:'',aspect:'16:9',startMs:0,endMs:4000,sceneCount:2});
  const revised=await updateSongPlan(env,owner,plan.id,{...plan,expectedRevision:1,scenes:plan.scenes.map((s,i)=>i?s:{...s,subjectOrigin:{subjectId:subject.id,revision:1}})});
  await updateSongCaptions(env,owner,plan.id,{expectedRevision:revised.revision,rightsConfirmed:true,cues:[{id:'cue_001',startMs:0,endMs:1000,text:owner===project?'Private lyric one':'Private lyric other',speaker:''}]});
 }
 const cookie='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']});
 const get=(id,auth=cookie)=>worker.fetch(new Request(`https://studio.test/api/projects/${id}/export`,{headers:auth?{cookie:auth}:{}}),env);
 assert.equal((await get(project.id,'')).status,401); assert.equal((await get(other.id)).status,403);
 const response=await get(project.id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const payload=await response.json();
 assert.equal(payload.format,'media-studio.export/v1'); assert.equal(payload.songPlans.length,1);assert.equal(payload.songPlans[0].title,'Plan One');
 assert.equal(payload.songPlans[0].captions.cues[0].text,'Private lyric one');assert.equal(payload.songPlans[0].scenes[0].subjectOrigin.name,'Private One');
 assert.doesNotMatch(JSON.stringify(payload),/Private lyric other|Private Other|Plan Other|fictional-provider-key-do-not-export/);
 assert.equal(payload.project.creativeDirection,'User-entered sensitive token marker');
 assert.ok(payload.notes.some(n=>n.includes('private lyrics')));assert.ok(payload.notes.some(n=>n.includes('not a restore')));
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
