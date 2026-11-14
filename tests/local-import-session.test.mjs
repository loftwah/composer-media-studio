import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup } from './harness.mjs';

function wav() {
  const bytes = new Uint8Array(52), v = new DataView(bytes.buffer);
  for (const [n,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) for (let i=0;i<s.length;i++) bytes[n+i]=s.charCodeAt(i);
  v.setUint32(4,44,true); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,44100,true); v.setUint32(28,88200,true); v.setUint16(32,2,true); v.setUint16(34,16,true); v.setUint32(40,8,true); return bytes;
}
function form() { const f = new FormData(); f.set('file',new File([wav()],'fictional.wav',{type:'audio/wav'})); return f; }
test('local import binding rejects a session switch even with identical display names', async () => {
  const {env, project} = await setup();
  const auth = async actor => 'studio_session='+await createSession(env,{mode:'owner',actor,actorName:'same',workspace:'same',workspaceName:'same'});
  const a=await auth('first-principal'), b=await auth('second-principal');
  const call=(path,cookie,extra={})=>worker.fetch(new Request('https://studio.test'+path,{headers:{cookie,origin:'https://studio.test',...extra.headers},method:extra.method??'GET',...(extra.body?{body:extra.body}:{})}),env);
  const stateA=await (await call('/api/session',a)).json(), stateB=await (await call('/api/session',b)).json();
  assert.equal(stateA.actor,stateB.actor); assert.notEqual(stateA.localImportBinding,stateB.localImportBinding);
  const path=`/api/projects/${project.id}/assets`, header={'x-studio-local-import-binding':stateA.localImportBinding};
  assert.equal((await call(path,b,{method:'POST',headers:header,body:form()})).status,409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,0);
  const good=await call(path,a,{method:'POST',headers:header,body:form()}); assert.equal(good.status,201); assert.equal((await good.json()).asset.kind,'audio');
  assert.equal((await call(path,a,{method:'POST',headers:{'x-studio-local-import-binding':'bad'},body:form()})).status,409);
  // Non-local clients keep their existing authenticated upload contract.
  assert.equal((await call(path,a,{method:'POST',body:form()})).status,201);
});
