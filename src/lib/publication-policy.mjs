// Explicit first-party publication policy. Never infer rights from an asset's source.
import { HttpError, id, now, slug } from "./util.mjs";
import { verifiedShareCredit } from "./publication-attribution.mjs";

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

// Only documented, reference-free generation shapes can be published without
// source attribution. Fail closed on legacy/unknown records, references, edits
// and assembled media until their full public credit and licence are available.
const attributionSafe = `a.source='generated' AND a.parent_asset_id IS NULL AND g.composition_id IS NULL
  AND g.model IN ('studio-print','studio-film','studio-draft','studio-quick','studio-score','studio-voice','studio-effect')
  AND CASE WHEN json_valid(g.request_json) THEN
    json_type(g.request_json)='object'
    AND json_type(g.request_json,'$.referenceAssetId')='null'
    AND (json_type(g.request_json,'$.referenceSha256') IS NULL OR json_type(g.request_json,'$.referenceSha256')='null')
    AND json_type(g.request_json,'$.parentAssetId')='null'
    AND (json_type(g.request_json,'$.maskAssetId') IS NULL OR json_type(g.request_json,'$.maskAssetId')='null')
    AND (json_type(g.request_json,'$.maskSha256') IS NULL OR json_type(g.request_json,'$.maskSha256')='null')
    AND json_type(g.request_json,'$.compositionId') IS NULL
    AND json_type(g.request_json,'$.shots') IS NULL
    AND json_type(g.request_json,'$.audioAssetId') IS NULL
    AND json_type(g.request_json,'$.audioTracks') IS NULL
    AND json_type(g.request_json,'$.slateAssetId') IS NULL
    AND json_type(g.request_json,'$.slateVideoAssetId') IS NULL
  ELSE 0 END`;

// A narrow, one-input path. Multi-input and unknown models remain held.
const directReference = `a.source IN ('generated','variant') AND a.parent_asset_id IS NOT NULL AND g.composition_id IS NULL
  AND g.model IN ('h3-max-turbo','hailuo-standard','kling-standard','studio-detail','studio-cutout','studio-upscale')
  AND CASE WHEN json_valid(g.request_json) THEN
    json_type(g.request_json)='object'
    AND json_extract(g.request_json,'$.referenceAssetId')=a.parent_asset_id
    AND (json_type(g.request_json,'$.parentAssetId') IS NULL OR json_type(g.request_json,'$.parentAssetId')='null' OR json_extract(g.request_json,'$.parentAssetId')=a.parent_asset_id)
    AND (json_type(g.request_json,'$.maskAssetId') IS NULL OR json_type(g.request_json,'$.maskAssetId')='null')
    AND json_type(g.request_json,'$.compositionId') IS NULL AND json_type(g.request_json,'$.shots') IS NULL
    AND json_type(g.request_json,'$.audioAssetId') IS NULL AND json_type(g.request_json,'$.audioTracks') IS NULL
    AND json_type(g.request_json,'$.slateAssetId') IS NULL AND json_type(g.request_json,'$.slateVideoAssetId') IS NULL
  ELSE 0 END
  AND EXISTS(SELECT 1 FROM assets ref WHERE ref.id=a.parent_asset_id AND ref.project_id=a.project_id AND ref.source='upload' AND ref.deleted_at IS NULL
    AND ref.sha256=json_extract(g.request_json,'$.referenceSha256')
    AND ref.caption LIKE 'https://woodhouse.loftwah.com/api/v1/assets/%')`;

