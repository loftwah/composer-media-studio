import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup } from './harness.mjs';
async function fixture() {
 const {env,project}=await setup(); const cookie='studio_session='+await createSession(env);
 const call=(path,method='GET',data,auth=cookie)=>worker.fetch(new Request(`https://studio.test${path}`,{method,headers:{origin:'https://studio.test',...(auth?{cookie:auth}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
 const base=`/api/projects/${project.id}/promo-briefs`;
 const input={title:'Fictional spot',audience:'Curious builders',brief:'Show a workflow',cta:'Explore',aspect:'16:9',targetSeconds:20,scenes:[{spoken:'Hello there',visual:'First shot'},{spoken:'Come along',visual:'Second shot'}]};
 return {env,project,base,input,call};
}
test('private brief saves and exports without a generation, and enforces scoped permissions',async()=>{
 const {env,project,base,input,call}=await fixture();
 const created=await call(base,'POST',input); assert.equal(created.status,201); const brief=(await created.json()).brief;
 assert.equal(brief.revision,1); assert.deepEqual(brief.scenes,input.scenes);
 assert.equal((await (await call(base)).json()).briefs.length,1);
 assert.equal((await (await call(`/api/projects/${project.id}/export`)).json()).promoBriefs[0].id,brief.id);
 assert.equal((await call(base,'GET',undefined,'')).status,401);
 const other='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read','edit']});
 assert.equal((await call(base,'GET',undefined,other)).status,403);
 assert.ok([403,503].includes((await call(`${base}/${brief.id}`,'PATCH',{...input,expectedRevision:1},other)).status));
 await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',1,1)").run();
 assert.equal((await call(`/api/projects/prj_other/promo-briefs/${brief.id}`,'PATCH',{...input,expectedRevision:1})).status,404);
 const readOnly='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']});
 assert.equal((await call(base,'POST',input,readOnly)).status,403);
 const gallery=await (await call('/gallery','GET',undefined,'')).text(); assert.equal(gallery.includes(input.title),false);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});
test('stale simultaneous updates cannot overwrite the winning edit; invalid shapes fail',async()=>{
 const {base,input,call}=await fixture(); const brief=(await (await call(base,'POST',input)).json()).brief;
 const replies=await Promise.all(['First','Second'].map(title=>call(`${base}/${brief.id}`,'PATCH',{...input,title,expectedRevision:1})));
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
 assert.equal((await (await call(base)).json()).briefs[0].revision,2);
 assert.equal((await call(base,'POST',{...input,targetSeconds:31})).status,400);
 assert.equal((await call(base,'POST',{...input,scenes:[input.scenes[0]]})).status,400);
 assert.equal((await call(`${base}/${brief.id}`,'PATCH',{...input,expectedRevision:0})).status,400);
});
