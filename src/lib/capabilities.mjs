// MIT. The versioned Studio capability manifest and its read-only freshness
// check. A refresh reads public provider pages and model search; it never calls
// inference, changes a default, spends money or writes a GitHub issue.

import { imageAspects, models, publicModels, publicRetiredModels } from "./providers.mjs";
import { DARKROOM_VERSION } from "./darkroom.mjs";

export const CAPABILITIES_CONTRACT = "media-studio-capabilities";
export const CAPABILITIES_VERSION = 1;
export const CAPABILITIES_KEY = "capabilities/latest.json";
export const CAPABILITIES_LAST_GOOD_KEY = "capabilities/last-good.json";
export const CAPABILITIES_STATE_KEY = "capabilities/state.json";
export const CAPABILITIES_REFRESH_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const CLOUDFLARE_DOCS = "https://developers.cloudflare.com/workers-ai/models";
const FAL_MODELS = "https://fal.ai/api/models";
const MODELS_DEV = "https://models.dev/api.json";

/** One stable, de-duplicated migration item. The id never changes for the same
 * model and problem, so a daily refresh updates rather than duplicates it. */
export function alertKey(kind, model, detail = "") {
  return `${kind}:${model}${detail ? `:${detail}` : ""}`;
}

function iso(value) {
  return new Date(value).toISOString();
}

