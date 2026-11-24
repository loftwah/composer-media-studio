// MIT. The saved library's response projections: one asset row, one generation
// row and the model attribution a saved job keeps. Moved out of worker.mjs for
// #198 so they are checked under strict TypeScript. Field names, null and
// undefined handling, spread/override order and the saved model fallbacks are
// unchanged; reads, authorization and response assembly stay in the Worker.

import { models, retiredModels } from "./provider-catalogue.ts";
import { reuseStillFor } from "./sharing.ts";
import { safeJson } from "./util.ts";

/** The saved asset columns used by the projection and still reuse. */
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
  deleted_at: number | null;
}

/** The saved generation columns used by the projection. */
interface GenerationRow {
  id: string;
  composition_id: string | null;
  kind: string;
  recipe_id: string;
  model: string;
  request_json: string;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  output_asset_id: string | null;
  cost_estimate_micro: number;
  cost_allocated_micro: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

/** The saved request fields these views read. Stored request_json predates the
 * current settings shape, so every field stays optional and malformed JSON is
 * handled by safeJson exactly as before. */
interface GenerationRequest {
  modelEndpoint?: string | null;
  variant?: string | null;
  prompt?: string | null;
  aspect?: string | null;
  durationSeconds?: number | null;
  referenceAssetId?: string | null;
  maskAssetId?: string | null;
  maskSha256?: string | null;
  parentAssetId?: string | null;
}

/** A live, retired or unknown saved model's exact attribution. */
interface ModelAttribution {
  modelLabel: string;
  modelEndpoint: string | null;
  modelRetired: boolean;
}

/** The additive fields a caller may place after the base asset projection. */
interface AssetViewExtra {
  reuseStillId?: string | null;
  hasLocalRenderReceipt?: boolean;
  hasPreview?: boolean;
  duplicate?: boolean;
  reused?: boolean;
  reuse?: { assetId: string; href: string };
}

/** The base asset projection. Extra fields are spread after these. */
interface AssetView {
  id: string;
  kind: string;
  title: string;
  caption: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  sha256: string;
  source: string;
  reuseStillId: string | null;
  parentAssetId: string | null;
  generationId: string | null;
  createdAt: number;
  file: string;
  download: string;
}

/** Additive fields a caller may place after the base generation projection. */
type GenerationViewExtra = Partial<GenerationView> & Record<string, unknown>;

/** The base generation projection. Extra fields are spread after these. */
interface GenerationView extends ModelAttribution {
  id: string;
  kind: string;
  status: string;
  model: string;
  recipeId: string;
  compositionId: string | null;
  variant: string | null;
  prompt: string;
  aspect: string | null;
  durationSeconds: number | null;
  referenceAssetId: string | null;
  maskAssetId: string | null;
  maskSha256: string | null;
  parentAssetId: string | null;
  costEstimateMicro: number;
  costAllocatedMicro: number | null;
  error: { code: string; message: string } | null;
  assetId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** Project one saved asset for a library, upload, import or export response. */
export function assetView(asset: AssetRow, extra: AssetViewExtra = {}): AssetView & AssetViewExtra {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    caption: asset.caption,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration_ms,
    sampleRate: asset.sample_rate ?? null,
    channels: asset.channels ?? null,
    sha256: asset.sha256,
    source: asset.source,
    // The immediate upload/import response must carry the same self-reference
    // as a fresh project read. Video relationships are supplied by that read.
    reuseStillId: reuseStillFor({ asset, assets: [asset] })?.id ?? null,
    parentAssetId: asset.parent_asset_id,
    generationId: asset.generation_id,
    createdAt: asset.created_at,
    file: `/api/assets/${asset.id}/file`,
    download: `/api/assets/${asset.id}/download`,
    ...extra,
  };
}

/** Attribute a saved job to the live catalogue, then the retired catalogue,
 * then the model id that was stored with it. */
function modelAttribution(
  generation: Pick<GenerationRow, "model" | "request_json">,
): ModelAttribution {
  const request = safeJson<GenerationRequest>(generation.request_json, {});
  const current = models[generation.model];
  const retired = retiredModels[generation.model];
  return {
    modelLabel: current?.label ?? retired?.label ?? generation.model,
    modelEndpoint: request.modelEndpoint ?? current?.endpoint ?? retired?.endpoint ?? null,
    modelRetired: Boolean(retired),
  };
}

/** Project one saved generation for an immediate, replayed or reloaded response. */
export function generationView(
  generation: GenerationRow,
  extra: GenerationViewExtra = {},
): GenerationView & GenerationViewExtra {
  const request = safeJson<GenerationRequest>(generation.request_json, {});
  return {
    id: generation.id,
    kind: generation.kind,
    status: generation.status,
    model: generation.model,
    ...modelAttribution(generation),
    recipeId: generation.recipe_id,
    compositionId: generation.composition_id ?? null,
    variant: request.variant ?? null,
    prompt: request.prompt ?? "",
    aspect: request.aspect ?? null,
    durationSeconds: request.durationSeconds ?? null,
    referenceAssetId: request.referenceAssetId ?? null,
    maskAssetId: request.maskAssetId ?? null,
    maskSha256: request.maskSha256 ?? null,
    parentAssetId: request.parentAssetId ?? null,
    costEstimateMicro: generation.cost_estimate_micro,
    costAllocatedMicro: generation.cost_allocated_micro,
    error: generation.error_code
      ? { code: generation.error_code, message: generation.error_detail ?? "" }
      : null,
    assetId: generation.output_asset_id,
    createdAt: generation.created_at,
    updatedAt: generation.updated_at,
    completedAt: generation.completed_at,
    ...extra,
  };
}
