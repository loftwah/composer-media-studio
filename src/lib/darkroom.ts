// MIT. Workers AI stills through Darkroom, read from and written to this
// studio's own R2 bucket. No Computer, Hub or Oyster is involved.
//
// Darkroom owns the provider call, the durable per-request operation and the
// reference fit. The studio keeps the budget ledger, dispatch lease, retained
// bytes, asset record and tombstones in jobs.mjs; this module only supplies the
// permission check for each object key and maps one studio request to one
// Darkroom request.
//
// This is the strict TypeScript source. Binding and operation seams reuse
// Darkroom's published Cloudflare types; the row and request shapes below name
// only the columns this module reads. Every annotation is erased at runtime, so
// the emitted statements stay the original JavaScript and the darkroom.mjs shim
// keeps existing callers on their current import path.

import { getMediaModel } from "@fungi.computer/darkroom";
import type {
  ImageFormat,
  MediaGenerationSettingsInput,
  ReferenceImageFitter,
} from "@fungi.computer/darkroom";
import {
  createImagesReferenceFitter,
  createR2MediaDestination,
  createWorkersAiMediaProvider,
} from "@fungi.computer/darkroom/cloudflare";
import type {
  MediaAiResult,
  MediaImagePort,
  MediaOperationObject,
  MediaR2Bucket,
} from "@fungi.computer/darkroom/cloudflare";
import { generateMedia } from "@fungi.computer/darkroom/server";
import type {
  MediaErasurePreflight,
  MediaOperation,
  MediaOperationProjection,
  MediaServiceHost,
} from "@fungi.computer/darkroom/server";
import { aspectDimensions } from "./providers.mjs";
import { HttpError, safeJson } from "./util.mjs";

/** The id a Darkroom reference must carry; it names this studio's bucket. */
export const DARKROOM_DESTINATION = "media-studio";
const DARKROOM_NAMESPACE = "media-studio";
export const DARKROOM_VERSION = "0.10.0";

/**
 * Studio models whose Workers AI endpoint Darkroom's catalogue also carries.
 * Studio Draft now uses FLUX.2 Klein 9B through Darkroom's multipart adapter.
 * Every fal.ai model keeps its own adapter.
 */
const darkroomModels = new Map<string, string>([
  ["studio-print", "@cf/leonardo/lucid-origin"],
  ["studio-film", "@cf/leonardo/phoenix-1.0"],
  ["studio-quick", "@cf/black-forest-labs/flux-1-schnell"],
  ["studio-detail", "@cf/black-forest-labs/flux-2-klein-4b"],
  ["studio-craft", "@cf/black-forest-labs/flux-2-klein-9b"],
]);

/** The catalogue fields this module reads from one Studio image model. */
export interface DarkroomModel {
  id: string;
  references: number;
}

/** The identity shared by a generation row and its durable operation. */
export interface DarkroomGeneration {
  id: string;
  project_id: string;
}

/** The stored request column that pins a generation to this Darkroom version. */
export interface DarkroomStoredRequest {
  request_json?: string | null;
}

/** A generation row plus the request column recovery and erasure inspect. */
export type DarkroomGenerationRecord = DarkroomGeneration & DarkroomStoredRequest;

/** The selected reference image and its stored asset columns. */
export interface DarkroomReference {
  asset: { id: string; r2_key: string };
  format: ImageFormat;
  width: number;
  height: number;
}

/** The dimensions and encoding available from a stored reference. */
export interface DarkroomReferenceShape {
  width?: unknown;
  height?: unknown;
  format?: unknown;
}

/** The image settings one Studio request passes to Darkroom. */
export interface DarkroomSettings {
  prompt: string;
  aspect: string;
}

/** A minimal prepared statement, the only D1 surface this module calls. */
interface DarkroomStatement {
  bind(...values: unknown[]): DarkroomStatement;
  first<Row>(): Promise<Row | null>;
}

/** The D1 binding, narrowed to prepared reads and the dispatch-boundary update. */
interface DarkroomDatabase {
  prepare(query: string): DarkroomStatement;
}

/** The durable operation namespace resolved by this module's request id. */
export interface DarkroomOperations {
  getByName(name: string): DarkroomOperation;
}

