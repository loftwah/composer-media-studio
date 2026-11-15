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
import { aspectDimensions, getModel } from "./providers.mjs";
import { HttpError } from "./util.mjs";

/** The id a Darkroom reference must carry; it names this studio's bucket. */
export const DARKROOM_DESTINATION = "media-studio";
const DARKROOM_NAMESPACE = "media-studio";

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
  return darkroomModels.has(model.id);
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

function requireBindings(env) {
  if (!env.AI) throw new HttpError(502, "Workers AI is not configured; nothing was submitted.", "provider_unconfigured");
  if (!env.IMAGES || !env.MEDIA_OPERATION)
    throw new HttpError(502, "The IMAGES and MEDIA_OPERATION bindings are required for Darkroom; nothing was submitted.", "provider_unconfigured");
}

function refusal(error) {
  // Darkroom wraps host refusals; surface the studio's own HttpError.
  for (let cause = error; cause; cause = cause.cause) if (cause instanceof HttpError) return cause;
  return null;
}

/**
 * Generate one still through Darkroom and return the exact bytes it saved.
 * The generation id is the Darkroom request id, so a retry reuses the saved
 * output instead of calling Workers AI again.
 */
export async function runDarkroomImage(env, generation, model, settings, reference, signal) {
  requireBindings(env);
  const { width, height } = aspectDimensions(settings.aspect, reference);
  const path = darkroomOutputKey(generation);
  const request = {
    prompt: settings.prompt,
    model: darkroomModels.get(model.id),
    width,
    height,
  };
  if (model.references > 0) {
    if (!reference) throw new HttpError(400, "Select a reference image for this model");
    request.references = [{ computerId: DARKROOM_DESTINATION, path: reference.asset.r2_key }];
  }
  const host = {
    scope: {
      actorId: generation.project_id,
      namespace: DARKROOM_NAMESPACE,
      owner: "studio",
      destinationId: DARKROOM_DESTINATION,
    },
    operations: env.MEDIA_OPERATION,
    provider: createWorkersAiMediaProvider(env.AI),
    // The studio pays its own Workers AI account and keeps its own ledger.
    metering: "unmetered",
    destination: createR2MediaDestination({
      bucket: env.MEDIA,
      destinationId: DARKROOM_DESTINATION,
      fit: createImagesReferenceFitter(env.IMAGES),
      authorize: authorizeKey(env, generation),
    }),
  };
  let outcome;
  try {
    outcome = await generateMedia(host, { requestId: generation.id, path, settings: request }, signal);
  } catch (error) {
    const own = refusal(error);
    if (own) throw own;
    throw new HttpError(502, `Image generation was not accepted: ${String(error.message ?? error).slice(0, 160)}`, "provider_error");
  }
  if (outcome.kind !== "succeeded")
    throw new HttpError(502, "Darkroom did not finish this image; nothing was saved. Start a new request.", "provider_error");
  const object = await env.MEDIA.get(path);
  if (!object) throw new HttpError(502, "Darkroom reported a result that is not in the bucket", "provider_invalid");
  const bytes = new Uint8Array(await object.arrayBuffer());
  // The studio retains its own copy under the generation; this one was only the hand-off.
  await env.MEDIA.delete(path);
  return { bytes, format: outcome.format };
}

/**
 * Erase Darkroom's retained copy of one generation: the immutable output under
 * media-output/ in APP_ARTIFACTS and the operation's own storage. Darkroom's
 * public erase refuses an operation that is still running; that job erases when
 * the studio next discards it, so the refusal is not an error here.
 */
export async function eraseDarkroomOperation(env, generation) {
  if (!env.MEDIA_OPERATION || !generation) return;
  const model = getModel(generation.model);
  if (!model || !usesDarkroom(model)) return;
  try {
    const result = await env.MEDIA_OPERATION.getByName(`media:${generation.id}`).erase(DARKROOM_NAMESPACE, generation.id);
    if (!result.clear) throw new HttpError(502, "Darkroom's retained copy could not be confirmed erased", "erase_incomplete");
  } catch (error) {
    if (String(error?.message).includes("still active")) return;
    throw error;
  }
}
