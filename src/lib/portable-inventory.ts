// MIT. Read-only installation inventory and local bundle description, typed.
//
// Faithful strict-TypeScript extraction of the two read-only helpers that used
// to live in portable-bundle.mjs. That module re-exports both names, so the
// owner worker, CLI and portable project tests keep their existing import path.
// Nothing here authorizes, writes, restores, migrates or transports anything:
// the SQL strings, the project option (which filters only the import list) and
// the installation-wide duplicate/total aggregation are unchanged.

import type { FootagePlanEnv } from "./footage-plans.ts";

/** Reuse the repository's checked D1 read seam; this module only ever reads. */
type PortableInventoryEnv = Pick<FootagePlanEnv, "DB">;

/** One restored-import row, as selected by the inventory query. */
interface PortableImportRow {
  id: string;
  bundle_id: string;
  source_project_id: string;
  project_id: string;
  status: string;
  asset_count: number;
  byte_count: number;
  created_at: number;
  committed_at: number | null;
}

/** One duplicate-bytes group from the installation-wide aggregation. */
interface DuplicateGroupRow {
  project_id: string;
  sha256: string;
  n: number;
  bytes: number;
  asset_ids: string;
}

/** Installation-wide live-asset totals. */
interface AssetTotalsRow {
  assets: number;
  bytes: number;
}

export interface PortableImportSummary {
  importId: string;
  bundleId: string;
  sourceProjectId: string;
  projectId: string;
  status: string;
  assets: number;
  bytes: number;
  createdAt: number;
  committedAt: number | null;
}

export interface DuplicateContentSummary {
  projectId: string;
  sha256: string;
  count: number;
  bytesEach: number;
  wastedBytes: number;
  assetIds: string[];
}

export interface PortableInventoryReport {
  readOnly: true;
  generatedAt: number;
  totals: { assets: number; bytes: number };
  imports: PortableImportSummary[];
  duplicateContent: DuplicateContentSummary[];
}

/** `projectId` narrows only the import list; duplicates and totals stay
 * installation-wide, exactly as before. */
export interface PortableInventoryOptions {
  projectId?: string | null;
}

/** Read-only inventory. Useful for #158 duplicate review and restore support. */
export async function portableInventory(
  env: PortableInventoryEnv,
  { projectId = null }: PortableInventoryOptions = {}
): Promise<PortableInventoryReport> {
  const imports = (await (projectId
    ? env.DB.prepare('SELECT id,bundle_id,source_project_id,project_id,status,asset_count,byte_count,created_at,committed_at FROM project_bundle_imports WHERE project_id=?1 ORDER BY created_at DESC').bind(projectId).all<PortableImportRow>()
    : env.DB.prepare('SELECT id,bundle_id,source_project_id,project_id,status,asset_count,byte_count,created_at,committed_at FROM project_bundle_imports ORDER BY created_at DESC LIMIT 100').all<PortableImportRow>())).results;
  const duplicates = (await env.DB.prepare(
    'SELECT project_id,sha256,COUNT(*) AS n,SUM(bytes) AS bytes,GROUP_CONCAT(id) AS asset_ids FROM assets WHERE deleted_at IS NULL GROUP BY project_id,sha256 HAVING COUNT(*)>1 ORDER BY (COUNT(*)-1)*SUM(bytes) DESC LIMIT 100',
  ).all<DuplicateGroupRow>()).results.map((row) => ({
    projectId: row.project_id,
    sha256: row.sha256,
    count: row.n,
    bytesEach: Number(row.bytes) / row.n,
    wastedBytes: Number(row.bytes) - Number(row.bytes) / row.n,
    assetIds: String(row.asset_ids).split(','),
  }));
  // The aggregate query always returns exactly one row; the assertion is erased.
  const totals = (await env.DB.prepare('SELECT COUNT(*) AS assets,COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE deleted_at IS NULL').first<AssetTotalsRow>())!;
  return {
    readOnly: true,
    generatedAt: Date.now(),
    totals: { assets: totals.assets, bytes: totals.bytes },
    imports: imports.map((row) => ({ importId: row.id, bundleId: row.bundle_id, sourceProjectId: row.source_project_id, projectId: row.project_id, status: row.status, assets: row.asset_count, bytes: row.byte_count, createdAt: row.created_at, committedAt: row.committed_at })),
    duplicateContent: duplicates,
  };
}

/** The seven manifest fields the CLI description reads and passes through. */
export interface BundleDescriptionSource {
  format: string;
  schemaVersion: number;
  bundleId: string;
  project: unknown;
  stats: unknown;
  excluded: unknown;
  limits: unknown;
}

/** Same keys, same order, no derived fields. */
export type BundleDescription = BundleDescriptionSource;

/** Local validation helper used by the CLI before any network write. */
export function describeBundle(manifest: BundleDescriptionSource): BundleDescription {
  return {
    format: manifest.format,
    schemaVersion: manifest.schemaVersion,
    bundleId: manifest.bundleId,
    project: manifest.project,
    stats: manifest.stats,
    excluded: manifest.excluded,
    limits: manifest.limits,
  };
}
