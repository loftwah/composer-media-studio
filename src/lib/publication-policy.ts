// Explicit first-party publication policy. Never infer rights from an asset's source.
//
// This is a faithful move of publication-policy.mjs into strict TypeScript. The
// read-only inventory and its SQL helpers carry the checked narrow seams below;
// the policy, backfill and publish writes keep the same SQL, cursors, guards and
// local/remote behaviour. No Cloudflare types are imported and every annotation
// here is erased at runtime, so callers keep passing the same Worker env and D1
// rows they always did.
import { HttpError, id, now, slug } from "./util.mjs";
import { verifiedShareCredit } from "./publication-attribution.ts";
import { checkPublicImage } from "./public-image-privacy.ts";

// --- narrow, erased structural seams -------------------------------------

/** D1 returns EXISTS/CASE flags as 0|1 integers and COUNT() as a number. */
type Flag = 0 | 1;

interface PublicationStatement {
  bind(...values: unknown[]): PublicationStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ changes?: number; meta?: { changes?: number } }>;
}

/** The D1 read seam and the one R2 method the read-only inventory uses. */
export interface PublicationInventoryEnv {
  DB: { prepare(query: string): PublicationStatement };
  MEDIA: { head(key: string): Promise<unknown> };
}

/** The full Worker env this module is called with: adds the write-side seams. */
export interface PublicationEnv extends PublicationInventoryEnv {
  MEDIA: PublicationInventoryEnv["MEDIA"] & {
    get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
  FIRST_PARTY_PUBLICATION_PROJECTS?: unknown;
}

/** A policy row; all three columns are nullable in D1. */
interface PolicyRow {
  enabled: number | null;
  enabled_at: number | null;
  attested_at: number | null;
}
interface PolicyView {
  installationAllowed: boolean;
  enabled: boolean;
  enabledAt: number | null;
  attestedAt: number | null;
}

/** One asset row from the paged inventory SELECT, including computed flags. */
interface InventoryAssetRow {
  id: string;
  title: string;
  kind: string;
  source: string;
  created_at: number;
  sha256: string;
  parent_asset_id: string | null;
  deleted_at: number | null;
  r2_key: string;
  eligible: Flag;
  attribution_safe: Flag;
  source_verifiable: Flag;
  withdrawn: Flag;
  hidden: Flag;
  published: Flag;
}
/** UNION columns can be null when no reference was ever recorded. */
interface ReferenceRow {
  id: string | null;
}
interface DuplicateRow {
  sha256: string;
}
interface PublishedRow {
  id: string;
  sha256: string;
  slug: string;
}
/** The aggregate query always returns one row; the optional shape only guards
 * an absent binding. Counts are nullable only through that fallback. */
interface SummaryRow {
  total_assets?: number | null;
  active_assets?: number | null;
  deleted_assets?: number | null;
  saved_generated_outputs?: number | null;
  active_publications?: number | null;
  listed_publications?: number | null;
  unlisted_publications?: number | null;
  hidden_publications?: number | null;
  withdrawn_publications?: number | null;
  published_assets?: number | null;
  record_candidates?: number | null;
  duplicate_groups?: number | null;
  duplicate_assets?: number | null;
  versions?: number | null;
  reference_originals?: number | null;
  private_uploads?: number | null;
}

type InventoryStatus =
  | "ineligible"
  | "withdrawn"
  | "hidden"
  | "source_verification_available"
  | "attribution_review_required"
  | "existing"
  | "candidate";
type ExcludedReason =
  | "output_bytes_missing"
  | "duplicate_of_published"
  | "asset_deleted"
  | "reference_original"
  | "private_upload"
  | "not_a_saved_generated_output"
  | "previously_withdrawn"
  | "hidden_placement"
  | "attribution_review_required";

export interface InventoryItem {
  id: string;
  title: string;
  kind: string;
  source: string;
  status: InventoryStatus;
  eligible: boolean;
  excludedReason: ExcludedReason | null;
  duplicate: boolean;
  duplicateOfPublished: string | null;
  versionOf: string | null;
  storageMissing: boolean;
}
export interface InventoryReport {
  items: InventoryItem[];
  nextAfter: string | null;
  summary: {
    totalAssets: number;
    activeAssets: number;
    deletedAssets: number;
    savedGeneratedOutputs: number;
    activePublications: number;
    listedPublications: number;
    unlistedPublications: number;
    hiddenPublications: number;
    withdrawnPublications: number;
    publishedAssets: number;
    recordCandidates: number;
    duplicateGroups: number;
    duplicateAssets: number;
    versions: number;
    referenceOriginals: number;
    privateUploads: number;
    page: {
      returned: number;
      eligible: number;
      storageChecked: number;
      storageMissing: number;
    };
  };
}

interface BackfillOptions {
  limit?: unknown;
  after?: string;
}
type PublishOutcome =
  | "not_allowed"
  | "skipped"
  | "attribution_review_required"
  | "metadata_review_required"
  | "existing"
  | "created";
type BackfillOutcome = PublishOutcome | "bytes_missing";
interface BackfillCandidate {
  id: string;
  r2_key: string;
}
interface BackfillResult {
  assetId: string;
  result: BackfillOutcome;
}
interface BackfillReport {
  attempted: number;
  created: number;
  existing: number;
  held: number;
  skipped: number;
  missingBytes: number;
  results: BackfillResult[];
  nextAfter: string | null;
}

/** The publish-side candidate row: saved output plus its checked provenance. */
interface CandidateRow {
  id: string;
  project_id: string;
  kind: string;
  mime: string;
  bytes: number;
  sha256: string;
  generation_id: string | null;
  r2_key: string;
  request_json: string;
  parent_asset_id: string | null;
  reference_sha256: string | null;
  reference_caption: string | null;
  plain_safe: Flag;
  share_safe: Flag;
  chain_safe: Flag;
}
interface ChainRootRow {
  id: string;
  sha256: string;
  caption: string;
}
interface ExistingPublicationRow {
  id: string;
}

export function installationAllows(env: PublicationEnv, projectId: string): boolean {
  return String(env.FIRST_PARTY_PUBLICATION_PROJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean).includes(projectId);
}

export async function policyFor(env: PublicationEnv, projectId: string): Promise<PolicyView> {
  const row = await env.DB.prepare("SELECT * FROM publication_policies WHERE project_id=?1").bind(projectId).first<PolicyRow>();
  return { installationAllowed: installationAllows(env, projectId), enabled: Boolean(row?.enabled), enabledAt: row?.enabled_at ?? null, attestedAt: row?.attested_at ?? null };
}

export async function setPolicy(env: PublicationEnv, projectId: string, enabled: boolean, rightsConfirmed?: unknown): Promise<PolicyView> {
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
  AND g.model IN ('studio-print','studio-film','studio-craft','studio-draft','studio-quick','studio-score','studio-voice','studio-effect')
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

// A second bounded chain may end at one public Share upload. Every other
// node must be a saved, no-mask single-input generation with matching hash.
const shareChain = `EXISTS(WITH RECURSIVE chain(node_id,depth) AS (
    SELECT a.id,0 UNION ALL SELECT n.parent_asset_id,c.depth+1 FROM chain c JOIN assets n ON n.id=c.node_id
    WHERE n.parent_asset_id IS NOT NULL AND c.depth<8
  ) SELECT 1 WHERE EXISTS(SELECT 1 FROM chain c JOIN assets n ON n.id=c.node_id
    WHERE c.depth>=2 AND n.project_id=a.project_id AND n.deleted_at IS NULL AND n.source='upload' AND n.parent_asset_id IS NULL
      AND n.caption LIKE 'https://woodhouse.loftwah.com/api/v1/assets/%')
  AND NOT EXISTS(SELECT 1 FROM chain c LEFT JOIN assets n ON n.id=c.node_id LEFT JOIN generations ng ON ng.id=n.generation_id
    WHERE n.id IS NULL OR n.project_id!=a.project_id OR n.deleted_at IS NOT NULL
      OR NOT (n.source='upload' AND n.parent_asset_id IS NULL AND n.caption LIKE 'https://woodhouse.loftwah.com/api/v1/assets/%'
        OR (ng.id IS NOT NULL AND ng.project_id=n.project_id AND ng.status='saved' AND ng.deleted_at IS NULL AND ng.output_asset_id IS n.id AND COALESCE((${chainEdge}),0)=1))
      OR EXISTS(SELECT 1 FROM publications prior WHERE prior.asset_id=n.id AND (prior.revoked_at IS NOT NULL OR prior.hidden=1))))`;

// The four provenance paths are staged as separate UNION branches for the
// inventory count. D1 caps expression trees at depth 100; combining every path
// with the eligibility and publication guards in one OR exceeded that cap on a
// real project. Each branch below is no deeper than the page SELECT's own flag
// expressions, and UNION (distinct ids) keeps the counted set identical.
const recordCandidateBranches = [attributionSafe, generatedChain, directReference, shareChain]
  .map(
    (predicate) => `SELECT a.id FROM assets a LEFT JOIN generations g ON g.id=a.generation_id
      WHERE a.project_id=?1 AND ${eligible} AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id)
      AND ${predicate}`,
  )
  .join(" UNION ");

// Recheck that the exact public original verified before the write is still
// the root of this chain, not merely an unrelated asset with the same hash.
function shareRootProof(idParam: string, hashParam: string, captionParam: string): string {
  return `EXISTS(WITH RECURSIVE chain(node_id,depth) AS (
    SELECT a.id,0 UNION ALL SELECT n.parent_asset_id,c.depth+1 FROM chain c JOIN assets n ON n.id=c.node_id
    WHERE n.parent_asset_id IS NOT NULL AND c.depth<8
  ) SELECT 1 FROM chain c JOIN assets n ON n.id=c.node_id
    WHERE c.depth>=2 AND n.id=${idParam} AND n.project_id=a.project_id AND n.deleted_at IS NULL
      AND n.source='upload' AND n.parent_asset_id IS NULL AND n.sha256=${hashParam} AND n.caption=${captionParam})`;
}

export async function inventory(env: PublicationInventoryEnv, projectId: string, after = ""): Promise<InventoryReport> {
  const rows = await env.DB.prepare(`SELECT a.id,a.title,a.kind,a.source,a.created_at,a.sha256,a.parent_asset_id,a.deleted_at,a.r2_key,
    CASE WHEN ${eligible} THEN 1 ELSE 0 END AS eligible,
    CASE WHEN ${eligible} AND (${attributionSafe} OR ${generatedChain}) THEN 1 ELSE 0 END AS attribution_safe,
    CASE WHEN ${eligible} AND (${directReference} OR ${shareChain}) THEN 1 ELSE 0 END AS source_verifiable,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NOT NULL) AS withdrawn,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL AND p.hidden=1) AS hidden,
    EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id AND p.revoked_at IS NULL) AS published
    FROM assets a LEFT JOIN generations g ON g.id=a.generation_id WHERE a.project_id=?1 AND a.id>?2
    ORDER BY a.id LIMIT 26`).bind(projectId, after).all<InventoryAssetRow>();
  const page = rows.results.slice(0, 25);
  const [referenceRows, duplicateRows, publishedRows, summaryRow] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT parent_asset_id AS id FROM assets WHERE project_id=?1 AND parent_asset_id IS NOT NULL
      UNION SELECT DISTINCT json_extract(request_json,'$.referenceAssetId') FROM generations
        WHERE project_id=?1 AND json_valid(request_json) AND json_type(request_json,'$.referenceAssetId')='text'
      UNION SELECT DISTINCT json_extract(request_json,'$.maskAssetId') FROM generations
        WHERE project_id=?1 AND json_valid(request_json) AND json_type(request_json,'$.maskAssetId')='text'
      UNION SELECT DISTINCT json_extract(request_json,'$.parentAssetId') FROM generations
        WHERE project_id=?1 AND json_valid(request_json) AND json_type(request_json,'$.parentAssetId')='text'`)
      .bind(projectId)
      .all<ReferenceRow>(),
    env.DB.prepare("SELECT sha256 FROM assets WHERE project_id=?1 AND deleted_at IS NULL GROUP BY sha256 HAVING COUNT(*)>1")
      .bind(projectId)
      .all<DuplicateRow>(),
    env.DB.prepare(`SELECT a.id,a.sha256,p.slug FROM assets a JOIN publications p ON p.asset_id=a.id
      WHERE a.project_id=?1 AND a.deleted_at IS NULL AND p.revoked_at IS NULL`).bind(projectId).all<PublishedRow>(),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM assets WHERE project_id=?1) AS total_assets,
      (SELECT COUNT(*) FROM assets WHERE project_id=?1 AND deleted_at IS NULL) AS active_assets,
      (SELECT COUNT(*) FROM assets WHERE project_id=?1 AND deleted_at IS NOT NULL) AS deleted_assets,
      (SELECT COUNT(*) FROM assets a LEFT JOIN generations g ON g.id=a.generation_id WHERE a.project_id=?1 AND ${eligible}) AS saved_generated_outputs,
      (SELECT COUNT(*) FROM publications WHERE project_id=?1 AND revoked_at IS NULL) AS active_publications,
      (SELECT COUNT(*) FROM publications WHERE project_id=?1 AND revoked_at IS NULL AND listed=1 AND hidden=0) AS listed_publications,
      (SELECT COUNT(*) FROM publications WHERE project_id=?1 AND revoked_at IS NULL AND listed=0) AS unlisted_publications,
      (SELECT COUNT(*) FROM publications WHERE project_id=?1 AND revoked_at IS NULL AND hidden=1) AS hidden_publications,
      (SELECT COUNT(*) FROM publications WHERE project_id=?1 AND revoked_at IS NOT NULL) AS withdrawn_publications,
      (SELECT COUNT(DISTINCT asset_id) FROM publications WHERE project_id=?1 AND revoked_at IS NULL) AS published_assets,
      (SELECT COUNT(*) FROM (${recordCandidateBranches})) AS record_candidates,
      (SELECT COUNT(*) FROM (SELECT 1 FROM assets WHERE project_id=?1 AND deleted_at IS NULL GROUP BY sha256 HAVING COUNT(*)>1)) AS duplicate_groups,
      (SELECT COALESCE(SUM(n),0) FROM (SELECT COUNT(*) AS n FROM assets WHERE project_id=?1 AND deleted_at IS NULL GROUP BY sha256 HAVING COUNT(*)>1)) AS duplicate_assets,
      (SELECT COUNT(*) FROM assets WHERE project_id=?1 AND deleted_at IS NULL AND parent_asset_id IS NOT NULL) AS versions,
      (SELECT COUNT(*) FROM assets a WHERE a.project_id=?1 AND a.deleted_at IS NULL AND a.source='upload' AND ${referenceOf("a")}) AS reference_originals,
      (SELECT COUNT(*) FROM assets a WHERE a.project_id=?1 AND a.deleted_at IS NULL AND a.source='upload' AND NOT ${referenceOf("a")}) AS private_uploads`)
      .bind(projectId)
      .first<SummaryRow>(),
  ]);
  const referenced = new Set(referenceRows.results.map((row) => row.id).filter(Boolean));
  const duplicateHashes = new Set(duplicateRows.results.map((row) => row.sha256));
  const publishedBySha = new Map<string, string>();
  for (const row of publishedRows.results) if (!publishedBySha.has(row.sha256)) publishedBySha.set(row.sha256, row.slug);
  // R2 reads are bounded to the page (25 items) and only answer "do the saved
  // bytes still exist?", never content.
  const storageMissing = new Set<string>();
  await Promise.all(
    page
      .filter((asset) => !asset.deleted_at && asset.r2_key)
      .map(async (asset) => {
        try {
          if (!(await env.MEDIA.head(asset.r2_key))) storageMissing.add(asset.id);
        } catch {
          storageMissing.add(asset.id);
        }
      }),
  );
  const items = page.map((a) => {
    const status: InventoryStatus = !a.eligible
      ? "ineligible"
      : a.withdrawn
        ? "withdrawn"
        : a.hidden
          ? "hidden"
          : !a.attribution_safe && a.source_verifiable
            ? "source_verification_available"
            : !a.attribution_safe
              ? "attribution_review_required"
              : a.published
                ? "existing"
                : "candidate";
    const missing = storageMissing.has(a.id);
    const duplicatePublished = Boolean(!a.published && a.sha256 && publishedBySha.has(a.sha256));
    let excludedReason: ExcludedReason | null = null;
    if (status === "candidate") {
      if (missing) excludedReason = "output_bytes_missing";
      else if (duplicatePublished) excludedReason = "duplicate_of_published";
    } else if (status === "ineligible") {
      excludedReason = a.deleted_at
        ? "asset_deleted"
        : a.source === "upload"
          ? referenced.has(a.id)
            ? "reference_original"
            : "private_upload"
          : "not_a_saved_generated_output";
    } else if (status === "withdrawn") excludedReason = "previously_withdrawn";
    else if (status === "hidden") excludedReason = "hidden_placement";
    else if (status === "attribution_review_required") excludedReason = "attribution_review_required";
    return {
      id: a.id,
      title: a.title,
      kind: a.kind,
      source: a.source,
      status,
      eligible: status === "candidate" && !missing && !duplicatePublished,
      excludedReason,
      duplicate: Boolean(a.sha256 && duplicateHashes.has(a.sha256)),
      duplicateOfPublished: duplicatePublished ? publishedBySha.get(a.sha256)! : null,
      versionOf: a.parent_asset_id ?? null,
      storageMissing: missing,
    };
  });
  const summary = summaryRow ?? {};
  return {
    items,
    // The cursor page is non-empty whenever a 26th row was returned.
    nextAfter: rows.results.length > 25 ? page.at(-1)!.id : null,
    summary: {
      totalAssets: summary.total_assets ?? 0,
      activeAssets: summary.active_assets ?? 0,
      deletedAssets: summary.deleted_assets ?? 0,
      savedGeneratedOutputs: summary.saved_generated_outputs ?? 0,
      activePublications: summary.active_publications ?? 0,
      listedPublications: summary.listed_publications ?? 0,
      unlistedPublications: summary.unlisted_publications ?? 0,
      hiddenPublications: summary.hidden_publications ?? 0,
      withdrawnPublications: summary.withdrawn_publications ?? 0,
      publishedAssets: summary.published_assets ?? 0,
      recordCandidates: summary.record_candidates ?? 0,
      duplicateGroups: summary.duplicate_groups ?? 0,
      duplicateAssets: summary.duplicate_assets ?? 0,
      versions: summary.versions ?? 0,
      referenceOriginals: summary.reference_originals ?? 0,
      privateUploads: summary.private_uploads ?? 0,
      page: {
        returned: items.length,
        eligible: items.filter((item) => item.eligible).length,
        storageChecked: page.filter((asset) => !asset.deleted_at && asset.r2_key).length,
        storageMissing: items.filter((item) => item.storageMissing).length,
      },
    },
  };
}

