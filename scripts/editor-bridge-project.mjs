#!/usr/bin/env node
// MIT. Local, read-only adapter from Studio's existing portable project bundle
// to the bounded FFmpeg editor probe. It uses the owning decoder and validator.
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  decodePortableBundle, MAX_PORTABLE_BUNDLE_BYTES, MAX_PORTABLE_MANIFEST_BYTES,
} from '../src/lib/portable-bundle.mjs';

const usage = `Prepare a local Studio project for the editor experiment.
  node scripts/editor-bridge-project.mjs --bundle project.studio --list
  node scripts/editor-bridge-project.mjs --bundle project.studio --composition cmp_id --out output/editor-inputs

The archive is verified with Studio's existing decoder. Only the selected
storyboard's source clips and saved mixed soundtrack are copied. No network,
provider job, upload or publication occurs. The output directory must be new.
The original composition record and archive identity are retained in source.json.
`;

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') { args.help = true; continue; }
    if (key === '--list') { args.list = true; continue; }
    if (!['--bundle', '--composition', '--out'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete option: ${key}`);
    }
    if (args[key.slice(2)] !== undefined) throw new Error(`Duplicate option: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  return args;
}

const extensions = new Map([
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['audio/wav', 'wav'],
  ['audio/mpeg', 'mp3'], ['audio/mp4', 'm4a'], ['audio/ogg', 'ogg'],
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage); return; }
  if (!args.bundle) throw new Error('Pass --bundle with a local .studio archive.');
  const bundlePath = resolve(args.bundle);
  const info = await stat(bundlePath);
  if (!info.isFile() || info.size > MAX_PORTABLE_BUNDLE_BYTES + MAX_PORTABLE_MANIFEST_BYTES + 1024) {
    throw new Error('The input is not a bounded Studio project archive.');
  }
  const bytes = await readFile(bundlePath);
  const { manifest, blobs } = await decodePortableBundle(bytes);
  const rows = manifest.compositions;
  if (args.list) {
    process.stdout.write(json({ projectId: manifest.project.id, compositions: rows.map((row) => ({
      id: row.id, title: row.title, shots: row.spec.shots?.length ?? 0,
      totalMs: row.spec.totalMs ?? null, mixedAudioAssetId: row.spec.audioAssetId ?? null,
    })) }));
    return;
  }
  if (!args.out) throw new Error('Pass --out with a new owner-controlled directory, or --list.');
  const row = args.composition ? rows.find((entry) => entry.id === args.composition) : rows.length === 1 ? rows[0] : null;
  if (!row) throw new Error('Select an existing composition ID from --list.');
  const composition = {
    ...row.spec, id: row.id, projectId: manifest.project.id, title: row.title,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
  if (!Array.isArray(composition.shots) || composition.shots.length < 2 || composition.shots.length > 6) {
    throw new Error('This experiment supports two to six saved video shots.');
  }
  if (composition.slateAssetId) throw new Error('Slate rendering is outside this probe; use a separate storyboard without a slate.');
  if ((composition.audioTracks?.length ?? 0) > 0 && !composition.audioAssetId) {
    throw new Error('Use Studio Mix soundtrack and save first; the probe requires the saved premix.');
  }
  const wanted = new Set(composition.shots.map((shot) => shot.assetId));
  if (composition.audioAssetId) wanted.add(composition.audioAssetId);
  const selected = [...wanted].map((assetId) => {
    const asset = manifest.assets.find((entry) => entry.id === assetId);
    if (!asset || asset.content !== 'media' || !blobs.has(asset.blobSha256)) {
      throw new Error(`The selected asset is missing, deleted or has no bytes: ${assetId}`);
    }
    const ext = extensions.get(asset.mime);
    if (!ext) throw new Error(`Unsupported selected media type: ${asset.mime}`);
    return { asset, ext, bytes: blobs.get(asset.blobSha256) };
  });
  const out = resolve(args.out);
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  // Exclusive ownership: never merge with or overwrite an existing directory.
  await mkdir(out, { mode: 0o700 });
  try {
    await mkdir(join(out, 'media'), { mode: 0o700 });
    const assets = {};
    const written = new Set();
    for (const { asset, ext, bytes: mediaBytes } of selected) {
      const path = `media/${asset.blobSha256}.${ext}`;
      if (!written.has(path)) {
        await writeFile(join(out, path), mediaBytes, { mode: 0o600, flag: 'wx' });
        written.add(path);
      }
      assets[asset.id] = { path, sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime, durationMs: asset.durationMs };
    }
    const files = {
      'composition.json': composition,
      'assets.json': assets,
      'source.json': {
        archiveSha256: sha256(bytes), bundleId: manifest.bundleId,
        projectId: manifest.project.id, compositionRecord: row,
        selectedAssets: selected.map(({ asset }) => asset),
        scope: 'Local extraction only; no native editor, generation or creative-quality claim.',
      },
    };
    for (const [name, value] of Object.entries(files)) await writeFile(join(out, name), json(value), { mode: 0o600, flag: 'wx' });
    process.stdout.write(json({ status: 'prepared', directory: out, compositionId: row.id, assets: selected.length, sourceArchiveUnchanged: true }));
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Editor project preparation failed: ${error.message}\n`);
  process.exitCode = 1;
});
