// MIT. Non-destructive source-video cut maps; no processing or provider calls.
import { HttpError, id, now, safeJson, text } from './util.mjs';
const fail = message => { throw new HttpError(400, message, 'invalid_footage_plan'); };
const integer = (value, label) => {
  if (!Number.isSafeInteger(value)) fail(`${label} must be an integer number of milliseconds`);
  return value;
};
async function asset(env, project, assetId, kind) {
  const row = await env.DB.prepare('SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL').bind(assetId, project.id).first();
  if (!row || row.kind !== kind) fail(`Choose a saved ${kind} asset from this project`);
  return row;
}
function view(row) {
  return { id: row.id, projectId: row.project_id, sourceAssetId: row.source_asset_id, sourceSha256: row.source_sha256, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, ...safeJson(row.spec_json, {}) };
}
async function validate(env, project, source, input) {
  const title = text(input.title, 80, 'Plan title');
  const treatment = text(input.treatment ?? '', 1200, 'Treatment', { required: false });
  if (!['16:9', '9:16', '1:1'].includes(input.aspect)) fail('Choose a supported aspect ratio');
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 6) fail('A cut map needs one to six scenes');
  const seen = new Set(), scenes = [];
  let previousEnd = 0, totalMs = 0;
  for (const item of input.scenes) {
    if (!item || !/^[a-z0-9_]{4,80}$/.test(item.id ?? '') || seen.has(item.id)) fail('Each scene needs a unique stable ID');
    seen.add(item.id);
    const from = integer(item.sourceStartMs, 'Scene start'), to = integer(item.sourceEndMs, 'Scene end');
    if (from < previousEnd || to <= from || to > source.duration_ms) fail('Scenes must be ordered, non-overlapping ranges within the source video');
    totalMs += to - from;
    if (totalMs > 60000) fail('Keep the selected source ranges within 60 seconds');
    const direction = text(item.direction ?? '', 1200, 'Scene direction', { required: false });
    const referenceAssetId = item.referenceAssetId || null, selectedTakeId = item.selectedTakeId || null;
    if (referenceAssetId) await asset(env, project, referenceAssetId, 'image');
    if (selectedTakeId) await asset(env, project, selectedTakeId, 'video');
    scenes.push({ id: item.id, sourceStartMs: from, sourceEndMs: to, direction, referenceAssetId, selectedTakeId });
    previousEnd = to;
  }
  return { title, treatment, aspect: input.aspect, rightsConfirmed: true, scenes, totalMs };
}
export async function createFootagePlan(env, project, input) {
  if (input.rightsConfirmed !== true) fail('Confirm you own the footage or have permission to use it');
  const source = await asset(env, project, input.sourceAssetId, 'video');
  if (!Number.isSafeInteger(source.duration_ms) || source.duration_ms <= 0 || !source.sha256) fail('The source video needs a measured duration and fingerprint');
  const from = integer(input.sourceStartMs, 'Source start'), to = integer(input.sourceEndMs, 'Source end');
  const count = input.sceneCount;
  if (!Number.isInteger(count) || count < 1 || count > 6) fail('Choose one to six suggested scenes');
  const scenes = Array.from({length: count}, (_, i) => ({ id: id('scn'), sourceStartMs: from + Math.round((to-from)*i/count), sourceEndMs: from + Math.round((to-from)*(i+1)/count), direction: '', referenceAssetId: null, selectedTakeId: null }));
  const spec = await validate(env, project, source, {...input, scenes});
  const timestamp = now(), planId = id('foot');
  await env.DB.prepare('INSERT INTO footage_plans(id,project_id,source_asset_id,source_sha256,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)').bind(planId, project.id, source.id, source.sha256, JSON.stringify(spec), timestamp).run();
  return view({id:planId, project_id:project.id, source_asset_id:source.id, source_sha256:source.sha256, spec_json:JSON.stringify(spec), revision:1, created_at:timestamp, updated_at:timestamp});
}
export async function listFootagePlans(env, project) {
  const rows = await env.DB.prepare('SELECT * FROM footage_plans WHERE project_id=?1 ORDER BY updated_at DESC').bind(project.id).all();
  return rows.results.map(view);
}
export async function updateFootagePlan(env, project, planId, input) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Provide the revision you last read');
  const row = await env.DB.prepare('SELECT * FROM footage_plans WHERE id=?1 AND project_id=?2').bind(planId, project.id).first();
  if (!row) throw new HttpError(404, 'Footage plan not found', 'not_found');
  if (row.revision !== input.expectedRevision) throw new HttpError(409, 'This cut map changed. Reload it before applying your edit.', 'revision_conflict');
  const source = await asset(env, project, row.source_asset_id, 'video');
  if (source.sha256 !== row.source_sha256) throw new HttpError(409, 'The source video changed. Reload the plan.', 'source_changed');
  const spec = await validate(env, project, source, input);
  const updated = await env.DB.prepare('UPDATE footage_plans SET spec_json=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5 RETURNING *').bind(JSON.stringify(spec), now(), planId, project.id, input.expectedRevision).first();
  if (!updated) throw new HttpError(409, 'This cut map changed. Reload it before applying your edit.', 'revision_conflict');
  return view(updated);
}
