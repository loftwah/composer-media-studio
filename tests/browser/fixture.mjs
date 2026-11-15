// Builds a fictional local Studio fixture in an isolated wrangler --persist-to
// directory. No production binding is touched: wrangler runs with --local.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const WORK = process.env.STUDIO_BROWSER_DIR ?? path.join(os.tmpdir(), 'studio-browser-fixture');
const PERSIST = path.join(WORK, 'persist');
const MEDIA = path.join(WORK, 'media');
const PORT = Number(process.env.FIXTURE_PORT ?? 8791);
const ORIGIN = `https://localhost:${PORT}`;
const PASSPHRASE = 'fictional-fixture-passphrase-148';
const SESSION_SECRET = 'f'.repeat(64);

const sh = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr?.slice(-800)}`);
  return result.stdout;
};

async function makeMedia() {
  await mkdir(MEDIA, { recursive: true });
  const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
  const refs = [
    ['ref-water.png', '#0d3b66', 'Fictional reference — water', '1111'],
    ['ref-path.png', '#5c4b51', 'Fictional reference — path', '2222'],
    ['ref-desk.png', '#8a5a2b', 'Fictional reference — desk', '3333'],
  ];
  for (const [name, colour, text, seed] of refs) {
    const file = path.join(MEDIA, name);
    if (!existsSync(file)) sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=960x540:d=1`, '-vf', `noise=alls=${Number(seed)%60+20}:allf=t+u,drawbox=x=40:y=40:w=880:h=460:color=white@0.5:t=4`, '-frames:v', '1', file]);
  }
  const takes = [
    ['take-1.mp4', 20, 440],
    ['take-2.mp4', 200, 660],
    ['take-3.mp4', 40, 550],
    ['take-4.mp4', 180, 330],
    ['take-5.mp4', 300, 495],
    ['take-6.mp4', 90, 220],
    ['take-alt-4.mp4', 350, 280],
  ];
  for (const [name, hue, freq] of takes) {
    const file = path.join(MEDIA, name);
    if (!existsSync(file)) {
      sh('ffmpeg', ['-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=5.6',
        '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=5.6`,
        '-vf', `hue=h=${hue}:s=1.4,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', file]);
    }
  }
  const song = path.join(MEDIA, 'song.wav');
  if (!existsSync(song)) {
    sh('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=40',
      '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=40',
      '-filter_complex', '[0:a][1:a]amerge=inputs=2,volume=0.12,aformat=channel_layouts=stereo[a]',
      '-map', '[a]', '-c:a', 'pcm_s16le', song]);
  }
  return { refs: refs.map(r => path.join(MEDIA, r[0])), takes: takes.map(t => path.join(MEDIA, t[0])), song };
}

async function startServer() {
  const log = path.join(WORK, 'wrangler.log');
  const out = (await import('node:fs')).createWriteStream(log, { flags: 'w' });
  const child = spawn('npx', ['wrangler', 'dev', '--local', '--persist-to', PERSIST, '--port', String(PORT),
    '--infer-origin-from-routes', 'false', '--local-protocol', 'https',
    '--var', `OWNER_PASSPHRASE:${PASSPHRASE}`,
    '--var', `SESSION_SECRET:${SESSION_SECRET}`,
    '--var', `PUBLIC_ORIGIN:${ORIGIN}`, '--var', 'DIRECTOR_FIXTURE:1',
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  child.stdout.pipe(out); child.stderr.pipe(out);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${ORIGIN}/healthz`); if (r.ok) return { child, log }; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not answer; see ${log}`);
}

let cookie = '';
async function api(pathname, { method = 'GET', body, form } = {}) {
  const headers = { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${ORIGIN}${pathname}`, { method, headers, body: payload });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { text }; }
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}
async function upload(projectId, file, title, caption = '') {
  const bytes = await readFile(file);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.png') ? 'image/png' : 'audio/wav' }), path.basename(file));
  form.set('title', title);
  if (caption) form.set('caption', caption);
  const data = await api(`/api/projects/${projectId}/assets`, { method: 'POST', form });
  return data.asset;
}