/** A reference original is an upload that another asset or generation names. */
function referenceOf(alias: string): string {
  return `(EXISTS(SELECT 1 FROM assets c WHERE c.project_id=${alias}.project_id AND c.parent_asset_id=${alias}.id)
    OR EXISTS(SELECT 1 FROM generations r WHERE r.project_id=${alias}.project_id AND json_valid(r.request_json)
      AND (json_extract(r.request_json,'$.referenceAssetId')=${alias}.id OR json_extract(r.request_json,'$.maskAssetId')=${alias}.id)))`;
}

/**
 * Publish the next bounded page of already-eligible, still-unpublished saved
 * outputs. It is idempotent: any asset with a publication row (including a
 * withdrawn or hidden one) is never selected again, and items that share the
 * exact bytes of an already-published page are left out as duplicates.
 *
 * The caller must have explicitly confirmed the project policy and rights; this
 * function performs no selection beyond that and never runs on a GET.
 */
export async function boundedBackfill(env: PublicationEnv, projectId: string, { limit = 10, after = "" }: BackfillOptions = {}): Promise<BackfillReport> {
  const bounded = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const rows = await env.DB.prepare(`SELECT a.id,a.r2_key FROM assets a JOIN generations g ON g.id=a.generation_id
    WHERE a.project_id=?1 AND a.id>?2 AND ${eligible}
      AND (${attributionSafe} OR ${generatedChain} OR ${directReference} OR ${shareChain})
      AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM publications px JOIN assets ax ON ax.id=px.asset_id
        WHERE px.project_id=a.project_id AND px.revoked_at IS NULL AND ax.deleted_at IS NULL AND ax.sha256=a.sha256)
    ORDER BY a.id LIMIT ?3`).bind(projectId, after, bounded + 1).all<BackfillCandidate>();
  const page = rows.results.slice(0, bounded);
  const results: BackfillResult[] = [];
  for (const candidate of page) {
    const object = await env.MEDIA.head(candidate.r2_key).catch(() => null);
    if (!object) {
      results.push({ assetId: candidate.id, result: "bytes_missing" });
      continue;
    }
    results.push({ assetId: candidate.id, result: await publishCandidate(env, projectId, candidate.id) });
  }
  const count = (name: BackfillOutcome) => results.filter((item) => item.result === name).length;
  return {
    attempted: results.length,
    created: count("created"),
    existing: count("existing"),
    held: count("attribution_review_required") + count("metadata_review_required"),
    skipped: count("skipped") + count("not_allowed"),
    missingBytes: count("bytes_missing"),
    results,
    // Progress is by asset cursor, so a held or missing item cannot block the
    // next call forever. An empty page is the end of the bounded selection.
    nextAfter: page.length ? page.at(-1)!.id : null,
  };
}

