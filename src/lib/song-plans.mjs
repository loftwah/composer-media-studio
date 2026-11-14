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
async function validateSpec(env, project, song, input, previousScenes = [], newOrigins = []) {
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
    const previous = previousScenes.find(scene => scene.id === entry.id)?.subjectOrigin ?? null;
    const requested = Object.hasOwn(entry, 'subjectOrigin') ? entry.subjectOrigin : previous;
    let subjectOrigin = null;
    if (requested !== null && requested !== undefined) {
      if (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(key => !['subjectId','revision','name'].includes(key)) || !/^sub_[a-z0-9_]{1,80}$/.test(requested.subjectId ?? '') || !Number.isSafeInteger(requested.revision) || requested.revision < 1) fail('Choose a valid subject version');
      if (previous && requested.subjectId === previous.subjectId && requested.revision === previous.revision) subjectOrigin = previous;
      else {
        const source = await env.DB.prepare(`SELECT s.spec_json FROM subject_versions s JOIN assets a ON a.id=s.reference_asset_id AND a.project_id=s.project_id AND a.kind='image' AND a.deleted_at IS NULL AND a.sha256=s.reference_sha256 WHERE s.subject_id=?1 AND s.project_id=?2 AND s.revision=?3`).bind(requested.subjectId,project.id,requested.revision).first();
        if (!source) fail('Choose an available subject version from this project');
        const name = safeJson(source.spec_json, {}).name;
        if (typeof name !== 'string' || !name) fail('The subject version is invalid');
        subjectOrigin = { subjectId: requested.subjectId, revision: requested.revision, name };
        newOrigins.push(subjectOrigin);
      }
    }
    scenes.push({ id: entry.id, startMs: from, endMs: to, direction, referenceAssetId, selectedTakeId, ...(subjectOrigin ? {subjectOrigin} : {}) });
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
export async function updateSongPlan(env, project, planId, input, { reviewedReferences = null } = {}) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Provide the revision you last read');
  const row = await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(planId, project.id).first();
  if (!row) throw new HttpError(404, 'Song plan not found', 'not_found');
  if (row.revision !== input.expectedRevision) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  const song = await asset(env, project, row.song_asset_id, 'audio');
  if (song.sha256 !== row.song_sha256) throw new HttpError(409, 'The source song changed. Reload the plan.', 'song_changed');
  const previousSpec = safeJson(row.spec_json, {}), newOrigins = [];
  const spec = await validateSpec(env, project, song, input, previousSpec.scenes ?? [], newOrigins);
  const existingCaptions = previousSpec.captions;
  if (existingCaptions) spec.captions = validateCaptions(existingCaptions, spec.startMs, spec.endMs);
  let sql='UPDATE song_plans SET spec_json=?1, revision=revision+1, updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5';
  const args=[JSON.stringify(spec),now(),planId,project.id,input.expectedRevision];
  if (reviewedReferences) {
    sql += ' AND EXISTS (SELECT 1 FROM assets WHERE id=?6 AND project_id=?4 AND sha256=?7 AND deleted_at IS NULL)'; args.push(song.id,song.sha256);
    for (const reference of reviewedReferences) { const n=args.length+1; sql += ` AND EXISTS (SELECT 1 FROM assets WHERE id=?${n} AND project_id=?4 AND kind=\'image\' AND sha256 IS ?${n+1} AND deleted_at IS NULL)`; args.push(reference.id,reference.sha256); }
  }
  for (const origin of newOrigins) {
    const n=args.length+1;
    sql += ` AND EXISTS (SELECT 1 FROM subject_versions s JOIN assets a ON a.id=s.reference_asset_id AND a.project_id=s.project_id AND a.kind='image' AND a.deleted_at IS NULL AND a.sha256=s.reference_sha256 WHERE s.subject_id=?${n} AND s.project_id=?4 AND s.revision=?${n+1})`;
    args.push(origin.subjectId,origin.revision);
  }
  const updated = await env.DB.prepare(sql+' RETURNING *').bind(...args).first();
  if (!updated) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  return viewSongPlan(updated);
}

