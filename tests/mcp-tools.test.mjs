import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createStudioMcpHandler } from '../src/mcp/tools.mjs';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { setup, addAsset } from './harness.mjs';

async function connect(dispatch, versionNegotiation = { mode: 'auto' }) {
  const server = createStudioMcpHandler(dispatch);
  const client = new Client({ name: 'studio-test', version: '1.0.0' }, { versionNegotiation });
  const transport = new StreamableHTTPClientTransport(new URL('https://studio.test/mcp'), {
    fetch: (url, init) => server.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

test('MCP SDK discovers actual read tools and reads existing scoped Studio records', async () => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env, { mode: 'bridge', actor: 'user', workspace: 'workspace', project: project.id, actions: ['read'] });
  let active = true;
  const calls = [];
  const client = await connect(async ({ method, path }) => {
    calls.push(path);
    if (!active) return { status: 403, body: { error: { code: 'forbidden', message: 'Grant revoked' } } };
    const response = await worker.fetch(new Request('https://studio.test' + path, { method, headers: { cookie } }), env);
    return { status: response.status, body: await response.json() };
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['studio_create_footage_plan', 'studio_create_song_plan', 'studio_create_storyboard', 'studio_download_asset_chunk', 'studio_export_project', 'studio_export_song_captions', 'studio_get_asset', 'studio_get_job', 'studio_get_project', 'studio_import_share_artwork', 'studio_list_footage_plans', 'studio_list_models', 'studio_list_projects', 'studio_list_song_plans', 'studio_publish_asset', 'studio_rename_asset', 'studio_storyboard_from_song_plan', 'studio_update_footage_plan', 'studio_update_project', 'studio_update_song_captions', 'studio_update_song_plan', 'studio_update_storyboard', 'studio_withdraw_publication']);
  const state = await client.callTool({ name: 'studio_list_projects', arguments: {} });
  assert.equal(state.structuredContent.projects[0].id, project.id);
  const wrong = await client.callTool({ name: 'studio_get_project', arguments: { projectId: 'prj_other' } });
  assert.equal(wrong.isError, true);
  active = false;
  const revoked = await client.callTool({ name: 'studio_get_project', arguments: { projectId: project.id } });
  assert.equal(revoked.isError, true);
  assert.match(revoked.content[0].text, /Grant revoked/);
  const before = calls.length;
  const invalid = await client.callTool({ name: 'studio_get_project', arguments: { projectId: '../api/state' } });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, before);
  await client.close();
});

test('the tool core cannot be instantiated without an authorization dispatcher', () => {
  assert.throws(() => createStudioMcpHandler(), /authorized Studio dispatcher/);
});

test('2025 handshake clients also discover the same tools', async () => {
  const client = await connect(async () => ({ status: 200, body: { models: [] } }), { mode: 'legacy' });
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'studio_list_models'));
  const job = tools.find(tool => tool.name === 'studio_get_job');
  assert.equal(job.annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'studio_list_models', arguments: {} });
  assert.deepEqual(result.structuredContent, { models: [] });
  await client.close();
});

