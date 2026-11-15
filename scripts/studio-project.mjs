#!/usr/bin/env node
// MIT. Owner CLI for portable Studio projects. It talks only to the studio's
// existing authenticated API; it never imports a separate backend, reads
// provider keys or writes D1/R2 directly.
//
//   node scripts/studio-project.mjs export  --studio URL --project prj_... --out project.studio [--confirm]
//   node scripts/studio-project.mjs inspect --bundle project.studio
//   node scripts/studio-project.mjs import  --studio URL --bundle project.studio [--dry-run|--confirm]
//   node scripts/studio-project.mjs inventory --studio URL [--project prj_...]
//   node scripts/studio-project.mjs cleanup --studio URL --import-id imp_... --confirm
//
// Authentication: STUDIO_PASSPHRASE, or STUDIO_SESSION_COOKIE, or --cookie.
// `export` is a read, but refuses without --confirm because it writes a private
// archive to disk and is the first step of an owner handoff.

import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MAX_PORTABLE_ASSET_BYTES,
  canonicalJson,
  decodePortableBundle,
  describeBundle,
  encodePortableBundle,
  validateManifest,
} from '../src/lib/portable-bundle.mjs';
import { sniffMedia } from '../src/lib/util.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) { args._.push(item); continue; }
    const [key, inline] = item.slice(2).split('=', 2);
    if (inline !== undefined) { args[key] = inline; continue; }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { args[key] = next; index += 1; } else args[key] = true;
  }
  return args;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(message, details = null) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

class StudioClient {
  constructor({ studio, cookie = null, passphrase = null, quiet = false }) {
    this.studio = String(studio ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(this.studio)) fail('Pass --studio with the owner-controlled Studio origin (http or https).');
    this.cookie = cookie;
    this.passphrase = passphrase;
    this.quiet = quiet;
  }
  log(message) { if (!this.quiet) process.stderr.write(`${message}\n`); }
  async signIn() {
    if (this.cookie) return;
    if (!this.passphrase) fail('Set STUDIO_PASSPHRASE, STUDIO_SESSION_COOKIE or --cookie. No session was created.');
    const response = await fetch(`${this.studio}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: this.passphrase }),
    });
    if (!response.ok) fail(`Studio sign-in failed (${response.status}). ${await response.text()}`);
    const set = response.headers.getSetCookie?.() ?? [];
    const raw = set[0] ?? response.headers.get('set-cookie');
    if (!raw) fail('Studio signed in but returned no session cookie.');
    this.cookie = raw.split(';', 1)[0];
  }
  async request(path, { method = 'GET', json = undefined, raw = undefined, contentType = 'application/json', binary = false } = {}) {
    await this.signIn();
    const headers = { cookie: this.cookie };
    if (json !== undefined) headers['content-type'] = 'application/json';
    if (raw !== undefined) headers['content-type'] = contentType;
    const response = await fetch(`${this.studio}${path}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : raw,
      redirect: 'manual',
    });
    if (binary && response.ok) return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 400) }; }
    if (!response.ok) {
      const code = payload?.error?.code ?? `http_${response.status}`;
      const message = payload?.error?.message ?? `Studio returned ${response.status}.`;
      const error = new Error(`${message} (${code})`);
      error.code = code;
      error.report = payload?.report ?? payload;
      throw error;
    }
    return payload;
  }
}

async function cmdExport(args) {
  const client = new StudioClient({ studio: args.studio, passphrase: process.env.STUDIO_PASSPHRASE, cookie: args.cookie ?? process.env.STUDIO_SESSION_COOKIE, quiet: args.quiet === true });
  if (!args.project) fail('Pass --project prj_... from your Studio project URL.');
  if (!args.out) fail('Pass --out /path/to/project.studio.');
  if (args.confirm !== true) fail('Export writes a private archive. Re-run with --confirm after choosing an owner-controlled destination.');
  const manifest = await client.request(`/api/projects/${encodeURIComponent(args.project)}/portable-export`);
  await validateManifest(manifest);
  const blobAsset = new Map();
  for (const asset of manifest.assets) if (asset.content === 'media') blobAsset.set(asset.blobSha256, asset.id);
  const blobs = new Map();
  let index = 0;
  for (const blob of manifest.blobs) {
    index += 1;
    const assetId = blobAsset.get(blob.sha256);
    if (!assetId) fail(`Manifest lists media ${blob.sha256} with no source asset.`);
    client.log(`[${index}/${manifest.blobs.length}] downloading ${blob.bytes} bytes (${blob.mime})`);
    const { bytes } = await client.request(`/api/assets/${encodeURIComponent(assetId)}/download`, { binary: true });
    if (bytes.byteLength !== blob.bytes) fail(`Downloaded media ${assetId} has ${bytes.byteLength} bytes; expected ${blob.bytes}.`);
    if (sha256(bytes) !== blob.sha256) fail(`Downloaded media ${assetId} does not match its saved SHA-256. Nothing was written.`);
    if (sniffMedia(bytes, blob.mime).mime !== blob.mime) fail(`Downloaded media ${assetId} is not the declared ${blob.mime}. Nothing was written.`);
    blobs.set(blob.sha256, bytes);
  }
  const archive = await encodePortableBundle(manifest, blobs);
  const out = resolve(args.out);
  await writeFile(out, archive, { mode: 0o600, flag: args.force === true ? 'w' : 'wx' }).catch((error) => {
    if (error.code === 'EEXIST') fail(`Refusing to overwrite ${out}. Choose another --out or pass --force.`);
    throw error;
  });
  await chmod(out, 0o600);
  const archiveHash = sha256(archive);
  report(args, {
    status: 'exported', file: out, bytes: archive.byteLength, archiveSha256: archiveHash,
    bundleId: manifest.bundleId, project: manifest.project.id, stats: manifest.stats,
    notes: ['The archive is private. Provider keys and session cookies are not included.', 'Keep the archive owner-controlled; publication history is metadata, not a public URL.'],
  });
}

