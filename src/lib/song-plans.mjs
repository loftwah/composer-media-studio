// MIT. Durable, project-scoped editorial planning; no provider calls or spend.
import { HttpError, id, now, safeJson, text } from './util.mjs';

const fail = (message) => { throw new HttpError(400, message, 'invalid_song_plan'); };
const integer = (value, label) => {
  if (!Number.isSafeInteger(value)) fail(`${label} must be an integer number of milliseconds`);
  return value;
};
async function asset(env, project, assetId, kind) {
  const row = await env.DB.prepare('SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL').bind(assetId, project.id).first();
  if (!row || row.kind !== kind) fail(`Choose a saved ${kind} asset from this project`);
  return row;
}
export function viewSongPlan(row) {
  return { id: row.id, projectId: row.project_id, songAssetId: row.song_asset_id, songSha256: row.song_sha256, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, ...safeJson(row.spec_json, {}) };
}
async function validateSpec(env, project, song, input) {
  const startMs = integer(input.startMs, 'Start');
  const endMs = integer(input.endMs, 'End');
  if (startMs < 0 || endMs > song.duration_ms || endMs - startMs > 60000 || endMs - startMs < 2000) fail('Choose a 2–60 second segment within the saved song');
  const title = text(input.title, 80, 'Plan title');
  const treatment = text(input.treatment ?? '', 1200, 'Treatment', { required: false });
  const aspect = input.aspect;
  if (!['16:9', '9:16', '1:1'].includes(aspect)) fail('Choose a supported aspect ratio');
  if (!Array.isArray(input.scenes) || input.scenes.length < 2 || input.scenes.length > 6) fail('A plan needs two to six scenes');
  let cursor = startMs;
  const seen = new Set();
  const scenes = [];
  for (const entry of input.scenes) {
    if (!entry || typeof entry !== 'object' || !/^[a-z0-9_]{4,80}$/.test(entry.id ?? '') || seen.has(entry.id)) fail('Each scene needs a unique stable ID');
    seen.add(entry.id);
    const from = integer(entry.startMs, 'Scene start');
    const to = integer(entry.endMs, 'Scene end');
    if (from !== cursor || to <= from || to > endMs) fail('Scenes must cover the segment in order without gaps or overlaps');
    const direction = text(entry.direction ?? '', 1200, 'Scene direction', { required: false });
    const referenceAssetId = entry.referenceAssetId || null;
    const selectedTakeId = entry.selectedTakeId || null;
    if (referenceAssetId) await asset(env, project, referenceAssetId, 'image');
    if (selectedTakeId) await asset(env, project, selectedTakeId, 'video');
    scenes.push({ id: entry.id, startMs: from, endMs: to, direction, referenceAssetId, selectedTakeId });
    cursor = to;
  }
  if (cursor !== endMs) fail('Scenes must cover the whole chosen segment');
  return { title, treatment, aspect, startMs, endMs, rightsConfirmed: true, scenes };
}
export async function createSongPlan(env, project, input) {
  if (input.rightsConfirmed !== true) fail('Confirm you own the song or have permission to use it');
  const song = await asset(env, project, input.songAssetId, 'audio');
  if (!Number.isSafeInteger(song.duration_ms) || song.duration_ms <= 0 || !song.sha256) fail('The song needs a measured duration and fingerprint');
  const startMs = integer(input.startMs, 'Start');
  const endMs = integer(input.endMs, 'End');
  const count = input.sceneCount;
  if (!Number.isInteger(count) || count < 2 || count > 6) fail('Choose two to six suggested scenes');
  const scenes = Array.from({ length: count }, (_, i) => ({ id: id('scn'), startMs: startMs + Math.round((endMs-startMs)*i/count), endMs: startMs + Math.round((endMs-startMs)*(i+1)/count), direction: '', referenceAssetId: null, selectedTakeId: null }));
  const spec = await validateSpec(env, project, song, { ...input, scenes });
  const timestamp = now(), planId = id('plan');
  await env.DB.prepare('INSERT INTO song_plans(id,project_id,song_asset_id,song_sha256,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)').bind(planId, project.id, song.id, song.sha256, JSON.stringify(spec), timestamp).run();
  return viewSongPlan({ id: planId, project_id: project.id, song_asset_id: song.id, song_sha256: song.sha256, spec_json: JSON.stringify(spec), revision: 1, created_at: timestamp, updated_at: timestamp });
}
export async function listSongPlans(env, project) {
  const rows = await env.DB.prepare('SELECT * FROM song_plans WHERE project_id=?1 ORDER BY updated_at DESC').bind(project.id).all();
  return rows.results.map(viewSongPlan);
}
export async function updateSongPlan(env, project, planId, input) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Provide the revision you last read');
  const row = await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(planId, project.id).first();
  if (!row) throw new HttpError(404, 'Song plan not found', 'not_found');
  if (row.revision !== input.expectedRevision) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  const song = await asset(env, project, row.song_asset_id, 'audio');
  if (song.sha256 !== row.song_sha256) throw new HttpError(409, 'The source song changed. Reload the plan.', 'song_changed');
  const spec = await validateSpec(env, project, song, input);
  const updated = await env.DB.prepare('UPDATE song_plans SET spec_json=?1, revision=revision+1, updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5 RETURNING *').bind(JSON.stringify(spec), now(), planId, project.id, input.expectedRevision).first();
  if (!updated) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  return viewSongPlan(updated);
}