test('MCP song plans respect the project grant and share the real revisioned API state', async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: 'asset_song1', kind: 'audio', durationMs: 40000 });
  let cookie = 'studio_session=' + await createSession(env);
  const scopedCookie = 'studio_session=' + await createSession(env, { mode: 'bridge', actor: 'user', workspace: 'workspace', project: project.id, actions: ['read'] });
  const client = await connect(async ({ method, path, body }) => {
    const response = await worker.fetch(new Request('https://studio.test' + path, { method, headers: { cookie, origin: 'https://studio.test', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, body: await response.json() };
  });
  try {
    const created = await client.callTool({ name: 'studio_create_song_plan', arguments: { projectId: project.id, songAssetId: 'asset_song1', rightsConfirmed: true, title: 'Fictional song', aspect: '16:9', startMs: 0, endMs: 30000, sceneCount: 4 } });
    assert.equal(created.isError, undefined, JSON.stringify(created));
    assert.equal(created.structuredContent.plan.revision, 1);
    const planId = created.structuredContent.plan.id;
    const saved = await client.callTool({ name: 'studio_update_song_captions', arguments: { projectId: project.id, planId, expectedRevision: 1, rightsConfirmed: true, cues: [{ id: 'cue_test1', startMs: 1000, endMs: 2000, text: 'Original fictional words' }] } });
    assert.equal(saved.structuredContent.plan.revision, 2);
    const exported = await client.callTool({ name: 'studio_export_song_captions', arguments: { projectId: project.id, planId, format: 'vtt' } });
    assert.match(exported.structuredContent.content, /WEBVTT/);
    const file = await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/song-plans/${planId}/captions?format=srt&download=1`, { headers: { cookie } }), env);
    assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /application\/x-subrip/); assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.match(await file.text(), /Original fictional words/);

    cookie = scopedCookie;
    const read = await client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: project.id } });
    assert.equal(read.structuredContent.plans[0].id, created.structuredContent.plan.id);
    const denied = await client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: 'prj_other' } });
    assert.equal(denied.isError, true);
    const deniedExport = await client.callTool({ name: 'studio_export_song_captions', arguments: { projectId: 'prj_other', planId, format: 'vtt' } });
    assert.equal(deniedExport.isError, true);
  } finally { await client.close(); }
});

test('MCP footage cut maps use existing authorised project and cannot read another project', async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: 'asset_source1', kind: 'video', durationMs: 40000 });
  let cookie = 'studio_session=' + await createSession(env);
  const scopedCookie = 'studio_session=' + await createSession(env, { mode: 'bridge', actor: 'user', workspace: 'workspace', project: project.id, actions: ['read'] });
  const client = await connect(async ({ method, path, body }) => {
    const response = await worker.fetch(new Request('https://studio.test' + path, { method, headers: { cookie, origin: 'https://studio.test', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, body: await response.json() };
  });
  try {
    const created=await client.callTool({name:'studio_create_footage_plan',arguments:{projectId:project.id,sourceAssetId:'asset_source1',rightsConfirmed:true,title:'Fictional clip',aspect:'16:9',sourceStartMs:0,sourceEndMs:20000,sceneCount:4}});
    assert.equal(created.isError,undefined,JSON.stringify(created));
    assert.equal(created.structuredContent.plan.revision,1);
    cookie=scopedCookie;
    const read=await client.callTool({name:'studio_list_footage_plans',arguments:{projectId:project.id}});
    assert.equal(read.structuredContent.plans[0].id,created.structuredContent.plan.id);
    const denied=await client.callTool({name:'studio_list_footage_plans',arguments:{projectId:'prj_other'}});
    assert.equal(denied.isError,true);
  } finally { await client.close(); }
});

test('MCP turns an authorised ready song plan into the same saved storyboard without spending', async () => {
  const { createSongPlan, updateSongPlan } = await import('../src/lib/song-plans.mjs');
  const { env, project } = await setup();
  await addAsset(env, project, { id: 'asset_song1', kind: 'audio', durationMs: 20000 });
  for (let i = 1; i <= 4; i++) await addAsset(env, project, { id: `asset_take0${i}`, kind: 'video', durationMs: i === 1 ? 5200 : 5000 });
  const plan = await createSongPlan(env, project, { songAssetId: 'asset_song1', rightsConfirmed: true, title: 'Fictional film', aspect: '16:9', startMs: 0, endMs: 20000, sceneCount: 4 });
  await updateSongPlan(env, project, plan.id, { ...plan, expectedRevision: 1, scenes: plan.scenes.map((scene, i) => ({ ...scene, selectedTakeId: `asset_take0${i+1}` })) });
  const cookie = 'studio_session=' + await createSession(env);
  const client = await connect(async ({method, path, body}) => {
    const response = await worker.fetch(new Request('https://studio.test' + path, { method, headers: { cookie, origin: 'https://studio.test', 'content-type': 'application/json' }, ...(body ? {body: JSON.stringify(body)} : {}) }), env);
    return { status: response.status, body: await response.json() };
  });
  try {
    const refused = await client.callTool({name:'studio_storyboard_from_song_plan',arguments:{projectId:project.id,planId:plan.id,expectedRevision:2}});
    assert.equal(refused.isError,true);
    const first = await client.callTool({name:'studio_storyboard_from_song_plan',arguments:{projectId:project.id,planId:plan.id,expectedRevision:2,allowTrim:true}});
    assert.equal(first.isError,undefined,JSON.stringify(first)); assert.equal(first.structuredContent.created,true);
    assert.equal(first.structuredContent.composition.shots[0].trimEndMs,5000);
    const again = await client.callTool({name:'studio_storyboard_from_song_plan',arguments:{projectId:project.id,planId:plan.id,expectedRevision:2,allowTrim:true}});
    assert.equal(again.structuredContent.created,false); assert.equal(again.structuredContent.composition.id,first.structuredContent.composition.id);
    const selectedRanges=plan.scenes.map((scene,i)=>({sceneId:scene.id,startMs:i===0?100:0}));
    const shifted=await client.callTool({name:'studio_storyboard_from_song_plan',arguments:{projectId:project.id,planId:plan.id,expectedRevision:2,allowTrim:true,sceneStarts:selectedRanges}});
    assert.equal(shifted.isError,undefined,JSON.stringify(shifted));
    assert.equal(shifted.structuredContent.composition.shots[0].trimStartMs,100);
    assert.notEqual(shifted.structuredContent.composition.id,first.structuredContent.composition.id);
    const composition=first.structuredContent.composition;
    const update={projectId:project.id,compositionId:composition.id,expectedUpdatedAt:composition.updatedAt,title:'Revised cut',shots:composition.shots.map(({assetId,trimStartMs,trimEndMs})=>({assetId,...(trimStartMs === undefined ? {} : {trimStartMs,trimEndMs})}))};
    const saved=await client.callTool({name:'studio_update_storyboard',arguments:update});
    assert.equal(saved.isError,undefined,JSON.stringify(saved));
    const stale=await client.callTool({name:'studio_update_storyboard',arguments:update});
    assert.equal(stale.isError,true);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations').first()).n,0);
  } finally { await client.close(); }
});
