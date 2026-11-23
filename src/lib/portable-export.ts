// MIT. Read-only portable project export, typed.
//
// Faithful strict-TypeScript extraction of exportProjectManifest from
// portable-bundle.mjs. That module re-exports this same function, so the owner
// worker, CLI, API and fixture tests keep their existing portable-bundle
// import path.
//
// This module only reads D1 within one project and seals the resulting
// manifest. It does not write, restore, commit, clean up, authorize, migrate or
// touch R2. The SQL strings, selection order, project scope, id normalization,
// per-kind media bounds, tombstones, exclusions and shared validation are
// unchanged. Media bytes are still read by the export CLI, which verifies each
// stored hash before writing it into the archive.

import type { FootagePlanEnv } from "./footage-plans.ts";
import { HttpError, safeJson } from "./util.mjs";
import {
  AUDIO_BYTES,
  IMAGE_BYTES,
  scanSecrets,
  validateManifest,
} from "./portable-validation.ts";
import {
  MAX_PORTABLE_ASSET_BYTES,
  MAX_PORTABLE_BUNDLE_BYTES,
  MAX_PORTABLE_ASSETS,
  MAX_PORTABLE_RECORDS,
  PORTABLE_FORMAT,
  SHA256_HEX,
  sealManifest,
} from "./portable-manifest.ts";

/** Reuse the repository's checked D1 read seam; this module only ever reads. */
type PortableExportEnv = Pick<FootagePlanEnv, "DB">;

/** The project row the export reads; other D1 columns are ignored. */
export interface PortableExportProject {
  id: string;
  name: string;
  slug: string;
  creative_direction: string;
  references_json: string;
  visibility: string;
  defaults_json: string;
  created_at: number;
  updated_at: number;
}

/** Asset columns read into the manifest and the media bounds. */
interface AssetRow {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sample_rate: number | null;
  channels: number | null;
  sha256: string;
  title: string;
  caption: string;
  source: string;
  parent_asset_id: string | null;
  generation_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  delete_revision: number;
}

/** Generation columns read into the manifest. */
interface GenerationRow {
  id: string;
  composition_id: string | null;
  client_request_id: string;
  kind: string;
  recipe_id: string;
  provider: string;
  model: string;
  model_version: string;
  request_json: string;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  retained_bytes: number | null;
  retained_mime: string | null;
  output_asset_id: string | null;
  cost_estimate_micro: number;
  cost_reserved_micro: number;
  cost_allocated_micro: number | null;
  provider_charged_micro: number | null;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  deleted_at: number | null;
  delete_revision: number;
}

/** Storyboard columns read into the manifest. */
interface CompositionRow {
  id: string;
  title: string;
  spec_json: string;
  created_at: number;
  updated_at: number;
}

/** Recipe columns read into the manifest. */
interface RecipeRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  prompt_template: string;
  controls_json: string;
  version: number;
  created_at: number;
}

/** Subject-version columns read into the manifest. */
interface SubjectRow {
  subject_id: string;
  revision: number;
  spec_json: string;
  reference_asset_id: string;
  reference_sha256: string;
  created_at: number;
}