// Caption timing is in source-song milliseconds. Export shifts it to the
// chosen segment's zero point; no external transcription service is used.
function validateCaptions(captions, startMs, endMs) {
  if (!captions) return null;
  if (captions.source !== 'owner_supplied' || captions.rightsConfirmed !== true || !Array.isArray(captions.cues) || captions.cues.length > 100) fail('Confirm permission for the supplied lyrics and provide at most 100 cues');
  const seen = new Set();
  const cues = captions.cues.map((cue) => {
    if (!cue || !/^[a-z0-9_]{4,80}$/.test(cue.id ?? '') || seen.has(cue.id)) fail('Each caption needs a unique stable ID');
    seen.add(cue.id);
    const from = integer(cue.startMs, 'Caption start'), to = integer(cue.endMs, 'Caption end');
    if (from < startMs || to > endMs || to <= from) fail('Caption times must fit within the chosen song segment');
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 300 || /[\u0000-\u001f\u007f]/.test(cue.text)) fail('Caption text must be a single line of up to 300 characters');
    const speaker = cue.speaker ?? '';
    if (typeof speaker !== 'string' || speaker.length > 80 || /[\u0000-\u001f\u007f]/.test(speaker)) fail('Speaker must be a single line of up to 80 characters');
    return { id: cue.id, startMs: from, endMs: to, text: cue.text.trim(), speaker: speaker.trim() };
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
  return { source: 'owner_supplied', rightsConfirmed: true, cues };
}
async function planRow(env, project, planId) {
  const row = await env.DB.prepare('SELECT * FROM song_plans WHERE id=?1 AND project_id=?2').bind(planId, project.id).first();
  if (!row) throw new HttpError(404, 'Song plan not found', 'not_found');
  return row;
}
export async function updateSongCaptions(env, project, planId, input) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Provide the revision you last read');
  const row = await planRow(env, project, planId);
  if (row.revision !== input.expectedRevision) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  const song = await asset(env, project, row.song_asset_id, 'audio');
  if (song.sha256 !== row.song_sha256) throw new HttpError(409, 'The source song changed. Reload the plan.', 'song_changed');
  const spec = safeJson(row.spec_json, {});
  spec.captions = validateCaptions({ source: 'owner_supplied', rightsConfirmed: input.rightsConfirmed, cues: input.cues }, spec.startMs, spec.endMs);
  const updated = await env.DB.prepare('UPDATE song_plans SET spec_json=?1, revision=revision+1, updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5 RETURNING *').bind(JSON.stringify(spec), now(), planId, project.id, input.expectedRevision).first();
  if (!updated) throw new HttpError(409, 'This plan changed. Reload it before applying your edit.', 'revision_conflict');
  return viewSongPlan(updated);
}
// WebVTT parses character references; SRT readers such as FFmpeg show them
// literally. Keep ordinary ampersands in SRT while still neutralising markup.
const escapeCaption = (value, format) => (format === 'vtt' ? value.replaceAll('&', '&amp;') : value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function stamp(ms, format) {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, fraction = ms % 1000;
  const two = n => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}${format === 'srt' ? ',' : '.'}${String(fraction).padStart(3, '0')}`;
}
export async function exportSongCaptions(env, project, planId, format) {
  if (!['srt', 'vtt'].includes(format)) fail('Choose SRT or WebVTT');
  const row = await planRow(env, project, planId);
  const song = await asset(env, project, row.song_asset_id, 'audio');
  if (song.sha256 !== row.song_sha256) throw new HttpError(409, 'The source song changed. Reload the plan.', 'song_changed');
  const spec = safeJson(row.spec_json, {});
  const captions = validateCaptions(spec.captions, spec.startMs, spec.endMs);
  if (!captions || !captions.cues.length) throw new HttpError(404, 'This plan has no saved captions', 'not_found');
  const blocks = captions.cues.map((cue, i) => `${format === 'srt' ? i + 1 : cue.id}\n${stamp(cue.startMs-spec.startMs, format)} --> ${stamp(cue.endMs-spec.startMs, format)}\n${cue.speaker ? escapeCaption(cue.speaker, format) + ': ' : ''}${escapeCaption(cue.text, format)}\n`).join('\n');
  return { format, content: `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks}`, revision: row.revision };
}
