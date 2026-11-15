import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';

const WORK = process.env.STUDIO_BROWSER_DIR ?? path.join(os.tmpdir(), 'studio-browser-fixture');
const PERSIST = path.join(WORK, 'persist');
const PORT = Number(process.env.FIXTURE_PORT ?? 8791);
export const ORIGIN = `https://localhost:${PORT}`;
// The local wrangler certificate is self-signed; this only affects the fixture process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Set STUDIO_AI_REMOTE=1 to exercise the real Workers AI binding. That writes a
// temporary local-only config with a remote AI binding (all other bindings stay
// local) and removes it when the server stops. It never deploys the Studio.
export async function serve({ aiRemote = process.env.STUDIO_AI_REMOTE === '1' } = {}) {
  await mkdir(PERSIST, { recursive: true });
  const fixture = JSON.parse(await readFile(path.join(WORK, 'fixture.json'), 'utf8'));
  const log = createWriteStream(path.join(WORK, 'wrangler-run.log'), { flags: 'w' });
  let config = null;
  if (aiRemote) {
    const source = await readFile(path.join(process.cwd(), 'wrangler.jsonc'), 'utf8');
    config = path.join(process.cwd(), 'wrangler.fixture.jsonc');
    await writeFile(config, '// Temporary local fixture: real Workers AI, every other binding local.\n' + source.replace('"ai": {\n    "binding": "AI"\n  },', '"ai": {\n    "binding": "AI",\n    "remote": true\n  },'));
  }
  const args = config ? ['-c', 'wrangler.fixture.jsonc'] : ['--local'];
  const child = spawn('npx', ['wrangler', 'dev', ...args, '--persist-to', PERSIST, '--port', String(PORT),
    '--infer-origin-from-routes', 'false', '--local-protocol', 'https',
    '--var', 'OWNER_PASSPHRASE:fictional-fixture-passphrase-148',
    '--var', `SESSION_SECRET:${'f'.repeat(64)}`,
    '--var', `PUBLIC_ORIGIN:${ORIGIN}`,
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  child.stdout.pipe(log); child.stderr.pipe(log);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${ORIGIN}/healthz`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return { child, fixture, stop: async () => { child.kill('SIGTERM'); await new Promise(r => setTimeout(r, 700)); if (config) await rm(config, { force: true }); } };
}

export async function login(context) {
  const response = await fetch(`${ORIGIN}/api/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'fictional-fixture-passphrase-148' }) });
  if (!response.ok) throw new Error(`login ${response.status} ${await response.text()}`);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const value = setCookie.split(';')[0].split('=').slice(1).join('=');
  if (!value) throw new Error('login did not set a session cookie');
  await context.addCookies([{ name: 'studio_session', value, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

export async function api(context, pathname, { method = 'GET', data } = {}) {
  const response = await context.request.fetch(`${ORIGIN}${pathname}`, { method, data, headers: { origin: ORIGIN } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${method} ${pathname} -> ${response.status()} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

export async function loadPlaywright() {
  const modulePath = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
  return import(modulePath);
}
