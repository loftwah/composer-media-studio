import { publishCandidate } from "./publication-policy.mjs";
// MIT. One durable job authority for images and video.
//
// Invariants:
// - intent is persisted before any provider dispatch;
// - a client request id can only create one generation;
// - a durable lease prevents two workers dispatching the same admitted job;
// - retained bytes are saved without another inference call;
// - an ambiguous provider outcome keeps its reservation and is never resubmitted;
// - a deleted job or asset is never resurrected by a late completion.

import {
  classifyProviderFailure,
  downloadMedia,
  downloadVideo,
  estimateCost,
  getModel,
  readAudioResult,
  readImageResult,
  readRenderResult,
  readSlateResult,
  readVideoResult,
  readVideoStatus,
  runImage,
  submitAssembly,
  submitAudio,
  submitImageEdit,
  submitSlateVideo,
  submitVideo,
  toBase64,
  validateSettings,
  cancelVideo,
} from "./providers.mjs";
import { builtinRecipe } from "./recipes.mjs";
import { signRenderLink } from "./render-links.mjs";
import {
  audioInfo,
  extensionFor,
  HttpError,
  id,
  imageSize,
  money,
  now,
  periodKey,
  safeJson,
  sha256Hex,
  sniffMedia,
  text,
  videoInfo,
} from "./util.mjs";

export const defaultAllowanceMicro = 5_000_000;

export function allowanceFor(env) {
  const configured = Number(env.MONTHLY_ALLOWANCE_MICRO);
  return Number.isSafeInteger(configured) && configured >= 0
    ? configured
    : defaultAllowanceMicro;
}

export async function loadProject(env, projectId, { required = true } = {}) {
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(projectId).first();
  if (!project && required) throw new HttpError(404, "Project not found", "not_found");
  return project;
}

export async function loadGeneration(env, generationId) {
  const row = await env.DB.prepare("SELECT * FROM generations WHERE id=?1").bind(generationId).first();
  if (!row) throw new HttpError(404, "Generation not found", "not_found");
  return row;
}

export async function budgetSnapshot(env, projectId) {
  const period = periodKey();
  const row = await env.DB.prepare("SELECT * FROM budgets WHERE project_id=?1 AND period=?2")
    .bind(projectId, period)
    .first();
  const allowance = row?.allowance_micro ?? allowanceFor(env);
  return {
    period,
    allowanceMicro: allowance,
    reservedMicro: row?.reserved_micro ?? 0,
    spentMicro: row?.spent_micro ?? 0,
    availableMicro: Math.max(0, allowance - (row?.reserved_micro ?? 0) - (row?.spent_micro ?? 0)),
  };
}

async function ensureBudget(env, projectId) {
  await env.DB.prepare(
    "INSERT INTO budgets(project_id,period,allowance_micro,reserved_micro,spent_micro,updated_at) VALUES(?1,?2,?3,0,0,?4) ON CONFLICT(project_id,period) DO NOTHING",
  )
    .bind(projectId, periodKey(), allowanceFor(env), now())
    .run();
}

/** Atomic admission: one SQL statement is the allowance authority. */
async function reserve(env, projectId, amount) {
  await ensureBudget(env, projectId);
  const row = await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=reserved_micro+?3, updated_at=?4 WHERE project_id=?1 AND period=?2 AND reserved_micro+spent_micro+?3<=allowance_micro RETURNING reserved_micro,spent_micro,allowance_micro",
  )
    .bind(projectId, periodKey(), amount, now())
    .first();
  if (!row) {
    const snapshot = await budgetSnapshot(env, projectId);
    throw new HttpError(
      402,
      `This month's allowance has ${money(snapshot.availableMicro)} free; this request needs ${money(amount)}. Raise the allowance or wait for next month.`,
      "budget_exhausted",
    );
  }
  return row;
}

async function settleReservation(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.cost_observed_micro !== null) return;
  await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=MAX(0,reserved_micro-?3), spent_micro=spent_micro+?3, updated_at=?4 WHERE project_id=?1 AND period=?2",
  )
    .bind(generation.project_id, periodKey(generation.created_at), generation.cost_reserved_micro, now())
    .run();
  await env.DB.prepare("UPDATE generations SET cost_observed_micro=?2, updated_at=?3 WHERE id=?1 AND cost_observed_micro IS NULL")
    .bind(generation.id, generation.cost_reserved_micro, now())
    .run();
}

async function releaseReservation(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.cost_observed_micro !== null) return;
  await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=MAX(0,reserved_micro-?3), updated_at=?4 WHERE project_id=?1 AND period=?2",
  )
    .bind(generation.project_id, periodKey(generation.created_at), generation.cost_reserved_micro, now())
    .run();
  await env.DB.prepare("UPDATE generations SET cost_observed_micro=0, updated_at=?2 WHERE id=?1 AND cost_observed_micro IS NULL")
    .bind(generation.id, now())
    .run();
}

async function referenceFor(env, projectId, assetId) {
  if (!assetId) return null;
  const asset = await env.DB.prepare(
    "SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL",
  )
    .bind(assetId, projectId)
    .first();
  if (!asset) throw new HttpError(404, "The selected reference is not in this project", "reference_unavailable");
  if (asset.kind !== "image")
    throw new HttpError(400, "Choose a still image as the reference", "reference_unavailable");
  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(410, "The selected reference bytes are unavailable", "reference_unavailable");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const size = imageSize(bytes);
  return {
    asset,
    bytes,
    format: size.format ?? "jpeg",
    width: size.width,
    height: size.height,
  };
}

