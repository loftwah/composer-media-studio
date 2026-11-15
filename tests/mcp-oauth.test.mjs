import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup, addAsset, jpeg } from './harness.mjs';
import { withDarkroom } from './support/darkroom-env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { pruneMcpRecords, reserveMcpSpend } from '../src/mcp/oauth.mjs';

const base = 'https://studio.test';
const resource = base + '/mcp';
const challenge = async (s) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('base64url');
async function call(env, path, init = {}) { return worker.fetch(new Request(base + path, init), env); }

test('workspace-wide bridge consent creates only a selected-project token and rechecks the grant', async (t) => {
  const { env, project } = await setup();
  await env.DB.prepare("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_second','Second studio','second','','private','{}',1,1)").run();
  env.COMPOSER_ORIGIN='https://composer.test'; env.BRIDGE_SECRET='fictional-bridge-secret-at-least-thirty-two';
  let active = true, checks = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    checks++; const claim=JSON.parse(init.body);
    return Response.json({ok:active,actor:claim.actor,workspace:claim.workspace,actions:['read']}, {status:active?200:403});
  });
  const makeCookie = async (projectId, explicit = true) => 'studio_session=' + await createSession(env,{mode:'bridge',actor:'alice',workspace:'team',project:projectId,projectClaimExplicit:explicit,actions:['read']});
  const workspace = await makeCookie(null), scoped = await makeCookie(project.id);
  const oldWorkspace = await makeCookie(null, false);
  const payload=JSON.parse(Buffer.from(workspace.slice('studio_session='.length).split('.')[0],'base64url').toString());
  delete payload.project;
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const malformed='studio_session='+encoded+'.'+createHmac('sha256',env.SESSION_SECRET).update(encoded).digest('hex');
  const reg = await call(env,'/mcp/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Fixture',redirect_uris:['http://127.0.0.1:43210/callback'],token_endpoint_auth_method:'none'})});
  const {client_id}=await reg.json(), verifier='x'.repeat(64);
  const params=new URLSearchParams({response_type:'code',client_id,redirect_uri:'http://127.0.0.1:43210/callback',code_challenge:await challenge(verifier),code_challenge_method:'S256',resource,scope:'studio.read',state:'fixture'});
  const page = async cookie => call(env,'/mcp/authorize?'+params,{headers:{cookie}});
  const workspacePage=await (await page(workspace)).text();
  assert.match(workspacePage, new RegExp(`value="${project.id}"`)); assert.match(workspacePage,/value="prj_second"/);
  const oldPage=await page(oldWorkspace); assert.equal(oldPage.status,403);
  assert.match(await oldPage.text(),/href="https:\/\/composer\.test\/media-studio\/studio"/);
  const scopedPage=await (await page(scoped)).text();
  assert.match(scopedPage,new RegExp(`value="${project.id}"`)); assert.doesNotMatch(scopedPage,/value="prj_second"/);
  const malformedPage=await (await page(malformed)).text();
  assert.doesNotMatch(malformedPage,new RegExp(`value="${project.id}"`)); assert.doesNotMatch(malformedPage,/value="prj_second"/);
  const approve = (cookie,id) => call(env,'/mcp/authorize',{method:'POST',headers:{cookie,origin:base},body:new URLSearchParams({...Object.fromEntries(params),project:id,decision:'allow'})});
  assert.equal((await approve(scoped,'prj_second')).status,403);
  assert.equal((await approve(malformed,project.id)).status,403);
  assert.equal((await approve(oldWorkspace,project.id)).status,403);
  active=false; assert.equal((await page(workspace)).status,403); assert.equal((await approve(workspace,project.id)).status,403); active=true;
  const before=checks; const approved=await approve(workspace,project.id); assert.equal(approved.status,303); assert.ok(checks>before);
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  const exchange=()=>call(env,'/mcp/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id,redirect_uri:'http://127.0.0.1:43210/callback',code_verifier:verifier,resource})});
  active=false; assert.notEqual((await exchange()).status,200); active=true;
  // Failed exchange may consume the code; use a fresh confirmed flow.
  const token=await flow(env, project, workspace);
  const client=new Client({name:'workspace-test',version:'1'},{versionNegotiation:{mode:'auto'}});
  const transport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:'Bearer '+token}},fetch:(url,init)=>worker.fetch(new Request(url,init),env)});
  await client.connect(transport);
  const list=await client.callTool({name:'studio_list_projects',arguments:{}});
  assert.deepEqual(list.structuredContent.projects.map(p=>p.id),[project.id]);
  assert.equal((await client.callTool({name:'studio_get_project',arguments:{projectId:'prj_second'}})).isError,true);
  active=false; const denied=await call(env,'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
  assert.notEqual(denied.status,200); await client.close();
});
async function flow(env, project, cookie, scope = 'studio.read', spendCap = '0.01') {
  const register = await call(env, '/mcp/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Fictional agent', redirect_uris: ['http://127.0.0.1:43210/callback'], token_endpoint_auth_method: 'none' }) });
  assert.equal(register.status, 201);
  const { client_id } = await register.json();
  const verifier = 'x'.repeat(64);
  const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code_challenge: await challenge(verifier), code_challenge_method: 'S256', resource, scope, state: 'one' });
  const page = await call(env, '/mcp/authorize?' + params, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.match(page.headers.get('content-security-policy'), /form-action 'self' http:\/\/127\.0\.0\.1:43210(?:;|$)/);
  assert.equal(page.headers.get('x-studio-internal-callback-origin'), null);
  assert.match(await page.text(), /Fictional agent/);
  params.set('project', project.id); params.set('decision', 'allow');
  if (scope.includes('studio.generate')) params.set('spend_cap_usd', spendCap);
  const crossSite = await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: 'https://evil.test' }, body: params });
  assert.equal(crossSite.status, 403);
  const wrongProject = new URLSearchParams(params); wrongProject.set('project', 'prj_not_owned');
  assert.equal((await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: base }, body: wrongProject })).status, 403);
  const badRedirect = new URLSearchParams(params); badRedirect.set('redirect_uri', 'http://127.0.0.1:43210/attacker');
  assert.equal((await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: base }, body: badRedirect })).status, 400);
  if (scope.includes('studio.generate')) for (const invalidCap of ['', '-1', '0', '101', '0.001', '1e2']) {
    const badCap = new URLSearchParams(params); badCap.set('spend_cap_usd', invalidCap);
    assert.equal((await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: base }, body: badCap })).status, 400);
  }
  const consent = await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: params });
  assert.equal(consent.status, 303);
  const redirected = new URL(consent.headers.get('location'));
  assert.equal(redirected.searchParams.get('state'), 'one');
  const code = redirected.searchParams.get('code');
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code, code_verifier: verifier, resource });
  for (const [key, value] of [['code_verifier', 'y'.repeat(64)], ['resource', 'https://other.test/mcp'], ['redirect_uri', 'http://127.0.0.1:43210/attacker']]) {
    const invalidBody = new URLSearchParams(body); invalidBody.set(key, value);
    assert.equal((await call(env, '/mcp/token', { method: 'POST', body: invalidBody })).status, 400);
  }
  const exchange = () => call(env, '/mcp/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const tokenResponse = await exchange();
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  assert.equal((await exchange()).status, 400);
  return token.access_token;
}

