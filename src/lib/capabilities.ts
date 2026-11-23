// MIT. The versioned Studio capability manifest and its read-only freshness
// check. A refresh reads public provider pages and model search; it never calls
// inference, changes a default, spends money or writes a GitHub issue.

import { imageAspects, models, publicModels, publicRetiredModels } from "./provider-catalogue.ts";
import type { CatalogueEntry, PublicModelRecord, RetiredModelRecord } from "./provider-catalogue.ts";
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

/** The public facts read from a Workers AI model page. */
export interface CloudflareModelFacts {
  retirementDate: string | null;
  pricing: string | null;
  beta: boolean;
  title: string | null;
}

/** The public facts read from one fal model-search result. */
export interface FalModelFacts {
  id: string | null;
  deprecated: boolean;
  removed: boolean;
  status: string | null;
  pricing: string;
  updatedAt: string | null;
}

export type SourceStatus = "ok" | "unavailable";

/** One provider page or model-search check, as stored in the manifest. */
export interface CapabilitySource {
  model: string;
  endpoint: string;
  provider: string;
  source: string;
  status: SourceStatus;
  detail: string | null;
  checkedAt: string | null;
  retirementDate: string | null;
  pricing: string | null;
  deprecated?: boolean;
  removed?: boolean;
  updatedAt?: string | null;
}

/** The models.dev provider-count check; it names no model. */
export interface ModelsDevCheck {
  model?: undefined;
  source: string;
  status: SourceStatus;
  detail: string;
  checkedAt: string;
  providers?: string[];
}

export type ManifestSource = CapabilitySource | ModelsDevCheck;

export type AlertKind = "schema" | "retirement" | "pricing";
export type AlertSeverity = "high" | "medium";

/** One stable, de-duplicated migration item. */
export interface CapabilityAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  model: string;
  label: string;
  source: string;
  retirementDate?: string | null;
  previous?: string;
  current?: string;
  message: string;
  action: string;
  firstSeenAt: string | null;
  checkedAt: string | null;
}

export interface CapabilityAdapters {
  workersAi: string;
  fal: string;
  darkroom: string;
}

export interface CapabilityManifest {
  contract: string;
  version: number;
  checkedAt: string | null;
  lastGoodAt: string | null;
  models: Array<PublicModelRecord & { status: "enabled" }>;
  retired: RetiredModelRecord[];
  frames: string[];
  adapters: CapabilityAdapters;
  sources: ManifestSource[];
  alerts: CapabilityAlert[];
}

export interface CapabilityManifestInput {
  checkedAt?: string | null;
  lastGoodAt?: string | null;
  alerts?: CapabilityAlert[];
  sources?: ManifestSource[];
}

/** The stored freshness record. It names no model and never spends. */
export interface CapabilityRefreshState {
  checkedAt: string;
  outcome: "complete" | "partial";
  lastGoodAt: string | null;
  nextDueAt: string;
  openAlerts: number;
  failures: number;
  modelCalls: number;
  issuesWritten: number;
}

export type CapabilityRefreshResult =
  | { skipped: true; reason: "not-due"; state: CapabilityRefreshState }
  | { skipped: false; manifest: CapabilityManifest; state: CapabilityRefreshState };

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** The narrow R2 surface this lane reads and writes. */
export interface CapabilityBucketObject {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
}

export interface CapabilityBucket {
  get(key: string): Promise<CapabilityBucketObject | null>;
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
}

export interface CapabilityEnv {
  MEDIA: CapabilityBucket;
}

export interface CapabilityRefreshOptions {
  now?: number;
  fetchImpl?: FetchLike;
  force?: boolean;
}

/** One stable, de-duplicated migration item. The id never changes for the same
 * model and problem, so a daily refresh updates rather than duplicates it. */