export async function createGeneration(env, project, input) {
  const model = getModel(input.model);
  if (model.kind !== input.kind)
    throw new HttpError(400, "That model does not create this kind of media");
  const settings = validateSettings(model, input);
  const clientRequestId = String(input.clientRequestId ?? "").slice(0, 80);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(clientRequestId))
    throw new HttpError(400, "A client request id is required", "invalid_request");

  const existing = await env.DB.prepare(
    "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
  )
    .bind(project.id, clientRequestId)
    .first();
  if (existing) return { generation: existing, created: false };

  const reference = await referenceFor(env, project.id, input.referenceAssetId);
  if (model.references > 0 && !reference)
    throw new HttpError(400, `${model.label} needs a selected reference image`);
  if (model.references === 0 && reference)
    throw new HttpError(400, `${model.label} does not take a reference image`);

  let mask = null;
  if (model.edit === "fill") {
    mask = await referenceFor(env, project.id, input.maskAssetId);
    if (!mask) throw new HttpError(400, "Draw or upload a mask before sending a fill request", "mask_required");
    if (
      reference.width && reference.height && mask.width && mask.height &&
      (reference.width !== mask.width || reference.height !== mask.height)
    )
      throw new HttpError(
        400,
        "The mask must be exactly the same width and height as the selected still. Reopen the mask tool; the studio will not stretch it for you.",
        "mask_mismatch",
      );
    if (input.maskAssetId === input.referenceAssetId)
      throw new HttpError(400, "The mask must be a separate saved image", "mask_mismatch");
  }

  const cost = estimateCost(model, settings);
  const generationId = id("gen");
  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'admitted',?9,?10,?11,?12)`,
    )
      .bind(
        generationId,
        project.id,
        clientRequestId,
        model.kind,
        String(input.recipeId ?? "freeform").slice(0, 80),
        model.provider,
        model.id,
        JSON.stringify({
          ...settings,
          referenceAssetId: reference?.asset.id ?? null,
          referenceSha256: reference?.asset.sha256 ?? null,
          maskAssetId: mask?.asset.id ?? null,
          maskSha256: mask?.asset.sha256 ?? null,
          parentAssetId: input.parentAssetId ?? null,
        }),
        cost,
        cost,
        timestamp,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error.message ?? error).includes("UNIQUE")) {
      const row = await env.DB.prepare(
        "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
      )
        .bind(project.id, clientRequestId)
        .first();
      if (row) return { generation: row, created: false };
    }
    throw error;
  }

  let generation = await loadGeneration(env, generationId);
  try {
    await reserve(env, project.id, cost);
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET status='failed',error_code='budget_exhausted',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generationId, error.message, now())
      .run();
    throw error;
  }

  generation = await loadGeneration(env, generationId);
  return { generation, created: true, model, settings, reference };
}

/** Atomically take the dispatch lease so two callers cannot both submit. */
async function claim(env, generationId, from, to) {
  const row = await env.DB.prepare(
    `UPDATE generations SET status=?3, updated_at=?4 WHERE id=?1 AND status=?2 RETURNING id`,
  )
    .bind(generationId, from, to, now())
    .first();
  return Boolean(row);
}

export async function dispatchGeneration(env, generation) {
  const model = getModel(generation.model);
  const request = safeJson(generation.request_json, {});
  const reference = await referenceFor(env, generation.project_id, request.referenceAssetId);

  if (!(await claim(env, generation.id, "admitted", "submitting"))) {
    return loadGeneration(env, generation.id);
  }

  if (model.kind === "image" && model.edit) {
    try {
      const maskReference = request.maskAssetId
        ? await referenceFor(env, generation.project_id, request.maskAssetId)
        : null;
      const submitted = await submitImageEdit(env, model, request, [
        {
          bytes: reference.bytes,
          format: reference.format,
          maskBytes: maskReference?.bytes ?? null,
          maskFormat: maskReference?.format ?? null,
        },
      ]);
      await env.DB.prepare(
        "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
      )
        .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
        .run();
      return loadGeneration(env, generation.id);
    } catch (error) {
      return failGeneration(env, generation, error, { dispatched: true });
    }
  }

  if (model.kind === "image") {
    try {
      const output = await runImage(env, model, request, reference ? [reference] : []);
      return await saveGeneration(env, generation, output.bytes, output.format);
    } catch (error) {
      return failGeneration(env, generation, error);
    }
  }

  if (model.kind === "audio") {
    try {
      const submitted = await submitAudio(env, model, request);
      await env.DB.prepare(
        "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
      )
        .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
        .run();
      return loadGeneration(env, generation.id);
    } catch (error) {
      return failGeneration(env, generation, error, { dispatched: true });
    }
  }

  try {
    const submitted = await submitVideo(env, model, request, reference);
    await env.DB.prepare(
      "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
    )
      .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
      .run();
    return loadGeneration(env, generation.id);
  } catch (error) {
    return failGeneration(env, generation, error, { dispatched: true });
  }
}

/** Record a failure that happened after dispatch. The provider request id and
 * result URLs stay on the row so a bounded reconcile can still read them, and
 * the reservation is kept because failures after execution may still be billed.
 * Only a provider-reported terminal error is `failed`; an unreadable status is
 * `unknown`, which keeps the reconcile path honest. */
async function recordProviderFailure(env, generation, error, stage) {
  const terminal = stage === "execution";
  const code = error instanceof HttpError ? error.code : "provider_error";
  const detail = [
    String(error.message ?? error),
    error.providerStatus ? `HTTP ${error.providerStatus}` : null,
    error.errorType ? `type ${error.errorType}` : null,
    `stage ${stage}`,
    terminal
      ? "no output was saved; cost kept for provider reconciliation"
      : "request kept for reconciliation",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 240);
  await env.DB.prepare(
    "UPDATE generations SET status=?2,error_code=?3,error_detail=?4,updated_at=?5 WHERE id=?1 AND status IN ('submitting','submitted','running','provider_complete','unknown','cancel_requested')",
  )
    .bind(generation.id, terminal ? "failed" : "unknown", code, detail, now())
    .run();
  return loadGeneration(env, generation.id);
}

async function failGeneration(env, generation, error, { dispatched = false } = {}) {
  const definitive = error instanceof HttpError && error.definitive === true;
  const status = definitive || !dispatched ? "failed" : "unknown";
  const code = error instanceof HttpError ? error.code : "provider_error";
  await env.DB.prepare(
    "UPDATE generations SET status=?2,error_code=?3,error_detail=?4,updated_at=?5 WHERE id=?1 AND status IN ('submitting','submitted','running')",
  )
    .bind(generation.id, status, code, String(error.message ?? error).slice(0, 240), now())
    .run();
  if (status === "failed") await releaseReservation(env, generation);
  return loadGeneration(env, generation.id);
}

/** Persist exact output bytes, then the asset record. Never calls inference. */
export async function saveGeneration(env, generation, bytes, format) {
  const mime = mimeFor(format, bytes);
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "saved") {
    if (fresh.output_asset_id && !fresh.deleted_at) {
      try { await publishCandidate(env, fresh.project_id, fresh.output_asset_id, { automatic: true }); }
      catch (error) { console.warn("Automatic publication skipped:", String(error.message ?? error).slice(0, 120)); }
    }
    return fresh;
  }
  if (fresh.deleted_at) {
    await env.DB.prepare("UPDATE generations SET status='discarded_after_delete',updated_at=?2 WHERE id=?1")
      .bind(generation.id, now())
      .run();
    return loadGeneration(env, generation.id);
  }

  const hash = await sha256Hex(bytes);
  const existingAsset = await env.DB.prepare(
    "SELECT * FROM assets WHERE generation_id=?1 AND deleted_at IS NULL",
  )
    .bind(generation.id)
    .first();
  if (existingAsset) {
    await env.DB.prepare(
      "UPDATE generations SET status='saved',output_asset_id=?2,completed_at=?3,updated_at=?3,error_code=NULL,error_detail=NULL WHERE id=?1",
    )
      .bind(generation.id, existingAsset.id, now())
      .run();
    await settleReservation(env, generation);
    try { await publishCandidate(env, generation.project_id, existingAsset.id, { automatic: true }); }
    catch (error) { console.warn("Automatic publication skipped:", String(error.message ?? error).slice(0, 120)); }
    return loadGeneration(env, generation.id);
  }
  const extension = extensionFor(mime);
  const retainedKey = fresh.retained_key ?? `projects/${generation.project_id}/generations/${generation.id}/retained.${extension}`;
  if (!fresh.retained_key) {
    await env.MEDIA.put(retainedKey, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare(
      "UPDATE generations SET retained_key=?2,retained_mime=?3,retained_bytes=?4,status='saving',updated_at=?5 WHERE id=?1",
    )
      .bind(generation.id, retainedKey, mime, bytes.length, now())
      .run();
  }

  const request = safeJson(fresh.request_json, {});
  const assetId = id("asset");
  const assetKey = `projects/${generation.project_id}/assets/${assetId}/original.${extension}`;
  await env.MEDIA.put(assetKey, bytes, { httpMetadata: { contentType: mime } });
  const kind = kindForMime(mime);
  const size = sizeForBytes(mime, bytes);
  const source = getModel(fresh.model)?.render
    ? "assembled"
    : getModel(fresh.model)?.edit
      ? "variant"
      : "generated";
  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)`,
    )
      .bind(
        assetId,
        generation.project_id,
        kind,
        assetKey,
        mime,
        bytes.length,
        size.width ?? null,
        size.height ?? null,
        size.durationMs ?? null,
        size.sampleRate ?? null,
        size.channels ?? null,
        hash,
        fresh.model === "studio-assembly"
          ? text(request.title ?? "", 100, "Title", { required: false }) || "Assembled cut"
          : fresh.model === "studio-social"
            ? `${size.width ?? 720} × ${size.height ?? 1280} cut`
            : builtinRecipe(request.recipeId)?.title ??
              (getModel(fresh.model)?.edit === "fill"
                ? "Masked fill"
                : getModel(fresh.model)?.edit === "cutout"
                  ? "Background removed"
                  : getModel(fresh.model)?.edit === "upscale"
                    ? "Upscaled still"
                    : kind === "audio"
                      ? fresh.model === "studio-effect"
                        ? "Generated effect"
                        : fresh.model === "studio-voice"
                          ? "Generated narration"
                          : "Generated music"
                      : kind === "video"
                        ? "Generated clip"
                        : "Generated still"),
        String(request.prompt ?? "").slice(0, 400),
        source,
        request.parentAssetId ?? request.referenceAssetId ?? null,
        generation.id,
        timestamp,
      )
      .run();
  } catch (error) {
    // The provider already produced bytes. Keep them retained for a save retry.
    await env.DB.prepare(
      "UPDATE generations SET status='provider_complete',error_code='save_failed',error_detail=?2,updated_at=?3 WHERE id=?1",
    )
      .bind(generation.id, String(error.message ?? error).slice(0, 200), now())
      .run();
    throw new HttpError(500, "The result was created but could not be saved. Retry saving; it will not generate again.", "save_failed");
  }

  await env.DB.prepare(
    "UPDATE generations SET status='saved',output_asset_id=?2,completed_at=?3,updated_at=?3,error_code=NULL,error_detail=NULL WHERE id=?1",
  )
    .bind(generation.id, assetId, now())
    .run();
  await settleReservation(env, generation);
  try { await publishCandidate(env, generation.project_id, assetId, { automatic: true }); }
  catch (error) { console.warn("Automatic publication skipped:", String(error.message ?? error).slice(0, 120)); }
  return loadGeneration(env, generation.id);
}