test('OAuth PKCE consent binds one project, denies revoked access, and connects a real MCP SDK client', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  const protectedMetadata = await (await call(env, '/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(protectedMetadata.resource, resource);
  assert.deepEqual(protectedMetadata.scopes_supported, ['studio.read', 'studio.edit', 'studio.generate', 'studio.publish']);
  const unauth = await call(env, '/mcp', { method: 'POST' });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /oauth-protected-resource/);
  const token = await flow(env, project, cookie);
  const stored = await env.DB.prepare('SELECT * FROM mcp_tokens').first();
  assert.notEqual(stored.hash, token);
  assert.equal(JSON.stringify(stored).includes(token), false);
  const client = new Client({ name: 'fictional-client', version: '1.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: 'Bearer ' + token } }, fetch: (url, init) => worker.fetch(new Request(url, init), env) });
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.some(t => t.name === 'studio_get_project'));
  const result = await client.callTool({ name: 'studio_get_project', arguments: { projectId: project.id } });
  assert.equal(result.structuredContent.project.id, project.id);
  const deniedEdit = await client.callTool({ name: 'studio_update_project', arguments: { projectId: project.id, name: 'Not authorised' } });
  assert.equal(deniedEdit.isError, true);
  assert.equal((await env.DB.prepare('SELECT name FROM projects WHERE id=?1').bind(project.id).first()).name, 'Test studio');
  const deniedPublish = await client.callTool({ name: 'studio_publish_asset', arguments: { assetId: 'asset_missing', title: 'Not authorised' } });
  assert.equal(deniedPublish.isError, true);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM publications').first()).n, 0);
  await addAsset(env, project, { id: 'asset_chunk', kind: 'image' });
  const fixture = Uint8Array.from([0,1,2,3,4,5,6,7,8,9]);
  env.MEDIA.get = async (_key, opts) => ({ body: new Response(fixture.slice(opts.range.offset, opts.range.offset + opts.range.length)).body });
  const firstChunk = await client.callTool({ name: 'studio_download_asset_chunk', arguments: { assetId: 'asset_chunk', offset: 0, length: 4 } });
  assert.deepEqual([...Buffer.from(firstChunk.structuredContent.data, 'base64')], [0,1,2,3]);
  assert.equal(firstChunk.structuredContent.nextOffset, 4);
  const lastChunk = await client.callTool({ name: 'studio_download_asset_chunk', arguments: { assetId: 'asset_chunk', offset: 4, length: 8 } });
  assert.deepEqual([...Buffer.from(lastChunk.structuredContent.data, 'base64')], [4,5,6,7,8,9]);
  assert.equal(lastChunk.structuredContent.nextOffset, null);
  const outOfRange = await client.callTool({ name: 'studio_download_asset_chunk', arguments: { assetId: 'asset_chunk', offset: 10, length: 1 } });
  assert.equal(outOfRange.isError, true);
  await env.DB.prepare("INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,provider_request_id,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES(?1,?2,'request','video','recipe','fal','social','{\"stage\":\"slate\"}','provider-id','submitted',1,1,1,1)").bind('gen_passive', project.id).run();
  const oldFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw Error('Unexpected provider dispatch'); };
  try {
    const job = await client.callTool({ name: 'studio_get_job', arguments: { generationId: 'gen_passive' } });
    assert.equal(job.structuredContent.generation.status, 'submitted');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = oldFetch; }
  const denied = await client.callTool({ name: 'studio_get_project', arguments: { projectId: 'prj_wrong' } });
  assert.equal(denied.isError, true);
  const tokenRow = await env.DB.prepare('SELECT id FROM mcp_tokens').first();
  const connectionPage = await call(env, '/mcp/connections', { headers: { cookie } });
  assert.equal(connectionPage.headers.get('referrer-policy'), 'same-origin');
  assert.equal((await call(env, '/mcp/connections', { method: 'POST', headers: { cookie, origin: 'https://evil.test' }, body: new URLSearchParams({ id: tokenRow.id }) })).status, 403);
  assert.equal((await call(env, '/mcp/connections', { method: 'POST', headers: { cookie, origin: base }, body: new URLSearchParams({ id: tokenRow.id }) })).status, 303);
  assert.equal((await call(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 401);
  await client.close();
});

test('edit and publish grants are explicit, project scoped and use existing Studio records', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  const token = await flow(env, project, cookie, 'studio.read studio.edit studio.publish');
  const client = new Client({ name: 'fictional-client', version: '1.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: 'Bearer ' + token } }, fetch: (url, init) => worker.fetch(new Request(url, init), env) });
  await client.connect(transport);
  const changed = await client.callTool({ name: 'studio_update_project', arguments: { projectId: project.id, name: 'Updated project' } });
  assert.equal(changed.structuredContent.project.name, 'Updated project');
  const wrong = await client.callTool({ name: 'studio_update_project', arguments: { projectId: 'prj_other', name: 'No' } });
  assert.equal(wrong.isError, true);
  await addAsset(env, project, { id: 'asset_demo', kind: 'image' });
  const published = await client.callTool({ name: 'studio_publish_asset', arguments: { assetId: 'asset_demo', title: 'Example' } });
  assert.ok(published.structuredContent.publication.id);
  const withdrawal = await client.callTool({ name: 'studio_withdraw_publication', arguments: { publicationId: published.structuredContent.publication.id } });
  assert.equal(withdrawal.structuredContent.revoked, true);
  await client.close();
});

test('generation requires explicit elicitation, bound estimate, budget and idempotency', async () => {
  const { env, project } = await setup();
  let providerCalls = 0;
  withDarkroom(env);
  const image = new Uint8Array(300); image.set(jpeg(1024, 1024));
  env.AI = { run: async () => { providerCalls++; return { image: Buffer.from(image).toString('base64') }; } };
  const cookie = 'studio_session=' + await createSession(env);
  const token = await flow(env, project, cookie, 'studio.read studio.generate');
  const client = new Client({ name: 'fictional-client', version: '1.0' }, { versionNegotiation: { mode: 'auto' }, capabilities: { elicitation: { form: {} } } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: 'Bearer ' + token } }, fetch: (url, init) => worker.fetch(new Request(url, init), env) });
  let approved = false, prompts = 0;
  client.setRequestHandler('elicitation/create', async request => { prompts++; assert.match(request.params.message, /estimated/i); return { action: 'accept', content: { approve: approved } }; });
  await client.connect(transport);
  const args = { projectId: project.id, kind: 'image', model: 'studio-quick', prompt: 'A fictional paper scene', aspect: 'square', clientRequestId: 'request_fictional_1', maxCostMicro: 700 };
  const denied = await client.callTool({ name: 'studio_generate', arguments: args });
  assert.equal(denied.isError, true);
  assert.equal(providerCalls, 0);
  const tooLow = await client.callTool({ name: 'studio_generate', arguments: { ...args, maxCostMicro: 1 } });
  assert.equal(tooLow.isError, true);
  assert.equal(providerCalls, 0);
  approved = true;
  // A browser or another connection may already have admitted a job under
  // this project-wide client ID. This connection's cheap quote must never
  // dispatch that unrelated job.
  await env.DB.prepare("INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at) VALUES('gen_collision',?1,'request_fictional_1','image','freeform','cloudflare','studio-print','{}','admitted',25000,25000,1,1)").bind(project.id).run();
  const overStandingCap = await client.callTool({ name: 'studio_generate', arguments: { ...args, model: 'studio-print', maxCostMicro: 25000, clientRequestId: 'request_over_cap' } });
  assert.equal(overStandingCap.isError, true);
  assert.match(overStandingCap.content[0].text, /spending limit/i);
  assert.equal(providerCalls, 0);
  const generated = await client.callTool({ name: 'studio_generate', arguments: args });
  assert.equal(generated.structuredContent.generation.status, 'saved');
  assert.notEqual(generated.structuredContent.generation.id, 'gen_collision');
  assert.equal((await env.DB.prepare("SELECT status FROM generations WHERE id='gen_collision'").first()).status, 'admitted');
  assert.equal(providerCalls, 1);
  const replay = await client.callTool({ name: 'studio_generate', arguments: args });
  assert.equal(replay.structuredContent.generation.id, generated.structuredContent.generation.id);
  assert.equal(providerCalls, 1);
  assert.equal(prompts, 4);
  await client.close();
});

test('owner-set token cap is atomic, request-bound, replay-safe and stops after revoke', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  await flow(env, project, cookie, 'studio.read studio.generate', '0.01');
  const row = await env.DB.prepare('SELECT * FROM mcp_tokens').first();
  assert.equal(row.spend_cap_micro, 10000);
  const results = await Promise.all([
    reserveMcpSpend(env, row.id, 'request_one', 'fingerprint_one', 7000),
    reserveMcpSpend(env, row.id, 'request_two', 'fingerprint_two', 7000),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  const saved = await env.DB.prepare('SELECT * FROM mcp_spend_reservations WHERE token_id=?1').bind(row.id).first();
  assert.equal(await reserveMcpSpend(env, row.id, saved.request_id, saved.fingerprint, 7000), true);
  assert.equal(await reserveMcpSpend(env, row.id, saved.request_id, 'different', 7000), false);
  assert.equal(await reserveMcpSpend(env, row.id, saved.request_id, saved.fingerprint, 7001), false);
  await env.DB.prepare('UPDATE mcp_tokens SET revoked_at=?1 WHERE id=?2').bind(Date.now(), row.id).run();
  assert.equal(await reserveMcpSpend(env, row.id, saved.request_id, saved.fingerprint, 7000), false);
});

test('insufficient allowance and clients without confirmation support cannot dispatch', async () => {
  const { env, project } = await setup({ allowance: 1 });
  let providerCalls = 0;
  env.AI = { run: async () => { providerCalls++; throw Error('Should not dispatch'); } };
  const cookie = 'studio_session=' + await createSession(env);
  const token = await flow(env, project, cookie, 'studio.read studio.generate');
  const client = new Client({ name: 'fictional-client', version: '1.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: 'Bearer ' + token } }, fetch: (url, init) => worker.fetch(new Request(url, init), env) });
  await client.connect(transport);
  const args = { projectId: project.id, kind: 'image', model: 'studio-quick', prompt: 'A fictional scene', aspect: 'square', clientRequestId: 'request_budget_1', maxCostMicro: 700 };
  const denied = await client.callTool({ name: 'studio_generate', arguments: args });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /allowance/i);
  assert.equal(providerCalls, 0);
  env.MONTHLY_ALLOWANCE_MICRO = 5000000;
  await assert.rejects(client.callTool({ name: 'studio_generate', arguments: args }));
  assert.equal(providerCalls, 0);
  await client.close();
});

test('registration and token requests fail safely for bad redirects, missing resource and PKCE', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  const bad = await call(env, '/mcp/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['https://evil.test/callback'] }) });
  assert.equal(bad.status, 400);
  const token = await flow(env, project, cookie);
  assert.equal((await call(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await call(env, '/mcp/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code_verifier: 'bad' }) })).status, 400);
});

test('Composer grant and actor/workspace/project remain bound and are rechecked on every request', async (t) => {
  const { env, project } = await setup();
  env.COMPOSER_ORIGIN = 'https://composer.test';
  env.BRIDGE_SECRET = 'fictional-bridge-secret-at-least-thirty-two';
  let enabled = true, checks = 0, wrongAccount = false, failOnCheck = Infinity;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    checks++;
    const body = JSON.parse(init.body);
    const allowed = enabled && checks < failOnCheck;
    return Response.json(allowed ? { ok: true, actor: wrongAccount ? 'different-actor' : body.actor, workspace: body.workspace, actions: ['read'] } : { ok: false }, { status: allowed ? 200 : 403 });
  });
  const cookie = 'studio_session=' + await createSession(env, { mode: 'bridge', actor: 'alice', workspace: 'team', project: project.id, actions: ['read'] });
  const token = await flow(env, project, cookie);
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const discovery = () => call(env, '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
  const before = checks;
  assert.equal((await discovery()).status, 200);
  assert.ok(checks > before);
  const client = new Client({ name: 'grant-test', version: '1' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: 'Bearer ' + token } }, fetch: (url, init) => worker.fetch(new Request(url, init), env) });
  await client.connect(transport);
  // The outer HTTP request passes, but the grant is revoked before the tool's
  // dispatcher rechecks it; no project content may be returned.
  failOnCheck = checks + 2;
  const interrupted = await client.callTool({ name: 'studio_get_project', arguments: { projectId: project.id } });
  assert.equal(interrupted.isError, true);
  assert.equal(interrupted.structuredContent, undefined);
  failOnCheck = Infinity;
  await client.close();
  const tokenRow = await env.DB.prepare('SELECT id FROM mcp_tokens').first();
  for (const claim of [
    { actor: 'bob', workspace: 'team', project: project.id },
    { actor: 'alice', workspace: 'other', project: project.id },
    { actor: 'alice', workspace: 'team', project: 'prj_other' },
  ]) {
    const otherCookie = 'studio_session=' + await createSession(env, { mode: 'bridge', ...claim, actions: ['read'] });
    const revoke = await call(env, '/mcp/connections', { method: 'POST', headers: { cookie: otherCookie, origin: base }, body: new URLSearchParams({ id: tokenRow.id }) });
    assert.equal(revoke.status, 404);
  }
  wrongAccount = true;
  assert.equal((await discovery()).status, 403);
  wrongAccount = false;
  enabled = false;
  assert.equal((await discovery()).status, 403);
});

test('migration adds only MCP tables and preserves existing project records', () => {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql') && f < '0005').sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  db.exec("INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_existing','Kept','kept','','private','{}',1,1)");
  db.exec(readFileSync(new URL('0005_mcp_oauth.sql', dir), 'utf8'));
  assert.equal(db.prepare('SELECT name FROM projects WHERE id=?').get('prj_existing').name, 'Kept');
  db.close();
});

test('client registration is bounded per IP and responses prohibit caching', async () => {
  const { env } = await setup();
  for (let i = 0; i < 21; i++) {
    const response = await call(env, '/mcp/register', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'] }) });
    assert.equal(response.status, i < 20 ? 201 : 429);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  const rows = await env.DB.prepare('SELECT * FROM mcp_registration_limits').all();
  assert.equal(rows.results.length, 1);
  assert.match(rows.results[0].ip_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(rows).includes('192.0.2.1'), false);
});

test('expired credentials cannot be used, and never appear in connection listings', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  const token = await flow(env, project, cookie);
  const page = await (await call(env, '/mcp/connections', { headers: { cookie } })).text();
  assert.match(page, /Fictional agent/);
  assert.doesNotMatch(page, new RegExp(token));
  await env.DB.prepare('UPDATE mcp_tokens SET expires_at=?1').bind(Date.now() - 1).run();
  assert.equal((await call(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 401);
});

test('pruning removes expired authorization metadata and old inactive clients only', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env);
  await flow(env, project, cookie);
  const cutoff = Date.now();
  await env.DB.prepare('UPDATE mcp_clients SET created_at=?1').bind(cutoff - 100 * 86400000).run();
  await pruneMcpRecords(env, cutoff);
  assert.ok(await env.DB.prepare('SELECT id FROM mcp_clients').first(), 'active tokens retain the client');
  await env.DB.prepare('UPDATE mcp_codes SET expires_at=?1').bind(cutoff - 1).run();
  await env.DB.prepare('UPDATE mcp_tokens SET expires_at=?1').bind(cutoff - 1).run();
  await env.DB.prepare('UPDATE mcp_registration_limits SET reset_at=?1').bind(cutoff - 1).run();
  await pruneMcpRecords(env, cutoff);
  for (const table of ['mcp_clients', 'mcp_codes', 'mcp_tokens', 'mcp_registration_limits']) assert.equal((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT name FROM projects WHERE id=?1').bind(project.id).first()).name, 'Test studio');
});

test('promo brief tools obey OAuth project and edit scopes, revision checks and revocation without spending', async () => {
  const {env,project}=await setup(); const cookie='studio_session='+await createSession(env);
  const readToken=await flow(env,project,cookie,'studio.read');
  const editToken=await flow(env,project,cookie,'studio.read studio.edit');
  async function clientFor(token) {
    const client=new Client({name:'fictional-promo-client',version:'1.0'},{versionNegotiation:{mode:'auto'}});
    await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:'Bearer '+token}},fetch:(url,init)=>worker.fetch(new Request(url,init),env)}));return client;
  }
  const reader=await clientFor(readToken), editor=await clientFor(editToken);
  const args={projectId:project.id,title:'Fictional promo',aspect:'9:16',targetSeconds:20,scenes:[{spoken:'Hello',visual:'Open'},{spoken:'Explore',visual:'Close'}]};
  try {
    const tools=(await editor.listTools()).tools;
    assert.equal(tools.find(t=>t.name==='studio_list_promo_briefs').annotations.readOnlyHint,true);
    assert.equal(tools.find(t=>t.name==='studio_create_promo_brief').annotations.readOnlyHint,false);
    assert.equal((await reader.callTool({name:'studio_create_promo_brief',arguments:args})).isError,true);
    const created=await editor.callTool({name:'studio_create_promo_brief',arguments:args});
    assert.equal(created.isError,undefined,JSON.stringify(created));const brief=created.structuredContent.brief;assert.equal(brief.revision,1);
    assert.equal((await reader.callTool({name:'studio_list_promo_briefs',arguments:{projectId:project.id}})).structuredContent.briefs[0].id,brief.id);
    assert.equal((await reader.callTool({name:'studio_list_promo_briefs',arguments:{projectId:'prj_wrong'}})).isError,true);
    const updateArgs={...args,briefId:brief.id,expectedRevision:1,title:'Updated fictional promo'};
    assert.equal((await editor.callTool({name:'studio_update_promo_brief',arguments:updateArgs})).structuredContent.brief.revision,2);
    assert.equal((await editor.callTool({name:'studio_update_promo_brief',arguments:updateArgs})).isError,true);
    assert.equal((await reader.callTool({name:'studio_update_promo_brief',arguments:{...updateArgs,expectedRevision:2}})).isError,true);
    assert.equal((await editor.callTool({name:'studio_create_promo_brief',arguments:{...args,unexpected:'secret'}})).isError,true);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM publications').first()).n,0);
    const tokens=await env.DB.prepare('SELECT id FROM mcp_tokens ORDER BY rowid DESC LIMIT 1').first();
    await env.DB.prepare('UPDATE mcp_tokens SET revoked_at=?1 WHERE id=?2').bind(Date.now(),tokens.id).run();
    assert.equal((await call(env,'/mcp',{method:'POST',headers:{authorization:'Bearer '+editToken}})).status,401);
  } finally {await reader.close();await editor.close();}
});

test('subject read tools share private version history and enforce OAuth project grants', async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: 'asset_subject1', kind: 'image' });
  await env.DB.prepare('UPDATE assets SET sha256=?1 WHERE id=?2').bind('a'.repeat(64), 'asset_subject1').run();
  const cookie = 'studio_session=' + await createSession(env);
  const body = { type:'person', name:'Fictional subject', traits:'A green coat', referenceAssetId:'asset_subject1', referenceRole:'face', rightsConfirmed:true };
  const basePath = `/api/projects/${project.id}/subjects`;
  const request = (path, method, data) => call(env,path,{method,headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(data)});
  const first = await request(basePath,'POST',body); assert.equal(first.status,201); const subject=(await first.json()).subject;
  assert.equal((await request(`${basePath}/${subject.id}`,'PATCH',{...body,name:'Fictional subject revised',expectedRevision:1})).status,200);
  const token = await flow(env,project,cookie,'studio.read');
  const client = new Client({name:'fictional-subject-reader',version:'1.0'},{versionNegotiation:{mode:'auto'}});
  await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:'Bearer '+token}},fetch:(url,init)=>worker.fetch(new Request(url,init),env)}));
  try {
    const tools=(await client.listTools()).tools;
    for (const name of ['studio_list_subjects','studio_get_subject_versions']) assert.equal(tools.find(t=>t.name===name).annotations.readOnlyHint,true);
    const listed=await client.callTool({name:'studio_list_subjects',arguments:{projectId:project.id}});
    assert.equal(listed.structuredContent.subjects[0].revision,2);
    const args={projectId:project.id,subjectId:subject.id};
    const history=await client.callTool({name:'studio_get_subject_versions',arguments:args});
    assert.deepEqual(history.structuredContent.versions.map(v=>v.revision),[2,1]);
    await env.DB.prepare('UPDATE assets SET deleted_at=1 WHERE id=?1').bind('asset_subject1').run();
    assert.equal((await client.callTool({name:'studio_get_subject_versions',arguments:args})).structuredContent.versions[0].referenceAvailable,false);
    assert.equal((await client.callTool({name:'studio_list_subjects',arguments:{projectId:'prj_wrong'}})).isError,true);
    assert.equal((await client.callTool({name:'studio_get_subject_versions',arguments:{projectId:'prj_wrong',subjectId:subject.id}})).isError,true);
    assert.equal((await client.callTool({name:'studio_get_subject_versions',arguments:{projectId:project.id,subjectId:'../api/state'}})).isError,true);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
    await env.DB.prepare('UPDATE mcp_tokens SET revoked_at=?1').bind(Date.now()).run();
    assert.equal((await call(env,'/mcp',{method:'POST',headers:{authorization:'Bearer '+token}})).status,401);
  } finally { await client.close(); }
});
