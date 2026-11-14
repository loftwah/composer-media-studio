// MIT. Narrow OAuth 2.1 authorization-code/PKCE flow for Studio MCP read access.
import { readSession, verifyComposerGrant, can } from '../lib/auth.mjs';
import { escapeHtml, id, json, now, sha256Hex, slug } from '../lib/util.mjs';

const TOKEN_LIFETIME = 30 * 60 * 1000;
const CODE_LIFETIME = 2 * 60 * 1000;
const SCOPE_ACTIONS = { 'studio.read': 'read', 'studio.edit': 'edit', 'studio.generate': 'generate', 'studio.publish': 'publish' };
const hash = (s) => sha256Hex(new TextEncoder().encode(s));
async function registrationKey(secret, address) {
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).length < 32) throw new Error('Studio session secret is not configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('mcp-registration:' + address));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Remove only expired short-lived authorization metadata. Clients unused for
 * 90 days are removed after their final live authorization code and token. */
export async function pruneMcpRecords(env, timestamp = now()) {
  await env.DB.prepare('DELETE FROM mcp_registration_limits WHERE reset_at<=?1').bind(timestamp).run();
  await env.DB.prepare('DELETE FROM mcp_codes WHERE expires_at<=?1').bind(timestamp).run();
  await env.DB.prepare('DELETE FROM mcp_tokens WHERE expires_at<=?1').bind(timestamp).run();
  await env.DB.prepare('DELETE FROM mcp_spend_reservations WHERE NOT EXISTS (SELECT 1 FROM mcp_tokens WHERE id=mcp_spend_reservations.token_id)').run();
  await env.DB.prepare('DELETE FROM mcp_clients WHERE created_at<?1 AND NOT EXISTS (SELECT 1 FROM mcp_codes WHERE client_id=mcp_clients.id) AND NOT EXISTS (SELECT 1 FROM mcp_tokens WHERE client_id=mcp_clients.id)').bind(timestamp - 90 * 24 * 60 * 60 * 1000).run();
}
const invalid = (error, description, status = 400) => json({ error, error_description: description }, status);
const content = (body, status = 200, callbackOrigin = null) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Media Studio connection</title><link rel="stylesheet" href="/studio.css"><body><main>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...(callbackOrigin ? { 'x-studio-internal-callback-origin': callbackOrigin } : {}) } });

function publicOrigin(env, request) {
  const configured = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  try {
    const parsed = new URL(configured);
    if ((parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch { return null; }
}
function resource(env, request) { const origin = publicOrigin(env, request); return origin ? origin + '/mcp' : null; }
function loopback(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && !!parsed.port && !parsed.username && !parsed.password && !parsed.hash;
  } catch { return false; }
}
async function readSmall(request, max = 8192) {
  if (Number(request.headers.get('content-length') || 0) > max) throw Error('too large');
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw Error('too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function clientRow(env, clientId) {
  if (!/^mcp_[a-z0-9]{1,80}$/.test(clientId || '')) return null;
  return env.DB.prepare('SELECT * FROM mcp_clients WHERE id=?1').bind(clientId).first();
}
async function requestParams(env, request, params) {
  const client = await clientRow(env, params.get('client_id'));
  const redirect = params.get('redirect_uri') || '';
  const aud = resource(env, request);
  if (!client || !JSON.parse(client.redirect_uris_json).includes(redirect)) return null;
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') || '')) return null;
  const scopes = [...new Set((params.get('scope') || 'studio.read').trim().split(/\s+/))];
  if (params.get('resource') !== aud || !scopes.includes('studio.read') || !scopes.every(scope => SCOPE_ACTIONS[scope])) return null;
  const state = params.get('state') || '';
  if (state.length > 512) return null;
  return { client, redirect, aud, state, scopes, challenge: params.get('code_challenge') };
}
async function projectAllowed(env, session, project, scopes = ['studio.read']) {
  if (!session || !scopes.every(scope => can(session, SCOPE_ACTIONS[scope]))) return false;
  // A null bridge project is the existing workspace-wide Studio grant. The
  // issued MCP token below is still bound to the one project selected here.
  if (session.mode !== 'owner' && !(session.project === project || (session.project === null && session.projectClaimExplicit === true))) return false;
  const row = await env.DB.prepare('SELECT id FROM projects WHERE id=?1').bind(project).first();
  if (!row) return false;
  if (session.mode !== 'owner') for (const scope of scopes) await verifyComposerGrant(env, session, SCOPE_ACTIONS[scope]);
  return true;
}
function issuer(session) {
  return { mode: session.mode, actor: session.actor, workspace: session.workspace, project: session.project, projectClaimExplicit: session.projectClaimExplicit === true, revision: session.revision, actions: session.actions };
}
function sameIssuer(a, b) { return a.mode === b.mode && a.actor === b.actor && a.workspace === b.workspace && (a.mode === 'owner' || a.project === b.project); }
function challengeDigest(verifier) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''));
}
function consentFields(params) {
  return ['client_id','redirect_uri','response_type','code_challenge','code_challenge_method','resource','scope','state'].map(k => `<input type="hidden" name="${k}" value="${escapeHtml(params.get(k) || '')}">`).join('');
}
function spendCap(value) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value || '');
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 && cents <= 10000 ? cents * 10000 : null;
}

