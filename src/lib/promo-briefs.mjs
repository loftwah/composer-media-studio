// Project-private editorial drafts. Saving never creates media or spends.
import { HttpError, id, now, safeJson, text } from './util.mjs';
const invalid = message => { throw new HttpError(400, message, 'invalid_promo_brief'); };
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Provide a promo brief.');
  const title = text(input.title, 80, 'Title');
  const audience = text(input.audience ?? '', 300, 'Audience', { required: false });
  const brief = text(input.brief ?? '', 1200, 'Brief', { required: false });
  const cta = text(input.cta ?? '', 300, 'Call to action', { required: false });
  if (!['16:9','9:16','1:1'].includes(input.aspect)) invalid('Choose a supported frame.');
  if (!Number.isInteger(input.targetSeconds) || input.targetSeconds < 15 || input.targetSeconds > 30) invalid('Choose a target from 15 to 30 seconds.');
  if (!Array.isArray(input.scenes) || input.scenes.length < 2 || input.scenes.length > 6) invalid('Add two to six scenes.');
  const scenes = input.scenes.map((scene) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) invalid('Provide scene text.');
    return { spoken: text(scene.spoken ?? '', 600, 'Spoken words', { required: false }), visual: text(scene.visual ?? '', 600, 'Visual direction', { required: false }) };
  });
  return { title, audience, brief, cta, aspect:input.aspect, targetSeconds:input.targetSeconds, scenes };
}
function view(row) { return { id:row.id, projectId:row.project_id, revision:row.revision, createdAt:row.created_at, updatedAt:row.updated_at, ...safeJson(row.spec_json,{}) }; }
export async function listPromoBriefs(env, project) {
  const rows=await env.DB.prepare('SELECT * FROM promo_briefs WHERE project_id=?1 ORDER BY updated_at DESC,id DESC').bind(project.id).all();
  return rows.results.map(view);
}
export async function createPromoBrief(env, project, input) {
  const spec=validate(input), timestamp=now(), briefId=id('promo');
  const row=await env.DB.prepare('INSERT INTO promo_briefs(id,project_id,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?4) RETURNING *').bind(briefId,project.id,JSON.stringify(spec),timestamp).first();
  return view(row);
}
export async function updatePromoBrief(env, project, briefId, input) {
  if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 1) invalid('Provide the version you last read.');
  const spec=validate(input);
  const row=await env.DB.prepare('UPDATE promo_briefs SET spec_json=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5 RETURNING *').bind(JSON.stringify(spec),now(),briefId,project.id,input.expectedRevision).first();
  if (row) return view(row);
  const exists=await env.DB.prepare('SELECT id FROM promo_briefs WHERE id=?1 AND project_id=?2').bind(briefId,project.id).first();
  if (!exists) throw new HttpError(404,'Promo brief not found','not_found');
  throw new HttpError(409,'This brief changed. Reload the latest version before saving.','revision_conflict');
}
