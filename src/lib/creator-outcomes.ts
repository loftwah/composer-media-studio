// MIT. Private, evidence-bounded creator outcomes for one existing Studio
// project. This reads only rows the studio already saved: a generation whose
// job completed into a retained asset, an output asset bound by an exact local
// render or footage export receipt, and append-only publication changes.
//
// Every query is a bounded, read-only SELECT with bound integer-millisecond
// window bounds. No provider call, no R2 walk, no route and no per-row detail
// leaves this module: the result is aggregate fields only. A count is the
// partial count of covered records, never a claim about all exports or all
// publishing. Where the source cannot support a number, the value is null.

import type { LocalRenderEnv } from './local-render-receipts.ts';

/** The D1 read seam, reused from the qualified receipt readers. */
export type OutcomesDb = LocalRenderEnv['DB'];

/** A half-open range of whole UTC days; epoch bounds are integer millis. */
export interface OutcomeWindow {
  fromInclusive: string;
  toExclusive: string;
  fromMillis: number;
  toMillis: number;
}

export type OutcomeMetricKey =
  | 'saved_provider_outputs'
  | 'saved_local_exports'
  | 'publication_published'
  | 'publication_unlisted'
  | 'publication_withdrawn';

export type OutcomeUnit = 'saved_outputs' | 'saved_exports' | 'publication_transitions';

export interface OutcomeMetric {
  key: OutcomeMetricKey;
  label: string;
  unit: OutcomeUnit;
  /** A covered count, or null when the source is not supported for this project. */
  value: number | null;
  status: 'partial' | 'unavailable';
  definition: string;
  evidenceLevel: string;
  definitionVersion: 1;
  /** One plain string stating the allowed paths and the exclusions. */
  coverage: string;
}

export interface CreatorOutcomesSource {
  producer: string;
  revision: string;
  now?: number;
}

export interface CreatorOutcomes {
  format: 'media-studio.creator-outcomes/v1';
  schemaVersion: 1;
  projectId: string;
  window: { fromInclusive: string; toExclusive: string; timezone: 'UTC' };
  generatedAt: string;
  source: { producer: string; revision: string; watermark: string | null };
  metrics: OutcomeMetric[];
}

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse one strict YYYY-MM-DD UTC day into integer millis, or null. */
function utcDay(value: string | null): number | null {
  if (value === null) return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return millis;
}

