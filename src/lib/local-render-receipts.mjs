import { HttpError, id, now, safeJson } from './util.mjs';
import { shotRange } from '../../public/shot-trims.js';

const fail = (message, code = 'invalid_receipt') => { throw new HttpError(400, message, code); };
const conflict = () => { throw new HttpError(409, 'The saved storyboard or its sources changed. Reload before rendering.', 'revision_conflict'); };
const hashPattern = /^[a-f0-9]{64}$/i;

export async function createLocalRenderReceipt(env, project, compositionId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['expectedUpdatedAt','includeCaptions','framing'].includes(k)) || !Number.isSafeInteger(input.expectedUpdatedAt) || typeof input.includeCaptions !== 'boolean') fail('Provide the saved version and caption choice');
  const framing = input.framing;
  if (!framing || !['source','16:9','9:16','1:1'].includes(framing.aspect) || !['contain','cover'].includes(framing.fit) || Object.keys(framing).some(k => !['aspect','fit'].includes(k))) fail('Choose a supported frame and fit');
  const composition = await env.DB.prepare('SELECT * FROM compositions WHERE id=?1 AND project_id=?2').bind(compositionId, project.id).first();
  if (!composition) throw new HttpError(404, 'Storyboard not found', 'not_found');
  if (composition.updated_at !== input.expectedUpdatedAt) conflict();
  const spec = safeJson(composition.spec_json, {});
  if (!Array.isArray(spec.shots) || spec.shots.length < 2 || spec.shots.length > 6 || !Array.isArray(spec.audioTracks ?? []) || (spec.audioTracks ?? []).length > 4) fail('This storyboard is outside local render limits');
  const checked = new Map();
  const source = async (assetId, kind) => {
    const row = await env.DB.prepare('SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL').bind(assetId, project.id).first();
    if (!row || row.kind !== kind || !hashPattern.test(row.sha256 ?? '')) conflict();
    checked.set(row.id, row);
    return row;
  };
  const shots = [];
  let inputBytes = 0;
  for (const shot of spec.shots) {
    const asset = await source(shot.assetId, 'video');
    const range = shotRange(shot, { durationMs: asset.duration_ms });
    if (!range || asset.duration_ms > 16000 || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || shots.some(existing => existing.assetId === asset.id)) fail('A selected shot has an invalid range or size');
    inputBytes += asset.bytes;
    shots.push({ assetId: asset.id, sha256: asset.sha256, startMs: range.start, endMs: range.end });
  }
  const totalMs = shots.reduce((sum, shot) => sum + shot.endMs - shot.startMs, 0);
  if (totalMs <= 0 || totalMs > 60000 || totalMs !== spec.totalMs) fail('The saved storyboard duration is invalid');
  let soundtrack = null;
  if (spec.audioAssetId) {
    const asset = await source(spec.audioAssetId, 'audio');
    if (asset.mime !== 'audio/wav' || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 16*1024*1024 || !Number.isSafeInteger(asset.duration_ms) || Math.abs(asset.duration_ms - totalMs) > 100) fail('The mixed WAV soundtrack must match the storyboard and fit the local limit');
    inputBytes += asset.bytes;
    soundtrack = { assetId: asset.id, sha256: asset.sha256 };
  } else if ((spec.audioTracks ?? []).length) fail('Mix the soundtrack before rendering');
  if (inputBytes > 128*1024*1024) fail('The selected media exceeds the local input limit');
  const tracks = [];
  for (const track of spec.audioTracks ?? []) {
    const asset = await source(track.assetId, 'audio');
    tracks.push({ assetId: asset.id, sha256: asset.sha256, role: track.role, startMs: track.startMs, trimStartMs: track.trimStartMs, trimEndMs: track.trimEndMs, gainDb: track.gainDb, fadeInMs: track.fadeInMs, fadeOutMs: track.fadeOutMs });
  }
  let captions = null, plan = null;
  if (input.includeCaptions) {
    const origin = spec.originSongPlan;
    if (!origin) fail('This storyboard has no linked song plan');
    plan = await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(origin.id, project.id).first();
    if (!plan || plan.revision !== origin.revision || plan.song_sha256 !== origin.songSha256) conflict();
    const song = await source(plan.song_asset_id, 'audio');
    const planSpec = safeJson(plan.spec_json, {});
    if (song.sha256 !== plan.song_sha256 || planSpec.rightsConfirmed !== true || planSpec.startMs !== origin.sourceStartMs || planSpec.endMs !== origin.sourceEndMs || totalMs !== planSpec.endMs - planSpec.startMs || !Array.isArray(planSpec.scenes) || !Array.isArray(origin.scenes) || planSpec.scenes.length !== shots.length || origin.scenes.length !== shots.length) conflict();
    let cursor = planSpec.startMs;
    for (const [i, scene] of planSpec.scenes.entries()) {
      const frozen = origin.scenes[i], shot = shots[i], clip = checked.get(shot.assetId);
      const range = frozen && shotRange(frozen, { durationMs: clip.duration_ms });
      if (!frozen || scene.id !== frozen.id || scene.selectedTakeId !== frozen.selectedTakeId || scene.selectedTakeId !== shot.assetId || scene.startMs !== frozen.startMs || scene.endMs !== frozen.endMs || scene.startMs !== cursor || scene.endMs <= cursor || !range || range.start !== shot.startMs || range.end !== shot.endMs || range.durationMs !== scene.endMs - scene.startMs) conflict();
      cursor = scene.endMs;
    }
    if (cursor !== planSpec.endMs || planSpec.captions?.source !== 'owner_supplied' || planSpec.captions?.rightsConfirmed !== true || !Array.isArray(planSpec.captions.cues) || !planSpec.captions.cues.length || planSpec.captions.cues.length > 100) fail('Save permission-confirmed captions before rendering');
    const cues = [...planSpec.captions.cues].sort((a,b) => a.startMs - b.startMs || a.endMs - b.endMs);
    let last = planSpec.startMs;
    for (const cue of cues) {
      if (!cue || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < last || cue.endMs <= cue.startMs || cue.endMs > planSpec.endMs || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 300 || typeof cue.speaker !== 'string' || cue.speaker.length > 80) fail('Captions must have valid non-overlapping times');
      last = cue.endMs;
    }
    captions = { planId: plan.id, revision: plan.revision, songAssetId: song.id, songSha256: song.sha256 };
  }
  const snapshot = { version: 1, evidence: { snapshot: 'server_verified', render: 'browser_reported' }, storyboard: { id: composition.id, updatedAt: composition.updated_at }, shots, totalMs, soundtrack, tracks, captions, framing: { aspect: framing.aspect, fit: framing.fit } };
  const receiptId = id('lrr'), outputAssetId = id('asset'), timestamp = now();
  await env.DB.prepare('DELETE FROM local_render_receipts WHERE project_id=?1 AND expires_at<?2 AND NOT EXISTS (SELECT 1 FROM assets WHERE id=output_asset_id)').bind(project.id, timestamp).run();
  const rows = [...checked.values()];
  let sql = 'INSERT INTO local_render_receipts(id,project_id,output_asset_id,snapshot_json,created_at,expires_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM compositions WHERE id=?7 AND project_id=?2 AND spec_json=?8 AND updated_at=?9) AND (SELECT COUNT(*) FROM local_render_receipts r WHERE r.project_id=?2 AND r.expires_at>=?5 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=r.output_asset_id)) < 16';
  const args = [receiptId,project.id,outputAssetId,JSON.stringify(snapshot),timestamp,timestamp+30*60*1000,composition.id,composition.spec_json,composition.updated_at];
  for (const row of rows) { const i=args.length+1; sql += ` AND EXISTS (SELECT 1 FROM assets WHERE id=?${i} AND project_id=?2 AND sha256=?${i+1} AND duration_ms IS ?${i+2} AND deleted_at IS NULL)`; args.push(row.id,row.sha256,row.duration_ms); }
  if (plan) { const i=args.length+1; sql += ` AND EXISTS (SELECT 1 FROM song_plans WHERE id=?${i} AND project_id=?2 AND revision=?${i+1} AND spec_json=?${i+2})`; args.push(plan.id,plan.revision,plan.spec_json); }
  const created = await env.DB.prepare(sql+' RETURNING id').bind(...args).first();
  if (!created) {
    const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM local_render_receipts r WHERE r.project_id=?1 AND r.expires_at>=?2 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=r.output_asset_id)').bind(project.id,timestamp).first();
    if (pending.n >= 16) throw new HttpError(429, 'Too many unfinished local renders. Wait for an earlier receipt to expire.', 'receipt_limit');
    conflict();
  }
  return { id: receiptId, expiresAt: timestamp+30*60*1000 };
}
