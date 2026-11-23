// MIT. Read-only public catalogue and related-work queries.
//
// This is a faithful move of the Worker's public browse reads into strict
// TypeScript. The SQL strings, their parameter order, the listed/public
// boundary, the fixed query counts and the returned shapes are unchanged. No
// Cloudflare types are imported and every annotation here is erased at runtime,
// so callers keep passing the same Worker env and D1 rows they always did.

import type { GalleryCardItem } from "./gallery-cards.ts";
import type { PublicGalleryProject } from "./public-gallery.ts";

// --- narrow, erased structural seams -------------------------------------

interface PublicWorksStatement {
  bind(...values: unknown[]): PublicWorksStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
}

interface PublicCatalogueEnv {
  DB: { prepare(query: string): PublicWorksStatement };
}

interface FacetRow {
  facet: string;
  value: string;
  label: string;
  works: number;
}

interface TotalRow {
  total: number;
}

/** The card projection shared by the catalogue and the related-work strip. */
interface PublicWorkRow extends GalleryCardItem {
  created_at: number;
  mime: string | null;
}

/** The catalogue card projection adds the currently selected project and capability. */
interface CatalogueWorkRow extends PublicWorkRow {
  project_name: string;
  capability: string | null;
}

export interface PublicCatalogueOptions {
  query?: string;
  kind?: string;
  order?: string;
  project?: string;
  capability?: string;
  withFacets?: boolean;
}

export interface PublicCatalogueResult {
  items: CatalogueWorkRow[];
  hasMore: boolean;
  total: number;
  projects: PublicGalleryProject[];
  capabilities: string[];
  project: string;
  capability: string;
}

// Capability is derived from stored lineage only: never from a title, a prompt
// or a filename. `assembled` records a composition or multi-track assembly;
// `refinement` is an edit of an existing asset (mask, edit model or saved
// variant); `variation` used an existing asset as its input; `original` is a
// saved generation with no recorded input asset. Uploads, deleted or unreadable
// generation records stay absent and never match a capability filter.
const capabilitySql = `CASE
  WHEN a.source='assembled' OR g.composition_id IS NOT NULL THEN 'assembled'
  WHEN json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
    json_type(g.request_json,'$.shots') IN ('array','object')
    OR json_type(g.request_json,'$.audioTracks')='array'
    OR json_type(g.request_json,'$.slateAssetId')='text'
    OR json_type(g.request_json,'$.slateVideoAssetId')='text'
  ) THEN 'assembled'
  WHEN (a.source='variant' AND a.parent_asset_id IS NOT NULL)
    OR (json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
      json_type(g.request_json,'$.maskAssetId')='text'
      OR json_type(g.request_json,'$.maskSha256')='text'
      OR g.model IN ('studio-fill','studio-cutout','studio-upscale','kling-o1-restyle')
    )) THEN 'refinement'
  WHEN a.parent_asset_id IS NOT NULL
    OR (json_valid(g.request_json) AND json_type(g.request_json)='object' AND (
      json_type(g.request_json,'$.referenceAssetId')='text'
      OR json_type(g.request_json,'$.parentAssetId')='text'
    )) THEN 'variation'
  WHEN a.source='generated' AND json_valid(g.request_json) AND json_type(g.request_json)='object' THEN 'original'
  ELSE NULL END`;

// The public browse facets are a stable, small taxonomy rather than whatever a
// single page happens to contain.
const CAPABILITY_ORDER = ["original", "variation", "refinement", "assembled"];

// One CTE keeps the card query, its total and its facet options on exactly the
// same public boundary. `listed=1` is the deliberate listing decision: hidden,
// unlisted, withdrawn and privately published rows never enter `works`.
const publicWorksSql = `WITH works AS (
  SELECT p.id,p.project_id,p.slug,p.title,p.description,p.created_at,a.kind,a.mime,a.width,a.height,
    pr.slug AS project_slug,pr.name AS project_name,
    poster.id AS poster_asset_id,poster.width AS poster_width,poster.height AS poster_height,
    t.publication_id AS thumb_id,t.width AS thumb_width,t.height AS thumb_height,
    pd.publication_id AS poster_preview_id,pd.width AS poster_preview_width,pd.height AS poster_preview_height,
    ${capabilitySql} AS capability
  FROM publications p
  JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
  JOIN projects pr ON pr.id=p.project_id
  LEFT JOIN generations g ON g.id=a.generation_id AND g.project_id=p.project_id AND g.deleted_at IS NULL
  LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
  LEFT JOIN publication_derivatives t ON t.publication_id=p.id AND t.kind='thumb'
  LEFT JOIN publication_derivatives pd ON pd.publication_id=p.id AND pd.kind='poster' AND pd.source_sha256=poster.sha256
  WHERE p.listed=1 AND p.hidden=0 AND p.revoked_at IS NULL AND a.deleted_at IS NULL
)`;
const publicWorksFilter = `WHERE (?1 = '' OR instr(lower(title), lower(?1)) > 0 OR instr(lower(description), lower(?1)) > 0)
  AND (?2 = '' OR kind = ?2)
  AND (?3 = '' OR project_slug = ?3)
  AND (?4 = '' OR capability = ?4)`;

