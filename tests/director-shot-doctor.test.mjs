// MIT. One continuous, project-grounded Director editing flow on fictional
// fixtures: saved-evidence diagnosis, approve/decline, revision read-back in
// three surfaces, the three operational error states, and a playable export.
// No model, paid provider or production record is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { createSongPlan, updateSongPlan, updateSongCaptions } from '../src/lib/song-plans.ts';
import { createComposition, createRender, completeFromWebhook, loadGeneration } from '../src/lib/jobs.mjs';
import { measureFootageSource } from '../src/lib/footage-preflight.ts';
import { sha256Hex, sniffMedia, videoInfo } from '../src/lib/util.mjs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setup, addAsset } from './harness.mjs';

const base = 'https://studio.test';
const call = (env, path, init = {}) => worker.fetch(new Request(base + path, init), env);
const songPlanPath = (projectId, planId) => `/api/projects/${projectId}/song-plans/${planId}`;

async function fixture() {
  const { env, project } = await setup();
  await addAsset(env, project, { id: 'asset_song1', kind: 'audio', durationMs: 30000 });
  await addAsset(env, project, { id: 'asset_ref01', kind: 'image', title: 'Fictional still' });
  await addAsset(env, project, { id: 'asset_take01', kind: 'video', durationMs: 6000, title: 'Fictional take one' });
  await addAsset(env, project, { id: 'asset_take02', kind: 'video', durationMs: 3000, title: 'Fictional take two' });
  await addAsset(env, project, { id: 'asset_clip01', kind: 'video', durationMs: 6000, title: 'Fictional clip one' });
  await addAsset(env, project, { id: 'asset_clip02', kind: 'video', durationMs: 4000, title: 'Fictional clip two' });
  const hashes = { asset_song1: 'song-sha-1', asset_ref01: 'a'.repeat(64), asset_take01: 'take-sha-1', asset_take02: 'take-sha-2', asset_clip01: 'clip-sha-1', asset_clip02: 'clip-sha-2' };
  for (const [id, sha] of Object.entries(hashes)) await env.DB.prepare('UPDATE assets SET sha256=?2 WHERE id=?1').bind(id, sha).run();
  let plan = await createSongPlan(env, project, { songAssetId: 'asset_song1', rightsConfirmed: true, title: 'Fictional shot doctor plan', aspect: '16:9', startMs: 0, endMs: 12000, sceneCount: 3 });
  plan = await updateSongPlan(env, project, plan.id, {
    ...plan, expectedRevision: 1,
    scenes: plan.scenes.map((scene, index) => ({
      ...scene,
      direction: `Saved direction ${index + 1}`,
      referenceAssetId: index === 0 ? 'asset_ref01' : null,
      selectedTakeId: index === 0 ? 'asset_take01' : index === 1 ? 'asset_take02' : null,
    })),
  });
  plan = await updateSongCaptions(env, project, plan.id, { expectedRevision: 2, rightsConfirmed: true, cues: [{ id: 'cue_fixture1', startMs: 500, endMs: 1500, text: 'Fictional words' }] });
  const stamp = 1_700_000_000_000;
  const receipt = (id, takeId, cost, prompt, reference) => env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,cost_allocated_micro,output_asset_id,provider_request_id,created_at,updated_at,submitted_at,completed_at)
     VALUES(?1,?2,?3,'video','freeform','fal','studio-h3',?4,'saved',?5,?5,?5,?6,?7,?8,?8,?8,?8)`,
  ).bind(id, project.id, `req_${id}`, JSON.stringify({ prompt, aspect: '16:9', durationSeconds: 6, ...reference }), cost, takeId, `prov_${id}`, stamp);
  await receipt('gen_saved1', 'asset_take01', 240000, 'Saved direction 1', { referenceAssetId: 'asset_ref01', referenceSha256: 'a'.repeat(64) }).run();
  await receipt('gen_saved2', 'asset_take02', 120000, 'Saved direction 2', {}).run();
  await env.DB.prepare("UPDATE assets SET generation_id='gen_saved1' WHERE id='asset_take01'").run();
  await env.DB.prepare("UPDATE assets SET generation_id='gen_saved2' WHERE id='asset_take02'").run();
  const cookie = 'studio_session=' + await createSession(env);
  const post = (path, payload, auth = cookie) => call(env, path, { method: 'POST', headers: { cookie: auth, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const plans = async (auth = cookie) => (await call(env, `/api/projects/${project.id}/song-plans`, { headers: { cookie: auth } })).json();
  const diagnosis = (payload, auth = cookie) => post(`${songPlanPath(project.id, plan.id)}/shot-diagnosis`, payload, auth);
  return { env, project, plan, cookie, post, plans, diagnosis };
}

async function ownerToken(env, project) {
  const registered = await call(env, '/mcp/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Fictional studio agent', redirect_uris: ['http://127.0.0.1:43210/callback'], token_endpoint_auth_method: 'none' }) });
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json();
  const verifier = 'x'.repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp', scope: 'studio.read', state: 'fixture' });
  const cookie = 'studio_session=' + await createSession(env);
  params.set('project', project.id); params.set('decision', 'allow');
  const consent = await call(env, '/mcp/authorize', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: params });
  assert.equal(consent.status, 303);
  const code = new URL(consent.headers.get('location')).searchParams.get('code');
  const exchanged = await call(env, '/mcp/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code, code_verifier: verifier, resource: base + '/mcp' }) });
  assert.equal(exchanged.status, 200);
  return { token: (await exchanged.json()).access_token, cookie };
}

async function mcpClient(env, token) {
  const client = new Client({ name: 'studio-fixture-agent', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer ' + token } },
    fetch: (url, init) => worker.fetch(new Request(url, init), env),
  });
  await client.connect(transport);
  return client;
}

test('the answer names the failing shot, its saved cause and cost without submitting a job', async () => {
  const { env, project, plan, diagnosis } = await fixture();
  const response = await diagnosis({ expectedRevision: plan.revision, sceneIds: plan.scenes.map(scene => scene.id) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.plan.id, plan.id);
  assert.equal(data.plan.revision, plan.revision);
  assert.match(data.plan.revisionDigest, /^[a-f0-9]{64}$/);
  assert.equal(data.song.matches, true);
  assert.equal(data.shots[0].code, 'ok');
  assert.equal(data.shots[0].requiresRerun, false);
  assert.equal(data.shots[1].code, 'take_too_short');
  assert.equal(data.shots[1].requiresRerun, true);
  assert.match(data.shots[1].summary, /3\.0 s/);
  assert.match(data.shots[1].summary, /4\.0 s/);
  assert.equal(data.shots[1].rerun.estimateMicro, 120000);
  assert.equal(data.shots[1].rerun.estimateLabel, '$0.12');
  assert.equal(data.shots[1].rerun.basis, 'Recorded admission estimate for the saved job settings.');
  assert.match(data.shots[1].rerun.note, /may cost more than the recorded estimate/);
  assert.equal(data.shots[1].evidence.receipt.id, 'gen_saved2');
  assert.equal(data.shots[2].code, 'no_take');
  assert.equal(data.shots[2].rerun.estimateMicro, null);
  assert.match(data.shots[0].evidence.reference.shaLabel, /^aaaaaaaaaaaa/);
  assert.equal(data.shots[0].evidence.receipt.settings.referenceSha256, 'a'.repeat(64));
  assert.match(data.answer, /2 of the 3 selected shots need a rerun/);
  assert.match(data.answer, /Scene 2 — The take is 3\.0 s but the scene needs 4\.0 s/);
  assert.match(data.answer, /\$0\.12 at the saved estimate for 1 of 2 shots/);
  assert.equal(data.cost.rerunMicro, 120000);
  assert.equal(data.cost.shotCount, 2);
  assert.equal(data.nothingSubmitted, true);
  // Saved state and the job count are untouched.
  const found = (await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1').bind(plan.id).first());
  assert.equal(found.revision, plan.revision);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations WHERE project_id=?1').bind(project.id).first()).n, 2);
});

test('one reviewed change is approved and the other declined, and only the approved scene is saved', async () => {
  const { env, project, plan, post, plans } = await fixture();
  const changes = [
    { sceneId: plan.scenes[0].id, direction: 'Brighter practical light, same take.' },
    { sceneId: plan.scenes[1].id, direction: 'Warmer light, same take.' },
  ];
  const previewResponse = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/preview`, { expectedRevision: plan.revision, changes });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.proposal.changes.length, 2);
  assert.match(preview.revision.digest, /^[a-f0-9]{64}$/);
  const applied = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/apply`, { expectedRevision: plan.revision, changes, reviewDigest: preview.reviewDigest, approved: true, acceptSceneIds: [plan.scenes[0].id] });
  assert.equal(applied.status, 200);
  const result = await applied.json();
  assert.deepEqual(result.acceptedSceneIds, [plan.scenes[0].id]);
  assert.deepEqual(result.declinedSceneIds, [plan.scenes[1].id]);
  assert.equal(result.plan.revision, plan.revision + 1);
  assert.equal(result.plan.scenes[0].direction, 'Brighter practical light, same take.');
  // The declined change left the saved scene exactly as it was.
  assert.deepEqual(result.plan.scenes[1], plan.scenes[1]);
  assert.deepEqual(result.plan.scenes[2], plan.scenes[2]);
  assert.deepEqual(result.plan.scenes.map(scene => [scene.startMs, scene.endMs]), plan.scenes.map(scene => [scene.startMs, scene.endMs]));
  assert.deepEqual(result.plan.scenes.map(scene => scene.selectedTakeId), plan.scenes.map(scene => scene.selectedTakeId));
  assert.deepEqual(result.plan.captions, plan.captions);
  const reopened = (await plans()).plans[0];
  assert.equal(reopened.revision, plan.revision + 1);
  assert.equal(reopened.scenes[1].direction, plan.scenes[1].direction);
  // Replaying the reviewed digest cannot apply the declined change later.
  const replay = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/apply`, { expectedRevision: plan.revision, changes, reviewDigest: preview.reviewDigest, approved: true, acceptSceneIds: [plan.scenes[1].id] });
  assert.equal(replay.status, 409);
  const unknown = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/preview`, { expectedRevision: plan.revision + 1, changes });
  assert.equal(unknown.status, 200);
  const unknownApply = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/apply`, { expectedRevision: plan.revision + 1, changes, reviewDigest: (await unknown.json()).reviewDigest, approved: true, acceptSceneIds: ['scn_missing'] });
  assert.equal(unknownApply.status, 400);
});