/** The owner methods this module calls in addition to dispatch/settlement. */
export interface DarkroomOperation extends MediaOperation {
  read(): MediaOperationProjection | null | Promise<MediaOperationProjection | null>;
  preflightErasure(
    namespace: string,
    requestId: string,
  ): MediaErasurePreflight | Promise<MediaErasurePreflight>;
  erase(namespace: string, requestId: string): { clear: boolean } | Promise<{ clear: boolean }>;
}

/** A retained artifact as read by recovery: exact bytes and their MIME type. */
export interface DarkroomArtifactObject {
  size: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The artifact bucket surface used for retained output and erasure readback. */
export interface DarkroomArtifactBucket {
  get(key: string): Promise<DarkroomArtifactObject | null>;
  head(key: string): Promise<MediaOperationObject | null>;
}

/** The Workers AI input fields this module reads or adjusts before dispatch. */
interface DarkroomProviderInput {
  prompt?: string;
  width?: number;
  height?: number;
  guidance?: number;
  num_steps?: number;
  multipart?: unknown;
  [field: string]: unknown;
}

/** The one paid provider call, bound to this studio's Workers AI binding. */
interface DarkroomAiPort {
  run(endpoint: string, input: DarkroomProviderInput, options?: unknown): Promise<MediaAiResult>;
}

/** The Worker env seam this module reads. Bindings are checked before use. */
export interface DarkroomEnv {
  DB: DarkroomDatabase;
  MEDIA: MediaR2Bucket;
  AI?: DarkroomAiPort;
  APP_ARTIFACTS?: DarkroomArtifactBucket;
  IMAGES?: MediaImagePort;
  MEDIA_OPERATION?: DarkroomOperations;
}

function modelEndpoint(modelId: string): string {
  const endpoint = darkroomModels.get(modelId);
  if (!endpoint) throw preflightError(400, "That image model is not available through Darkroom.", "model_unavailable");
  return endpoint;
}

export function usesDarkroom(model: { id?: string | null } | null | undefined): boolean {
  return model?.id ? darkroomModels.has(model.id) : false;
}

/** Where Darkroom saves one generation's result before the studio retains it. */
export function darkroomOutputKey(generation: DarkroomGeneration): string {
  return `projects/${generation.project_id}/generations/${generation.id}/darkroom-output`;
}

/**
 * The studio's permission check for one object key, applied by Darkroom before
 * every dispatch, reference read and write. A key is allowed only when it is
 * this generation's own output key or the stored original of a live image asset
 * in the same project. Anything else, including another project's media, is
 * refused before any provider call.
 */
export function authorizeKey(env: DarkroomEnv, generation: DarkroomGeneration) {
  return async (key: string): Promise<void> => {
    if (key === darkroomOutputKey(generation)) return;
    const asset = await env.DB.prepare(
      "SELECT id FROM assets WHERE r2_key=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
    )
      .bind(key, generation.project_id)
      .first<{ id: string }>();
    if (!asset)
      throw Object.assign(new HttpError(403, "That media is not available to this project", "reference_unavailable"), { definitive: true });
  };
}

export function darkroomOriginalKey(generation: DarkroomGeneration): string {
  return `media-output/v1/media:${generation.id}`;
}

export function isDarkroomGeneration(generation: DarkroomStoredRequest | null | undefined): boolean {
  return safeJson<{ darkroomVersion?: unknown }>(generation?.request_json ?? "", {}).darkroomVersion === DARKROOM_VERSION;
}

/** Whether these bytes already satisfy the model's reference rule.
 *
 * Darkroom fits a reference through the Images binding, which is unavailable on
 * an account still on legacy billing. A reference that is already inside the
 * catalogue's dimension and encoding needs no transform, so the studio can send
 * it without that dependency and keep reference-guided work available. */
export function referenceFitsModel(
  model: { id?: string | null } | null | undefined,
  reference: DarkroomReferenceShape | null | undefined,
): boolean {
  const endpoint = model?.id ? darkroomModels.get(model.id) : undefined;
  const catalogue = endpoint ? getMediaModel(endpoint) : undefined;
  const limit = catalogue?.input?.referenceDimension;
  const format = catalogue?.input?.referenceFormat;
  if (!limit || !format || !reference) return false;
  const width = Number(reference.width);
  const height = Number(reference.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return false;
  return reference.format === format && Math.max(width, height) <= limit;
}

function preflightError(
  status: number,
  message: string,
  code: string,
): HttpError & { definitive: true } {
  return Object.assign(new HttpError(status, message, code), { definitive: true as const });
}

function operationFor(operations: DarkroomOperations, generation: DarkroomGeneration): DarkroomOperation {
  return operations.getByName(`media:${generation.id}`);
}

function requireBindings(env: DarkroomEnv, needsReference: boolean) {
  const { AI, MEDIA_OPERATION, APP_ARTIFACTS, IMAGES } = env;
  if (!AI || !MEDIA_OPERATION || !APP_ARTIFACTS || (needsReference && !IMAGES))
    throw preflightError(503, "This studio cannot reach its image service yet. No image request was sent.", "provider_unconfigured");
  return { AI, MEDIA_OPERATION, APP_ARTIFACTS, IMAGES };
}

/** The bounded facts on a thrown value; never assumes it is an Error instance. */
interface ErrorFacts {
  name?: unknown;
  message?: unknown;
  causeName?: unknown;
  causeMessage?: unknown;
}

function errorFacts(error: unknown): ErrorFacts {
  const value = typeof error === "object" && error !== null
    ? error as { name?: unknown; message?: unknown; cause?: unknown }
    : {};
  const cause = typeof value.cause === "object" && value.cause !== null
    ? value.cause as { name?: unknown; message?: unknown }
    : {};
  return {
    name: value.name,
    message: value.message,
    causeName: cause.name,
    causeMessage: cause.message,
  };
}

/** A paid request that fails before dispatch must say why.
 *
 * Darkroom's reference preparation rejects an unsupported or oversized
 * reference and its Images dependency can be unavailable for billing reasons.
 * Those errors used to collapse into one generic message, which hid the real
 * reason from the studio, the agent and the release record. The package's own
 * wording is fixed text, never provider detail, so it is safe to return. */
export function preflightFailure(error: unknown): HttpError & { definitive: true } {
  const facts = errorFacts(error);
  const message = typeof facts.message === "string" ? facts.message.trim() : "";
  if (/legacy billing|9432/i.test(message))
    return preflightError(
      503,
      "Cloudflare Images is not available on this account because it is on legacy billing. Reference images need the Images binding. No image request was sent.",
      "provider_billing",
    );
  if (facts.name === "MediaSettingsError" && message && message.length <= 200)
    return preflightError(400, `The reference image was refused: ${message}. No image request was sent.`, "reference_invalid");
  return preflightError(502, "The image service could not prepare this request. No image request was sent.", "provider_preflight");
}

const formats = new Map<string, ImageFormat>([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** Darkroom 0.10.0 exposes readShare only for metered successes. Studio's
 * unmetered operation reaches "written" instead. Verify the scoped operation
 * and read the fixed immutable output key used by this exact package's erasure. */
async function readOriginal(
  artifacts: DarkroomArtifactBucket,
  generation: DarkroomGeneration,
  operation: DarkroomOperation,
) {
  const state = await operation.read();
  if (!state || state.state !== "written") return null;
  assertOperationScope(state, generation);
  const key = darkroomOriginalKey(generation);
  const object = await artifacts.get(key);
  const contentType = object?.httpMetadata?.contentType;
  const format = contentType ? formats.get(contentType) : undefined;
  if (!object || !format || format !== state.image?.format || object.size < 1 || object.size > 32 * 1024 * 1024)
    throw new HttpError(502, "The original image is unavailable. Check this job again to recover it.", "provider_invalid");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== object.size)
    throw new HttpError(502, "The original image read was incomplete. Check this job again.", "provider_invalid");
  return { bytes, format };
}

function assertOperationScope(
  operation: MediaOperationProjection,
  generation: DarkroomGeneration,
): void {
  if (operation.requestId !== generation.id || operation.operationId !== `media:${generation.id}` ||
      operation.namespace !== DARKROOM_NAMESPACE || operation.owner !== "studio")
    throw new HttpError(502, "The image operation did not match this Studio job.", "provider_invalid");
}

/** Finish only existing operation state. A DO claim can adopt bytes committed
 * just before a worker crashed, and has no path to invoking Workers AI. */
async function finishRetainedOperation(
  operation: DarkroomOperation,
  generation: DarkroomGeneration,
  { erasing = false }: { erasing?: boolean } = {},
): Promise<void> {
  const current = await operation.read();
  if (!current) return;
  assertOperationScope(current, generation);
  if (!["generating", "writing", ...(erasing ? ["estimating"] : [])].includes(current.state)) return;
  const claim = await operation.claim();
  if (claim.kind !== "claimed") return;
  const leaseId = claim.leaseId;
  if (!leaseId) throw new Error("The image operation claim has no lease");
  if (claim.operation.state === "estimating") {
    await operation.releaseEstimate(leaseId);
  } else if (claim.operation.state === "writing") {
    // The package verifies the object version and length when reading its lease.
    try {
      const image = claim.operation.image;
      if (!image) throw new Error("The image operation has no retained result");
      const bytes = await operation.readGenerated(leaseId);
      await operation.recordWrittenWithoutSettlement(leaseId, "studio-retained-original", {
        bytes: bytes.byteLength, format: image.format,
      });
    } catch (error) {
      await Promise.resolve(operation.releaseWrite(leaseId)).catch(() => {});
      throw error;
    }
  }
}

export async function recoverDarkroomImage(env: DarkroomEnv, generation: DarkroomGenerationRecord) {
  if (!isDarkroomGeneration(generation)) return null;
  if (!env.MEDIA_OPERATION || !env.APP_ARTIFACTS)
    throw new HttpError(503, "Image recovery is temporarily unavailable. Check the same job again.", "provider_unconfigured");
  const artifacts = env.APP_ARTIFACTS;
  const operation = operationFor(env.MEDIA_OPERATION, generation);
  await finishRetainedOperation(operation, generation);
  return readOriginal(artifacts, generation, operation);
}

/** Start one paid request. Studio holds the dispatch lease; disable the
 * package's capacity retry and keep the existing provider input defaults. */
export async function runDarkroomImage(
  env: DarkroomEnv,
  generation: DarkroomGeneration,
  model: DarkroomModel,
  settings: DarkroomSettings,
  reference?: DarkroomReference | null,
  signal?: AbortSignal,
) {
  const referenceAlreadyFits = model.references > 0 && referenceFitsModel(model, reference);
  if (model.references > 0 && !reference)
    throw preflightError(400, "Select a reference image for this model", "reference_unavailable");
  const bindings = requireBindings(env, model.references > 0 && !referenceAlreadyFits);
  const { width, height } = aspectDimensions(settings.aspect, reference);
  const path = darkroomOutputKey(generation);
  const request: MediaGenerationSettingsInput = {
    prompt: settings.prompt,
    model: modelEndpoint(model.id),
    width,
    height,
    ...(model.references > 0 && reference
      ? { references: [{ computerId: DARKROOM_DESTINATION, path: reference.asset.r2_key }] }
      : {}),
  };

  let attempted = false;
  let refusal: unknown;
  const authorize = authorizeKey(env, generation);
  const ai: DarkroomAiPort = {
    async run(endpoint, input, options) {
      if (attempted) throw new Error("Studio does not retry a paid image call");
      // Persist the dispatch boundary before the only AI call. The same
      // statement rechecks the job and the reference against deletion.
      const active = await env.DB.prepare(`
        UPDATE generations SET request_json=json_set(request_json,'$.darkroomDispatched',1)
        WHERE id=?1 AND project_id=?2 AND status='submitting' AND deleted_at IS NULL
          AND (?3 IS NULL OR EXISTS (
            SELECT 1 FROM assets WHERE id=?3 AND project_id=?2 AND r2_key=?4 AND kind='image' AND deleted_at IS NULL
          )) RETURNING id
      `).bind(generation.id, generation.project_id, reference?.asset.id ?? null, reference?.asset.r2_key ?? null).first<{ id: string }>();
      if (!active) {
        refusal = preflightError(409, "This job or its reference is no longer available. No image request was sent.",
          reference ? "reference_unavailable" : "generation_inactive");
        throw refusal;
      }
      // Keep Phoenix/Lucid guidance and the original Schnell request shape.
      if (model.id === "studio-print") input = { ...input, guidance: 5 };
      if (model.id === "studio-film") {
        input = { ...input, guidance: 3 };
        delete input.num_steps;
      }
      if (model.id === "studio-quick") input = { prompt: settings.prompt, width, height };
      attempted = true;
      return bindings.AI.run(endpoint, input, options);
    },
  };
  const unavailableFitter: ReferenceImageFitter = async () => {
    throw new Error("No reference fitter is configured");
  };
  let fit: ReferenceImageFitter;
  if (referenceAlreadyFits && reference) {
    const storedReference = reference;
    // A reference that already meets the model's catalogue rule is sent as it
    // is. This keeps reference-guided stills working on an account whose Images
    // binding is unavailable, instead of refusing the whole request.
    fit = async (bytes) => ({
      bytes,
      format: storedReference.format,
      width: storedReference.width,
      height: storedReference.height,
    });
  } else {
    fit = bindings.IMAGES ? createImagesReferenceFitter(bindings.IMAGES) : unavailableFitter;
  }
  const destination = createR2MediaDestination({
    bucket: env.MEDIA,
    destinationId: DARKROOM_DESTINATION,
    fit,
    authorize: async (key) => {
      try { await authorize(key); }
      catch (error) { refusal = error; throw error; }
    },
  });
  const host: MediaServiceHost = {
    scope: { actorId: generation.project_id, namespace: DARKROOM_NAMESPACE, owner: "studio", destinationId: DARKROOM_DESTINATION },
    operations: bindings.MEDIA_OPERATION,
    provider: createWorkersAiMediaProvider(ai),
    metering: "unmetered",
    destination: {
      ...destination,
      // The DO has already stored the provider's exact bytes. The decorated
      // handoff contains the private prompt; do not write it to any bucket.
      write: (key) => destination.authorize(key),
    },
  };
  let outcome;
  try {
    outcome = await generateMedia(host, { requestId: generation.id, path, settings: request }, signal);
  } catch (error) {
    if (!attempted) {
      // The bounded reason is also in the worker log so a released failure can
      // be diagnosed without exposing the private prompt. Darkroom wraps the
      // real cause in a stage error; keep its one-line identity too.
      const facts = errorFacts(error);
      console.error(
        "darkroom preflight", generation.id,
        facts.name ?? "Error", String(facts.message ?? "").slice(0, 200),
        facts.causeName ?? "-", String(facts.causeMessage ?? "").slice(0, 200),
      );
      throw refusal ?? preflightFailure(error);
    }
    throw new HttpError(502, "The image request may have run. Check this job to recover the original without generating again.", "provider_error");
  }
  if (outcome.kind !== "succeeded")
    throw new HttpError(502, "The image result is not confirmed. Check this job before making a new request.", "provider_unknown");
  const original = await readOriginal(
    bindings.APP_ARTIFACTS,
    generation,
    operationFor(bindings.MEDIA_OPERATION, generation),
  ).catch(() => null);
  if (!original) throw new HttpError(502, "The image is pending recovery. Check the same job again.", "provider_invalid");
  return original;
}

/** Erase the retained original and verify Darkroom's durable erasure marker.
 * A live lease can refuse erasure; Studio keeps the tombstone queued. */
export async function eraseDarkroomOperation(
  env: DarkroomEnv,
  generation: DarkroomGenerationRecord,
  beforeErase: (() => Promise<void>) | null = null,
): Promise<void> {
  if (!isDarkroomGeneration(generation)) return;
  if (!env.MEDIA_OPERATION || !env.APP_ARTIFACTS)
    throw new HttpError(502, "Image cleanup is temporarily unavailable.", "erase_incomplete");
  const artifacts = env.APP_ARTIFACTS;
  const operation = operationFor(env.MEDIA_OPERATION, generation);
  await finishRetainedOperation(operation, generation, { erasing: true });
  try {
    // A written operation is terminal and proves that paid output was retained.
    await operation.preflightErasure(DARKROOM_NAMESPACE, generation.id);
    if (beforeErase && (await operation.read())?.state === "written") await beforeErase();
    const result = await operation.erase(DARKROOM_NAMESPACE, generation.id);
    if (!result.clear) {
      // In 0.10.0 readErasure also counts workerd's internal _cf_KV
      // table, which stores its own erasure marker. The package writes the
      // marker only after clear-all. Confirm that marker, no operation and
      // no R2 object; never accept a missing object alone as proof.
      const marker = await operation.preflightErasure(DARKROOM_NAMESPACE, generation.id);
      if (!marker.erased || (await operation.read()) !== null ||
          (await artifacts.head(darkroomOriginalKey(generation))) !== null)
        throw new Error("Erasure not confirmed");
    }
  } catch {
    throw new HttpError(502, "Image cleanup is pending. The original is no longer accessible through this job.", "erase_incomplete");
  }
}
