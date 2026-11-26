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
  modelId: string | null;
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
  factsCheckedAt?: string | null;
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
  const title = (/^#\s+(.+)$/m.exec(text)?.[1] ?? "").trim() || null;
  const modelId = /^Model ID(?:[ \t]*:[ \t]*|[ \t]*\n\s*)`?([^\s`|]+)/mi.exec(text)?.[1] ?? null;
  return {
    modelId,
    retirementDate: planned ? dateValue(planned[1]) : null,
    pricing: pricing ? boundedText(pricing[1].replace(/\s*\|\s*$/, "")) : null,
    beta,
    title,
  };
}

/** Read the public fal model search result. */
export function parseFalModel(item: unknown): FalModelFacts | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.id !== "string" ||
    (typeof record.status !== "string" &&
      typeof record.deprecated !== "boolean" && typeof record.removed !== "boolean")) return null;
  return {
    id: record.id,
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
    deprecated: extra.deprecated,
    removed: extra.removed,
    updatedAt: extra.updatedAt ?? null,
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
    const readable = parsed.modelId === model.endpoint ||
      (parsed.modelId === null && parsed.title === slug && /^\|\s*Model Info\s*\|/m.test(text));
    if (!readable) {
      return sourceRecord(model, source, "unavailable", "schema: Cloudflare model page did not identify the exact model endpoint", {
        checkedAt,
      });
    }
    return sourceRecord(model, source, "ok", parsed.title, {
      checkedAt,
      retirementDate: parsed.retirementDate,
      pricing: parsed.pricing,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return sourceRecord(model, source, "unavailable", detail, { checkedAt });
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
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("schema: fal model search response was not valid JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("schema: fal model search response was not an object");
    }
    const items = (payload as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new Error("schema: fal model search response did not include an items array");
    }
    const item = items.find((candidate) => falModelMatches(model.endpoint, candidate)) ?? null;
    if (!item) throw new Error("schema: the exact endpoint was not returned by model search");
    const parsed = parseFalModel(item);
    if (!parsed) throw new Error("schema: fal model entry did not include a string id");
    return sourceRecord(model, source, "ok", parsed.status, {
      checkedAt,
      retirementDate: parsed.deprecated || parsed.removed ? "withdrawn" : null,
      pricing: parsed.pricing,
      deprecated: parsed.deprecated,
      removed: parsed.removed,
      updatedAt: parsed.updatedAt,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return sourceRecord(model, source, "unavailable", boundedText(detail), { checkedAt });
  }
}

async function checkModelsDev(fetchImpl: FetchLike, checkedAt: string): Promise<ModelsDevCheck> {
  try {
    const text = await fetchText(fetchImpl, MODELS_DEV);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("schema: models.dev response was not valid JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("schema: models.dev response was not an object");
    }
    const record = payload as Record<string, unknown>;
    const providers = Object.entries(record).flatMap(([id, entry]) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const provider = entry as Record<string, unknown>;
      return provider.id === id && typeof provider.name === "string" &&
        provider.models && typeof provider.models === "object" && !Array.isArray(provider.models)
        ? [id] : [];
    });
    if (!providers.length) {
      throw new Error("schema: models.dev response did not contain provider entries with models");
    }
    return {
      source: MODELS_DEV,
      status: "ok",
      detail: `${providers.length} public provider records`,
      checkedAt,
      providers,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      source: MODELS_DEV,
      status: "unavailable",
      detail: boundedText(detail),
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
  previousSources: readonly CapabilitySource[] = [],
  previousAlerts: readonly CapabilityAlert[] = [],
): CapabilityAlert[] {
  const priorSources = new Map(previousSources.map((source) => [sourceKey(source), source]));
  const priorAlerts = new Map(previousAlerts.map((alert) => [alert.id, alert]));
  const alerts = new Map<string, CapabilityAlert>();

  for (const source of sources) {
    const label = models[source.model]?.label ?? source.model;
    const idFor = (kind: AlertKind) => alertKey(kind, source.model, kind === "schema" ? source.provider : "");
    const prior = (kind: AlertKind) => {
      const alert = priorAlerts.get(idFor(kind));
      return alert?.source === source.source ? alert : undefined;
    };
    const add = (kind: AlertKind, fields: Pick<CapabilityAlert, "message" | "action" | "retirementDate" | "previous" | "current">) => {
      const id = idFor(kind);
      alerts.set(id, {
        id, kind, model: source.model, label, source: source.source,
        severity: kind === "pricing" ? "medium" : "high",
        firstSeenAt: prior(kind)?.firstSeenAt ?? source.checkedAt,
        checkedAt: source.checkedAt,
        ...fields,
      });
    };
    const retain = (kind: "retirement" | "pricing") => {
      const alert = prior(kind);
      if (alert) alerts.set(alert.id, alert);
    };

    if (source.status !== "ok") {
      add("schema", {
        message: "The provider page or exact model search result could not be read. The last good evidence is retained.",
        action: "Review the endpoint on the provider's current page, then refresh again.",
      });
      retain("retirement");
      retain("pricing");
      continue;
    }

    if (source.provider === "cloudflare-workers-ai" && source.retirementDate) {
      add("retirement", {
        retirementDate: source.retirementDate,
        message: `${label} has a published retirement date of ${source.retirementDate}.`,
        action: "Qualify the named replacement against the Studio adapter, frames and cost, then update Studio and its consumers together.",
      });
    } else if (source.provider === "fal" && (source.deprecated || source.removed)) {
      add("retirement", {
        retirementDate: source.retirementDate,
        message: `${label} is marked ${source.removed ? "removed" : "deprecated"} by fal model search.`,
        action: "Check saved jobs, qualify a replacement and preserve old attribution.",
      });
    } else {
      // A readable response alone does not review previous retirement evidence.
      retain("retirement");
    }

    const baseline = prior("pricing")?.previous ?? priorSources.get(sourceKey(source))?.pricing;
    if (!source.pricing) {
      retain("pricing");
    } else if (baseline && source.pricing !== baseline) {
      add("pricing", {
        previous: baseline,
        current: source.pricing,
        message: `${label} has a changed public price description.`,
        action: "Check Studio's estimate against the current provider price and review the cost basis.",
      });
    }
  }
  return [...alerts.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function sourceKey(source: CapabilitySource): string {
  return `${source.model}:${source.source}`;
}

function modelSources(manifest: CapabilityManifest | null): CapabilitySource[] {
  return Array.isArray(manifest?.sources)
    ? manifest.sources.filter((source): source is CapabilitySource => Boolean(source?.model))
    : [];
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
  const lastGood = (await readJson(env.MEDIA, CAPABILITIES_LAST_GOOD_KEY)) as CapabilityManifest | null;
  const latest = (await readJson(env.MEDIA, CAPABILITIES_KEY)) as CapabilityManifest | null;
  const previous = (latest ?? lastGood ?? capabilityManifest()) as CapabilityManifest;
  const previousAlerts: CapabilityAlert[] = Array.isArray(previous.alerts) ? previous.alerts : [];
  const priorSources = new Map(modelSources(lastGood).map((source) => [sourceKey(source), source]));
  for (const source of modelSources(previous)) {
    if (source.status === "ok" || source.factsCheckedAt || !priorSources.has(sourceKey(source))) {
      priorSources.set(sourceKey(source), source);
    }
  }
  const checkedAt = iso(now);
  const workersAi = Object.values(models).filter((model) => CLOUDFLARE_ENDPOINT.test(model.endpoint));
  const fal = Object.values(models).filter((model) => model.provider === "fal");
  const results = await Promise.all([
    ...workersAi.map((model) => checkCloudflare(fetchImpl, model, checkedAt)),
    ...fal.map((model) => checkFal(fetchImpl, model, checkedAt)),
    checkModelsDev(fetchImpl, checkedAt),
  ]);
  const rawSources = results.filter((result) => result.model) as CapabilitySource[];
  const sources = rawSources.map((source) => {
    if (source.status !== "unavailable") return source;
    const prior = priorSources.get(sourceKey(source));
    if (!prior) return source;
    return {
      ...source,
      retirementDate: source.retirementDate ?? prior.retirementDate ?? null,
      pricing: source.pricing ?? prior.pricing ?? null,
      deprecated: source.deprecated ?? prior.deprecated,
      removed: source.removed ?? prior.removed,
      updatedAt: source.updatedAt ?? prior.updatedAt ?? null,
      factsCheckedAt: prior.factsCheckedAt ?? (prior.status === "ok" ? prior.checkedAt : null),
    };
  });
  const modelsDev = results.find((result) => !result.model) as ModelsDevCheck | undefined;
  const alerts = buildAlerts(sources, [...priorSources.values()], previousAlerts);
  const complete = sources.every((source) => source.status === "ok") && modelsDev?.status === "ok";
  const manifest = capabilityManifest({
    checkedAt,
    lastGoodAt: complete ? checkedAt : previous.lastGoodAt ?? lastGood?.lastGoodAt ?? null,
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