function dateValue(text) {
  const match = String(text ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function boundedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function cloudflareSlug(endpoint) {
  return endpoint.split("/").pop();
}

/** Read the public model page's retirement and price facts. */
export function parseCloudflareModelPage(markdown) {
  const text = String(markdown ?? "");
  const planned = /Planned\s+Deprecation\s*\|\s*([0-9/]+)/i.exec(text);
  const pricing = /Unit\s+Pricing\s*\|\s*([^\n]+)/i.exec(text);
  const beta = /(?:^|\n)\s*Beta\s*(?:\n|$)/i.test(text);
  return {
    retirementDate: planned ? dateValue(planned[1]) : null,
    pricing: pricing ? boundedText(pricing[1].replace(/\s*\|\s*$/, "")) : null,
    beta,
    title: (/^#\s+(.+)$/m.exec(text)?.[1] ?? "").trim() || null,
  };
}

/** Read the public fal model search result. */
export function parseFalModel(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: typeof item.id === "string" ? item.id : null,
    deprecated: item.deprecated === true,
    removed: item.removed === true,
    status: typeof item.status === "string" ? item.status : null,
    pricing: boundedText(item.pricingInfoOverride),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
  };
}

function sourceRecord(model, source, status, detail, extra = {}) {
  return {
    model: model.id,
    endpoint: model.endpoint,
    provider: model.provider,
    source,
    status,
    detail: detail ? boundedText(detail) : null,
    checkedAt: extra.checkedAt ?? null,
    retirementDate: extra.retirementDate ?? null,
    pricing: extra.pricing ?? null,
  };
}

async function readBounded(response) {
  const text = await response.text();
  return text.length > MAX_SOURCE_BYTES ? text.slice(0, MAX_SOURCE_BYTES) : text;
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "text/markdown, application/json;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBounded(response);
}

async function checkCloudflare(fetchImpl, model, checkedAt) {
  const slug = cloudflareSlug(model.endpoint);
  const source = `${CLOUDFLARE_DOCS}/${slug}/index.md`;
  try {
    const text = await fetchText(fetchImpl, source);
    const parsed = parseCloudflareModelPage(text);
    return sourceRecord(model, source, "ok", parsed.title, {
      checkedAt,
      retirementDate: parsed.retirementDate,
      pricing: parsed.pricing,
    });
  } catch (error) {
    return sourceRecord(model, source, "unavailable", error instanceof Error ? error.message : String(error), { checkedAt });
  }
}

export function falModelMatches(endpoint, item) {
  if (!item || typeof item.id !== "string") return false;
  return item.id === endpoint || item.id === endpoint.replace(/^fal-ai\//, "");
}

async function checkFal(fetchImpl, model, checkedAt) {
  const source = `${FAL_MODELS}?keywords=${encodeURIComponent(model.endpoint)}`;
  try {
    const text = await fetchText(fetchImpl, source);
    const payload = JSON.parse(text);
    const item = Array.isArray(payload?.items)
      ? payload.items.find((candidate) => falModelMatches(model.endpoint, candidate))
      : null;
    if (!item) throw new Error("The exact endpoint was not returned by model search");
    const parsed = parseFalModel(item);
    return sourceRecord(model, source, "ok", parsed.status, {
      checkedAt,
      retirementDate: parsed.deprecated || parsed.removed ? "withdrawn" : null,
      pricing: parsed.pricing,
      deprecated: parsed.deprecated,
      removed: parsed.removed,
      updatedAt: parsed.updatedAt,
    });
  } catch (error) {
    return sourceRecord(model, source, "unavailable", error instanceof Error ? error.message : String(error), { checkedAt });
  }
}

async function checkModelsDev(fetchImpl, checkedAt) {
  try {
    const text = await fetchText(fetchImpl, MODELS_DEV);
    const payload = JSON.parse(text);
    const providers = Object.keys(payload ?? {});
    return {
      source: MODELS_DEV,
      status: "ok",
      detail: `${providers.length} public provider records`,
      checkedAt,
      providers,
    };
  } catch (error) {
    return {
      source: MODELS_DEV,
      status: "unavailable",
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
    };
  }
}

const CLOUDFLARE_ENDPOINT = /^@cf\//;
const WITHDRAWN = new Set(["deprecated", "removed", "unavailable"]);

/** Turn fresh source records into stable, actionable items. A change is only
 * proposed; no production default is updated by this function. */
export function buildAlerts(sources, previousSources = []) {
  const prior = new Map(previousSources.map((source) => [`${source.model}:${source.source}`, source]));
  const alerts = [];
  for (const source of sources) {
    if (!source.model) continue;
    const model = models[source.model];
    const label = model?.label ?? publicRetiredModels().find((item) => item.id === source.model)?.label ?? source.model;
    const previous = prior.get(`${source.model}:${source.source}`);
    if (source.status === "unavailable") {
      alerts.push({
        id: alertKey("schema", source.model, source.provider),
        kind: "schema",
        severity: "high",
        model: source.model,
        label,
        source: source.source,
        message: "The provider page or exact model search result could not be read. The last good manifest is retained; do not change a default from this run.",
        action: "Review the endpoint on the provider's current page, then refresh again.",
        firstSeenAt: previous?.alertFirstSeenAt ?? source.checkedAt,
        checkedAt: source.checkedAt,
      });
      continue;
    }
    if (source.provider === "cloudflare-workers-ai" && source.retirementDate) {
      alerts.push({
        id: alertKey("retirement", source.model),
        kind: "retirement",
        severity: "high",
        model: source.model,
        label,
        source: source.source,
        retirementDate: source.retirementDate,
        message: `${label} has a published retirement date of ${source.retirementDate}.`,
        action: "Qualify the named replacement against the Studio adapter, frames, cost and a real output; then update Studio, Composer Init, the spec and the agent handoff together.",
        firstSeenAt: previous?.alertFirstSeenAt ?? source.checkedAt,
        checkedAt: source.checkedAt,
      });
    }
    if (source.provider === "fal" && (source.deprecated || source.removed)) {
      alerts.push({
        id: alertKey("retirement", source.model),
        kind: "retirement",
        severity: "high",
        model: source.model,
        label,
        source: source.source,
        retirementDate: source.retirementDate,
        message: `${label} is marked ${source.removed ? "removed" : "deprecated"} by fal model search.`,
        action: "Stop offering it for new work after checking the saved jobs, then qualify a replacement and keep old attribution.",
        firstSeenAt: previous?.alertFirstSeenAt ?? source.checkedAt,
        checkedAt: source.checkedAt,
      });
    }
    if (previous?.pricing && source.pricing && previous.pricing !== source.pricing) {
      alerts.push({
        id: alertKey("pricing", source.model),
        kind: "pricing",
        severity: "medium",
        model: source.model,
        label,
        source: source.source,
        previous: previous.pricing,
        current: source.pricing,
        message: `${label} has a changed public price description.`,
        action: "Recheck the estimate against the current provider price, then update the model's cost basis. Allocated estimates remain distinct from provider charges.",
        firstSeenAt: previous?.alertFirstSeenAt ?? source.checkedAt,
        checkedAt: source.checkedAt,
      });
    }
  }
  // One item per stable id; keep the earliest first-seen time.
  const deduped = new Map();
  for (const alert of alerts) {
    const existing = deduped.get(alert.id);
    if (!existing) deduped.set(alert.id, alert);
    else if (existing.firstSeenAt > alert.firstSeenAt) deduped.set(alert.id, { ...alert, firstSeenAt: existing.firstSeenAt });
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function capabilityManifest({ checkedAt = null, lastGoodAt = null, alerts = [], sources = [] } = {}) {
  const enabled = publicModels().map((model) => ({ ...model, status: "enabled" }));
  return {
    contract: CAPABILITIES_CONTRACT,
    version: CAPABILITIES_VERSION,
    checkedAt,
    lastGoodAt,
    models: enabled,
    retired: publicRetiredModels(),
    frames: [...imageAspects],
    adapters: {
      workersAi: "cloudflare-ai-binding",
      fal: "queue-rest",
      darkroom: DARKROOM_VERSION,
    },
    sources,
    alerts,
  };
}

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const text = typeof object.arrayBuffer === "function"
      ? new TextDecoder().decode(await object.arrayBuffer())
      : await new Response(object.body).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJson(bucket, key, value) {
  await bucket.put(key, new TextEncoder().encode(JSON.stringify(value, null, 2)), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
  });
}

export async function readCapabilityManifest(env) {
  return (await readJson(env.MEDIA, CAPABILITIES_KEY)) ?? capabilityManifest();
}

export async function readCapabilityState(env) {
  return (await readJson(env.MEDIA, CAPABILITIES_STATE_KEY)) ?? null;
}

/** Run one bounded, read-only check. The previous manifest is the fallback. */
export async function refreshCapabilities(env, { now = Date.now(), fetchImpl = fetch, force = false } = {}) {
  const state = await readCapabilityState(env);
  if (!force && state?.nextDueAt && Date.parse(state.nextDueAt) > now) {
    return { skipped: true, reason: "not-due", state };
  }
  const previous = (await readJson(env.MEDIA, CAPABILITIES_KEY)) ?? capabilityManifest();
  const previousAlerts = Array.isArray(previous.alerts) ? previous.alerts : [];
  const previousSources = (Array.isArray(previous.sources) ? previous.sources : []).map((source) => ({
    ...source,
    alertFirstSeenAt:
      previousAlerts.find((alert) => alert.model === source.model && alert.source === source.source)?.firstSeenAt ?? null,
  }));
  const checkedAt = iso(now);
  const workersAi = Object.values(models).filter((model) => CLOUDFLARE_ENDPOINT.test(model.endpoint));
  const fal = Object.values(models).filter((model) => model.provider === "fal");
  const results = await Promise.all([
    ...workersAi.map((model) => checkCloudflare(fetchImpl, model, checkedAt)),
    ...fal.map((model) => checkFal(fetchImpl, model, checkedAt)),
    checkModelsDev(fetchImpl, checkedAt),
  ]);
  const sources = results.filter((result) => result.model);
  const modelsDev = results.find((result) => !result.model);
  const alerts = buildAlerts(sources, previousSources);
  const complete = sources.every((source) => source.status === "ok") && modelsDev?.status === "ok";
  const manifest = capabilityManifest({
    checkedAt,
    lastGoodAt: complete ? checkedAt : previous.lastGoodAt ?? null,
    alerts,
    sources: [...sources, modelsDev].filter(Boolean),
  });
  await writeJson(env.MEDIA, CAPABILITIES_KEY, manifest);
  if (complete) await writeJson(env.MEDIA, CAPABILITIES_LAST_GOOD_KEY, manifest);
  const next = {
    checkedAt,
    outcome: complete ? "complete" : "partial",
    lastGoodAt: manifest.lastGoodAt,
    nextDueAt: iso(now + CAPABILITIES_REFRESH_MS),
    openAlerts: alerts.length,
    failures: sources.filter((source) => source.status !== "ok").length + (modelsDev?.status === "ok" ? 0 : 1),
    modelCalls: 0,
    issuesWritten: 0,
  };
  await writeJson(env.MEDIA, CAPABILITIES_STATE_KEY, next);
  return { skipped: false, manifest, state: next };
}

/** The every-minute cron calls this; it does real work at most once a day. */
export async function refreshCapabilitiesIfDue(env, options = {}) {
  return refreshCapabilities(env, options);
}

export { WITHDRAWN };