function dayLabel(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/** Build a half-open window of the last `days` complete UTC days. */
function lastCompleteDays(days: number, today: number): OutcomeWindow {
  const fromMillis = today - days * DAY_MS;
  return {
    fromInclusive: dayLabel(fromMillis),
    toExclusive: dayLabel(today),
    fromMillis,
    toMillis: today,
  };
}

/**
 * Validate a requested reporting window. With no parameters this is the last
 * seven complete UTC days; `days=7` and `days=30` select the last seven or
 * thirty complete days. A preset may not be repeated or combined with explicit
 * `from`/`until`, and only `7` or `30` are accepted. Explicit `from` and `until`
 * must both be present, strict YYYY-MM-DD days, 1 to 30 whole days apart, with
 * `until` no later than today (exclusive, so it is itself a completed day).
 * Duplicate or future values are rejected rather than silently narrowed.
 * Invalid input returns null.
 */
export function parseOutcomeWindow(params: URLSearchParams, now?: number): OutcomeWindow | null {
  const stamp = now ?? Date.now();
  if (!Number.isSafeInteger(stamp)) return null;
  let today: number;
  try {
    today = Math.floor(stamp / DAY_MS) * DAY_MS;
    dayLabel(today);
  } catch {
    return null;
  }

  const fromValues = params.getAll('from');
  const untilValues = params.getAll('until');
  const dayValues = params.getAll('days');
  if (dayValues.length > 1) return null;
  if (dayValues.length > 0 && (fromValues.length > 0 || untilValues.length > 0)) return null;

  if (dayValues.length > 0) {
    if (dayValues[0] !== '7' && dayValues[0] !== '30') return null;
    return lastCompleteDays(Number(dayValues[0]), today);
  }

  if (fromValues.length === 0 && untilValues.length === 0) return lastCompleteDays(7, today);
  if ((fromValues.length > 0) !== (untilValues.length > 0)) return null;
  if (fromValues.length > 1 || untilValues.length > 1) return null;

  const fromMillis = utcDay(fromValues[0]);
  const toMillis = utcDay(untilValues[0]);
  if (fromMillis === null || toMillis === null || fromMillis >= toMillis) return null;
  const days = (toMillis - fromMillis) / DAY_MS;
  if (!Number.isInteger(days) || days < 1 || days > 30 || toMillis > today) return null;
  return {
    fromInclusive: dayLabel(fromMillis),
    toExclusive: dayLabel(toMillis),
    fromMillis,
    toMillis,
  };
}

// Each query is a single aggregate read, so the narrow statement seam only
// needs bind()/first(). Bounds are :2 = fromMillis, :3 = toMillis everywhere.

// A generation and its retained output are counted once per asset identity.
// The saved job binds its exact output ID, and the asset must link back to the
// same job. The completion timestamp comes from the successful save.
const PROVIDER_OUTPUTS_SQL = `
  SELECT COUNT(DISTINCT a.id) AS n, MAX(g.completed_at) AS watermark
  FROM generations g
  JOIN assets a
    ON a.project_id = g.project_id
   AND a.deleted_at IS NULL
   AND a.bytes > 0
   AND a.source IN ('generated', 'variant', 'assembled')
   AND a.erasure_pending = 0
   AND a.generation_id = g.id
   AND a.id = g.output_asset_id
  WHERE g.project_id = ?1
    AND g.status = 'saved'
    AND g.deleted_at IS NULL
    AND g.completed_at IS NOT NULL
    AND g.provider <> ''
    AND g.completed_at >= ?2
    AND g.completed_at < ?3`;

// The event time is the asset's save time, required to fall inside the receipt
// validity; the receipt's own creation time is deliberately not the event.
// COUNT(DISTINCT) folds the two receipt tables into one count per output asset.
const LOCAL_EXPORTS_SQL = `
  SELECT COUNT(DISTINCT output_asset_id) AS n, MAX(saved_at) AS watermark
  FROM (
    SELECT r.output_asset_id AS output_asset_id, a.created_at AS saved_at
    FROM local_render_receipts r
    JOIN assets a
      ON a.id = r.output_asset_id
     AND a.project_id = r.project_id
     AND a.deleted_at IS NULL
     AND a.bytes > 0
     AND a.erasure_pending = 0
     AND a.source = 'upload'
    WHERE r.project_id = ?1
      AND a.created_at >= r.created_at
      AND a.created_at <= r.expires_at
      AND a.created_at >= ?2
      AND a.created_at < ?3
    UNION ALL
    SELECT r.output_asset_id, a.created_at
    FROM footage_export_receipts r
    JOIN assets a
      ON a.id = r.output_asset_id
     AND a.project_id = r.project_id
     AND a.deleted_at IS NULL
     AND a.bytes > 0
     AND a.erasure_pending = 0
     AND a.source = 'upload'
    WHERE r.project_id = ?1
      AND a.created_at >= r.created_at
      AND a.created_at <= r.expires_at
      AND a.created_at >= ?2
      AND a.created_at < ?3
  )`;

// previous_state and resulting_state are JSON snapshots of publication state.
// Only a real transition counts, once per recorded audit id, in the window.
const PUBLICATION_SQL = `
  SELECT
    COUNT(DISTINCT CASE WHEN action = 'publish' THEN id END) AS published,
    COUNT(DISTINCT CASE WHEN action = 'unlist' THEN id END) AS unlisted,
    COUNT(DISTINCT CASE WHEN action = 'withdraw' THEN id END) AS withdrawn,
    MAX(CASE WHEN previous_state <> resulting_state THEN created_at END) AS watermark
  FROM publication_audit
  WHERE project_id = ?1
    AND previous_state <> resulting_state
    AND created_at >= ?2
    AND created_at < ?3`;

// The project and status indexes cover this check. A committed portable bundle
// can restore old generation identities, so v1 reports such projects as
// unavailable rather than risking a double-counted or misattributed number.
const RESTORED_SQL = `
  SELECT 1 AS restored
  FROM project_bundle_imports
  WHERE project_id = ?1 AND status = 'committed'
  LIMIT 1`;

// One SQLite statement gives all counters a consistent source snapshot.
const COUNTS_SQL = `
  WITH provider AS (${PROVIDER_OUTPUTS_SQL}), local AS (${LOCAL_EXPORTS_SQL}),
       publication AS (${PUBLICATION_SQL})
  SELECT provider.n AS provider, local.n AS local,
         publication.published, publication.unlisted, publication.withdrawn,
         provider.watermark AS providerWatermark, local.watermark AS localWatermark,
         publication.watermark AS publicationWatermark
  FROM provider, local, publication`;

type Counts = {
  provider: number;
  local: number;
  published: number;
  unlisted: number;
  withdrawn: number;
  providerWatermark: number | null;
  localWatermark: number | null;
  publicationWatermark: number | null;
};

const COVERAGE: Record<OutcomeMetricKey, string> = {
  saved_provider_outputs: 'Saved provider jobs with their exact retained output. Pending, failed and deleted work is excluded.',
  saved_local_exports: 'Retained exports with a matching local render or footage receipt. Includes only saves made within receipt validity.',
  publication_published: 'Publish changes recorded by the bulk visibility tool. Individual and automatic publishing are outside this total.',
  publication_unlisted: 'Unlist changes recorded by the bulk visibility tool.',
  publication_withdrawn: 'Withdrawals recorded by the bulk visibility tool.',
};

function iso(millis: number | string | null | undefined): string | null {
  if (millis === null || millis === undefined) return null;
  const value = Number(millis);
  if (!Number.isSafeInteger(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function metric(
  key: OutcomeMetricKey,
  label: string,
  unit: OutcomeUnit,
  value: number | null,
  definition: string,
  evidenceLevel: string,
  restored: boolean,
): OutcomeMetric {
  return {
    key,
    label,
    unit,
    value,
    status: restored ? 'unavailable' : 'partial',
    definition,
    evidenceLevel,
    definitionVersion: 1,
    coverage: restored ? 'Unavailable for restored projects while their recorded history is being distinguished from new work.' : COVERAGE[key],
  };
}

/**
 * Read one project's private creator-outcomes summary for a validated window.
 * The caller owns existing project ACL; this function only ever binds the
 * project id and integer window bounds into read-only aggregate queries.
 */
export async function readCreatorOutcomes(
  db: OutcomesDb,
  projectId: string,
  window: OutcomeWindow,
  { producer, revision, now }: CreatorOutcomesSource,
): Promise<CreatorOutcomes> {
  const stamp = Number.isSafeInteger(now) ? (now as number) : Date.now();
  const generatedAt = iso(stamp) ?? new Date(0).toISOString();
  const bounds: [string, number, number] = [projectId, window.fromMillis, window.toMillis];

  const restored = await db
    .prepare(RESTORED_SQL)
    .bind(projectId)
    .first<{ restored: number }>();

  const row = restored ? null : await db.prepare(COUNTS_SQL).bind(...bounds).first<Counts>();
  if (!restored && (!row || [row.provider, row.local, row.published, row.unlisted, row.withdrawn]
    .some(value => !Number.isSafeInteger(value) || value < 0))) {
    throw new Error('Saved outcomes source did not return valid counts.');
  }
  const timestamps = row
    ? [row.providerWatermark, row.localWatermark, row.publicationWatermark].filter((value): value is number => value !== null)
    : [];
  const watermark = timestamps.length ? iso(Math.max(...timestamps)) : null;
  return {
    format: 'media-studio.creator-outcomes/v1',
    schemaVersion: 1,
    projectId,
    window: {
      fromInclusive: window.fromInclusive,
      toExclusive: window.toExclusive,
      timezone: 'UTC',
    },
    generatedAt,
    source: {
      producer: typeof producer === 'string' ? producer.slice(0, 120) : 'unknown',
      revision: typeof revision === 'string' ? revision.slice(0, 120) : 'unknown',
      watermark,
    },
    metrics: [
      metric(
        'saved_provider_outputs',
        'Saved provider outputs',
        'saved_outputs',
        row?.provider ?? null,
        'Provider-generated work that completed and was retained as a saved asset in this project in the window.',
        'saved-generation-state-and-retained-asset',
        Boolean(restored),
      ),
      metric(
        'saved_local_exports',
        'Saved local exports',
        'saved_exports',
        row?.local ?? null,
        'Saved output assets whose save time is inside both the reporting window and an exact receipt validity.',
        'receipt-bound-saved-asset',
        Boolean(restored),
      ),
      metric(
        'publication_published',
        'Published transitions',
        'publication_transitions',
        row?.published ?? null,
        'Real publish transitions recorded in the project audit in the window.',
        'append-only-publication-audit-change',
        Boolean(restored),
      ),
      metric(
        'publication_unlisted',
        'Unlisted transitions',
        'publication_transitions',
        row?.unlisted ?? null,
        'Real unlist transitions recorded in the project audit in the window.',
        'append-only-publication-audit-change',
        Boolean(restored),
      ),
      metric(
        'publication_withdrawn',
        'Withdrawn transitions',
        'publication_transitions',
        row?.withdrawn ?? null,
        'Real withdraw transitions recorded in the project audit in the window.',
        'append-only-publication-audit-change',
        Boolean(restored),
      ),
    ],
  };
}