test('the same persisted revision identity is read from the Director, the workbench and a scoped MCP tool', async () => {
  const { env, project, plan, cookie, post, plans, diagnosis } = await fixture();
  const changes = [{ sceneId: plan.scenes[0].id, direction: 'A slower push-in under the same practical light.' }];
  const preview = await (await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/preview`, { expectedRevision: plan.revision, changes })).json();
  const applied = await (await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/apply`, { expectedRevision: plan.revision, changes, reviewDigest: preview.reviewDigest, approved: true })).json();
  const revision = applied.plan.revision;
  const digest = applied.plan.revisionDigest;
  assert.match(digest, /^[a-f0-9]{64}$/);
  // Director read-back returns the revision it just wrote.
  assert.equal(applied.plan.id, plan.id);
  // Native workbench reads through the saved plan API.
  const workbench = (await plans(cookie)).plans.find(item => item.id === plan.id);
  assert.equal(workbench.revision, revision);
  assert.equal(workbench.revisionDigest, digest);
  assert.equal(workbench.scenes[0].direction, 'A slower push-in under the same practical light.');
  // The Director proposal carries the same saved identity it would edit.
  env.AI = { async run() { return { response: JSON.stringify({ changes: [{ sceneId: plan.scenes[0].id, direction: 'A Director suggestion, not applied.' }] }) }; } };
  const director = await (await post(`${songPlanPath(project.id, plan.id)}/director`, { expectedRevision: revision, request: 'Try a slower push-in.', sceneIds: [plan.scenes[0].id] })).json();
  assert.equal(director.revision.digest, digest);
  assert.equal(director.revision.revision, revision);
  assert.equal(director.proposal.expectedRevision, revision);
  assert.equal(director.director.applied, false);
  assert.equal((await plans(cookie)).plans.find(item => item.id === plan.id).revision, revision);
  // Shot doctor reports the same identity from its own read.
  const doctor = await (await diagnosis({ expectedRevision: revision, sceneIds: [plan.scenes[0].id] })).json();
  assert.equal(doctor.plan.revision, revision);
  assert.equal(doctor.plan.revisionDigest, digest);
  // The scoped MCP tool reads the same record through the real /mcp endpoint.
  const { token } = await ownerToken(env, project);
  const client = await mcpClient(env, token);
  try {
    const listed = await client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: project.id } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const overMcp = listed.structuredContent.plans.find(item => item.id === plan.id);
    assert.equal(overMcp.revision, revision);
    assert.equal(overMcp.revisionDigest, digest);
    assert.equal(overMcp.scenes[0].direction, 'A slower push-in under the same practical light.');
  } finally { await client.close(); }
  // A new save produces a different identity, so the digest is content-bound.
  const next = await (await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/preview`, { expectedRevision: revision, changes: [{ sceneId: plan.scenes[2].id, direction: 'Late light.' }] })).json();
  const second = await (await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/apply`, { expectedRevision: revision, changes: [{ sceneId: plan.scenes[2].id, direction: 'Late light.' }], reviewDigest: next.reviewDigest, approved: true })).json();
  assert.equal(second.plan.revision, revision + 1);
  assert.notEqual(second.plan.revisionDigest, digest);
});

