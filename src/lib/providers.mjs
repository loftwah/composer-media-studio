// MIT. Provider adapters and the one server-side model catalogue.
// Provider request shapes are exercised by mocked contract checks; live
// availability and completed generation are separately recorded evidence.
//
// Image: Cloudflare Workers AI, billed to this app's own Cloudflare account.
// Video: fal.ai queue REST, billed to this app's own fal key.

import { HttpError } from "./util.mjs";

export const PROVIDER_CLOUDFLARE = "cloudflare-workers-ai";
export const PROVIDER_FAL = "fal";
export const FAL_ORIGIN = "https://queue.fal.run";

const imageDimensions = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1280, height: 1024 },
  wide: { width: 1280, height: 720 },
};

export const imageAspects = Object.keys(imageDimensions);

export const models = {
  "studio-print": {
    id: "studio-print",
    label: "Studio Print",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/lucid-origin",
    kind: "image",
    description: "Paper-cut editorial illustration with warm grounds and room for a headline.",
    aspects: imageAspects,
    references: 0,
    costMicro: 25_000,
    costBasis: "Cloudflare Workers AI estimate for one Lucid Origin still; not an invoice.",
  },
  "studio-film": {
    id: "studio-film",
    label: "Studio Film",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/phoenix-1.0",
    kind: "image",
    description: "Screenprinted cinematic frames with deep shadows and a strong single accent.",
    aspects: imageAspects,
    references: 0,
    costMicro: 20_000,
    costBasis: "Cloudflare Workers AI estimate for one Phoenix still; not an invoice.",
  },
  "studio-draft": {
    id: "studio-draft",
    label: "Studio Draft",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/bytedance/stable-diffusion-xl-lightning",
    kind: "image",
    description: "Fast photographic draft for product plates and lighting tests.",
    aspects: imageAspects,
    references: 0,
    costMicro: 1_200,
    costBasis: "Cloudflare Workers AI estimate for one 1024px still; not an invoice.",
  },
  "studio-detail": {
    id: "studio-detail",
    label: "Studio Detail",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-2-klein-4b",
    kind: "image",
    description: "Reference-guided square variation that takes palette, line quality and subject cues from one selected still. It does not promise identical composition or pixels.",
    aspects: ["square"],
    references: 1,
    costMicro: 6_000,
    costBasis: "Cloudflare Workers AI estimate for one FLUX.2 klein still; not an invoice.",
  },
  "studio-quick": {
    id: "studio-quick",
    label: "Studio Quick",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-1-schnell",
    kind: "image",
    description: "Cheapest square draft for exploring a direction.",
    aspects: ["square"],
    references: 0,
    costMicro: 700,
    costBasis: "Cloudflare Workers AI estimate for one schnell still; not an invoice.",
  },
  "hailuo-standard": {
    id: "hailuo-standard",
    label: "Hailuo 2.3 Standard",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    kind: "video",
    description: "Asynchronous image-to-video with a six or ten second clip.",
    aspects: ["from-image"],
    references: 1,
    durations: [6, 10],
    costMicro: 280_000,
    costPerSecondMicro: 46_667,
    durationCostsMicro: { 6: 280_000, 10: 560_000 },
    costBasis: "fal.ai lists US$0.28 for six seconds and US$0.56 for ten; checked 14 November 2026. Provider billing may change.",
  },
  "h3-max-turbo": {
    id: "h3-max-turbo",
    label: "MiniMax H3 Max Turbo · 768p",
    provider: PROVIDER_FAL,
    endpoint: "minimax/h3-max-turbo/image-to-video",
    kind: "video",
    description: "Animate a selected still into a 5, 10 or 15 second 768p video. Provider availability has not yet been verified in this studio.",
    aspects: ["from-image"],
    references: 1,
    durations: [5, 10, 15],
    costMicro: 240_000,
    durationCostsMicro: { 5: 240_000, 10: 440_000, 15: 640_000 },
    costBasis: "Conservative estimate at fal.ai's standard US$0.04 per generated second at 768p, with one extra second reserved because output can run longer. A temporary promotion may reduce the invoice; provider billing can change. Pricing checked 14 November 2026.",
  },
  "kling-standard": {
    id: "kling-standard",
    label: "Kling 2.5 Turbo Pro",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    kind: "video",
    description: "Higher-motion asynchronous image-to-video, five or ten seconds.",
    aspects: ["from-image"],
    references: 1,
    durations: [5, 10],
    costMicro: 350_000,
    costPerSecondMicro: 70_000,
    costBasis: "fal.ai review estimate for a five second clip; check current fal pricing before relying on it.",
  },
  "studio-score": {
    id: "studio-score",
    label: "Studio Score",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/stable-audio",
    kind: "audio",
    description:
      "An original music or atmosphere bed from a written description, 10 to 30 seconds long. Instrumental, generated for this studio.",
    audio: { mode: "music", minSeconds: 10, maxSeconds: 30 },
    references: 0,
    costMicro: 15_000,
    costBasis:
      "fal.ai estimate per second of Stable Audio, shown against the length you choose; confirm current fal pricing before relying on it.",
  },
  "studio-voice": {
    id: "studio-voice",
    label: "Studio Voice",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    kind: "audio",
    description:
      "Spoken narration from your own script, using ElevenLabs' voice model through fal.ai. Use text you wrote or have the rights to.",
    audio: { mode: "speech", maxChars: 1200 },
    references: 0,
    costMicro: 60_000,
    costBasis:
      "fal.ai estimate for one short ElevenLabs narration; the fal invoice, not this figure, is authoritative.",
  },
  "studio-effect": {
    id: "studio-effect",
    label: "Studio Effect",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/elevenlabs/sound-effects/v2",
    kind: "audio",
    description:
      "One short sound effect or atmosphere cue from a written description, using ElevenLabs' sound-effects model through fal.ai. Saved as its own asset so it can be mixed separately.",
    audio: { mode: "effect", minSeconds: 1, maxSeconds: 15 },
    references: 0,
    costMicro: 8_000,
    costBasis:
      "Planning estimate for one short fal-hosted ElevenLabs sound effect; the fal invoice is authoritative.",
  },
  "studio-fill": {
    id: "studio-fill",
    label: "Studio Fill",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/flux-pro/v1/fill",
    kind: "image",
    edit: "fill",
    description:
      "A real masked fill or outpaint: paint the area to change, describe what belongs there, and FLUX Fill returns a new still. The original, mask and result are kept separately.",
    aspects: ["match-reference"],
    references: 1,
    mask: true,
    costMicro: 50_000,
    costBasis:
      "Planning estimate for one FLUX.1 Fill request on fal.ai; confirm current fal pricing before relying on it.",
  },
  "studio-cutout": {
    id: "studio-cutout",
    label: "Studio Cutout",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/birefnet/v2",
    kind: "image",
    edit: "cutout",
    description:
      "Background removal with a transparent PNG result, produced from the selected still. The original stays untouched.",
    aspects: ["match-reference"],
    references: 1,
    promptRequired: false,
    costMicro: 2_000,
    costBasis:
      "Planning estimate for one BiRefNet request on fal.ai; the fal invoice is authoritative.",
  },
  "studio-upscale": {
    id: "studio-upscale",
    label: "Studio Upscale",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/clarity-upscaler",
    kind: "image",
    edit: "upscale",
    description:
      "A two-times upscale of the selected still with a deterministic record of the source. It enhances detail; it does not invent missing footage.",
    aspects: ["match-reference"],
    references: 1,
    promptRequired: false,
    costMicro: 20_000,
    costBasis:
      "Planning estimate for one Clarity Upscaler request on fal.ai; the fal invoice is authoritative.",
  },
  "studio-assembly": {
    id: "studio-assembly",
    label: "Studio Assembly",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/ffmpeg-api/compose",
    kind: "video",
    render: "assembly",
    description:
      "Assemble the ordered shots and an optional audio bed into one bounded, playable export.",
    aspects: ["assembly"],
    references: 0,
    costMicro: 20_000,
    costBasis:
      "fal.ai estimate for one bounded ffmpeg composition; confirm current fal pricing before relying on it.",
  },
  "studio-social": {
    id: "studio-social",
    label: "Studio 9:16 Cut",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/ffmpeg-api/compose",
    kind: "video",
    render: "social",
    description:
      "A true 720 × 1280 cut of the same takes and audio bed. A generated one-second vertical slate opens the cut; the selected shot order is preserved and the takes are fitted into the 9:16 frame rather than reordered.",
    aspects: ["social"],
    references: 0,
    costMicro: 520_000,
    costBasis:
      "One Wan 2.5 720p vertical slate video (5 s at the published US$0.10/s, about US$0.50) plus one bounded compose with the selected takes and sound. The slate is saved and reused by later renders of the same storyboard; this is an estimate, not an invoice.",
  },
};