export async function ensureFixture() {
  const fixtureFile = path.join(WORK, 'fixture.json');
  if (existsSync(fixtureFile) && !process.env.REBUILD_FIXTURE) return JSON.parse(await readFile(fixtureFile, 'utf8'));
  const { refs, takes, song } = await makeMedia();
  if (!existsSync(path.join(PERSIST, 'v3'))) {
    sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'media-studio', '--local', '--persist-to', PERSIST]);
  }
  const { child, log } = await startServer();
  let fixture;
  try {
    await api('/api/login', { method: 'POST', body: { passphrase: PASSPHRASE } });
    const created = await api('/api/projects', { method: 'POST', body: { name: 'Fictional workbench fixture', creativeDirection: 'Fictional test data only.' } });
    const projectId = created.project.id;
    const images = [];
    for (const [i, file] of refs.entries()) images.push(await upload(projectId, file, ['Fictional water', 'Fictional path', 'Fictional desk'][i], 'Fictional fixture reference'));
    const clips = [];
    for (const [i, file] of takes.entries()) clips.push(await upload(projectId, file, `Fictional take ${i + 1}`));
    const audio = await upload(projectId, song, 'Fictional bed', 'Fictional fixture song');
    const long = 'Hold the wide frame with the horizon level while the practical light warms across the foreground, keeping the grain gentle and the movement almost imperceptible.';
    const brief = await api(`/api/projects/${projectId}/promo-briefs`, { method: 'POST', body: {
      title: 'Fictional six-scene promo', audience: 'Fictional studio owners reviewing a long brief', brief: long, cta: 'Open the fictional studio',
      aspect: '16:9', targetSeconds: 30,
      scenes: Array.from({ length: 6 }, (_, i) => ({ spoken: `Scene ${i + 1}. ${'These are deliberately long spoken words for the workbench check. '.repeat(3)}`, visual: `Scene ${i + 1}. ${long} ${long}` })),
    } });
    const plan = await api(`/api/projects/${projectId}/song-plans`, { method: 'POST', body: { songAssetId: audio.id, rightsConfirmed: true, title: 'Fictional six-scene film', aspect: '16:9', startMs: 0, endMs: 33000, sceneCount: 6 } });
    const scenes = plan.plan.scenes.map((scene, i) => ({ ...scene, direction: `Fictional direction ${i + 1}. ${long}`, referenceAssetId: images[i % images.length].id, selectedTakeId: clips[i % clips.length].id }));
    const updated = await api(`/api/projects/${projectId}/song-plans/${plan.plan.id}`, { method: 'PATCH', body: { ...plan.plan, expectedRevision: 1, scenes } });
    const captioned = await api(`/api/projects/${projectId}/song-plans/${plan.plan.id}/captions`, { method: 'PATCH', body: { expectedRevision: 2, rightsConfirmed: true, cues: [
      { id: 'cue_fixture_001', startMs: 500, endMs: 3000, text: 'A fictional room settles into light.', speaker: '' },
      { id: 'cue_fixture_002', startMs: 12000, endMs: 15000, text: 'The desk holds one warm line.', speaker: '' },
    ] } });
    fixture = { origin: ORIGIN, projectId, projectName: 'Fictional workbench fixture', passphrase: PASSPHRASE, images, clips, audio, brief: brief.brief, plan: captioned.plan, log };
    await writeFile(fixtureFile, JSON.stringify(fixture, null, 2));
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 800));
  }
  return fixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = await ensureFixture();
  console.log(JSON.stringify({ origin: fixture.origin, projectId: fixture.projectId, brief: fixture.brief.id, plan: fixture.plan.id, revision: fixture.plan.revision, log: fixture.log }, null, 2));
}