/**
 * Read the public catalogue, its honest total and the facets that actually have
 * at least one listed work. Unknown project or capability values are ignored,
 * matching the existing invalid-kind fallback, so a stale link still renders.
 * The query count is fixed (three for the gallery, two for the home preview) and
 * never grows with the number of cards.
 */
export async function publicCatalogue(
  env: PublicCatalogueEnv,
  page = 1,
  limit = 24,
  { query = "", kind = "", order = "newest", project = "", capability = "", withFacets = true }: PublicCatalogueOptions = {},
): Promise<PublicCatalogueResult> {
  const direction = order === "oldest" ? "ASC" : "DESC";
  let facets: { projects: PublicGalleryProject[]; capabilities: string[] } = { projects: [], capabilities: [] };
  if (withFacets) {
    const facetRows = await env.DB.prepare(`${publicWorksSql}
      SELECT 'project' AS facet,project_slug AS value,project_name AS label,COUNT(*) AS works FROM works
      GROUP BY project_slug,project_name
      UNION ALL
      SELECT 'capability' AS facet,capability AS value,capability AS label,COUNT(*) AS works FROM works
      WHERE capability IS NOT NULL GROUP BY capability
      ORDER BY facet,label COLLATE NOCASE`).all<FacetRow>();
    const projectFacets = facetRows.results.filter((row) => row.facet === "project");
    const present = new Set(facetRows.results.filter((row) => row.facet === "capability").map((row) => row.value));
    facets = {
      projects: projectFacets.map((row) => ({ value: row.value, label: row.label })),
      capabilities: CAPABILITY_ORDER.filter((value) => present.has(value)),
    };
  }
  const selectedProject = facets.projects.some((entry) => entry.value === project) ? project : "";
  const selectedCapability = facets.capabilities.includes(capability) ? capability : "";
  const [result, count] = await Promise.all([
    env.DB.prepare(`${publicWorksSql}
      SELECT slug,title,description,created_at,kind,mime,width,height,project_name,capability,
        poster_asset_id,poster_width,poster_height,thumb_id,thumb_width,thumb_height,
        poster_preview_id,poster_preview_width,poster_preview_height
      FROM works ${publicWorksFilter}
      ORDER BY created_at ${direction},id ${direction} LIMIT ?5 OFFSET ?6`)
      .bind(query, kind, selectedProject, selectedCapability, limit + 1, (page - 1) * limit)
      .all<CatalogueWorkRow>(),
    env.DB.prepare(`${publicWorksSql} SELECT COUNT(*) AS total FROM works ${publicWorksFilter}`)
      .bind(query, kind, selectedProject, selectedCapability)
      .first<TotalRow>(),
  ]);
  return {
    items: result.results.slice(0, limit),
    hasMore: result.results.length > limit,
    total: count?.total ?? 0,
    projects: facets.projects,
    capabilities: facets.capabilities,
    project: selectedProject,
    capability: selectedCapability,
  };
}

/**
 * Up to three other listed, still-public works from the SAME project as the
 * current page. This reuses the exact `works` public boundary above — listed,
 * not hidden, not withdrawn and backed by a live asset — so an unlisted,
 * private, withdrawn or deleted work can never enter, and a different project
 * is excluded by its stored project id rather than a guessed relationship.
 * One bounded query, deterministic newest-first order (id breaks ties), no
 * facets. The caller checks that the current work is also listed.
 */
export async function relatedWorks(
  env: PublicCatalogueEnv,
  projectId: string | null | undefined,
  excludeId: string | null | undefined,
): Promise<PublicWorkRow[]> {
  if (!projectId || !excludeId) return [];
  const result = await env.DB.prepare(`${publicWorksSql}
    SELECT slug,title,description,created_at,kind,mime,width,height,
      thumb_id,thumb_width,thumb_height,poster_asset_id,poster_width,poster_height,
      poster_preview_id,poster_preview_width,poster_preview_height
    FROM works WHERE project_id=?1 AND id!=?2
    ORDER BY created_at DESC, id DESC LIMIT 3`)
    .bind(projectId, excludeId)
    .all<PublicWorkRow>();
  return result.results;
}
