// MIT. The signed PUT handoff is the supported path for originals too large to
// pass through a bounded JSON-RPC tool result. These tests use the real Worker,
// the real MCP SDK, in-memory D1/R2 and the Composer stub; no network is used.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/worker.mjs';
import { createSession } from '../src/lib/auth.mjs';
import { sha256Hex } from '../src/lib/util.mjs';
import { MAX_UPLOAD_LINK_BYTES, UPLOAD_LINK_TTL_MS } from '../src/lib/upload-links.mjs';
import { setup, wav } from './harness.mjs';

const base = 'https://studio.test';
const resource = base + '/mcp';
const challenge = async (value) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64url');

function call(env, path, init = {}) {
  return worker.fetch(new Request(base + path, init), env);
}

/** A real OAuth code + PKCE exchange against the owner studio. Owner-issued
 * tokens keep Composer out of the loop; only the token row is authoritative. */
async function mintToken(env, project, scope = 'studio.read studio.edit', sessionCookie) {
  const cookie = sessionCookie ?? 'studio_session=' + await createSession(env);
  const register = await call(env, '/mcp/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Fictional upload agent', redirect_uris: ['http://127.0.0.1:43210/callback'], token_endpoint_auth_method: 'none' }),
  });
  assert.equal(register.status, 201);
  const { client_id } = await register.json();
  const verifier = 'x'.repeat(64);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: 'http://127.0.0.1:43210/callback',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    resource,
    scope,
    state: 'upload',
    project: project.id,
    decision: 'allow',
  });
  const consent = await call(env, '/mcp/authorize', {
    method: 'POST',
    headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  assert.equal(consent.status, 303);
  const code = new URL(consent.headers.get('location')).searchParams.get('code');
  const exchange = await call(env, '/mcp/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id,
      redirect_uri: 'http://127.0.0.1:43210/callback',
      code,
      code_verifier: verifier,
      resource,
    }),
  });
  assert.equal(exchange.status, 200);
  return (await exchange.json()).access_token;
}

async function connect(env, token) {
  const client = new Client({ name: 'fictional-upload-agent', version: '1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { authorization: 'Bearer ' + token } },
      fetch: (url, init) => worker.fetch(new Request(url, init), env),
    }),
  );
  return client;
}

async function begin(client, projectId, bytes, { filename = 'Fictional upload.wav', contentType = 'audio/wav', sha256 } = {}) {
  return client.callTool({
    name: 'studio_begin_asset_upload',
    arguments: { projectId, filename, contentType, bytes: bytes.length, sha256: sha256 ?? await sha256Hex(bytes) },
  });
}

async function put(env, uploadUrl, bytes) {
  const response = await worker.fetch(
    new Request(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes }),
    env,
  );
  return { response, body: await response.json() };
}

function toolError(result) {
  assert.equal(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text).error;
}

async function assetCount(env) {
  return Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n);
}

test('a synthetic ~6 MiB WAV uploads through a signed PUT and reads back through bounded MCP', async () => {
  const { env, project } = await setup();
  const client = await connect(env, await mintToken(env, project));
  try {
    // Beyond the ~4 MiB JSON-RPC bound: the bytes only ever travel over HTTP.
    const bytes = wav({ seconds: 33, sampleRate: 48000, channels: 2 });
    assert.ok(bytes.length > 4 * 1024 * 1024, `fixture is ${bytes.length} bytes`);
    const sha256 = await sha256Hex(bytes);

    const begun = await begin(client, project.id, bytes, { filename: 'Fictional six megabyte song.wav' });
    assert.equal(begun.isError, undefined, JSON.stringify(begun));
    const { uploadUrl, expiresAt, maxBytes, method, headers } = begun.structuredContent;
    assert.equal(method, 'PUT');
    assert.equal(maxBytes, 32 * 1024 * 1024);
    assert.ok(expiresAt > Date.now() && expiresAt <= Date.now() + UPLOAD_LINK_TTL_MS);
    assert.match(uploadUrl, new RegExp(`^https://studio\\.test/upload/assets/upl_[a-f0-9]{32}\\?p=${project.id}&e=\\d+&s=[a-f0-9]{64}$`));
    assert.equal(uploadUrl.includes('studio_session'), false);
    assert.deepEqual(headers, { 'content-type': 'application/octet-stream' });

    const stored = await put(env, uploadUrl, bytes);
    assert.equal(stored.response.status, 201, JSON.stringify(stored.body));
    assert.equal(stored.body.upload.reused, false);
    assert.equal(stored.body.asset.kind, 'audio');
    assert.equal(stored.body.asset.mime, 'audio/wav');
    assert.equal(stored.body.asset.bytes, bytes.length);
    assert.equal(stored.body.asset.sha256, sha256);
    assert.equal(stored.body.asset.durationMs, 33000);
    assert.equal(stored.body.asset.sampleRate, 48000);
    assert.equal(stored.body.asset.channels, 2);

    const row = await env.DB.prepare('SELECT * FROM assets WHERE id=?1').bind(stored.body.asset.id).first();
    assert.match(row.r2_key, new RegExp(`^projects/${project.id}/assets/asset_[a-f0-9]{32}/original\\.wav$`));
    assert.equal(await env.MEDIA.head(row.r2_key).then(object => object.size), bytes.length);

    const read = await client.callTool({ name: 'studio_get_asset', arguments: { assetId: stored.body.asset.id } });
    assert.equal(read.isError, undefined, JSON.stringify(read));
    assert.equal(read.structuredContent.asset.sha256, sha256);
    assert.equal(read.structuredContent.asset.bytes, bytes.length);

    const replay = await put(env, uploadUrl, bytes);
    assert.equal(replay.response.status, 409);
    assert.equal(replay.body.error.code, 'upload_link_used');
    assert.equal(await assetCount(env), 1);

    const again = await begin(client, project.id, bytes, { filename: 'Fictional six megabyte song.wav' });
    const duplicate = await put(env, again.structuredContent.uploadUrl, bytes);
    assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body.upload.reused, true);
    assert.equal(duplicate.body.asset.id, stored.body.asset.id);
    assert.equal(await assetCount(env), 1);
  } finally {
    await client.close();
  }
});

