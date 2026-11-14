import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup, addAsset } from './harness.mjs';

async function fixture() {
  const {env,project}=await setup();
  await addAsset(env,project,{id:'asset_subject1',kind:'image'});
  await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('a'.repeat(64),'asset_subject1').run();
  const cookie='studio_session='+await createSession(env);
  const call=(path,method='GET',body,auth=cookie)=>worker.fetch(new Request(`https://studio.test${path}`,{method,headers:{origin:'https://studio.test',...(auth?{cookie:auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
  const base=`/api/projects/${project.id}/subjects`;
  const input={type:'person',name:'Moss',traits:'Green coat and lantern',referenceAssetId:'asset_subject1',referenceRole:'face',rightsConfirmed:true};
  return {env,project,call,base,input};
}

test('approved subject versions remain private, immutable and included in project export',async()=>{
  const {env,project,call,base,input}=await fixture();
  assert.equal((await call(base,'POST',{...input,rightsConfirmed:false})).status,400);
  const created=await call(base,'POST',input); assert.equal(created.status,201); const v1=(await created.json()).subject;
  assert.equal(v1.revision,1); assert.equal(v1.referenceAvailable,true); assert.equal(v1.referenceSha256,'a'.repeat(64));
  const changed=await call(`${base}/${v1.id}`,'PATCH',{...input,name:'Moss revised',expectedRevision:1}); assert.equal(changed.status,200);
  assert.equal((await changed.json()).subject.revision,2);
  const history=(await (await call(`${base}/${v1.id}`)).json()).versions;
  assert.deepEqual(history.map(v=>[v.revision,v.name]),[[2,'Moss revised'],[1,'Moss']]);
  assert.equal((await (await call(base)).json()).subjects.length,1);
  assert.equal((await (await call(`/api/projects/${project.id}/export`)).json()).subjects.length,2);
  assert.equal((await call(base,'GET',undefined,'')).status,401);
  const other='studio_session='+await createSession(env,{mode:'bridge',project:'prj_other',actions:['read','edit']});
  assert.equal((await call(base,'GET',undefined,other)).status,403);
  const readOnly='studio_session='+await createSession(env,{mode:'bridge',project:project.id,actions:['read']});
  assert.equal((await call(base,'POST',input,readOnly)).status,403);
  assert.equal((await call('/gallery','GET',undefined,'')).status,200);
  const gallery=await (await call('/gallery','GET',undefined,'')).text(); assert.equal(gallery.includes('Moss revised'),false);
  await env.DB.prepare('UPDATE assets SET deleted_at=1 WHERE id=?1').bind('asset_subject1').run();
  assert.equal((await (await call(base)).json()).subjects[0].referenceAvailable,false);
  assert.equal((await call(`${base}/${v1.id}`,'PATCH',{...input,expectedRevision:2})).status,400);
});

test('two writers cannot replace a version and missing cross-project references fail',async()=>{
  const {env,call,base,input}=await fixture(); const v1=(await (await call(base,'POST',input)).json()).subject;
  const outcomes=await Promise.all(['A','B'].map(name=>call(`${base}/${v1.id}`,'PATCH',{...input,name,expectedRevision:1})));
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  assert.equal((await (await call(`${base}/${v1.id}`)).json()).versions.length,2);
  await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',1,1)").run();
  await addAsset(env,{id:'prj_other'},{id:'asset_other',kind:'image'});
  await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('b'.repeat(64),'asset_other').run();
  assert.equal((await call(base,'POST',{...input,referenceAssetId:'asset_other'})).status,400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
});

test('source removed between validation and atomic insertion is rejected',async()=>{
  const {env,call,base,input}=await fixture(); const prepare=env.DB.prepare.bind(env.DB); let changed=false;
  env.DB.prepare=(sql)=>{if(sql.startsWith('INSERT INTO subject_versions')&&!changed){changed=true;env.DB.exec("UPDATE assets SET deleted_at=1 WHERE id='asset_subject1'");}return prepare(sql)};
  assert.equal((await call(base,'POST',input)).status,409);
  assert.equal((await prepare('SELECT COUNT(*) AS n FROM subject_versions').first()).n,0);
});