/** Song-plan columns read into the manifest. */
interface SongPlanRow {
  id: string;
  song_asset_id: string;
  song_sha256: string;
  spec_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

/** Footage-plan columns read into the manifest. */
interface FootagePlanRow {
  id: string;
  source_asset_id: string;
  source_sha256: string;
  spec_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

/** Publication columns read into the manifest. */
interface PublicationRow {
  id: string;
  asset_id: string;
  poster_asset_id: string | null;
  slug: string;
  title: string;
  description: string;
  asset_revision: number;
  listed: number;
  hidden: number;
  attribution_json: string;
  created_at: number;
  revoked_at: number | null;
}

/** Promo-brief columns read into the manifest. */
interface PromoBriefRow {
  id: string;
  spec_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

/** One distinct media blob listed in the archive. */
interface PortableBlobEntry {
  sha256: string;
  path: string;
  bytes: number;
  mime: string;
}

/** One asset record after media/tombstone classification. */
interface ExportedAssetRecord {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  blobSha256: string | null;
  content: "media" | "tombstone";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  sha256: string;
  title: string;
  caption: string;
  source: string;
  parentAssetId: string | null;
  generationId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  deleteRevision: number;
}

async function rows<T>(
  env: PortableExportEnv,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...values).all<T>()).results;
}

/** Build a manifest from D1 metadata. Media bytes are read by the export CLI,
 * which verifies each stored hash before writing it into the archive. */
export async function exportProjectManifest(
  env: PortableExportEnv,
  project: PortableExportProject
): Promise<Record<string, unknown>> {
  const assets = await rows<AssetRow>(
    env,
    "SELECT * FROM assets WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const generations = await rows<GenerationRow>(
    env,
    "SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const compositions = await rows<CompositionRow>(
    env,
    "SELECT * FROM compositions WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const recipes = await rows<RecipeRow>(
    env,
    "SELECT * FROM recipes WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const subjects = await rows<SubjectRow>(
    env,
    "SELECT * FROM subject_versions WHERE project_id=?1 ORDER BY subject_id ASC,revision ASC",
    project.id
  );
  const songPlans = await rows<SongPlanRow>(
    env,
    "SELECT * FROM song_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const footagePlans = await rows<FootagePlanRow>(
    env,
    "SELECT * FROM footage_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const publications = await rows<PublicationRow>(
    env,
    "SELECT * FROM publications WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );
  const promoBriefs = await rows<PromoBriefRow>(
    env,
    "SELECT * FROM promo_briefs WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    project.id
  );

  if (assets.length > MAX_PORTABLE_ASSETS)
    throw new HttpError(
      413,
      `A portable bundle carries at most ${MAX_PORTABLE_ASSETS} asset records.`,
      "bundle_too_large"
    );
  const recordCount =
    generations.length +
    compositions.length +
    recipes.length +
    subjects.length +
    songPlans.length +
    footagePlans.length +
    publications.length +
    promoBriefs.length;
  if (recordCount > MAX_PORTABLE_RECORDS)
    throw new HttpError(
      413,
      `A portable bundle carries at most ${MAX_PORTABLE_RECORDS} record rows.`,
      "bundle_too_large"
    );
  const blobs = new Map<string, PortableBlobEntry>();
  const assetRecords: ExportedAssetRecord[] = [];
  for (const asset of assets) {
    const media = asset.deleted_at === null;
    const blobSha = media ? String(asset.sha256 ?? "") : null;
    if (media) {
      const sha = blobSha;
      if (sha === null || !SHA256_HEX.test(sha))
        throw new HttpError(
          409,
          `Asset ${asset.id} has no usable fingerprint.`,
          "asset_without_hash"
        );
      const entryLimit =
        asset.kind === "video"
          ? MAX_PORTABLE_ASSET_BYTES
          : asset.kind === "audio"
            ? AUDIO_BYTES
            : IMAGE_BYTES;
      if (Number(asset.bytes) > entryLimit)
        throw new HttpError(
          413,
          `Asset ${asset.id} is larger than one archive entry allows.`,
          "bundle_too_large"
        );
      const existing = blobs.get(sha);
      if (
        existing &&
        (existing.bytes !== Number(asset.bytes) || existing.mime !== asset.mime)
      )
        throw new HttpError(
          409,
          `Asset ${asset.id} disagrees with another copy of the same bytes.`,
          "asset_mime_conflict"
        );
      if (!existing)
        blobs.set(sha, {
          sha256: sha,
          path: `assets/${sha}`,
          bytes: Number(asset.bytes),
          mime: asset.mime,
        });
    }
    assetRecords.push({
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      bytes: Number(asset.bytes),
      blobSha256: media ? blobSha : null,
      content: media ? "media" : "tombstone",
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration_ms,
      sampleRate: asset.sample_rate ?? null,
      channels: asset.channels ?? null,
      sha256: asset.sha256,
      title: asset.title,
      caption: asset.caption,
      source: asset.source,
      parentAssetId: asset.parent_asset_id,
      generationId: asset.generation_id,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      deletedAt: asset.deleted_at,
      deleteRevision: asset.delete_revision,
    });
  }

  const totalBlobBytes = [...blobs.values()].reduce(
    (sum, blob) => sum + blob.bytes,
    0
  );
  if (totalBlobBytes > MAX_PORTABLE_BUNDLE_BYTES)
    throw new HttpError(
      413,
      "This project is larger than one portable archive allows.",
      "bundle_too_large"
    );

  const content: Record<string, unknown> = {
    format: PORTABLE_FORMAT,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      creativeDirection: project.creative_direction,
      references: safeJson(project.references_json, []),
      visibility: project.visibility,
      defaults: safeJson(project.defaults_json, {}),
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    },
    blobs: [...blobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    assets: assetRecords,
    generations: generations.map((row) => ({
      id: row.id,
      compositionId: row.composition_id ?? null,
      clientRequestId: row.client_request_id,
      kind: row.kind,
      // A legacy blank recipe_id means the same thing the writer records when
      // a request omits its recipe: no selected recipe. Normalize exactly that
      // blank to the existing freeform sentinel so old rows still export. A
      // missing custom recipe (rcp_) is untouched and stays a missing
      // dependency; the stored row is never rewritten.
      recipeId: row.recipe_id === "" ? "freeform" : row.recipe_id,
      provider: row.provider,
      model: row.model,
      modelVersion: row.model_version,
      request: safeJson(row.request_json, {}),
      providerRequestId: null,
      providerStatusUrl: null,
      providerResponseUrl: null,
      status: row.status,
      errorCode: row.error_code,
      errorDetail: row.error_detail,
      retainedBytes: row.retained_bytes,
      retainedMime: row.retained_mime,
      outputAssetId: row.output_asset_id,
      costEstimateMicro: row.cost_estimate_micro,
      costReservedMicro: row.cost_reserved_micro,
      costAllocatedMicro: row.cost_allocated_micro,
      providerChargedMicro: row.provider_charged_micro ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      deletedAt: row.deleted_at,
      deleteRevision: row.delete_revision,
    })),
    compositions: compositions.map((row) => ({
      id: row.id,
      title: row.title,
      spec: safeJson(row.spec_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    recipes: recipes.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      kind: row.kind,
      promptTemplate: row.prompt_template,
      controls: safeJson(row.controls_json, []),
      version: row.version,
      createdAt: row.created_at,
    })),
    subjects: subjects.map((row) => ({
      subjectId: row.subject_id,
      revision: row.revision,
      spec: safeJson(row.spec_json, {}),
      referenceAssetId: row.reference_asset_id,
      referenceSha256: row.reference_sha256,
      createdAt: row.created_at,
    })),
    songPlans: songPlans.map((row) => ({
      id: row.id,
      songAssetId: row.song_asset_id,
      songSha256: row.song_sha256,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    footagePlans: footagePlans.map((row) => ({
      id: row.id,
      sourceAssetId: row.source_asset_id,
      sourceSha256: row.source_sha256,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    publications: publications.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      posterAssetId: row.poster_asset_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      assetRevision: row.asset_revision,
      listed: row.listed,
      hidden: row.hidden,
      attribution: safeJson(row.attribution_json, []),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    })),
    promoBriefs: promoBriefs.map((row) => ({
      id: row.id,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    excluded: [
      "Studio provider keys, worker secrets, session cookies and bearer tokens",
      "Composer workspace binding and grant checks",
      "MCP OAuth clients, codes, tokens and spend reservations",
      "Monthly budget reservations (restore never invents bills)",
      "Signed media URLs, render links, local-render and footage-export receipts",
      "Installation-wide publication policies (restored publications stay private)",
    ],
    limits: {
      maxAssetBytes: MAX_PORTABLE_ASSET_BYTES,
      maxBundleBytes: MAX_PORTABLE_BUNDLE_BYTES,
      maxAssets: MAX_PORTABLE_ASSETS,
      maxRecords: MAX_PORTABLE_RECORDS,
    },
    stats: {
      assets: assetRecords.length,
      mediaAssets: assetRecords.filter((asset) => asset.content === "media")
        .length,
      tombstones: assetRecords.filter((asset) => asset.content === "tombstone")
        .length,
      blobs: blobs.size,
      contentBytes: totalBlobBytes,
      generations: generations.length,
      compositions: compositions.length,
      recipes: recipes.length,
      subjects: subjects.length,
      songPlans: songPlans.length,
      footagePlans: footagePlans.length,
      publications: publications.length,
      promoBriefs: promoBriefs.length,
    },
  };
  scanSecrets(content);
  const sealed = await sealManifest(content);
  await validateManifest(sealed);
  return sealed;
}