test('an expired upload link is refused without reading or writing the file', async () => {
  const { env, project } = await setup();
  const client = await connect(env, await mintToken(env, project));
  try {
    const bytes = wav({ seconds: 1 });
    const begun = await begin(client, project.id, bytes);
    const linkId = new URL(begun.structuredContent.uploadUrl).pathname.split('/').pop();
    await env.DB.prepare('UPDATE asset_upload_links SET expires_at=?2 WHERE id=?1').bind(linkId, Date.now() - 1).run();
    const refused = await put(env, begun.structuredContent.uploadUrl, bytes);
    assert.equal(refused.response.status, 410);
    assert.equal(refused.body.error.code, 'upload_link_expired');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);
  } finally {
    await client.close();
  }
});

test('tampered bytes are refused for a hash mismatch and leave no row, object or consumed link', async () => {
  const { env, project } = await setup();
  const client = await connect(env, await mintToken(env, project));
  try {
    const bytes = wav({ seconds: 1 });
    const altered = bytes.slice();
    altered[altered.length - 1] ^= 0xff;
    const begun = await begin(client, project.id, bytes);
    const refused = await put(env, begun.structuredContent.uploadUrl, altered);
    assert.equal(refused.response.status, 422);
    assert.equal(refused.body.error.code, 'hash_mismatch');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);
    const linkId = new URL(begun.structuredContent.uploadUrl).pathname.split('/').pop();
    const link = await env.DB.prepare('SELECT consumed_at,asset_id FROM asset_upload_links WHERE id=?1').bind(linkId).first();
    assert.equal(link.consumed_at, null);
    assert.equal(link.asset_id, null);

    // The link was not burned: the exact bytes still upload once.
    const accepted = await put(env, begun.structuredContent.uploadUrl, bytes);
    assert.equal(accepted.response.status, 201, JSON.stringify(accepted.body));
    assert.equal(await assetCount(env), 1);
  } finally {
    await client.close();
  }
});

test('upload links are bound to their project, signature and agent connection', async () => {
  const { env, project } = await setup();
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other studio','other','','private','{}',1,1)",
  ).run();
  const token = await mintToken(env, project);
  const client = await connect(env, token);
  try {
    const bytes = wav({ seconds: 1 });
    const begun = await begin(client, project.id, bytes);
    const uploadUrl = begun.structuredContent.uploadUrl;

    const wrongProject = new URL(uploadUrl);
    wrongProject.searchParams.set('p', 'prj_other');
    const projectRefusal = await put(env, wrongProject.href, bytes);
    assert.equal(projectRefusal.response.status, 403);
    assert.equal(projectRefusal.body.error.code, 'upload_project_mismatch');
    assert.equal(await assetCount(env), 0);

    const tampered = new URL(uploadUrl);
    const signature = tampered.searchParams.get('s');
    tampered.searchParams.set('s', (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1));
    const signatureRefusal = await put(env, tampered.href, bytes);
    assert.equal(signatureRefusal.response.status, 403);
    assert.equal(signatureRefusal.body.error.code, 'upload_link_invalid');
    assert.equal(await assetCount(env), 0);

    const unknown = await put(
      env,
      `${base}/upload/assets/upl_${'0'.repeat(32)}?p=${project.id}&e=${Date.now() + 60000}&s=${'a'.repeat(64)}`,
      bytes,
    );
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.error.code, 'upload_link_unknown');

    const wrongArgs = await client.callTool({
      name: 'studio_begin_asset_upload',
      arguments: { projectId: 'prj_other', filename: 'Elsewhere.wav', contentType: 'audio/wav', bytes: bytes.length, sha256: await sha256Hex(bytes) },
    });
    assert.equal(toolError(wrongArgs).code, 'upload_project_mismatch');
    const owner = 'studio_session=' + await createSession(env);
    const noConnection = await call(env, `/api/projects/${project.id}/assets/upload-link`, {
      method: 'POST',
      headers: { cookie: owner, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'Browser.wav', contentType: 'audio/wav', bytes: bytes.length, sha256: await sha256Hex(bytes) }),
    });
    assert.equal(noConnection.status, 403);
    assert.equal((await noConnection.json()).error.code, 'agent_connection_required');

    // Revoking the connection after begin makes the link useless.
    const grant = await env.DB.prepare('SELECT id FROM mcp_tokens ORDER BY rowid DESC LIMIT 1').first();
    await env.DB.prepare('UPDATE mcp_tokens SET revoked_at=?2 WHERE id=?1').bind(grant.id, Date.now()).run();
    const revoked = await put(env, uploadUrl, bytes);
    assert.equal(revoked.response.status, 403);
    assert.equal(revoked.body.error.code, 'connection_revoked');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);
  } finally {
    await client.close();
  }
});