/** Chunked base64 so an 8 MiB reference cannot overflow the argument limit. */
export function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function publicModels() {
  return Object.values(models).map((model) => ({
    id: model.id,
    label: model.label,
    kind: model.kind,
    description: model.description,
    aspects: model.aspects ?? [],
    durations: model.durations ?? null,
    references: model.references,
    audio: model.audio ?? null,
    edit: model.edit ?? null,
    promptRequired: model.promptRequired !== false,
    mask: Boolean(model.mask),
    render: model.render ?? null,
    provider:
      model.provider === PROVIDER_CLOUDFLARE
        ? "Cloudflare Workers AI"
        : "fal.ai",
    costMicro: model.costMicro,
    costPerSecondMicro: model.costPerSecondMicro ?? null,
    durationCostsMicro: model.durationCostsMicro ?? null,
    costBasis: model.costBasis,
  }));
}

export function getModel(id) {
  const model = models[id];
  if (!model) throw new HttpError(400, "Choose a supported model");
  return model;
}

export function estimateCost(model, settings = {}) {
  if (model.kind === "audio" && model.audio?.mode === "music") {
    const seconds = Number(settings.durationSeconds ?? model.audio.maxSeconds);
    return Math.max(1, Math.round((model.costMicro * seconds) / model.audio.maxSeconds));
  }
  if (model.kind !== "video") return model.costMicro;
  const base = model.durations?.[0] ?? 5;
  const seconds = Number(settings.durationSeconds ?? base);
  if (Object.hasOwn(model.durationCostsMicro ?? {}, seconds))
    return model.durationCostsMicro[seconds];
  if (seconds === base) return model.costMicro;
  return Math.round((model.costMicro * seconds) / base);
}