export function alertKey(kind: string, model: string, detail = ""): string {
  return `${kind}:${model}${detail ? `:${detail}` : ""}`;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function dateValue(text: unknown): string | null {
  const match = String(text ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function boundedText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function cloudflareSlug(endpoint: string): string | undefined {
  return endpoint.split("/").pop();
}

/** Read the public model page's retirement and price facts. */
export function parseCloudflareModelPage(markdown: unknown): CloudflareModelFacts {
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
export function parseFalModel(item: unknown): FalModelFacts | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : null,
    deprecated: record.deprecated === true,
    removed: record.removed === true,
    status: typeof record.status === "string" ? record.status : null,
    pricing: boundedText(record.pricingInfoOverride),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

interface SourceRecordExtra {
  checkedAt?: string | null;
  retirementDate?: string | null;
  pricing?: string | null;
  deprecated?: boolean;
  removed?: boolean;
  updatedAt?: string | null;
}

function sourceRecord(
  model: CatalogueEntry,
  source: string,
  status: SourceStatus,
  detail: unknown,
  extra: SourceRecordExtra = {},
): CapabilitySource {
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

async function readBounded(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > MAX_SOURCE_BYTES ? text.slice(0, MAX_SOURCE_BYTES) : text;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { accept: "text/markdown, application/json;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBounded(response);
}

async function checkCloudflare(fetchImpl: FetchLike, model: CatalogueEntry, checkedAt: string): Promise<CapabilitySource> {
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

export function falModelMatches(endpoint: string, item: unknown): boolean {
  const candidate = item as { id?: unknown } | null | undefined;
  if (!candidate || typeof candidate.id !== "string") return false;
  return candidate.id === endpoint || candidate.id === endpoint.replace(/^fal-ai\//, "");
}

async function checkFal(fetchImpl: FetchLike, model: CatalogueEntry, checkedAt: string): Promise<CapabilitySource> {
  const source = `${FAL_MODELS}?keywords=${encodeURIComponent(model.endpoint)}`;
  try {
    const text = await fetchText(fetchImpl, source);
    const payload = JSON.parse(text) as unknown;
    const items = (payload as { items?: unknown } | null)?.items;
    const item = Array.isArray(items)
      ? items.find((candidate) => falModelMatches(model.endpoint, candidate))
      : null;
    if (!item) throw new Error("The exact endpoint was not returned by model search");
    // The match above only succeeds for an object carrying a string id.
    const parsed = parseFalModel(item)!;
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

async function checkModelsDev(fetchImpl: FetchLike, checkedAt: string): Promise<ModelsDevCheck> {
  try {
    const text = await fetchText(fetchImpl, MODELS_DEV);
    const payload = JSON.parse(text) as unknown;
    const providers = Object.keys((payload ?? {}) as object);
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
export function buildAlerts(
  sources: readonly CapabilitySource[],
  previousSources: readonly (CapabilitySource & { alertFirstSeenAt?: string | null })[] = [],
): CapabilityAlert[] {
  const prior = new Map(previousSources.map((source) => [`${source.model}:${source.source}`, source] as const));
  const alerts: CapabilityAlert[] = [];
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
  const deduped = new Map<string, CapabilityAlert>();
  for (const alert of alerts) {
    const existing = deduped.get(alert.id);
    if (!existing) deduped.set(alert.id, alert);
    // Both timestamps are ISO strings on the refresh path.
    else if (existing.firstSeenAt! > alert.firstSeenAt!) deduped.set(alert.id, { ...alert, firstSeenAt: existing.firstSeenAt });
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function capabilityManifest({
  checkedAt = null,
  lastGoodAt = null,
  alerts = [],
  sources = [],
}: CapabilityManifestInput = {}): CapabilityManifest {
  const enabled: Array<PublicModelRecord & { status: "enabled" }> = publicModels().map((model) => ({ ...model, status: "enabled" }));
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

async function readJson(bucket: CapabilityBucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const text = typeof object.arrayBuffer === "function"
      ? new TextDecoder().decode(await object.arrayBuffer())
      : await new Response(object.body).text();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(bucket: CapabilityBucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, new TextEncoder().encode(JSON.stringify(value, null, 2)), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
  });
}

/** The bucket holds JSON this module wrote. It is returned as-is; the in-code
 * manifest is used only when the object is missing or unreadable. */
export async function readCapabilityManifest(env: CapabilityEnv): Promise<CapabilityManifest> {
  return ((await readJson(env.MEDIA, CAPABILITIES_KEY)) ?? capabilityManifest()) as CapabilityManifest;
}

export async function readCapabilityState(env: CapabilityEnv): Promise<CapabilityRefreshState | null> {
  return ((await readJson(env.MEDIA, CAPABILITIES_STATE_KEY)) as CapabilityRefreshState | null) ?? null;
}

/** Run one bounded, read-only check. The previous manifest is the fallback. */
export async function refreshCapabilities(
  env: CapabilityEnv,
  { now = Date.now(), fetchImpl = fetch, force = false }: CapabilityRefreshOptions = {},
): Promise<CapabilityRefreshResult> {
  const state = await readCapabilityState(env);
  if (!force && state?.nextDueAt && Date.parse(state.nextDueAt) > now) {
    return { skipped: true, reason: "not-due", state };
  }
  const previous = ((await readJson(env.MEDIA, CAPABILITIES_KEY)) ?? capabilityManifest()) as CapabilityManifest;
  const previousAlerts: CapabilityAlert[] = Array.isArray(previous.alerts) ? previous.alerts : [];
  // The stored list may also hold the models.dev check; it names no model and is
  // skipped by buildAlerts, exactly as before.
  const storedSources = (Array.isArray(previous.sources) ? previous.sources : []) as CapabilitySource[];
  const previousSources = storedSources.map((source) => ({
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
  const sources = results.filter((result) => result.model) as CapabilitySource[];
  const modelsDev = results.find((result) => !result.model) as ModelsDevCheck | undefined;
  const alerts = buildAlerts(sources, previousSources);
  const complete = sources.every((source) => source.status === "ok") && modelsDev?.status === "ok";
  const manifest = capabilityManifest({
    checkedAt,
    lastGoodAt: complete ? checkedAt : previous.lastGoodAt ?? null,
    alerts,
    sources: [...sources, modelsDev].filter(Boolean) as ManifestSource[],
  });
  await writeJson(env.MEDIA, CAPABILITIES_KEY, manifest);
  if (complete) await writeJson(env.MEDIA, CAPABILITIES_LAST_GOOD_KEY, manifest);
  const next: CapabilityRefreshState = {
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
export async function refreshCapabilitiesIfDue(
  env: CapabilityEnv,
  options: CapabilityRefreshOptions = {},
): Promise<CapabilityRefreshResult> {
  return refreshCapabilities(env, options);
}

export { WITHDRAWN };