test('a stale revision says what changed and what to do', async () => {
  const { project, plan, post, diagnosis } = await fixture();
  const stale = await post(`${songPlanPath(project.id, plan.id)}/scene-proposal/preview`, { expectedRevision: plan.revision - 1, changes: [{ sceneId: plan.scenes[0].id, direction: 'Stale edit' }] });
  assert.equal(stale.status, 409);
  const error = (await stale.json()).error;
  assert.equal(error.code, 'proposal_conflict');
  assert.match(error.message, new RegExp(`revision ${plan.revision}`));
  assert.match(error.message, /Reload it, then preview the edit again/);
  assert.match(error.message, /Nothing was applied/);
  const diagnosisStale = await diagnosis({ expectedRevision: plan.revision - 1, sceneIds: [plan.scenes[0].id] });
  assert.equal(diagnosisStale.status, 409);
  assert.match((await diagnosisStale.json()).error.message, /Reload it before inspecting a shot/);
});

test('a revoked agent grant says the connection is gone and how to reconnect', async () => {
  const { env, project } = await fixture();
  const { token, cookie } = await ownerToken(env, project);
  const client = await mcpClient(env, token);
  try {
    const before = await client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: project.id } });
    assert.equal(before.isError, undefined, JSON.stringify(before));
    const tokenRow = await env.DB.prepare('SELECT id FROM mcp_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').first();
    const revoked = await call(env, '/mcp/connections', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: tokenRow.id }) });
    assert.equal(revoked.status, 303);
    // The next request is refused at the MCP endpoint, with an actionable
    // message rather than a bare 401.
    await assert.rejects(
      () => client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: project.id } }),
      error => {
        const body = String(error?.data?.text ?? error?.message ?? '');
        assert.match(body, /no longer active or has expired/);
        assert.match(body, /reconnect from Studio Agent connections/);
        assert.match(body, /Nothing was changed/);
        return true;
      },
    );
  } finally { await client.close(); }
});