export function aspectDimensions(aspect, reference) {
  if (aspect === "match-reference" || aspect === "from-image") {
    if (reference?.width && reference?.height)
      return { width: reference.width, height: reference.height };
    return { width: 1024, height: 1024 };
  }
  const dimensions = imageDimensions[aspect];
  if (!dimensions) throw new HttpError(400, "Choose a supported frame shape");
  return { ...dimensions };
}

/** Validate settings against the selected model; never coerce silently. */
export function validateSettings(model, input) {
  const prompt = String(input.prompt ?? "").trim();
  const promptRequired = model.promptRequired !== false;
  if (promptRequired && !prompt) throw new HttpError(400, "Describe what you want to create");
  if (prompt.length > 1800)
    throw new HttpError(400, "Keep the prompt under 1,800 characters");

  if (model.kind === "image") {
    const aspect = String(input.aspect ?? model.aspects[0]);
    if (!model.aspects.includes(aspect))
      throw new HttpError(400, `${model.label} does not support the ${aspect} frame`);
    if (model.edit) {
      return { prompt, aspect, edit: model.edit };
    }
    return { prompt, aspect };
  }

  if (model.kind === "audio") {
    if (model.audio.mode === "speech") {
      if (prompt.length > model.audio.maxChars)
        throw new HttpError(400, `${model.label} takes up to ${model.audio.maxChars} characters`);
      return { prompt, durationSeconds: null };
    }
    const durationSeconds = Math.round(Number(input.durationSeconds ?? model.audio.maxSeconds));
    if (!Number.isFinite(durationSeconds) || durationSeconds < model.audio.minSeconds || durationSeconds > model.audio.maxSeconds)
      throw new HttpError(
        400,
        `${model.label} makes ${model.audio.minSeconds} to ${model.audio.maxSeconds} seconds of sound`,
      );
    return { prompt, durationSeconds };
  }

  const durationSeconds = Number(input.durationSeconds ?? model.durations[0]);
  if (!model.durations.includes(durationSeconds))
    throw new HttpError(400, `${model.label} supports ${model.durations.join(" or ")} second clips`);
  const aspect = String(input.aspect ?? "from-image");
  if (!model.aspects.includes(aspect))
    throw new HttpError(400, `${model.label} takes its frame from the selected still`);
  const aspectRatio = ["16:9", "9:16", "1:1"].includes(input.aspectRatio)
    ? input.aspectRatio
    : null;
  return { prompt, durationSeconds, aspect, aspectRatio };
}

