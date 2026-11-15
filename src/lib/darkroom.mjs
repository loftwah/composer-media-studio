// MIT. Workers AI stills through Darkroom, read from and written to this
// studio's own R2 bucket. No Computer, Hub or Oyster is involved.
//
// Darkroom owns the provider call, the durable per-request operation and the
// reference fit. The studio keeps the budget ledger, dispatch lease, retained
// bytes, asset record and tombstones in jobs.mjs; this module only supplies the
// permission check for each object key and maps one studio request to one
// Darkroom request.

import { generateMedia } from "@fungi.computer/darkroom/server";
import {
  createImagesReferenceFitter,
  createR2MediaDestination,
  createWorkersAiMediaProvider,
} from "@fungi.computer/darkroom/cloudflare";
import { aspectDimensions } from "./providers.mjs";
import { HttpError, safeJson } from "./util.mjs";

/** The id a Darkroom reference must carry; it names this studio's bucket. */
export const DARKROOM_DESTINATION = "media-studio";
const DARKROOM_NAMESPACE = "media-studio";
export const DARKROOM_VERSION = "0.10.0";

/**
 * Studio models whose Workers AI endpoint Darkroom's catalogue also carries.
 * Studio Draft (SDXL Lightning) is not in that catalogue and keeps its direct
 * Workers AI call, as do every fal.ai model.
 */
const darkroomModels = new Map([
  ["studio-print", "@cf/leonardo/lucid-origin"],
  ["studio-film", "@cf/leonardo/phoenix-1.0"],
  ["studio-quick", "@cf/black-forest-labs/flux-1-schnell"],
  ["studio-detail", "@cf/black-forest-labs/flux-2-klein-4b"],
]);

export function usesDarkroom(model) {
  return darkroomModels.has(model?.id);
}

/** Where Darkroom saves one generation's result before the studio retains it. */
export function darkroomOutputKey(generation) {
  return `projects/${generation.project_id}/generations/${generation.id}/darkroom-output`;
}

/**
 * The studio's permission check for one object key, applied by Darkroom before
 * every dispatch, reference read and write. A key is allowed only when it is
 * this generation's own output key or the stored original of a live image asset
 * in the same project. Anything else, including another project's media, is
 * refused before any provider call.
 */
export function authorizeKey(env, generation) {
  return async (key) => {
    if (key === darkroomOutputKey(generation)) return;
    const asset = await env.DB.prepare(
      "SELECT id FROM assets WHERE r2_key=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
    )
      .bind(key, generation.project_id)
      .first();
    if (!asset) {
      const error = new HttpError(403, "That media is not available to this project", "reference_unavailable");
      error.definitive = true;
      throw error;
    }
  };
}

export function darkroomOriginalKey(generation) {
  return `media-output/v1/media:${generation.id}`;
}

export function isDarkroomGeneration(generation) {
  return safeJson(generation?.request_json, {})?.darkroomVersion === DARKROOM_VERSION;
}

function preflightError(status, message, code) {
  return Object.assign(new HttpError(status, message, code), { definitive: true });
}

function operationFor(env, generation) {
  return env.MEDIA_OPERATION.getByName(`media:${generation.id}`);
}

function requireBindings(env, needsReference) {
  if (!env.AI || !env.MEDIA_OPERATION || !env.APP_ARTIFACTS || (needsReference && !env.IMAGES))
    throw preflightError(503, "This studio cannot reach its image service yet. No image request was sent.", "provider_unconfigured");
}

const formats = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** Darkroom 0.10.0 exposes readShare only for metered successes. Studio's
 * unmetered operation reaches "written" instead. Verify the scoped operation
 * and read the fixed immutable output key used by this exact package's erasure. */
async function readOriginal(env, generation, operation) {
  const state = await operation.read();
  if (!state || state.state !== "written") return null;
  assertOperationScope(state, generation);
  const key = darkroomOriginalKey(generation);
  const object = await env.APP_ARTIFACTS.get(key);
  const format = formats.get(object?.httpMetadata?.contentType);
  if (!object || !format || format !== state.image?.format || object.size < 1 || object.size > 32 * 1024 * 1024)
    throw new HttpError(502, "The original image is unavailable. Check this job again to recover it.", "provider_invalid");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== object.size)
    throw new HttpError(502, "The original image read was incomplete. Check this job again.", "provider_invalid");
  return { bytes, format };
}

function assertOperationScope(operation, generation) {
  if (operation.requestId !== generation.id || operation.operationId !== `media:${generation.id}` ||
      operation.namespace !== DARKROOM_NAMESPACE || operation.owner !== "studio")
    throw new HttpError(502, "The image operation did not match this Studio job.", "provider_invalid");
}