/** One atomic SQLite admission per client request, against the cap entered by
 * the consenting owner. A retry may reuse only the exact same request and cost.
 * Reservations are deliberately retained after errors or ambiguous dispatch. */
export async function reserveMcpSpend(env, tokenId, requestId, fingerprint, estimateMicro) {
  if (!Number.isSafeInteger(estimateMicro) || estimateMicro < 0) return false;
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO mcp_spend_reservations(token_id,request_id,fingerprint,estimate_micro,created_at)
    SELECT id,?2,?3,?4,?5 FROM mcp_tokens
    WHERE id=?1 AND revoked_at IS NULL AND expires_at>?5 AND instr(' ' || scopes || ' ',' studio.generate ')>0
      AND COALESCE((SELECT SUM(estimate_micro) FROM mcp_spend_reservations WHERE token_id=?1),0)+?4<=spend_cap_micro
    ON CONFLICT(token_id,request_id) DO NOTHING`).bind(tokenId, requestId, fingerprint, estimateMicro, timestamp).run();
  const row = await env.DB.prepare("SELECT s.fingerprint,s.estimate_micro FROM mcp_spend_reservations s JOIN mcp_tokens t ON t.id=s.token_id WHERE s.token_id=?1 AND s.request_id=?2 AND t.revoked_at IS NULL AND t.expires_at>?3 AND instr(' ' || t.scopes || ' ',' studio.generate ')>0").bind(tokenId, requestId, timestamp).first();
  return Boolean(row && row.fingerprint === fingerprint && row.estimate_micro === estimateMicro);
}

export async function oauthRoute(request, env, url) {
  const origin = publicOrigin(env, request);
  const aud = resource(env, request);
  if (!origin) return invalid('server_error', 'Studio public origin is not configured.', 503);
  const path = url.pathname;
  if (path === '/.well-known/oauth-protected-resource/mcp' && request.method === 'GET') return json({ resource: aud, authorization_servers: [origin], scopes_supported: Object.keys(SCOPE_ACTIONS), bearer_methods_supported: ['header'] });
  if (path === '/.well-known/oauth-authorization-server' && request.method === 'GET') return json({ issuer: origin, authorization_endpoint: origin + '/mcp/authorize', token_endpoint: origin + '/mcp/token', registration_endpoint: origin + '/mcp/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: Object.keys(SCOPE_ACTIONS) });
  if (path === '/mcp/register' && request.method === 'POST') {
    const timestamp = now();
    const ipHash = await registrationKey(env.SESSION_SECRET, (request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64));
    await env.DB.prepare('INSERT INTO mcp_registration_limits(ip_hash,count,reset_at) VALUES(?1,1,?2) ON CONFLICT(ip_hash) DO UPDATE SET count=CASE WHEN reset_at<=?3 THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=?3 THEN ?2 ELSE reset_at END').bind(ipHash, timestamp + 3600000, timestamp).run();
    const limit = await env.DB.prepare('SELECT count FROM mcp_registration_limits WHERE ip_hash=?1').bind(ipHash).first();
    if (limit.count > 20) return invalid('slow_down', 'Too many client registrations. Try later.', 429);
    let input;
    try { input = JSON.parse(await readSmall(request)); } catch { return invalid('invalid_client_metadata', 'Send bounded client metadata.'); }
    const uris = input?.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(u => typeof u === 'string' && u.length <= 512 && loopback(u))) return invalid('invalid_redirect_uri', 'Register only explicit loopback HTTP callback URLs.');
    if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') return invalid('invalid_client_metadata', 'Only public PKCE clients are supported.');
    const name = typeof input.client_name === 'string' ? input.client_name.trim().slice(0, 80) : 'MCP client';
    const clientId = id('mcp');
    await env.DB.prepare('INSERT INTO mcp_clients(id,name,redirect_uris_json,created_at) VALUES(?1,?2,?3,?4)').bind(clientId, name || 'MCP client', JSON.stringify(uris), now()).run();
    return json({ client_id: clientId, client_name: name || 'MCP client', redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }, 201);
  }
  if (path === '/mcp/authorize' && (request.method === 'GET' || request.method === 'POST')) {
    const session = await readSession(env, request);
    if (!session || !can(session, 'read')) return content('<h1>Sign in to Media Studio</h1><p>Open Media Studio from App Composer, then restart this connection from your agent.</p><a href="/">Open Media Studio</a>', 401);
    let params;
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== origin) return invalid('access_denied', 'The consent request must come from this Studio.', 403);
      try { params = new URLSearchParams(await readSmall(request)); } catch { return invalid('invalid_request', 'Invalid consent request.'); }
    } else params = url.searchParams;
    const valid = await requestParams(env, request, params);
    if (!valid) return content('<h1>Connection request is invalid</h1><p>Return to your agent and start the connection again.</p>', 400);
    if (request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id,name FROM projects ORDER BY updated_at DESC').all();
      const projects = session.mode === 'owner' || (session.project === null && session.projectClaimExplicit === true) ? rows.results : rows.results.filter(p => p.id === session.project);
      if (!valid.scopes.every(scope => can(session, SCOPE_ACTIONS[scope]))) return content('<h1>Permission unavailable</h1><p>Your current Studio access does not include every requested action.</p>', 403);
      if (session.mode !== 'owner') for (const scope of valid.scopes) await verifyComposerGrant(env, session, SCOPE_ACTIONS[scope]);
      if (session.mode !== 'owner' && session.project === null && session.projectClaimExplicit !== true) {
        let reentry = '';
        try { const url = new URL(env.COMPOSER_ORIGIN); if (url.protocol === 'https:' && !url.username && !url.password) reentry = `<p><a href="${escapeHtml(url.origin + '/media-studio/studio')}">Reopen Studio from App Composer</a></p>`; } catch {}
        return content(`<h1>Reopen Media Studio</h1><p>Open Studio from App Composer, then restart this connection to choose a project.</p>${reentry}`, 403);
      }
      const options = projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
      const permissions = valid.scopes.map(scope => ({ 'studio.read': 'Read project records, prompts, captions, assets and exports', 'studio.edit': 'Edit project settings and save compositions or imports', 'studio.generate': 'Make paid generation requests within the spending limit you set below', 'studio.publish': 'Publish and withdraw project media without further Studio approval' })[scope]);
      const capField = valid.scopes.includes('studio.generate') ? '<label>Maximum estimated spend for this connection (US dollars) <input name="spend_cap_usd" type="number" min="0.01" max="100" step="0.01" required></label><p>The agent may make multiple requests up to this limit without another Studio approval. Provider charges may differ from estimates; the project allowance also applies. This connection expires after 30 minutes.</p>' : '';
      return content(`<h1>Connect an agent</h1><p><strong>${escapeHtml(valid.client.name)}</strong> requests access to one Studio project. The client supplies its own name; check that you recognise the request in your agent.</p><ul>${permissions.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul><form method="post" action="/mcp/authorize">${consentFields(params)}<label>Project <select name="project" required><option value="">Choose a project</option>${options}</select></label>${capField}<div class="row"><button type="submit" name="decision" value="allow">Allow requested access</button><button type="submit" class="secondary" name="decision" value="deny" formnovalidate>Cancel</button></div></form><p><a href="/mcp/connections">Manage existing connections</a></p>`, 200, new URL(valid.redirect).origin);
    }
    const redirect = new URL(valid.redirect);
    if (valid.state) redirect.searchParams.set('state', valid.state);
    if (params.get('decision') !== 'allow') { redirect.searchParams.set('error', 'access_denied'); return Response.redirect(redirect, 303); }
    const project = params.get('project') || '';
    if (!await projectAllowed(env, session, project, valid.scopes)) return content('<h1>Project access changed</h1><p>Reopen the Studio and start the connection again.</p>', 403);
    const cap = valid.scopes.includes('studio.generate') ? spendCap(params.get('spend_cap_usd')) : 0;
    if (cap === null) return content('<h1>Spending limit required</h1><p>Enter a limit between US$0.01 and US$100.00 and restart the connection.</p>', 400);
    const code = slug(32);
    await env.DB.prepare('INSERT INTO mcp_codes(hash,client_id,redirect_uri,challenge,resource,project_id,issuer_json,scopes,spend_cap_micro,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(await hash(code), valid.client.id, valid.redirect, valid.challenge, valid.aud, project, JSON.stringify(issuer(session)), valid.scopes.join(' '), cap, now() + CODE_LIFETIME).run();
    redirect.searchParams.set('code', code);
    return Response.redirect(redirect, 303);
  }
  if (path === '/mcp/token' && request.method === 'POST') {
    let input;
    try { input = new URLSearchParams(await readSmall(request)); } catch { return invalid('invalid_request', 'Invalid token request.'); }
    if (input.get('grant_type') !== 'authorization_code') return invalid('unsupported_grant_type', 'Use authorization_code.');
    const verifier = input.get('code_verifier') || '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return invalid('invalid_grant', 'Invalid authorization.');
    const row = await env.DB.prepare('SELECT * FROM mcp_codes WHERE hash=?1').bind(await hash(input.get('code') || '')).first();
    if (!row || row.used_at || row.expires_at <= now() || row.client_id !== input.get('client_id') || row.redirect_uri !== input.get('redirect_uri') || row.resource !== input.get('resource') || row.resource !== aud || row.challenge !== await challengeDigest(verifier)) return invalid('invalid_grant', 'Invalid or expired authorization.');
    const claimed = await env.DB.prepare('UPDATE mcp_codes SET used_at=?2 WHERE hash=?1 AND used_at IS NULL AND expires_at>?2').bind(row.hash, now()).run();
    if (!claimed.meta?.changes && !claimed.changes) return invalid('invalid_grant', 'Authorization already used.');
    const original = JSON.parse(row.issuer_json);
    const scopes = row.scopes.split(' ');
    if (!await projectAllowed(env, original, row.project_id, scopes)) return invalid('invalid_grant', 'Project access is no longer available.');
    const token = slug(32), timestamp = now(), tokenId = id('mcpt');
    await env.DB.prepare('INSERT INTO mcp_tokens(hash,id,client_id,resource,project_id,issuer_json,scopes,spend_cap_micro,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(await hash(token), tokenId, row.client_id, aud, row.project_id, row.issuer_json, row.scopes, row.spend_cap_micro, timestamp, timestamp + TOKEN_LIFETIME).run();
    await env.DB.prepare('UPDATE mcp_clients SET created_at=?2 WHERE id=?1').bind(row.client_id, timestamp).run();
    return json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_LIFETIME / 1000, scope: row.scopes });
  }
  if (path === '/mcp/connections' && (request.method === 'GET' || request.method === 'POST')) {
    const session = await readSession(env, request);
    if (!session || !can(session, 'read')) return content('<h1>Sign in to manage connections</h1><a href="/">Open Media Studio</a>', 401);
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== origin) return invalid('access_denied', 'The request must come from this Studio.', 403);
      let params; try { params = new URLSearchParams(await readSmall(request)); } catch { return invalid('invalid_request', 'Invalid request.'); }
      const token = await env.DB.prepare('SELECT * FROM mcp_tokens WHERE id=?1').bind(params.get('id') || '').first();
      if (!token || !sameIssuer(issuer(session), JSON.parse(token.issuer_json))) return content('<h1>Connection not found</h1>', 404);
      await env.DB.prepare('UPDATE mcp_tokens SET revoked_at=?2 WHERE id=?1 AND revoked_at IS NULL').bind(token.id, now()).run();
      return Response.redirect(origin + '/mcp/connections', 303);
    }
    const rows = await env.DB.prepare('SELECT t.*, c.name AS client_name, p.name AS project_name FROM mcp_tokens t JOIN mcp_clients c ON c.id=t.client_id JOIN projects p ON p.id=t.project_id WHERE t.revoked_at IS NULL AND t.expires_at>?1 ORDER BY t.created_at DESC').bind(now()).all();
    const list = rows.results.filter(row => sameIssuer(issuer(session), JSON.parse(row.issuer_json))).map(row => `<li>${escapeHtml(row.client_name)} · ${escapeHtml(row.project_name)} · ${escapeHtml(row.scopes)}${row.spend_cap_micro ? ` · US$${(row.spend_cap_micro / 1000000).toFixed(2)} estimated spending limit` : ''} <form method="post" action="/mcp/connections"><input type="hidden" name="id" value="${escapeHtml(row.id)}"><button class="secondary" type="submit">Disconnect</button></form></li>`).join('');
    return content(`<h1>Agent connections</h1><p>Connections expire after 30 minutes. Disconnect one to stop its next request.</p>${list ? `<ul>${list}</ul>` : '<p>No active connections.</p>'}<a href="/">Back to Studio</a>`);
  }
  return null;
}

export async function authorizeMcp(request, env) {
  const aud = resource(env, request);
  const authorization = request.headers.get('authorization') || '';
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  if (!token || !aud) return null;
  const row = await env.DB.prepare('SELECT * FROM mcp_tokens WHERE hash=?1 AND resource=?2 AND revoked_at IS NULL AND expires_at>?3').bind(await hash(token), aud, now()).first();
  if (!row) return null;
  const original = JSON.parse(row.issuer_json);
  const scopes = row.scopes.split(' ');
  if (!scopes.every(scope => SCOPE_ACTIONS[scope]) || !await projectAllowed(env, original, row.project_id, scopes)) return null;
  return { mode: 'agent', actor: original.actor, workspace: original.workspace, project: row.project_id, agentTokenId: row.id, actions: scopes.map(scope => SCOPE_ACTIONS[scope]) };
}
