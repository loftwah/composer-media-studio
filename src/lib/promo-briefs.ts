// Project-private editorial drafts.
import { HttpError, id, now, safeJson, text } from './util.mjs';

interface PromoBriefStatement {
  bind(...values: unknown[]): PromoBriefStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
interface PromoBriefEnv {
  DB: { prepare(query: string): PromoBriefStatement };
}
interface PromoBriefProject { id: string }
interface PromoBriefRow {
  id: string;
  project_id: string;
  spec_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}
type PromoAspect = '16:9' | '9:16' | '1:1';
interface PromoBriefScene {
  spoken: string;
  visual: string;
}
/** The validated spec as it is stored in `spec_json` and returned to callers. */
interface PromoBriefSpec {
  title: string;
  audience: string;
  brief: string;
  cta: string;
  aspect: PromoAspect;
  targetSeconds: number;
  scenes: PromoBriefScene[];
}
interface PromoBriefView extends Partial<PromoBriefSpec> {
  id: string;
  projectId: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
const invalid: (message: string) => never = message => { throw new HttpError(400, message, 'invalid_promo_brief'); };
function validate(input: unknown): PromoBriefSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Provide a promo brief.');
  const fields = input as Record<string, unknown>;
  const title = text(fields.title, 80, 'Title');
  const audience = text(fields.audience ?? '', 300, 'Audience', { required: false });
  const brief = text(fields.brief ?? '', 1200, 'Brief', { required: false });
  const cta = text(fields.cta ?? '', 300, 'Call to action', { required: false });
  const { aspect, targetSeconds } = fields;
  if (aspect !== '16:9' && aspect !== '9:16' && aspect !== '1:1') invalid('Choose a supported frame.');
  if (typeof targetSeconds !== 'number' || !Number.isInteger(targetSeconds) || targetSeconds < 15 || targetSeconds > 30)
    invalid('Choose a target from 15 to 30 seconds.');
  if (!Array.isArray(fields.scenes) || fields.scenes.length < 2 || fields.scenes.length > 6)
    invalid('Add two to six scenes.');
  const scenes = fields.scenes.map((value: unknown): PromoBriefScene => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Provide scene text.');
    const scene = value as Record<string, unknown>;
    return {
      spoken: text(scene.spoken ?? '', 600, 'Spoken words', { required: false }),
      visual: text(scene.visual ?? '', 600, 'Visual direction', { required: false }),
    };
  });
  return { title, audience, brief, cta, aspect, targetSeconds, scenes };
}
function view(row: PromoBriefRow): PromoBriefView {
  return { id: row.id, projectId: row.project_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, ...(safeJson(row.spec_json, {}) as Partial<PromoBriefSpec>) };
}
export async function listPromoBriefs(env: PromoBriefEnv, project: PromoBriefProject): Promise<PromoBriefView[]> {
  const rows = await env.DB.prepare('SELECT * FROM promo_briefs WHERE project_id=?1 ORDER BY updated_at DESC,id DESC').bind(project.id).all<PromoBriefRow>();
  return rows.results.map(view);
}
export async function createPromoBrief(env: PromoBriefEnv, project: PromoBriefProject, input: unknown): Promise<PromoBriefView> {
  const spec = validate(input), timestamp = now(), briefId = id('promo');
  const row = await env.DB.prepare('INSERT INTO promo_briefs(id,project_id,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?4) RETURNING *').bind(briefId, project.id, JSON.stringify(spec), timestamp).first<PromoBriefRow>();
  // INSERT ... RETURNING * yields the row that was just written.
  return view(row!);
}
export async function updatePromoBrief(env: PromoBriefEnv, project: PromoBriefProject, briefId: string, input: unknown): Promise<PromoBriefView> {
  const expectedRevision = (input as { expectedRevision?: unknown } | null)?.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    invalid('Provide the version you last read.');
  const spec = validate(input);
  const row = await env.DB.prepare('UPDATE promo_briefs SET spec_json=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND project_id=?4 AND revision=?5 RETURNING *').bind(JSON.stringify(spec), now(), briefId, project.id, expectedRevision).first<PromoBriefRow>();
  if (row) return view(row);
  const exists = await env.DB.prepare('SELECT id FROM promo_briefs WHERE id=?1 AND project_id=?2').bind(briefId, project.id).first<{ id: string }>();
  if (!exists) throw new HttpError(404, 'Promo brief not found', 'not_found');
  throw new HttpError(409, 'This brief changed. Reload the latest version before saving.', 'revision_conflict');
}