function mimeFor(format, bytes) {
  if (format === "mp4") return "video/mp4";
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  if (format === "m4a") return "audio/mp4";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  const sniffed = sniffMedia(bytes, "image/jpeg");
  return sniffed.kind === "image" ? sniffed.mime : "image/jpeg";
}

function kindForMime(mime) {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
}

function sizeForBytes(mime, bytes) {
  if (mime.startsWith("video/")) return videoInfo(bytes);
  if (mime.startsWith("audio/")) {
    const info = audioInfo(bytes);
    return { width: null, height: null, durationMs: info.durationMs, sampleRate: info.sampleRate, channels: info.channels };
  }
  const size = imageSize(bytes);
  return { width: size.width, height: size.height, durationMs: null };
}

/** Advance one asynchronous job. Safe to call repeatedly from polling or cron. */
export async function advanceGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.deleted_at) {
    if (fresh.retained_key) await env.MEDIA.delete(fresh.retained_key);
    await env.DB.prepare("UPDATE generations SET status='discarded_after_delete',retained_key=NULL,updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }

  if (["provider_complete", "saving"].includes(fresh.status) && fresh.retained_key) {
    const stored = await env.MEDIA.get(fresh.retained_key);
    if (stored) {
      const bytes = new Uint8Array(await stored.arrayBuffer());
      return saveGeneration(env, fresh, bytes, formatForMime(fresh.retained_mime));
    }
    return fresh;
  }

  // A result read that failed leaves the job at provider_complete with no saved
  // bytes. Reading the same provider result again is free and idempotent, so a
  // reconcile can recover it without dispatching anything new.
  if (fresh.status === "provider_complete" && !fresh.retained_key && fresh.provider_response_url && fresh.provider_request_id) {
    return completeJob(env, fresh, { responseUrl: fresh.provider_response_url });
  }

  if (fresh.status === "submitting") {
    // A worker can die between the dispatch lease and the provider reply.
    // The provider may or may not have started: never resubmit automatically.
    if (now() - fresh.updated_at > 120_000) {
      await env.DB.prepare(
        "UPDATE generations SET status='unknown',error_code='dispatch_unknown',error_detail='The studio lost the reply before the provider confirmed. Check the provider before retrying.',updated_at=?2 WHERE id=?1 AND status='submitting'",
      )
        .bind(fresh.id, now())
        .run();
      return loadGeneration(env, fresh.id);
    }
    return fresh;
  }

  if (!["submitted", "running", "cancel_requested"].includes(fresh.status)) return fresh;
  if (!fresh.provider_request_id) return fresh;

  let status;
  try {
    status = await readVideoStatus(env, fresh);
  } catch (error) {
    // A transient read failure is not a provider failure. A 4xx is a real
    // rejection: keep the request identity and record what the provider said.
    if (error instanceof HttpError && error.definitive) {
      await recordProviderFailure(env, fresh, error, "status");
      return loadGeneration(env, fresh.id);
    }
    return fresh;
  }

  const providerState = status.status.toUpperCase();
  if (providerState === "COMPLETED") {
    // fal can end a queue request as COMPLETED and still return the model's own
    // failure. Treat that as terminal and never fetch a result that cannot exist.
    if (status.error) {
      await recordProviderFailure(
        env,
        fresh,
        Object.assign(
          new HttpError(
            502,
            `Provider finished with an error${status.errorType ? ` (${status.errorType})` : ""}: ${status.error}`,
            classifyProviderFailure(502, { errorType: status.errorType, detail: status.error }),
          ),
          { providerStatus: 200, errorType: status.errorType, stage: "execution" },
        ),
        "execution",
      );
      return loadGeneration(env, fresh.id);
    }
    const model = getModel(fresh.model);
    const request = safeJson(fresh.request_json, {});
    if (model.render === "social" && request.stage === "slate")
      return completeSocialStage(env, fresh, status);
    return completeJob(env, fresh, status);
  }
  if (providerState === "CANCELLED" || providerState === "CANCELED") {
    await env.DB.prepare("UPDATE generations SET status='cancelled',cancelled_at=?2,updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    await settleReservation(env, fresh);
    return loadGeneration(env, fresh.id);
  }
  if (providerState === "FAILED" || providerState === "ERROR") {
    await env.DB.prepare("UPDATE generations SET status='failed',error_code='provider_failed',error_detail='The video provider reported a failed job',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    await releaseReservation(env, fresh);
    return loadGeneration(env, fresh.id);
  }
  if (providerState === "IN_PROGRESS" && fresh.status !== "cancel_requested") {
    await env.DB.prepare("UPDATE generations SET status='running',updated_at=?2 WHERE id=?1 AND status IN ('submitted','running')")
      .bind(fresh.id, now())
      .run();
  }
  return loadGeneration(env, fresh.id);
}

function formatForMime(mime) {
  if (!mime) return "jpeg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpeg";
}

/** Stage one of the true 9:16 cut: make one vertical slate video from the
 * deterministic 1080×1920 still, keep those bytes as a reusable asset, then
 * compose the selected takes in their chosen order after it. */
async function completeSocialStage(env, generation, status) {
  const request = safeJson(generation.request_json, {});
  let slate;
  try {
    slate = await readSlateResult(env, {
      ...generation,
      provider_response_url: status.responseUrl,
    });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE generations SET error_code='slate_unavailable',error_detail=?2,updated_at=?3 WHERE id=?1",
    )
      .bind(generation.id, String(error.message ?? error).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }

  let stored;
  try {
    const download = await downloadMedia(env, slate.url);
    stored = await storeDerivedAsset(env, generation.project_id, {
      bytes: download.bytes,
      mime: download.contentType.includes("webm") ? "video/webm" : "video/mp4",
      title: `9:16 slate video — ${request.title || "storyboard"}`.slice(0, 100),
      caption: `Generated once from the deterministic 1080 × 1920 slate (fal-ai/wan-25-preview/image-to-video, 720p, 5 s). The studio uses its first second and reuses these bytes for later 9:16 renders.`,
      source: "generated",
    });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE generations SET error_code='slate_save_failed',error_detail=?2,updated_at=?3 WHERE id=?1",
    )
      .bind(generation.id, String(error.message ?? error).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }

  if (request.compositionId) {
    const composition = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1 AND project_id=?2")
      .bind(request.compositionId, generation.project_id)
      .first();
    if (composition) {
      const spec = safeJson(composition.spec_json, {});
      spec.slateVideoAssetId = stored.id;
      await env.DB.prepare("UPDATE compositions SET spec_json=?2,updated_at=?3 WHERE id=?1")
        .bind(composition.id, JSON.stringify(spec), now())
        .run();
    }
  }

  const nextRequest = { ...request, stage: "compose", slateVideoAssetId: stored.id };
  return submitSocialCompose(env, generation, nextRequest, stored.id);
}

async function submitSocialCompose(env, generation, request, slateVideoAssetId) {
  const model = getModel(generation.model);
  const SLATE_MS = 1000;
  try {
    const slate = await loadAssetRow(env, generation.project_id, slateVideoAssetId);
    if (!slate) throw new HttpError(409, "The saved 9:16 slate is no longer in this project", "slate_unavailable");
    const keyframes = [
      {
        timestamp: 0,
        duration: SLATE_MS,
        url: await signRenderLink(env, { assetId: slate.id, projectId: generation.project_id }),
      },
    ];
    let cursor = SLATE_MS;
    for (const shot of request.shots ?? []) {
      const asset = await loadAssetRow(env, generation.project_id, shot.assetId);
      if (!asset) throw new HttpError(409, "A selected shot is no longer in this project", "shot_unavailable");
      keyframes.push({
        timestamp: cursor,
        duration: Number(shot.durationMs),
        url: await signRenderLink(env, { assetId: asset.id, projectId: generation.project_id }),
      });
      cursor += Number(shot.durationMs);
    }
    const tracks = [{ id: "visual", type: "video", keyframes }];
    tracks.push(...(await audioTracksForRender(env, generation.project_id, request, SLATE_MS)));
    const submitted = await submitAssembly(env, model, tracks);
    const nextRequest = {
      ...request,
      stage: "compose",
      slateMs: SLATE_MS,
      outputWidth: 720,
      outputHeight: 1280,
      totalMs: cursor,
    };
    await env.DB.prepare(
      "UPDATE generations SET request_json=?2,status='submitted',provider_request_id=?3,provider_status_url=?4,provider_response_url=?5,submitted_at=?6,updated_at=?6,error_code=NULL,error_detail=NULL WHERE id=?1",
    )
      .bind(
        generation.id,
        JSON.stringify(nextRequest),
        submitted.requestId,
        submitted.statusUrl,
        submitted.responseUrl,
        now(),
      )
      .run();
    return loadGeneration(env, generation.id);
  } catch (error) {
    return failGeneration(env, generation, error, { dispatched: true });
  }
}

/** Save an intermediate or retained result as a normal owned asset. */
async function storeDerivedAsset(env, projectId, { bytes, mime, title, caption, source = "generated", parentAssetId = null }) {
  const hash = await sha256Hex(bytes);
  const assetId = id("asset");
  const extension = extensionFor(mime);
  const key = `projects/${projectId}/assets/${assetId}/original.${extension}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  const kind = kindForMime(mime);
  const size = sizeForBytes(mime, bytes);
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,created_at,updated_at)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)`,
  )
    .bind(
      assetId,
      projectId,
      kind,
      key,
      mime,
      bytes.length,
      size.width ?? null,
      size.height ?? null,
      size.durationMs ?? null,
      size.sampleRate ?? null,
      size.channels ?? null,
      hash,
      title,
      caption,
      source,
      parentAssetId,
      timestamp,
    )
    .run();
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
}

async function audioTracksForRender(env, projectId, request, offsetMs = 0) {
  const tracks = [];
  const push = async (assetId, { startMs = 0, durationMs, role = "audio" }) => {
    const asset = await loadAssetRow(env, projectId, assetId);
    if (!asset) throw new HttpError(409, "A selected audio track is no longer in this project", "audio_unavailable");
    const duration = Math.max(1, Number(durationMs) || Number(asset.duration_ms) || 1);
    tracks.push({
      id: `audio-${tracks.length + 1}-${role}`.slice(0, 60),
      type: "audio",
      keyframes: [
        {
          timestamp: offsetMs + Math.max(0, Number(startMs) || 0),
          duration,
          url: await signRenderLink(env, { assetId: asset.id, projectId }),
        },
      ],
    });
  };

  if (request.audioAssetId) {
    await push(request.audioAssetId, { durationMs: request.totalMs, role: "mix" });
    return tracks;
  }
  for (const track of request.audioTracks ?? []) {
    await push(track.assetId, {
      startMs: track.startMs,
      durationMs: Number(track.trimEndMs) - Number(track.trimStartMs),
      role: track.role,
    });
  }
  return tracks;
}

/** Read the finished provider result, copy its bytes, then save. Model-specific
 * because audio, stills and renders return different result shapes. */
async function completeJob(env, generation, status) {
  if (generation.status === "cancel_requested") {
    // Completion won the race. Report what happened instead of pretending it cancelled.
    await env.DB.prepare("UPDATE generations SET error_code='completed_before_cancel',updated_at=?2 WHERE id=?1")
      .bind(generation.id, now())
      .run();
  }
  await env.DB.prepare("UPDATE generations SET status='provider_complete',updated_at=?2 WHERE id=?1")
    .bind(generation.id, now())
    .run();

  const model = getModel(generation.model);
  const request = safeJson(generation.request_json, {});
  const providerGeneration = { ...generation, provider_response_url: status.responseUrl };

  let result;
  try {
    result =
      model.kind === "audio"
        ? await readAudioResult(env, providerGeneration)
        : model.kind === "image" && model.edit
          ? await readImageResult(env, providerGeneration)
          : await readRenderResult(env, providerGeneration);
  } catch (error) {
    if (error instanceof HttpError && error.definitive) {
      // 4xx from the result endpoint reproduces a model or permission decision.
      // Stop here instead of polling a result that will never arrive.
      return recordProviderFailure(env, generation, error, "result");
    }
    await env.DB.prepare("UPDATE generations SET error_code='result_unavailable',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generation.id, String(error.message).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }

  let download;
  try {
    download = await downloadMedia(env, result.url);
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET error_code='download_failed',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generation.id, String(error.message).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }
  const format =
    model.kind === "audio"
      ? download.contentType.includes("wav")
        ? "wav"
        : "mp3"
      : model.kind === "image"
        ? download.contentType.includes("png")
          ? "png"
          : download.contentType.includes("webp")
            ? "webp"
            : "jpeg"
        : "mp4";
  return saveGeneration(env, generation, download.bytes, format);
}

function resultFileFor(model, payload) {
  if (!payload) return null;
  if (model.kind === "audio") return payload.audio ?? payload.audio_file ?? null;
  if (model.kind === "image")
    return payload.images?.[0] ?? payload.image ?? payload.mask_image ?? null;
  return (
    payload.video ??
    (typeof payload.video_url === "string"
      ? { url: payload.video_url, content_type: "video/mp4" }
      : null)
  );
}

function outputFormatFor(model, contentType) {
  if (model.kind === "audio")
    return contentType.includes("wav") ? "wav" : "mp3";
  if (model.kind === "image")
    return contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpeg";
  return "mp4";
}

export async function loadGenerationByProviderRequest(env, requestId) {
  return env.DB.prepare(
    "SELECT * FROM generations WHERE provider_request_id=?1 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(requestId)
    .first();
}

/** fal delivers the finished payload to the verified webhook. Save it through
 * the same owned-storage path as a polled result. Re-delivery is a no-op. */
export async function completeFromWebhook(env, generation, payload) {
  const fresh = await loadGeneration(env, generation.id);
  if (!fresh || fresh.status === "saved" || fresh.deleted_at) return fresh;
  const model = getModel(fresh.model);
  const file = resultFileFor(model, payload);
  if (!file?.url) {
    await env.DB.prepare(
      "UPDATE generations SET status='failed',error_code='provider_invalid',error_detail='The provider webhook carried no usable output',updated_at=?2 WHERE id=?1",
    )
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  await env.DB.prepare(
    "UPDATE generations SET status='provider_complete',updated_at=?2 WHERE id=?1",
  )
    .bind(fresh.id, now())
    .run();
  let download;
  try {
    download = await downloadMedia(env, file.url);
  } catch (error) {
    await env.DB.prepare(
      "UPDATE generations SET error_code='download_failed',error_detail=?2,updated_at=?3 WHERE id=?1",
    )
      .bind(fresh.id, String(error.message ?? error).slice(0, 200), now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  return saveGeneration(env, fresh, download.bytes, outputFormatFor(model, download.contentType));
}

/** A webhook ERROR is the provider's terminal answer. Keep the reservation:
 * a failed execution may still be billed, and nothing here proves a refund. */
export async function failFromWebhook(env, generation, { detail, errorType } = {}) {
  const message = `Provider finished with an error${errorType ? ` (${errorType})` : ""}: ${String(detail ?? "").slice(0, 240)}`;
  const error = new HttpError(
    502,
    message,
    classifyProviderFailure(502, { errorType, detail }),
  );
  error.providerStatus = 200;
  error.errorType = errorType ?? null;
  return recordProviderFailure(env, generation, error, "execution");
}

async function loadAssetRow(env, projectId, assetId) {
  if (!assetId) return null;
  return env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL")
    .bind(assetId, projectId)
    .first();
}

export async function cancelGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "admitted" || fresh.status === "submitting") {
    const cancelled = await env.DB.prepare(
      "UPDATE generations SET status='cancelled',cancelled_at=?2,updated_at=?2 WHERE id=?1 AND status IN ('admitted','submitting') RETURNING id",
    )
      .bind(fresh.id, now())
      .first();
    if (cancelled) {
      await releaseReservation(env, fresh);
      return loadGeneration(env, fresh.id);
    }
    return loadGeneration(env, fresh.id);
  }
  if (["submitted", "running"].includes(fresh.status)) {
    try {
      const result = await cancelVideo(env, fresh);
      if (result.accepted) {
        await env.DB.prepare("UPDATE generations SET status='cancel_requested',updated_at=?2 WHERE id=?1")
          .bind(fresh.id, now())
          .run();
        return loadGeneration(env, fresh.id);
      }
    } catch {
      // Fall through to an honest "not confirmed" state.
    }
    await env.DB.prepare("UPDATE generations SET error_code='cancel_unconfirmed',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  if (["provider_complete", "saving"].includes(fresh.status)) {
    return advanceGeneration(env, fresh);
  }
  return fresh;
}

export async function reconcileGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "unknown") {
    if (fresh.provider_request_id) return advanceGeneration(env, { ...fresh, status: "submitted" });
    await env.DB.prepare("UPDATE generations SET error_code='needs_support',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  return advanceGeneration(env, fresh);
}

export async function pendingGenerations(env, limit = 8) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM generations WHERE status IN ('submitting','submitted','running','provider_complete','saving') ORDER BY updated_at ASC LIMIT ?1",
  )
    .bind(limit)
    .all();
  return results;
}

export const MAX_SHOTS = 6;
// H3's documented 15-second output can run roughly 0.7 seconds longer.
export const MAX_SHOT_MS = 16_000;
export const MAX_TOTAL_MS = 60_000;

/** Validate an editable composition against the project's own saved clips. */
export async function buildCompositionSpec(env, project, input) {
  const title = text(input.title, 80, "Composition title");
  const shots = Array.isArray(input.shots) ? input.shots : [];
  if (shots.length < 2)
    throw new HttpError(400, "Choose at least two saved clips to assemble", "invalid_shots");
  if (shots.length > MAX_SHOTS)
    throw new HttpError(400, `A composition takes up to ${MAX_SHOTS} shots`, "invalid_shots");

  const ids = [];
  const manifest = [];
  let totalMs = 0;
  for (const shot of shots) {
    const assetId = String(shot?.assetId ?? "");
    if (!/^[a-z0-9_]{4,80}$/i.test(assetId) || ids.includes(assetId))
      throw new HttpError(400, "Each shot must be one saved clip, used once", "invalid_shots");
    const asset = await loadAssetRow(env, project.id, assetId);
    if (!asset || asset.kind !== "video")
      throw new HttpError(400, "Every shot must be a saved clip in this project", "invalid_shots");
    const durationMs = Number(asset.duration_ms);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_SHOT_MS)
      throw new HttpError(
        400,
        `${asset.title || "That clip"} is not a bounded clip the studio can assemble`,
        "invalid_shots",
      );
    ids.push(assetId);
    manifest.push({ assetId, title: asset.title || "Clip", durationMs });
    totalMs += durationMs;
  }
  if (totalMs > MAX_TOTAL_MS)
    throw new HttpError(400, `Keep the assembled result under ${MAX_TOTAL_MS / 1000} seconds`, "invalid_shots");

  let audioAssetId = null;
  if (input.audioAssetId) {
    const audio = await loadAssetRow(env, project.id, String(input.audioAssetId));
    if (!audio || audio.kind !== "audio")
      throw new HttpError(400, "Choose a saved audio track from this project", "invalid_audio");
    audioAssetId = audio.id;
  }

  const audioTracks = [];
  if (input.audioTracks !== undefined) {
    if (!Array.isArray(input.audioTracks) || input.audioTracks.length > 4)
      throw new HttpError(400, "A mix takes up to four saved audio tracks", "invalid_audio");
    for (const [index, track] of input.audioTracks.entries()) {
      if (!track || typeof track !== "object" || Array.isArray(track))
        throw new HttpError(400, "Each audio track needs an asset and a role", "invalid_audio");
      const audio = await loadAssetRow(env, project.id, String(track.assetId ?? ""));
      if (!audio || audio.kind !== "audio")
        throw new HttpError(400, "Every audio track must be a saved audio asset in this project", "invalid_audio");
      const role = ["music", "voice", "effect"].includes(track.role) ? track.role : "music";
      const durationMs = Number(audio.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 30 * 60 * 1000)
        throw new HttpError(400, "That audio track is not a bounded saved asset", "invalid_audio");
      const trimStartMs = Math.max(0, Math.round(Number(track.trimStartMs) || 0));
      const trimEndMs = Math.min(
        durationMs,
        Math.round(Number(track.trimEndMs) || durationMs),
      );
      if (trimEndMs - trimStartMs < 250)
        throw new HttpError(400, "Keep at least a quarter second of each audio track", "invalid_audio");
      const gainDb = Number(track.gainDb ?? 0);
      if (!Number.isFinite(gainDb) || gainDb < -24 || gainDb > 12)
        throw new HttpError(400, "Track gain must stay between -24 dB and +12 dB", "invalid_audio");
      const fadeInMs = Math.max(0, Math.round(Number(track.fadeInMs) || 0));
      const fadeOutMs = Math.max(0, Math.round(Number(track.fadeOutMs) || 0));
      if (fadeInMs > 3000 || fadeOutMs > 3000 || fadeInMs + fadeOutMs > trimEndMs - trimStartMs)
        throw new HttpError(400, "Fades must fit inside the trimmed track and stay under three seconds", "invalid_audio");
      const startMs = Math.max(0, Math.round(Number(track.startMs) || 0));
      if (startMs >= totalMs)
        throw new HttpError(400, "An audio track cannot start after the picture ends", "invalid_audio");
      audioTracks.push({
        assetId: audio.id,
        role,
        startMs,
        trimStartMs,
        trimEndMs,
        gainDb: Math.round(gainDb * 10) / 10,
        fadeInMs,
        fadeOutMs,
      });
      if (audioTracks.length !== index + 1) throw new HttpError(400, "Keep audio tracks in order", "invalid_audio");
    }
  }

  let slateAssetId = null;
  if (input.slateAssetId) {
    const slate = await loadAssetRow(env, project.id, String(input.slateAssetId));
    if (!slate || slate.kind !== "image")
      throw new HttpError(400, "The 9:16 slate must be a saved still in this project", "invalid_slate");
    slateAssetId = slate.id;
  }
  let slateVideoAssetId = null;
  if (input.slateVideoAssetId) {
    const slateVideo = await loadAssetRow(env, project.id, String(input.slateVideoAssetId));
    if (!slateVideo || slateVideo.kind !== "video")
      throw new HttpError(400, "The 9:16 slate video must be a saved clip in this project", "invalid_slate");
    slateVideoAssetId = slateVideo.id;
  }

  return { title, shots: manifest, audioAssetId, audioTracks, slateAssetId, slateVideoAssetId, totalMs };
}

export async function createComposition(env, project, input) {
  const spec = await buildCompositionSpec(env, project, input);
  const compositionId = id("cmp");
  const timestamp = now();
  await env.DB.prepare(
    "INSERT INTO compositions(id,project_id,title,spec_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",
  )
    .bind(compositionId, project.id, spec.title, JSON.stringify(spec), timestamp)
    .run();
  return { id: compositionId, projectId: project.id, ...spec, createdAt: timestamp };
}

/** Save a revision-checked song plan as an ordinary editable storyboard.
 * This only saves metadata: it does not submit, mix, render or spend. */
export async function createStoryboardFromSongPlan(env, project, planId, input) {
  const revision = input.expectedRevision;
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new HttpError(400, "Provide the plan revision you last read", "invalid_revision");
  const plan = await env.DB.prepare("SELECT * FROM song_plans WHERE id=?1 AND project_id=?2").bind(planId, project.id).first();
  if (!plan) throw new HttpError(404, "Song plan not found", "not_found");
  if (plan.revision !== revision) throw new HttpError(409, "This plan changed. Reload it before making a storyboard.", "revision_conflict");
  const source = await loadAssetRow(env, project.id, plan.song_asset_id);
  if (!source || source.kind !== "audio" || source.sha256 !== plan.song_sha256)
    throw new HttpError(409, "The source song is no longer available or has changed", "song_unavailable");
  const song = safeJson(plan.spec_json, {});
  if (!Array.isArray(song.scenes) || song.scenes.length < 2 || song.scenes.length > 6)
    throw new HttpError(400, "Choose two to six scenes", "invalid_shots");
  const shots = [];
  for (const [index, scene] of song.scenes.entries()) {
    if (!scene.selectedTakeId) throw new HttpError(400, `Choose a saved take for scene ${index + 1} first`, "take_required");
    const take = await loadAssetRow(env, project.id, scene.selectedTakeId);
    if (!take || take.kind !== "video") throw new HttpError(400, `The take for scene ${index + 1} is unavailable`, "take_unavailable");
    if (Number(take.duration_ms) !== scene.endMs - scene.startMs)
      throw new HttpError(400, `Scene ${index + 1} is ${((scene.endMs - scene.startMs) / 1000).toFixed(3)}s but its take is ${(Number(take.duration_ms) / 1000).toFixed(3)}s. Adjust the scene or choose a matching take; this renderer cannot trim shots.`, "take_duration_mismatch");
    shots.push({ assetId: take.id });
  }
  const spec = await buildCompositionSpec(env, project, {
    title: song.title, shots, audioTracks: [{ assetId: source.id, role: "music", startMs: 0, trimStartMs: song.startMs, trimEndMs: song.endMs, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }],
  });
  spec.originSongPlan = { id: plan.id, revision, songSha256: plan.song_sha256, sourceStartMs: song.startMs, sourceEndMs: song.endMs, scenes: song.scenes.map(scene => ({ id: scene.id, selectedTakeId: scene.selectedTakeId, startMs: scene.startMs, endMs: scene.endMs })) };
  const compositionId = `cmp_song_${plan.id}_${revision}`;
  let existing = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1 AND project_id=?2").bind(compositionId, project.id).first();
  if (existing) return { composition: { id: existing.id, projectId: existing.project_id, createdAt: existing.created_at, updatedAt: existing.updated_at, ...safeJson(existing.spec_json, {}) }, created: false };
  const timestamp = now();
  const created = await env.DB.prepare(`INSERT OR IGNORE INTO compositions(id,project_id,title,spec_json,created_at,updated_at)
    SELECT ?1,?2,?3,?4,?5,?5 WHERE EXISTS (SELECT 1 FROM song_plans WHERE id=?6 AND project_id=?2 AND revision=?7) RETURNING *`)
    .bind(compositionId, project.id, spec.title, JSON.stringify(spec), timestamp, plan.id, revision).first();
  if (!created) {
    existing = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1 AND project_id=?2").bind(compositionId, project.id).first();
    if (!existing) throw new HttpError(409, "This plan changed. Reload it before making a storyboard.", "revision_conflict");
  }
  const row = created || existing;
  return { composition: { id: row.id, projectId: row.project_id, createdAt: row.created_at, updatedAt: row.updated_at, ...safeJson(row.spec_json, {}) }, created: Boolean(created) };
}

/** Editing keeps the composition id, so earlier renders still point at the cut
 * they were made from and the manifest is never rewritten retroactively. */
export async function updateComposition(env, project, composition, input) {
  const spec = await buildCompositionSpec(env, project, input);
  // This is historical origin, not a claim that later edits still match the plan.
  const originSongPlan = safeJson(composition.spec_json, {}).originSongPlan;
  if (originSongPlan) spec.originSongPlan = originSongPlan;
  await env.DB.prepare("UPDATE compositions SET title=?2,spec_json=?3,updated_at=?4 WHERE id=?1 AND project_id=?5")
    .bind(composition.id, spec.title, JSON.stringify(spec), now(), project.id)
    .run();
  const fresh = await env.DB.prepare("SELECT * FROM compositions WHERE id=?1").bind(composition.id).first();
  return {
    id: fresh.id,
    projectId: fresh.project_id,
    title: fresh.title,
    createdAt: fresh.created_at,
    updatedAt: fresh.updated_at,
    ...safeJson(fresh.spec_json, {}),
  };
}

/** Create one durable render job for a saved composition. The manifest is
 * copied into the job, so a later edit never rewrites what was rendered. */
export async function createRender(env, project, composition, input) {
  const model = getModel(input.model ?? "studio-assembly");
  if (!model.render) throw new HttpError(400, "Choose a supported render", "invalid_model");
  const clientRequestId = String(input.clientRequestId ?? "").slice(0, 80);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(clientRequestId))
    throw new HttpError(400, "A client request id is required", "invalid_request");

  const existing = await env.DB.prepare(
    "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
  )
    .bind(project.id, clientRequestId)
    .first();
  if (existing) return { generation: existing, created: false };

  const spec = safeJson(composition.spec_json, { shots: [], audioAssetId: null, audioTracks: [], totalMs: 0 });
  let needsMix = (spec.audioTracks ?? []).some(
    (track) => track.trimStartMs || track.gainDb || track.fadeInMs || track.fadeOutMs || track.startMs,
  );
  if (!spec.audioAssetId && !needsMix) {
    for (const track of spec.audioTracks ?? []) {
      const audio = await loadAssetRow(env, project.id, track.assetId);
      if (!audio || track.trimEndMs < Number(audio.duration_ms)) { needsMix = true; break; }
    }
  }
  if (needsMix && !spec.audioAssetId) {
    // The compose endpoint has no per-track in-point, gain or fade fields.
    // The interface mixes those deterministically in the browser and saves
    // the result as audioAssetId; a direct API caller must do the same.
    throw new HttpError(
      400,
      "Trim, gain, fades and offsets need a rendered mix. Use the studio's Mix soundtrack control, which saves the mixed WAV first; the separate tracks stay as lineage.",
      "mix_required",
    );
  }
  if (model.render === "social") {
    // The selected order is preserved. A deliberate 1080 × 1920 slate opens the
    // cut, and compose fits every selected take into that frame after it.
    if ((spec.shots ?? []).length < 2)
      throw new HttpError(400, "A 9:16 cut needs at least two saved takes", "no_shots");
    if (!spec.slateAssetId)
      throw new HttpError(
        400,
        "A 9:16 cut needs a saved 1080 × 1920 slate. Use the studio's Make 9:16 cut control; it creates one before rendering.",
        "no_slate",
      );
  }

  // A saved slate video is reused, so only the final compose is charged.
  const cost = model.render === "social" && spec.slateVideoAssetId ? 20_000 : model.costMicro;
  const generationId = id("gen");
  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO generations(id,project_id,composition_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
       VALUES(?1,?2,?3,?4,'video','composition',?5,?6,?7,'admitted',?8,?9,?10,?10)`,
    )
      .bind(
        generationId,
        project.id,
        composition.id,
        clientRequestId,
        model.provider,
        model.id,
        JSON.stringify({
          compositionId: composition.id,
          title: composition.title,
          shots: spec.shots,
          audioAssetId: spec.audioAssetId ?? null,
          audioTracks: spec.audioTracks ?? [],
          slateAssetId: spec.slateAssetId ?? null,
          slateVideoAssetId: spec.slateVideoAssetId ?? null,
          totalMs: spec.totalMs,
          variant: model.render,
          stage: model.render === "social" ? "slate" : "compose",
          renderStep: model.render === "social" ? 2 : 1,
        }),
        cost,
        cost,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error.message ?? error).includes("UNIQUE")) {
      const row = await env.DB.prepare(
        "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
      )
        .bind(project.id, clientRequestId)
        .first();
      if (row) return { generation: row, created: false };
    }
    throw error;
  }

  const generation = await loadGeneration(env, generationId);
  try {
    await reserve(env, project.id, cost);
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET status='failed',error_code='budget_exhausted',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generationId, error.message, now())
      .run();
    throw error;
  }
  return { generation: await loadGeneration(env, generationId), created: true, model };
}

/** Submit the render. Exported so the worker can dispatch immediately. */
export async function dispatchRender(env, generation) {
  const model = getModel(generation.model);
  const request = safeJson(generation.request_json, {});
  if (!(await claim(env, generation.id, "admitted", "submitting"))) {
    return loadGeneration(env, generation.id);
  }

  try {
    const shots = [];
    for (const shot of request.shots ?? []) {
      const asset = await loadAssetRow(env, generation.project_id, shot.assetId);
      if (!asset) throw new HttpError(409, "A selected shot is no longer in this project", "shot_unavailable");
      shots.push({
        assetId: asset.id,
        durationMs: Number(shot.durationMs),
        portrait: Number(asset.height) > Number(asset.width),
      });
    }
    // The selected order is the edit. Never sort it for a frame size.
    const keyframes = [];
    let cursor = 0;
    for (const shot of shots) {
      keyframes.push({
        timestamp: cursor,
        duration: shot.durationMs,
        url: await signRenderLink(env, { assetId: shot.assetId, projectId: generation.project_id }),
      });
      cursor += shot.durationMs;
    }

    if (model.render === "social") {
      if (request.slateVideoAssetId) {
        const fresh = { ...generation, request_json: JSON.stringify({ ...request, stage: "compose" }) };
        return submitSocialCompose(env, fresh, { ...request, stage: "compose" }, request.slateVideoAssetId);
      }
      const slate = await loadAssetRow(env, generation.project_id, request.slateAssetId);
      if (!slate || slate.kind !== "image")
        throw new HttpError(409, "The 9:16 slate is no longer in this project", "slate_unavailable");
      const object = await env.MEDIA.get(slate.r2_key);
      if (!object) throw new HttpError(410, "The 9:16 slate bytes are unavailable", "slate_unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      const dataUri = `data:${slate.mime};base64,${toBase64(bytes)}`;
      const submitted = await submitSlateVideo(env, dataUri);
      await env.DB.prepare(
        "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
      )
        .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
        .run();
      return loadGeneration(env, generation.id);
    }

    const tracks = [{ id: "visual", type: "video", keyframes }];
    tracks.push(...(await audioTracksForRender(env, generation.project_id, request)));
    const submitted = await submitAssembly(env, model, tracks);
    await env.DB.prepare(
      "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
    )
      .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
      .run();
    return loadGeneration(env, generation.id);
  } catch (error) {
    return failGeneration(env, generation, error, { dispatched: true });
  }
}