// Linear chains of one-input, no-mask generation can terminate at a verified
// reference-free generated root. Bound depth and reject missing/cyclic inputs.
const rootForChain = attributionSafe.replace(/\ba\./g, "n.").replace(/\bg\./g, "ng.");
const chainEdge = `n.source IN ('generated','variant') AND n.parent_asset_id IS NOT NULL
  AND ng.composition_id IS NULL AND ng.model IN ('h3-max-turbo','hailuo-standard','kling-standard','studio-detail','studio-cutout','studio-upscale')
  AND CASE WHEN json_valid(ng.request_json) THEN json_type(ng.request_json)='object'
    AND json_extract(ng.request_json,'$.referenceAssetId')=n.parent_asset_id
    AND (json_type(ng.request_json,'$.parentAssetId') IS NULL OR json_type(ng.request_json,'$.parentAssetId')='null' OR json_extract(ng.request_json,'$.parentAssetId')=n.parent_asset_id)
    AND (json_type(ng.request_json,'$.maskAssetId') IS NULL OR json_type(ng.request_json,'$.maskAssetId')='null')
    AND (json_type(ng.request_json,'$.maskSha256') IS NULL OR json_type(ng.request_json,'$.maskSha256')='null')
    AND json_type(ng.request_json,'$.compositionId') IS NULL AND json_type(ng.request_json,'$.shots') IS NULL
    AND json_type(ng.request_json,'$.audioAssetId') IS NULL AND json_type(ng.request_json,'$.audioTracks') IS NULL
    AND json_type(ng.request_json,'$.slateAssetId') IS NULL AND json_type(ng.request_json,'$.slateVideoAssetId') IS NULL
    AND EXISTS(SELECT 1 FROM assets parent WHERE parent.id=n.parent_asset_id AND parent.project_id=n.project_id AND parent.deleted_at IS NULL AND parent.sha256=json_extract(ng.request_json,'$.referenceSha256'))
  ELSE 0 END`;
const generatedChain = `EXISTS(WITH RECURSIVE chain(node_id,depth) AS (
    SELECT a.id,0 UNION ALL SELECT n.parent_asset_id,c.depth+1 FROM chain c JOIN assets n ON n.id=c.node_id
    WHERE n.parent_asset_id IS NOT NULL AND c.depth<8
  ) SELECT 1 WHERE EXISTS(SELECT 1 FROM chain c JOIN assets n ON n.id=c.node_id JOIN generations ng ON ng.id=n.generation_id
    WHERE n.project_id=a.project_id AND n.deleted_at IS NULL AND ng.project_id=n.project_id AND ng.status='saved' AND ng.deleted_at IS NULL AND ng.output_asset_id=n.id AND ${rootForChain})
  AND NOT EXISTS(SELECT 1 FROM chain c LEFT JOIN assets n ON n.id=c.node_id LEFT JOIN generations ng ON ng.id=n.generation_id
    WHERE n.id IS NULL OR n.project_id!=a.project_id OR n.deleted_at IS NOT NULL OR ng.id IS NULL OR ng.project_id!=n.project_id OR ng.status!='saved' OR ng.deleted_at IS NOT NULL OR ng.output_asset_id IS NOT n.id OR COALESCE((${rootForChain} OR ${chainEdge}),0)=0
       OR EXISTS(SELECT 1 FROM publications prior WHERE prior.asset_id=n.id AND (prior.revoked_at IS NOT NULL OR prior.hidden=1))))`;

export async function inventory(env, projectId, after = "") {
  const rows = await env.DB.prepare(`SELECT a.id,a.title,a.kind,a.source,a.created_at,
    CASE WHEN ${eligible} THEN 1 ELSE 0 END AS eligible,
    CASE WHEN ${eligible} AND (${attributionSafe} OR ${generatedChain}) THEN 1 ELSE 0 END AS attribution_safe,
    CASE WHEN ${eligible} AND ${directReference} THEN 1 ELSE 0 END AS source_verifiable,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NOT NULL) AS withdrawn,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL AND p.hidden=1) AS hidden,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL) AS published
    FROM assets a LEFT JOIN generations g ON g.id=a.generation_id WHERE a.project_id=?1 AND a.id>?2
    ORDER BY a.id LIMIT 26`).bind(projectId, after).all();
  const page = rows.results.slice(0, 25);
  return { items: page.map((a) => ({ id:a.id, title:a.title, kind:a.kind, source:a.source, status: !a.eligible ? "ineligible" : a.withdrawn ? "withdrawn" : a.hidden ? "hidden" : !a.attribution_safe && a.source_verifiable ? "source_verification_available" : !a.attribution_safe ? "attribution_review_required" : a.published ? "existing" : "candidate" })), nextAfter: rows.results.length > 25 ? page.at(-1).id : null };
}