/** Text-to-image on the Workers AI binding. */
async function generateImage(env, model, settings, references, signal) {
  const reference = references[0];
  if (model.references > 0) {
    if (!reference) throw new HttpError(400, "Select a reference image for this model");
    const form = new FormData();
    form.set("prompt", settings.prompt);
    form.set("image", new File([reference.bytes], `reference.${reference.format === "png" ? "png" : "jpg"}`, {
      type: reference.format === "png" ? "image/png" : "image/jpeg",
    }));
    const request = new Request("https://studio.local/reference", { method: "POST", body: form });
    const output = await env.AI.run(
      model.endpoint,
      { multipart: { body: request.body, contentType: request.headers.get("content-type") } },
      { signal },
    );
    const base64 = output?.image;
    if (typeof base64 !== "string" || base64.length < 256)
      throw new HttpError(502, "The image provider returned no usable image", "provider_invalid");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return { bytes, format: "jpeg" };
  }

  const { width, height } = aspectDimensions(settings.aspect);
  const input = { prompt: settings.prompt, width, height };
  if (model.endpoint.includes("stable-diffusion-xl"))
    input.negative_prompt =
      "photograph of a real person, glossy 3d render, plastic skin, watermark, signature, busy detail";
  if (model.endpoint.includes("lucid-origin")) input.guidance = 5;
  if (model.endpoint.includes("phoenix")) input.guidance = 3;
  const output = await env.AI.run(model.endpoint, input, { signal });
  let bytes;
  if (output instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(output).arrayBuffer());
  } else if (typeof output?.image === "string") {
    bytes = Uint8Array.from(atob(output.image), (character) => character.charCodeAt(0));
  } else {
    throw new HttpError(502, "The image provider returned no usable image", "provider_invalid");
  }
  if (bytes.length < 256)
    throw new HttpError(502, "The image provider returned an empty image", "provider_invalid");
  return { bytes, format: "jpeg" };
}

export async function runImage(env, model, settings, references, signal) {
  try {
    return await generateImage(env, model, settings, references, signal);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `Image generation was not accepted: ${String(error.message ?? error).slice(0, 160)}`, "provider_error");
  }
}

function falKey(env) {
  if (!env.FAL_KEY) {
    // Nothing was sent, so this is a definitive failure rather than an unknown
    // provider outcome. It releases the reservation instead of holding it.
    const error = new HttpError(
      503,
      "This route needs a fal.ai key on this studio",
      "provider_not_configured",
    );
    error.definitive = true;
    throw error;
  }
  return env.FAL_KEY;
}

function checkFalUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(502, `Video provider returned an invalid ${label}`, "provider_invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run")
    throw new HttpError(502, `Video provider returned an unexpected ${label}`, "provider_invalid");
  return url.href;
}

/** Provider text can carry signed URLs and keys. Keep the actionable sentence,
 * drop the rest, and bound what reaches the job record or a log. */
