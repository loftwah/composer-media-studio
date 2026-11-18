// MIT. Project-private approved reference records; versions are append-only.
//
// Strict TypeScript move of subjects.mjs. The narrow D1 seam is reused from
// footage-plans.ts; the util helpers keep their runtime in util.mjs with
// type-only declarations in util.d.mts. No Cloudflare types are imported and
// every annotation here is erased at runtime. The SQL, append-only revisions,
// compare-and-swap refusal and output JSON are unchanged.
import { HttpError, id, now, safeJson, text } from './util.mjs';
import type { FootagePlanEnv, FootagePlanProject } from './footage-plans.ts';

/** The checked Worker D1 binding: only the calls this module makes. */
export type SubjectEnv = FootagePlanEnv;
/** The project row only needs its id for a private subject write. */
export type SubjectProject = FootagePlanProject;

const TYPES = ['person', 'product', 'location', 'style', 'source_frame'] as const;
const ROLES = ['face', 'full_body', 'profile', 'costume', 'prop', 'location', 'style', 'source_frame'] as const;
type SubjectType = (typeof TYPES)[number];
type ReferenceRole = (typeof ROLES)[number];

export interface SubjectSpec {
  type: SubjectType;
  name: string;
  traits: string;
  referenceRole: ReferenceRole;
  rightsConfirmed: true;
}
/** Stored spec JSON is untrusted on read, so every spec field is optional. */
export interface SubjectView extends Partial<SubjectSpec> {
  id: string;
  projectId: string;
  revision: number;
  referenceAssetId: string;
  referenceSha256: string;
  referenceAvailable: boolean;
  createdAt: number;
}
interface SubjectAssetRow { id: string; sha256: string }
interface SubjectVersionRow {
  subject_id: string;
  project_id: string;
  revision: number;
  spec_json: string;
  reference_asset_id: string;
  reference_sha256: string;
  reference_available: number;
  created_at: number;
}

const conflict = (): never => { throw new HttpError(409, 'The subject or reference changed. Reload before saving.', 'revision_conflict'); };
/** Match the original truthiness/object/array guard before any field access. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function validate(env: SubjectEnv, project: SubjectProject, input: unknown): Promise<{ spec: SubjectSpec; asset: SubjectAssetRow }> {
  if (!isRecord(input) || input.rightsConfirmed !== true) throw new HttpError(400, 'Confirm permission to use this reference.');
  if (!TYPES.includes(input.type as SubjectType) || !ROLES.includes(input.referenceRole as ReferenceRole)) throw new HttpError(400, 'Choose a supported subject type and reference role.');
  const name = text(input.name, 80, 'Name');
  const traits = text(input.traits ?? '', 1200, 'Traits', { required: false });
  if (!/^asset_[a-z0-9_]{1,80}$/.test(String(input.referenceAssetId ?? ''))) throw new HttpError(400, 'Choose a saved image in this project.');
  const asset = await env.DB.prepare("SELECT id,sha256 FROM assets WHERE id=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL").bind(input.referenceAssetId, project.id).first<SubjectAssetRow>();
  if (!asset || !/^[a-f0-9]{64}$/i.test(asset.sha256 ?? '')) throw new HttpError(400, 'Choose an available saved image with a fingerprint.');
  return { spec: { type: input.type as SubjectType, name, traits, referenceRole: input.referenceRole as ReferenceRole, rightsConfirmed: true }, asset };
}
function view(row: SubjectVersionRow): SubjectView {
  return { id: row.subject_id, projectId: row.project_id, revision: row.revision, ...safeJson<Partial<SubjectSpec>>(row.spec_json, {}), referenceAssetId: row.reference_asset_id, referenceSha256: row.reference_sha256, referenceAvailable: Boolean(row.reference_available), createdAt: row.created_at };
}
const SELECT = `SELECT s.*, EXISTS(SELECT 1 FROM assets a WHERE a.id=s.reference_asset_id AND a.project_id=s.project_id AND a.kind='image' AND a.deleted_at IS NULL AND a.sha256=s.reference_sha256) AS reference_available FROM subject_versions s`;
export async function listSubjects(env: SubjectEnv, project: SubjectProject, allVersions = false): Promise<SubjectView[]> {
  const rows = await env.DB.prepare(`${SELECT} WHERE s.project_id=?1 ${allVersions ? '' : 'AND s.revision=(SELECT MAX(v.revision) FROM subject_versions v WHERE v.subject_id=s.subject_id AND v.project_id=s.project_id)'} ORDER BY s.subject_id, s.revision DESC`).bind(project.id).all<SubjectVersionRow>();
  return rows.results.map(view);
}
export async function subjectVersions(env: SubjectEnv, project: SubjectProject, subjectId: string): Promise<SubjectView[]> {
  const rows = await env.DB.prepare(`${SELECT} WHERE s.project_id=?1 AND s.subject_id=?2 ORDER BY s.revision DESC`).bind(project.id, subjectId).all<SubjectVersionRow>();
  if (!rows.results.length) throw new HttpError(404, 'Subject not found', 'not_found');
  return rows.results.map(view);
}
export async function saveSubject(env: SubjectEnv, project: SubjectProject, input: unknown, subjectId: string | null = null): Promise<SubjectView> {
  const editing = subjectId !== null;
  const expectedRevision = isRecord(input) ? input.expectedRevision : undefined;
  if (editing && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new HttpError(400, 'Provide the version you last read.');
  const { spec, asset } = await validate(env, project, input);
  const subject = subjectId ?? id('sub');
  const revision = editing ? (expectedRevision as number) + 1 : 1;
  const timestamp = now();
  const saved = await env.DB.prepare(`INSERT INTO subject_versions(subject_id,project_id,revision,spec_json,reference_asset_id,reference_sha256,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7
    WHERE EXISTS(SELECT 1 FROM assets WHERE id=?5 AND project_id=?2 AND kind='image' AND deleted_at IS NULL AND sha256=?6)
    ${editing ? 'AND EXISTS(SELECT 1 FROM subject_versions WHERE subject_id=?1 AND project_id=?2 AND revision=?8) AND NOT EXISTS(SELECT 1 FROM subject_versions WHERE subject_id=?1 AND project_id=?2 AND revision>?8)' : ''}
    ON CONFLICT(subject_id,revision) DO NOTHING RETURNING subject_id`).bind(...[subject,project.id,revision,JSON.stringify(spec),asset.id,asset.sha256,timestamp,...(editing ? [expectedRevision] : [])]).first<{ subject_id: string }>();
  if (!saved) conflict();
  return view({ subject_id: subject, project_id: project.id, revision, spec_json: JSON.stringify(spec), reference_asset_id: asset.id, reference_sha256: asset.sha256, reference_available: 1, created_at: timestamp });
}