/** Finish only existing operation state. A DO claim can adopt bytes committed
 * just before a worker crashed, and has no path to invoking Workers AI. */
async function finishRetainedOperation(operation, generation, { erasing = false } = {}) {
  const current = await operation.read();
  if (!current) return;
  assertOperationScope(current, generation);
  if (!["generating", "writing", ...(erasing ? ["estimating"] : [])].includes(current.state)) return;
  const claim = await operation.claim();
  if (claim.kind !== "claimed") return;
  if (claim.operation.state === "estimating") {
    await operation.releaseEstimate(claim.leaseId);
  } else if (claim.operation.state === "writing") {
    // The package verifies the object version and length when reading its lease.
    try {
      const bytes = await operation.readGenerated(claim.leaseId);
      await operation.recordWrittenWithoutSettlement(claim.leaseId, "studio-retained-original", {
        bytes: bytes.byteLength, format: claim.operation.image.format,
      });
    } catch (error) {
      await operation.releaseWrite(claim.leaseId).catch(() => {});
      throw error;
    }
  }
}

export async function recoverDarkroomImage(env, generation) {
  if (!isDarkroomGeneration(generation)) return null;
  if (!env.MEDIA_OPERATION || !env.APP_ARTIFACTS)
    throw new HttpError(503, "Image recovery is temporarily unavailable. Check the same job again.", "provider_unconfigured");
  const operation = operationFor(env, generation);
  await finishRetainedOperation(operation, generation);
  return readOriginal(env, generation, operation);
}

/** Start one paid request. Studio holds the dispatch lease; disable the
 * package's capacity retry and keep the existing provider input defaults. */
export async function runDarkroomImage(env, generation, model, settings, reference, signal) {
  requireBindings(env, model.references > 0);
  const { width, height } = aspectDimensions(settings.aspect, reference);
  const path = darkroomOutputKey(generation);
  const request = { prompt: settings.prompt, model: darkroomModels.get(model.id), width, height };
  if (model.references > 0) {
    if (!reference) throw preflightError(400, "Select a reference image for this model", "reference_unavailable");
    request.references = [{ computerId: DARKROOM_DESTINATION, path: reference.asset.r2_key }];
  }

  let attempted = false;
  let refusal;
  const authorize = authorizeKey(env, generation);
  const ai = {
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
      `).bind(generation.id, generation.project_id, reference?.asset.id ?? null, reference?.asset.r2_key ?? null).first();
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
      return env.AI.run(endpoint, input, options);
    },
  };
  const destination = createR2MediaDestination({
    bucket: env.MEDIA,
    destinationId: DARKROOM_DESTINATION,
    fit: env.IMAGES ? createImagesReferenceFitter(env.IMAGES) : undefined,
    authorize: async (key) => {
      try { await authorize(key); }
      catch (error) { refusal = error; throw error; }
    },
  });
  const host = {
    scope: { actorId: generation.project_id, namespace: DARKROOM_NAMESPACE, owner: "studio", destinationId: DARKROOM_DESTINATION },
    operations: env.MEDIA_OPERATION,
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
  } catch {
    if (!attempted) {
      throw refusal ?? preflightError(502, "The image service could not prepare this request. No image request was sent.", "provider_preflight");
    }
    throw new HttpError(502, "The image request may have run. Check this job to recover the original without generating again.", "provider_error");
  }
  if (outcome.kind !== "succeeded")
    throw new HttpError(502, "The image result is not confirmed. Check this job before making a new request.", "provider_unknown");
  const original = await readOriginal(env, generation, operationFor(env, generation)).catch(() => null);
  if (!original) throw new HttpError(502, "The image is pending recovery. Check the same job again.", "provider_invalid");
  return original;
}

/** Erase the retained original and verify Darkroom's durable erasure marker.
 * A live lease can refuse erasure; Studio keeps the tombstone queued. */
export async function eraseDarkroomOperation(env, generation, beforeErase = null) {
  if (!isDarkroomGeneration(generation)) return;
  if (!env.MEDIA_OPERATION || !env.APP_ARTIFACTS)
    throw new HttpError(502, "Image cleanup is temporarily unavailable.", "erase_incomplete");
  const operation = operationFor(env, generation);
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
          (await env.APP_ARTIFACTS.head(darkroomOriginalKey(generation))) !== null)
        throw new Error("Erasure not confirmed");
    }
  } catch {
    throw new HttpError(502, "Image cleanup is pending. The original is no longer accessible through this job.", "erase_incomplete");
  }
}