export function sanitiseProviderDetail(value, max = 240) {
  if (value === undefined || value === null) return "";
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(authorization|api[_-]?key|key|token|secret)\b\s*[:=]\s*\S+/gi, "$1 [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A terminal queue state does not prove successful execution. fal reports the
 * model's own failure in the queue payload or when the result is read, and a
 * 403 means different things depending on the account and the endpoint. */
export function classifyProviderFailure(status, { errorType, detail } = {}) {
  const text = `${errorType ?? ""} ${detail ?? ""}`.toLowerCase();
  if (/balance|fund|credit|payment|billing|insufficient|exhausted/.test(text))
    return "provider_funding";
  if (/permission|forbidden|not allowed|unauthori[sz]ed|access denied|not enabled|scope/.test(text))
    return "provider_permission";
  if (/invalid|validation|unsupported|bad request|must (contain|be)|required/.test(text))
    return "provider_rejected";
  if (status === 401) return "provider_auth";
  if (status === 402) return "provider_funding";
  if (status === 403) return "provider_permission";
  if (status === 429) return "provider_rate_limited";
  if (status >= 400 && status < 500) return "provider_rejected";
  return "provider_error";
}

/** Read a fal error response once and keep its bounded, sanitised detail. */
export async function readProviderError(response, label) {
  const body = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  const raw =
    payload?.detail ??
    payload?.error?.message ??
    (typeof payload?.error === "string" ? payload.error : null) ??
    payload?.message ??
    body;
  const detail = sanitiseProviderDetail(raw);
  const errorType =
    sanitiseProviderDetail(
      payload?.error_type ?? payload?.error?.type ?? response.headers.get("x-fal-error-type") ?? "",
      80,
    ) || null;
  return {
    status: response.status,
    detail,
    errorType,
    code: classifyProviderFailure(response.status, { errorType, detail }),
    message: `${label} (${response.status})${detail ? `: ${detail}` : ""}`,
  };
}

/** Result retrieval can reproduce the model's error. A 4xx is a decision, not
 * a transient outage, so the caller can stop polling without a second spend. */
async function readFalResult(env, generation, label) {
  if (!generation.provider_response_url)
    throw new HttpError(409, "This job has no provider result to read", "unknown_outcome");
  const response = await fetch(generation.provider_response_url, {
    headers: { authorization: `Key ${falKey(env)}` },
  });
  if (!response.ok) {
    const failure = await readProviderError(response, `${label} result read failed`);
    const error = new HttpError(502, failure.message, failure.code);
    error.providerStatus = failure.status;
    error.errorType = failure.errorType;
    error.definitive = failure.status >= 400 && failure.status < 500;
    error.stage = "result";
    throw error;
  }
  return response.json().catch(() => null);
}

/** fal's documented webhook URL for a finished queue request. Only a public
 * HTTPS studio has one; local and standalone installs keep polling. */
export function webhookUrl(env) {
  const explicit = typeof env.FAL_WEBHOOK_URL === "string" ? env.FAL_WEBHOOK_URL.trim() : "";
  if (explicit.startsWith("https://")) return explicit;
  const origin = String(env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
  return origin.startsWith("https://") ? `${origin}/api/fal/webhook` : null;
}

function withWebhook(env, url) {
  const target = webhookUrl(env);
  if (!target) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("fal_webhook", target);
  return parsed.href;
}

export async function submitVideo(env, model, settings, reference) {
  if (!reference) throw new HttpError(400, "Select the still to animate");
  if (reference.bytes.length > 8 * 1024 * 1024)
    throw new HttpError(400, "The still is larger than the 8 MiB reference limit", "reference_too_large");
  const mime = reference.format === "png" ? "image/png" : "image/jpeg";
  const dataUri = `data:${mime};base64,${toBase64(reference.bytes)}`;

  const body = {
    prompt: settings.prompt,
    image_url: dataUri,
    duration: model.id === "h3-max-turbo" ? settings.durationSeconds : String(settings.durationSeconds),
  };
  if (model.id === "kling-standard") {
    body.negative_prompt = "blur, distort, low quality, text artefacts";
  } else if (model.id === "h3-max-turbo") {
    body.resolution = "768P";
    body.prompt_expansion_mode = "disabled";
    body.enable_safety_checker = true;
  } else {
    body.prompt_optimizer = false;
  }

  const response = await fetch(`${FAL_ORIGIN}/${model.endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Key ${falKey(env)}`,
      "content-type": "application/json",
      "x-fal-request-timeout": "120",
    },
    body: JSON.stringify(body),
  });
  const payload = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const failure = await readProviderError(response, "Video provider refused the request");
    const error = new HttpError(
      failure.code === "provider_funding" ? 402 : 502,
      failure.message,
      failure.code,
    );
    error.definitive = response.status >= 400 && response.status < 500;
    error.providerStatus = failure.status;
    error.errorType = failure.errorType;
    error.stage = "submit";
    throw error;
  }
  if (!payload?.request_id)
    throw new HttpError(502, "Video provider accepted the request without an identifier", "provider_invalid");
  return {
    requestId: payload.request_id,
    statusUrl: checkFalUrl(payload.status_url, "status URL"),
    responseUrl: checkFalUrl(payload.response_url, "result URL"),
  };
}

