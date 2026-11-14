// Explicit first-party publication policy. Never infer rights from an asset's source.
import { HttpError, id, now, slug } from "./util.mjs";

export function installationAllows(env, projectId) {
  return String(env.FIRST_PARTY_PUBLICATION_PROJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean).includes(projectId);
}

export async function policyFor(env, projectId) {
  const row = await env.DB.prepare("SELECT * FROM publication_policies WHERE project_id=?1").bind(projectId).first();
  return { installationAllowed: installationAllows(env, projectId), enabled: Boolean(row?.enabled), enabledAt: row?.enabled_at ?? null, attestedAt: row?.attested_at ?? null };
}

export async function setPolicy(env, projectId, enabled, rightsConfirmed) {
  if (enabled && !installationAllows(env, projectId)) throw new HttpError(403, "This project is not in the installation's first-party publication allowlist.", "not_allowed");
  if (enabled && rightsConfirmed !== true) throw new HttpError(400, "Confirm rights and public suitability for this project's generated work and its references.", "rights_required");
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,?2,?3,?3)
    ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,
    enabled_at=CASE WHEN excluded.enabled=1 AND publication_policies.enabled=0 THEN excluded.enabled_at ELSE publication_policies.enabled_at END,
    attested_at=CASE WHEN excluded.enabled=1 THEN excluded.attested_at ELSE publication_policies.attested_at END`)
    .bind(projectId, enabled ? 1 : 0, timestamp).run();
  return policyFor(env, projectId);
}

// A completed output must have durable provenance; imports and source/reference assets are never candidates.
const eligible = `a.deleted_at IS NULL AND a.source IN ('generated','variant','assembled')
  AND g.id=a.generation_id AND g.project_id=a.project_id AND g.status='saved' AND g.deleted_at IS NULL AND g.output_asset_id=a.id`;

export async function inventory(env, projectId, after = "") {
  const rows = await env.DB.prepare(`SELECT a.id,a.title,a.kind,a.source,a.created_at,
    CASE WHEN ${eligible} THEN 1 ELSE 0 END AS eligible,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NOT NULL) AS withdrawn,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL AND p.hidden=1) AS hidden,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL) AS published
    FROM assets a LEFT JOIN generations g ON g.id=a.generation_id WHERE a.project_id=?1 AND a.id>?2
    ORDER BY a.id LIMIT 26`).bind(projectId, after).all();
  const page = rows.results.slice(0, 25);
  return { items: page.map((a) => ({ id:a.id, title:a.title, kind:a.kind, source:a.source, status: !a.eligible ? "ineligible" : a.withdrawn ? "withdrawn" : a.hidden ? "hidden" : a.published ? "existing" : "candidate" })), nextAfter: rows.results.length > 25 ? page.at(-1).id : null };
}

// Recheck eligibility and policy in the write statement, serialising competing
// requests and preserving every existing URL and every withdrawal.
export async function publishCandidate(env, projectId, assetId, { automatic = false } = {}) {
  if (!installationAllows(env, projectId)) return "not_allowed";
  const active = await env.DB.prepare(`SELECT p.id FROM publications p JOIN assets a ON a.id=p.asset_id JOIN generations g ON g.id=a.generation_id
    JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?1 AND a.project_id=?2 AND ${eligible} AND p.revoked_at IS NULL AND p.hidden=0
    AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=a.id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
    AND (?3=0 OR g.created_at>policy.enabled_at) LIMIT 1`).bind(assetId, projectId, automatic ? 1 : 0).first();
  if (active) {
    // A saved-job retry must never undo a deliberate unlisting. Only an
    // explicitly confirmed reconciliation may list an existing page.
    if (automatic) return "existing";
    const result = await env.DB.prepare(`UPDATE publications SET listed=1 WHERE id=?1 AND revoked_at IS NULL AND hidden=0
      AND EXISTS(SELECT 1 FROM publication_policies policy WHERE policy.project_id=?2 AND policy.enabled=1)
      AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=publications.asset_id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
      AND EXISTS(SELECT 1 FROM assets a JOIN generations g ON g.id=a.generation_id WHERE a.id=publications.asset_id AND a.project_id=?2 AND ${eligible})`).bind(active.id, projectId).run();
    return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "existing" : "skipped";
  }
  const result = await env.DB.prepare(`INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed)
    SELECT ?1,a.project_id,a.id,?2,CASE a.kind WHEN 'video' THEN 'Generated film' WHEN 'audio' THEN 'Generated sound' ELSE 'Generated image' END,'',a.delete_revision,?3,1
    FROM assets a JOIN generations g ON g.id=a.generation_id JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?4 AND a.project_id=?5 AND ${eligible} AND (?6=0 OR g.created_at>policy.enabled_at)
    AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id)`).bind(id("pub"), slug(12), now(), assetId, projectId, automatic ? 1 : 0).run();
  return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "created" : "skipped";
}