test('a read-only grant cannot begin an upload and a non-media body is refused', async () => {
  const { env, project } = await setup();
  const reader = await connect(env, await mintToken(env, project, 'studio.read'));
  const editor = await connect(env, await mintToken(env, project, 'studio.read studio.edit'));
  try {
    const bytes = wav({ seconds: 1 });
    const denied = await begin(reader, project.id, bytes);
    assert.equal(toolError(denied).code, 'forbidden');
    assert.equal(Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM asset_upload_links').first()).n), 0);

    const text = new TextEncoder().encode('fictional notes');
    const begun = await begin(editor, project.id, text, { filename: 'notes.txt', contentType: 'text/plain' });
    assert.equal(begun.isError, undefined, JSON.stringify(begun));
    const refused = await put(env, begun.structuredContent.uploadUrl, text);
    assert.equal(refused.response.status, 415);
    assert.equal(refused.body.error.code, 'unsupported_type');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);
  } finally {
    await reader.close();
    await editor.close();
  }
});

test('a revoked Composer edit grant refuses the PUT and leaves no asset', async (t) => {
  const { env, project } = await setup();
  const cookie = 'studio_session=' + await createSession(env, {
    mode: 'bridge',
    actor: 'fictional-member',
    workspace: 'fictional-team',
    project: project.id,
    projectClaimExplicit: true,
    actions: ['read', 'edit'],
  });
  const client = await connect(env, await mintToken(env, project, 'studio.read studio.edit', cookie));
  try {
    const bytes = wav({ seconds: 1 });
    const begun = await begin(client, project.id, bytes);
    assert.equal(begun.isError, undefined, JSON.stringify(begun));
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const claim = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, actor: claim.actor, workspace: claim.workspace, actions: ['read'], revision: claim.revision }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const refused = await put(env, begun.structuredContent.uploadUrl, bytes);
    assert.equal(refused.response.status, 403);
    assert.equal(refused.body.error.code, 'forbidden');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);
  } finally {
    await client.close();
  }
});

test('oversized declarations and bodies are refused before anything is stored', async () => {
  const { env, project } = await setup();
  const client = await connect(env, await mintToken(env, project));
  try {
    const tooBig = new Uint8Array(1);
    const declared = await client.callTool({
      name: 'studio_begin_asset_upload',
      arguments: { projectId: project.id, filename: 'Huge.wav', contentType: 'audio/wav', bytes: MAX_UPLOAD_LINK_BYTES + 1, sha256: await sha256Hex(tooBig) },
    });
    assert.equal(toolError(declared).code, 'too_large');
    assert.equal(Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM asset_upload_links').first()).n), 0);

    const small = new Uint8Array(10);
    const begun = await begin(client, project.id, small, { filename: 'Small.bin', contentType: 'application/octet-stream' });
    const oversizedBody = new Uint8Array(20);
    const refused = await put(env, begun.structuredContent.uploadUrl, oversizedBody);
    assert.equal(refused.response.status, 413);
    assert.equal(refused.body.error.code, 'too_large');
    assert.equal(await assetCount(env), 0);
    assert.equal(env.MEDIA.puts.length, 0);

    const short = await put(env, begun.structuredContent.uploadUrl, new Uint8Array(5));
    assert.equal(short.response.status, 400);
    assert.equal(short.body.error.code, 'size_mismatch');
    assert.equal(await assetCount(env), 0);
  } finally {
    await client.close();
  }
});