export async function readVideoStatus(env, generation) {
  if (!generation.provider_status_url)
    throw new HttpError(409, "This job has no provider status to read", "unknown_outcome");
  // logs=1 is the documented way to see a runner failure without submitting
  // anything. Keep only bounded, sanitised lines.
  const statusUrl = new URL(generation.provider_status_url);
  statusUrl.searchParams.set("logs", "1");
  const response = await fetch(statusUrl.href, {
    headers: { authorization: `Key ${falKey(env)}` },
  });
  if (!response.ok) {
    const failure = await readProviderError(response, "Provider status read failed");
    const error = new HttpError(502, failure.message, failure.code);
    error.providerStatus = failure.status;
    error.errorType = failure.errorType;
    error.definitive = failure.status >= 400 && failure.status < 500;
    error.stage = "status";
    throw error;
  }
  const payload = await response.json().catch(() => null);
  const logs = Array.isArray(payload?.logs)
    ? payload.logs.slice(-5).map((line) => sanitiseProviderDetail(line?.message ?? line, 200))
    : [];
  return {
    status: String(payload?.status ?? ""),
    // COMPLETED does not prove the model succeeded. Keep the provider's own
    // error and type so the caller can stop without a second paid request.
    error: payload?.error ? sanitiseProviderDetail(payload.error) : null,
    errorType: payload?.error_type
      ? sanitiseProviderDetail(payload.error_type, 80)
      : null,
    logs,
    responseUrl: payload?.response_url
      ? checkFalUrl(payload.response_url, "result URL")
      : generation.provider_response_url,
  };
}

export async function readVideoResult(env, generation) {
  const payload = await readFalResult(env, generation, "Video provider");
  const file = payload?.video;
  if (!file?.url) throw new HttpError(502, "Video provider returned no video", "provider_invalid");
  return { url: file.url, contentType: file.content_type ?? "video/mp4", bytes: file.file_size ?? null };
}