async function cmdInspect(args) {
  if (!args.bundle) fail('Pass --bundle /path/to/project.studio.');
  const bytes = await readFile(resolve(args.bundle));
  const { manifest, validated } = await decodePortableBundle(bytes);
  report(args, { status: 'verified', file: resolve(args.bundle), archiveSha256: sha256(bytes), validated, ...describeBundle(manifest) });
}

async function cmdImport(args) {
  const client = new StudioClient({ studio: args.studio, passphrase: process.env.STUDIO_PASSPHRASE, cookie: args.cookie ?? process.env.STUDIO_SESSION_COOKIE, quiet: args.quiet === true });
  if (!args.bundle) fail('Pass --bundle /path/to/project.studio.');
  const bytes = await readFile(resolve(args.bundle));
  const { manifest, blobs } = await decodePortableBundle(bytes);
  if (args['dry-run'] === true || args.confirm !== true) {
    const preview = await client.request('/api/studio/restore/preview', { method: 'POST', json: { manifest } });
    report(args, { status: preview.status === 'already_imported' ? 'already_imported' : 'dry_run', archiveSha256: sha256(bytes), preview, writes: 0 });
    if (preview.status === 'already_imported') return;
    if (args.confirm !== true) client.log('Dry run only. Nothing was written. Re-run with --confirm to restore.');
    return;
  }
  const started = await client.request('/api/studio/restore', { method: 'POST', json: { manifest } });
  if (started.status === 'already_imported') { report(args, { status: 'already_imported', projectId: started.projectId, importId: null, writes: 0 }); return; }
  client.log(`Restore ${started.importId} staged for project ${started.projectId}.`);
  for (const [index, entry] of started.assets.entries()) {
    const source = manifest.assets.find((asset) => asset.id === entry.sourceId);
    const payload = blobs.get(source.blobSha256);
    if (!payload) fail(`The archive has no bytes for ${entry.sourceId}.`);
    client.log(`[${index + 1}/${started.assets.length}] staging ${entry.title || entry.sourceId} (${entry.bytes} bytes)`);
    await client.request(`/api/studio/restore/${encodeURIComponent(started.importId)}/assets/${encodeURIComponent(entry.sourceId)}`, {
      method: 'POST', raw: payload, contentType: 'application/octet-stream',
    });
  }
  const committed = await client.request(`/api/studio/restore/${encodeURIComponent(started.importId)}/commit`, { method: 'POST', json: { confirm: true } });
  report(args, { ...committed, status: 'restored', archiveSha256: sha256(bytes), notes: ['Publications are withdrawn and unlisted; review and publish deliberately.', 'Provider jobs were not replayed and no budget was restored.'] });
}

async function cmdInventory(args) {
  const client = new StudioClient({ studio: args.studio, passphrase: process.env.STUDIO_PASSPHRASE, cookie: args.cookie ?? process.env.STUDIO_SESSION_COOKIE, quiet: args.quiet === true });
  const query = args.project ? `?projectId=${encodeURIComponent(args.project)}` : '';
  report(args, await client.request(`/api/studio/imports${query}`));
}

async function cmdCleanup(args) {
  if (!args['import-id']) fail('Pass --import-id imp_... from the inventory or a restore report.');
  if (args.confirm !== true) fail('Cleanup is opt-in. Re-run with --confirm; it only removes unreferenced staging objects from that restore.');
  const client = new StudioClient({ studio: args.studio, passphrase: process.env.STUDIO_PASSPHRASE, cookie: args.cookie ?? process.env.STUDIO_SESSION_COOKIE, quiet: args.quiet === true });
  report(args, await client.request(`/api/studio/restore/${encodeURIComponent(args['import-id'])}/cleanup`, { method: 'POST', json: { confirm: true } }));
}

function report(args, value) {
  if (args.json === true) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${canonicalJson(value)}\n`);
}

const usage = `Usage:
  node scripts/studio-project.mjs export    --studio URL --project prj_... --out FILE --confirm [--force]
  node scripts/studio-project.mjs inspect   --bundle FILE
  node scripts/studio-project.mjs import    --studio URL --bundle FILE [--dry-run | --confirm]
  node scripts/studio-project.mjs inventory --studio URL [--project prj_...]
  node scripts/studio-project.mjs cleanup   --studio URL --import-id imp_... --confirm

Auth: STUDIO_PASSPHRASE, STUDIO_SESSION_COOKIE or --cookie. Import/export never
send provider keys, session material or media to a third party. Each archive
entry is bounded to ${MAX_PORTABLE_ASSET_BYTES} bytes.`;

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'help';
try {
  if (command === 'export') await cmdExport(args);
  else if (command === 'inspect') await cmdInspect(args);
  else if (command === 'import' || command === 'restore') await cmdImport(args);
  else if (command === 'inventory') await cmdInventory(args);
  else if (command === 'cleanup') await cmdCleanup(args);
  else { process.stdout.write(`${usage}\n`); process.exitCode = command === 'help' ? 0 : 2; }
} catch (error) {
  process.stderr.write(`studio-project: ${error.message}\n`);
  if (error.report) process.stderr.write(`${JSON.stringify(error.report, null, 2)}\n`);
  process.exitCode = 1;
}