test('a provider job that never answered is reported with reconcile guidance and no resubmit', async () => {
  const { env, project, plan, diagnosis } = await fixture();
  const stamp = Date.now();
  await env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,provider_request_id,created_at,updated_at,submitted_at)
     VALUES('gen_unanswered',?1,'req_unanswered','video','freeform','fal','studio-h3',?2,'unknown',50000,50000,'prov_never_answered',?3,?3,?3)`,
  ).bind(project.id, JSON.stringify({ prompt: 'Fictional unanswered shot', aspect: '16:9', durationSeconds: 5 }), stamp).run();
  const data = await (await diagnosis({ expectedRevision: plan.revision, sceneIds: [plan.scenes[2].id] })).json();
  const waiting = data.waitingJobs.find(job => job.id === 'gen_unanswered');
  assert.ok(waiting, JSON.stringify(data.waitingJobs));
  assert.equal(waiting.code, 'job_unanswered');
  assert.match(waiting.summary, /provider never answered/);
  assert.match(waiting.nextStep, /Reconcile this job/);
  assert.match(waiting.nextStep, /do not retry the same request/i);
  assert.match(waiting.nextStep, /accept the charge/);
  assert.equal(waiting.costEstimateMicro, 50000);
  // Reporting it changes nothing: same revision, same jobs, nothing dispatched.
  assert.equal(data.plan.revision, plan.revision);
  assert.equal((await env.DB.prepare("SELECT status FROM generations WHERE id='gen_unanswered'").first()).status, 'unknown');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generations WHERE project_id=?1').bind(project.id).first()).n, 3);
});

test('the assembled export saves owned bytes that decode as a playable MP4', async () => {
  const { env, project } = await fixture();
  const composition = await createComposition(env, project, { title: 'Fictional export revision', shots: [{ assetId: 'asset_clip01' }, { assetId: 'asset_clip02' }] });
  const row = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1').bind(composition.id).first();
  const created = await createRender(env, project, row, { model: 'studio-assembly', clientRequestId: 'req_fixture_export1' });
  assert.equal(created.created, true);
  const exportedRevision = JSON.parse(created.generation.request_json);
  assert.equal(exportedRevision.compositionId, composition.id);
  assert.deepEqual(exportedRevision.shots.map(shot => shot.assetId), ['asset_clip01', 'asset_clip02']);
  assert.equal(exportedRevision.totalMs, 10000);
  await env.DB.prepare("UPDATE generations SET status='submitted',provider_request_id='prov_fixture_export',submitted_at=?2,updated_at=?2 WHERE id=?1").bind(created.generation.id, Date.now()).run();
  const master = await readFile(new URL('../media/studio-proof/public/ldraw-mountain-hailuo-original.mp4', import.meta.url));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).startsWith('https://v3.fal.media/') ? new Response(master, { status: 200, headers: { 'content-type': 'video/mp4' } }) : originalFetch(url);
  let saved;
  try {
    saved = await completeFromWebhook(env, await loadGeneration(env, created.generation.id), { video: { url: 'https://v3.fal.media/files/master.mp4', content_type: 'video/mp4' } });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(saved.status, 'saved');
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(saved.output_asset_id).first();
  assert.equal(asset.kind, 'video');
  assert.equal(asset.source, 'assembled');
  assert.equal(asset.mime, 'video/mp4');
  assert.equal(asset.deleted_at, null);
  const object = await env.MEDIA.get(asset.r2_key);
  const bytes = new Uint8Array(await object.arrayBuffer());
  assert.equal(bytes.byteLength, asset.bytes);
  assert.equal(await sha256Hex(bytes), asset.sha256);
  assert.equal(sniffMedia(bytes, 'video/mp4').mime, 'video/mp4');
  const info = videoInfo(bytes);
  assert.ok(info.durationMs >= 5000, JSON.stringify(info));
  assert.ok(info.width > 0 && info.height > 0, JSON.stringify(info));
  // Demux and measure the saved file with the same bounded reader the studio
  // uses for source footage; this proves frames, not a filename.
  const measured = await measureFootageSource(env, asset);
  assert.ok(measured.video.frames > 0);
  assert.ok(Math.abs(measured.video.durationSeconds - 5.875) < 0.2, JSON.stringify(measured.video));
  assert.ok(measured.video.width > 0 && measured.video.height > 0);
});