export async function cancelVideo(env, generation) {
  if (!generation.provider_status_url)
    throw new HttpError(409, "This job has no provider request to cancel", "unknown_outcome");
  const url = generation.provider_status_url.replace(/\/status$/, "/cancel");
  checkFalUrl(url, "cancel URL");
  const response = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Key ${falKey(env)}` },
  });
  return { accepted: response.ok, status: response.status };
}

/** One place that submits to the fal queue, so audio and render jobs inherit
 * the same URL validation as video. */
async function falSubmit(env, endpoint, input, { webhook = false } = {}) {
  const target = `${FAL_ORIGIN}/${endpoint}`;
  const response = await fetch(webhook ? withWebhook(env, target) : target, {
    method: "POST",
    headers: {
      authorization: `Key ${falKey(env)}`,
      "content-type": "application/json",
      "x-fal-request-timeout": "120",
    },
    body: JSON.stringify(input),
  });
  const payload = response.ok ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const failure = await readProviderError(response, "Provider refused the request");
    const error = new HttpError(
      failure.code === "provider_funding" ? 402 : 502,
      failure.message,
      failure.code,
    );
    error.definitive = response.status >= 400 && response.status < 500;
    error.providerStatus = failure.status;
    error.errorType = failure.errorType;
    error.stage = "submit";
    throw error;
  }
  if (!payload?.request_id)
    throw new HttpError(502, "Provider accepted the request without an identifier", "provider_invalid");
  return {
    requestId: payload.request_id,
    statusUrl: checkFalUrl(payload.status_url, "status URL"),
    responseUrl: checkFalUrl(payload.response_url, "result URL"),
  };
}

export async function submitAudio(env, model, settings) {
  const input =
    model.audio.mode === "speech"
      ? {
          text: settings.prompt,
          voice: "Aria",
          stability: 0.5,
          output_format: "mp3_44100_128",
          enable_safety_checker: true,
        }
      : model.audio.mode === "effect"
        ? {
            text: settings.prompt,
            duration_seconds: settings.durationSeconds ?? 5,
            prompt_influence: 0.4,
            output_format: "mp3_44100_128",
            enable_safety_checker: true,
          }
        : {
            prompt: settings.prompt,
            seconds_total: settings.durationSeconds ?? model.audio.maxSeconds,
            enable_safety_checker: true,
          };
  return falSubmit(env, model.endpoint, input);
}

export async function readAudioResult(env, generation) {
  const payload = await readFalResult(env, generation, "Audio provider");
  const file = payload?.audio ?? payload?.audio_file;
  if (!file?.url) throw new HttpError(502, "Audio provider returned no audio", "provider_invalid");
  return { url: file.url, contentType: file.content_type ?? "audio/mpeg" };
}

/** Submit one masked fill, cutout or upscale request. Signed asset links stand
 * in for provider-readable URLs; the owner session never leaves the studio. */
export async function submitImageEdit(env, model, settings, references) {
  const reference = references[0];
  if (!reference?.bytes) throw new HttpError(400, "Select a still to edit");
  const mimeFor = (format) => (format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg");
  const imageUrl = `data:${mimeFor(reference.format)};base64,${toBase64(reference.bytes)}`;
  const input = { image_url: imageUrl, sync_mode: false };
  if (model.edit === "fill") {
    if (!reference.maskBytes)
      throw new HttpError(400, "Draw or upload a mask before sending a fill request", "mask_required");
    input.prompt = settings.prompt;
    input.mask_url = `data:${mimeFor(reference.maskFormat)};base64,${toBase64(reference.maskBytes)}`;
    input.output_format = "png";
    input.safety_tolerance = "2";
  } else if (model.edit === "cutout") {
    input.output_format = "png";
  } else if (model.edit === "upscale") {
    input.prompt = settings.prompt || "masterpiece, best quality, highres";
    input.upscale_factor = 2;
    input.creativity = 0.25;
    input.resemblance = 0.8;
    input.enable_safety_checker = true;
  } else {
    throw new HttpError(400, "Choose a supported still edit");
  }
  return falSubmit(env, model.endpoint, input);
}

export async function readImageResult(env, generation) {
  const payload = await readFalResult(env, generation, "Image edit provider");
  const file = payload?.images?.[0] ?? payload?.image ?? payload?.mask_image;
  if (!file?.url) throw new HttpError(502, "Image edit provider returned no image", "provider_invalid");
  return { url: file.url, contentType: file.content_type ?? "image/png" };
}

/** Retained for older callers. The portrait-first sort was the incomplete
 * 4:5 workaround; a true 9:16 cut now opens with a 1080×1920 slate and keeps
 * the selected shot order. */
export function orderShotsForSocial(shots) {
  return [...shots];
}

/** The 9:16 slate needs one real vertical video. Wan 2.5 accepts the
 * deterministic slate as a data URI and returns an exact 720×1280 frame at
 * this setting; compose then uses its first second as the opening card. */
export async function submitSlateVideo(env, imageDataUri) {
  return falSubmit(env, "fal-ai/wan-25-preview/image-to-video", {
    prompt:
      "A still opening title card with a very slow push in; keep the typography stable and unreadable text out of the way",
    image_url: imageDataUri,
    resolution: "720p",
    duration: "5",
    enable_prompt_expansion: false,
  });
}

export async function readSlateResult(env, generation) {
  return readVideoResult(env, generation);
}

/** Assemble ordered shots plus an optional audio bed in one bounded call. */
export async function submitAssembly(env, model, tracks) {
  // A bounded render is the one queue request whose result the current key
  // cannot read back. Ask fal to deliver the finished payload instead; the
  // polling path still runs and is idempotent if the webhook arrives first.
  return falSubmit(env, model.endpoint, { tracks }, { webhook: true });
}

export async function readRenderResult(env, generation) {
  const payload = await readFalResult(env, generation, "Render provider");
  const file =
    payload?.video ??
    (typeof payload?.video_url === "string"
      ? { url: payload.video_url, content_type: "video/mp4" }
      : null);
  if (!file?.url) throw new HttpError(502, "Render provider returned no video", "provider_invalid");
  return {
    url: file.url,
    contentType: file.content_type ?? "video/mp4",
    thumbnailUrl: typeof payload?.thumbnail_url === "string" ? payload.thumbnail_url : null,
  };
}
const ALLOWED_MEDIA_HOST = /(^|\.)fal\.media$/;

/** Copy a provider result into owned storage. Only fal's own media host is
 * trusted, and the result must fit the app's own output limit. */
export async function downloadMedia(env, url, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_MEDIA_HOST.test(parsed.hostname))
    throw new HttpError(502, "Provider returned an untrusted download address", "provider_invalid");
  const response = await fetch(parsed.href, { redirect: "follow" });
  if (!response.ok) throw new HttpError(502, `Provider download failed (${response.status})`, "provider_error");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes)
    throw new HttpError(502, `Provider output exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB owned-output limit`, "output_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes)
    throw new HttpError(502, `Provider output exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB owned-output limit`, "output_too_large");
  return { bytes, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export const downloadVideo = (env, url) => downloadMedia(env, url);