// Recheck eligibility and policy in the write statement, serialising competing
// requests and preserving every existing URL and every withdrawal.
export async function publishCandidate(env, projectId, assetId, { automatic = false } = {}) {
  if (!installationAllows(env, projectId)) return "not_allowed";
  const candidate = await env.DB.prepare(`SELECT a.parent_asset_id,g.request_json,ref.sha256 AS reference_sha256,ref.caption AS reference_caption,
    CASE WHEN ${attributionSafe} OR ${generatedChain} THEN 1 ELSE 0 END AS plain_safe,
    CASE WHEN ${directReference} THEN 1 ELSE 0 END AS share_safe
    FROM assets a JOIN generations g ON g.id=a.generation_id JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    LEFT JOIN assets ref ON ref.id=a.parent_asset_id AND ref.project_id=a.project_id
    WHERE a.id=?1 AND a.project_id=?2 AND ${eligible} AND (?3=0 OR g.created_at>policy.enabled_at)
    AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=a.id AND (w.revoked_at IS NOT NULL OR w.hidden=1))`).bind(assetId,projectId,automatic ? 1 : 0).first();
  if (!candidate) return "skipped";
  if (!candidate.plain_safe && !candidate.share_safe) return "attribution_review_required";
  // Automatic retries must not re-list existing pages, or make network calls for them.
  if (automatic && await env.DB.prepare("SELECT id FROM publications WHERE asset_id=?1 LIMIT 1").bind(assetId).first()) return "existing";
  let attribution = [];
  if (!candidate.plain_safe) {
    attribution = await verifiedShareCredit({ caption: candidate.reference_caption, sha256: candidate.reference_sha256 });
    if (!attribution) return "attribution_review_required";
  }
  const attributionJson = JSON.stringify(attribution);
  // Bind the exact validated generation record and parent hash in the write so
  // a changed provenance cannot inherit a stale credit during verification.
  const proof = `g.request_json=?4 AND ((?5 IS NULL AND a.parent_asset_id IS NULL) OR (a.parent_asset_id=?5 AND EXISTS(SELECT 1 FROM assets ref WHERE ref.id=?5 AND ref.project_id=a.project_id AND ref.deleted_at IS NULL AND ref.sha256=?6 AND ref.caption=?7)))`;
  const active = await env.DB.prepare(`SELECT p.id FROM publications p JOIN assets a ON a.id=p.asset_id JOIN generations g ON g.id=a.generation_id
    JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?1 AND a.project_id=?2 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference}) AND ${proof} AND p.revoked_at IS NULL AND p.hidden=0
    AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=a.id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
    AND (?3=0 OR g.created_at>policy.enabled_at) LIMIT 1`).bind(assetId, projectId, automatic ? 1 : 0, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption).first();
  if (active) {
    // A saved-job retry must never undo a deliberate unlisting. Only an
    // explicitly confirmed reconciliation may list an existing page.
    if (automatic) return "existing";
    const result = await env.DB.prepare(`UPDATE publications SET listed=1,attribution_json=?3 WHERE id=?1 AND revoked_at IS NULL AND hidden=0 AND (attribution_json='[]' OR attribution_json=?3)
      AND EXISTS(SELECT 1 FROM publication_policies policy WHERE policy.project_id=?2 AND policy.enabled=1)
      AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=publications.asset_id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
      AND EXISTS(SELECT 1 FROM assets a JOIN generations g ON g.id=a.generation_id WHERE a.id=publications.asset_id AND a.project_id=?2 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference}) AND ${proof})`).bind(active.id, projectId, attributionJson, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption).run();
    return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "existing" : "skipped";
  }
  const result = await env.DB.prepare(`INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,attribution_json)
    SELECT ?1,a.project_id,a.id,?2,CASE a.kind WHEN 'video' THEN 'Generated film' WHEN 'audio' THEN 'Generated sound' ELSE 'Generated image' END,'',a.delete_revision,?3,1,?7
    FROM assets a JOIN generations g ON g.id=a.generation_id JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?4 AND a.project_id=?5 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference}) AND g.request_json=?8 AND ((?9 IS NULL AND a.parent_asset_id IS NULL) OR (a.parent_asset_id=?9 AND EXISTS(SELECT 1 FROM assets ref WHERE ref.id=?9 AND ref.project_id=a.project_id AND ref.deleted_at IS NULL AND ref.sha256=?10 AND ref.caption=?11))) AND (?6=0 OR g.created_at>policy.enabled_at)
    AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id)`).bind(id("pub"), slug(12), now(), assetId, projectId, automatic ? 1 : 0, attributionJson, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption).run();
  return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "created" : "skipped";
}