// Recheck eligibility and policy in the write statement, serialising competing
// requests and preserving every existing URL and every withdrawal.
export async function publishCandidate(env: PublicationEnv, projectId: string, assetId: string, { automatic = false }: { automatic?: boolean } = {}): Promise<PublishOutcome> {
  if (!installationAllows(env, projectId)) return "not_allowed";
  const candidate = await env.DB.prepare(`SELECT a.*,g.request_json,ref.sha256 AS reference_sha256,ref.caption AS reference_caption,
    CASE WHEN ${attributionSafe} OR ${generatedChain} THEN 1 ELSE 0 END AS plain_safe,
    CASE WHEN ${directReference} THEN 1 ELSE 0 END AS share_safe,
    CASE WHEN ${shareChain} THEN 1 ELSE 0 END AS chain_safe
    FROM assets a JOIN generations g ON g.id=a.generation_id JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    LEFT JOIN assets ref ON ref.id=a.parent_asset_id AND ref.project_id=a.project_id
    WHERE a.id=?1 AND a.project_id=?2 AND ${eligible} AND (?3=0 OR g.created_at>policy.enabled_at)
    AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=a.id AND (w.revoked_at IS NOT NULL OR w.hidden=1))`).bind(assetId,projectId,automatic ? 1 : 0).first<CandidateRow>();
  if (!candidate) return "skipped";
  if (!candidate.plain_safe && !candidate.share_safe && !candidate.chain_safe) return "attribution_review_required";
  // Automatic retries must not re-list existing pages, or make network calls for them.
  if (automatic && await env.DB.prepare("SELECT id FROM publications WHERE asset_id=?1 LIMIT 1").bind(assetId).first()) return "existing";
  try {
    await checkPublicImage(env, candidate, candidate.request_json);
  } catch (error) {
    if ((error as { code?: string }).code === "publication_metadata_unverified") return "metadata_review_required";
    throw error;
  }
  let attribution: Awaited<ReturnType<typeof verifiedShareCredit>> = [];
  let chainRoot: ChainRootRow | null = null;
  if (!candidate.plain_safe) {
    if (candidate.chain_safe) {
      chainRoot = await env.DB.prepare(`WITH RECURSIVE chain(node_id,depth) AS (
        SELECT ?1,0 UNION ALL SELECT n.parent_asset_id,c.depth+1 FROM chain c JOIN assets n ON n.id=c.node_id
        WHERE n.parent_asset_id IS NOT NULL AND c.depth<8
      ) SELECT n.id,n.sha256,n.caption FROM chain c JOIN assets n ON n.id=c.node_id
        WHERE c.depth>=2 AND n.project_id=?2 AND n.deleted_at IS NULL AND n.source='upload' AND n.parent_asset_id IS NULL LIMIT 1`).bind(assetId,projectId).first<ChainRootRow>();
      if (!chainRoot) return "attribution_review_required";
    }
    attribution = await verifiedShareCredit(chainRoot ?? { caption: candidate.reference_caption, sha256: candidate.reference_sha256 });
    if (!attribution) return "attribution_review_required";
  }
  const attributionJson = JSON.stringify(attribution);
  // Bind the exact validated generation record and parent hash in the write so
  // a changed provenance cannot inherit a stale credit during verification.
  const proof = `g.request_json=?4 AND ((?5 IS NULL AND a.parent_asset_id IS NULL) OR (a.parent_asset_id=?5 AND EXISTS(SELECT 1 FROM assets ref WHERE ref.id=?5 AND ref.project_id=a.project_id AND ref.deleted_at IS NULL AND ref.sha256=?6 AND ref.caption=?7)))`;
  const active = await env.DB.prepare(`SELECT p.id FROM publications p JOIN assets a ON a.id=p.asset_id JOIN generations g ON g.id=a.generation_id
    JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?1 AND a.project_id=?2 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference} OR (${shareChain} AND ${shareRootProof('?8','?9','?10')})) AND ${proof} AND p.revoked_at IS NULL AND p.hidden=0
    AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=a.id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
    AND (?3=0 OR g.created_at>policy.enabled_at) LIMIT 1`).bind(assetId, projectId, automatic ? 1 : 0, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption, chainRoot?.id ?? null, chainRoot?.sha256 ?? null, chainRoot?.caption ?? null).first<ExistingPublicationRow>();
  if (active) {
    // A saved-job retry must never undo a deliberate unlisting. Only an
    // explicitly confirmed reconciliation may list an existing page.
    if (automatic) return "existing";
    const result = await env.DB.prepare(`UPDATE publications SET listed=1,attribution_json=?3 WHERE id=?1 AND revoked_at IS NULL AND hidden=0 AND (attribution_json='[]' OR attribution_json=?3)
      AND EXISTS(SELECT 1 FROM publication_policies policy WHERE policy.project_id=?2 AND policy.enabled=1)
      AND NOT EXISTS(SELECT 1 FROM publications w WHERE w.asset_id=publications.asset_id AND (w.revoked_at IS NOT NULL OR w.hidden=1))
      AND EXISTS(SELECT 1 FROM assets a JOIN generations g ON g.id=a.generation_id WHERE a.id=publications.asset_id AND a.project_id=?2 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference} OR (${shareChain} AND ${shareRootProof('?8','?9','?10')})) AND ${proof})`).bind(active.id, projectId, attributionJson, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption, chainRoot?.id ?? null, chainRoot?.sha256 ?? null, chainRoot?.caption ?? null).run();
    return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "existing" : "skipped";
  }
  const result = await env.DB.prepare(`INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,attribution_json)
    SELECT ?1,a.project_id,a.id,?2,CASE a.kind WHEN 'video' THEN 'Generated film' WHEN 'audio' THEN 'Generated sound' ELSE 'Generated image' END,'',a.delete_revision,?3,1,?7
    FROM assets a JOIN generations g ON g.id=a.generation_id JOIN publication_policies policy ON policy.project_id=a.project_id AND policy.enabled=1
    WHERE a.id=?4 AND a.project_id=?5 AND ${eligible} AND (${attributionSafe} OR ${generatedChain} OR ${directReference} OR (${shareChain} AND ${shareRootProof('?12','?13','?14')})) AND g.request_json=?8 AND ((?9 IS NULL AND a.parent_asset_id IS NULL) OR (a.parent_asset_id=?9 AND EXISTS(SELECT 1 FROM assets ref WHERE ref.id=?9 AND ref.project_id=a.project_id AND ref.deleted_at IS NULL AND ref.sha256=?10 AND ref.caption=?11))) AND (?6=0 OR g.created_at>policy.enabled_at)
    AND NOT EXISTS(SELECT 1 FROM publications p WHERE p.asset_id=a.id)`).bind(id("pub"), slug(12), now(), assetId, projectId, automatic ? 1 : 0, attributionJson, candidate.request_json, candidate.parent_asset_id, candidate.reference_sha256, candidate.reference_caption, chainRoot?.id ?? null, chainRoot?.sha256 ?? null, chainRoot?.caption ?? null).run();
  return (result.meta?.changes ?? result.changes ?? 0) > 0 ? "created" : "skipped";
}
