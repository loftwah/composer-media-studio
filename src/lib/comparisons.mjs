// MIT. Model comparison for the studio.
//
// The point of this module is a decision, not a leaderboard. Two models are only
// compared inside one job, under the same settings, and only from takes that were
// actually retained. Everything is derived from rows the studio already saved, so
// opening a comparison never calls a provider and never spends money.
//
// The three money fields mean three different things and are never collapsed:
//   estimateMicro          what the studio expected the job to cost
//   allocatedMicro         what the studio budgeted for it when it settled
//   providerChargedMicro   what the provider said it billed, when it said anything
// A missing charge stays null. An allocation is not evidence of an invoice.

/** @typedef {{id:string,label:string,provider:string,kind:string,references?:number,edit?:string,render?:string,restyle?:boolean,audio?:any,costMicro:number,costBasis:string,durations?:number[],aspects?:string[]}} Model */

/**
 * A job is the unit of comparison: the thing a person is trying to make. Two
 * models that cannot do the same job are never ranked against each other.
 *
 * `eligible` is deliberately conservative. A job with one eligible model is shown
 * with that fact stated, because "compare two models" is not available for it yet.
 */
export const JOB_GROUPS = [
  {
    id: "still",
    label: "A still image",
    purpose: "Generate a new still from a written brief.",
    eligible: (model) => model.kind === "image" && !model.edit && !model.render && (model.references ?? 0) === 0,
    settings: "Same brief, same aspect, same reference count (none).",
  },
  {
    id: "reference-edit",
    label: "A reference-guided variation",
    purpose: "Take palette, line quality and subject cues from one saved still.",
    eligible: (model) => model.kind === "image" && (model.references ?? 0) === 1 && !model.edit && !model.render,
    settings: "Same source still, same aspect, same brief.",
  },
  {
    id: "masked-edit",
    label: "A masked fill or outpaint",
    purpose: "Change one painted region and keep the rest of the still.",
    eligible: (model) => model.kind === "image" && Boolean(model.edit),
    settings: "Same source still, same mask, same fill brief.",
  },
  {
    id: "motion",
    label: "Motion from a still",
    purpose: "Animate one saved still into a short clip.",
    eligible: (model) => model.kind === "video" && (model.references ?? 0) === 1 && !model.restyle && !model.render,
    settings: "Same source still, same duration, same direction.",
  },
  {
    id: "footage-edit",
    label: "Footage editing",
    purpose: "Restyle an existing clip with a written direction.",
    eligible: (model) => model.kind === "video" && Boolean(model.restyle),
    settings: "Same source clip, same direction.",
  },
  {
    id: "voice",
    label: "Voice",
    purpose: "Read your own script aloud.",
    eligible: (model) => model.kind === "audio" && model.audio?.mode === "speech",
    settings: "Same script, same requested length.",
  },
  {
    id: "music",
    label: "Music",
    purpose: "An instrumental bed or atmosphere cue.",
    eligible: (model) => model.kind === "audio" && model.audio?.mode === "music",
    settings: "Same brief, same duration window.",
  },
  {
    id: "effects",
    label: "Effects",
    purpose: "One short sound effect or atmosphere cue.",
    eligible: (model) => model.kind === "audio" && model.audio?.mode === "effect",
    settings: "Same cue brief, same duration.",
  },
];

/**
 * Which models can do which job, from the served registry. Nothing here invents a
 * model: an id only appears because the worker serves it.
 * @param {Record<string, Model>} models
 */
export function jobCatalogue(models) {
  const list = Object.values(models ?? {});
  return JOB_GROUPS.map((group) => {
    const eligible = list.filter(group.eligible).map((model) => ({
      id: model.id,
      label: model.label,
      kind: model.kind,
      costMicro: model.costMicro,
      costBasis: model.costBasis,
    }));
    return {
      id: group.id,
      label: group.label,
      purpose: group.purpose,
      settings: group.settings,
      models: eligible,
      comparable: eligible.length >= 2,
      note:
        eligible.length >= 2
          ? null
          : eligible.length === 1
            ? `Only ${eligible[0].label} is served for this job, so there is nothing to compare yet.`
            : "No served model does this job.",
    };
  });
}

/** @param {any} model */
export function modelLabel(models, id) {
  return models?.[id]?.label ?? id;
}

/**
 * Keep the newest successful take per model for one job. The comparison then uses
 * saved work rather than generating anything.
 * @param {any[]} rows
 * @param {string} jobId
 */
export function latestPerModel(rows, jobId) {
  const seen = new Set();
  const entries = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (seen.has(row.model)) continue;
    seen.add(row.model);
    entries.push(toEntry(row, jobId));
  }
  return entries;
}

/**
 * The shape the page renders. Every field is either saved data or explicitly
 * null, so an unknown never quietly becomes a zero.
 * @param {any} row
 * @param {string} jobId
 */
export function toEntry(row, jobId) {
  const createdAt = Number(row.completed_at ?? row.created_at ?? 0) || null;
  return {
    job: jobId,
    model: row.model,
    generationId: row.id,
    kind: row.kind,
    assetId: row.asset_id ?? null,
    mime: row.mime ?? null,
    bytes: Number.isFinite(Number(row.bytes)) ? Number(row.bytes) : null,
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
    durationMs: Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null,
    sha256: row.sha256 ?? null,
    prompt: promptOf(row.request_json),
    createdAt,
    cost: {
      estimateMicro: numberOrNull(row.cost_estimate_micro),
      allocatedMicro: numberOrNull(row.cost_allocated_micro),
      providerChargedMicro: numberOrNull(row.provider_charged_micro),
    },
  };
}

/** @param {unknown} value */
function numberOrNull(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}

/** @param {unknown} raw */
function promptOf(raw) {
  if (typeof raw !== "string" || !raw) return "";
  try {
    const parsed = JSON.parse(raw);
    const prompt = parsed?.prompt ?? parsed?.brief ?? parsed?.text ?? "";
    return typeof prompt === "string" ? prompt.slice(0, 400) : "";
  } catch {
    return "";
  }
}

/**
 * The money that actually matters: what one take you would keep cost. A take that
 * exists is usable here by definition, because only saved generations are listed.
 * When the provider reported a charge it is shown separately and never averaged
 * into the allocation.
 * @param {{cost: {estimateMicro: number|null, allocatedMicro: number|null, providerChargedMicro: number|null}}[]} entries
 */
export function costSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const sum = (pick) => {
    const values = list.map(pick).filter((value) => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  const allocated = sum((entry) => entry.cost?.allocatedMicro ?? null);
  const estimate = sum((entry) => entry.cost?.estimateMicro ?? null);
  const charged = sum((entry) => entry.cost?.providerChargedMicro ?? null);
  const chargedTakes = list.filter((entry) => entry.cost?.providerChargedMicro !== null).length;
  return {
    takes: list.length,
    estimateMicro: estimate,
    allocatedMicro: allocated,
    providerChargedMicro: charged,
    providerChargedTakes: chargedTakes,
    perTakeAllocatedMicro: allocated === null || list.length === 0 ? null : Math.round(allocated / list.length),
    perTakeEstimateMicro: estimate === null || list.length === 0 ? null : Math.round(estimate / list.length),
    perTakeChargedMicro: charged === null || list.length === 0 ? null : Math.round(charged / list.length),
  };
}

/** @param {number|null} micro */
export function money(micro) {
  if (micro === null || micro === undefined || !Number.isFinite(Number(micro))) return "unknown";
  const value = Number(micro) / 1_000_000;
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * A verdict for one job. It says what the saved takes support and refuses to pick
 * a winner when the studios cannot be separated, when only one model has a take,
 * or when the owner's own vote contradicts the numbers.
 * @param {{entries: any[], votes?: Record<string, {choice?: boolean, reason?: string, at?: string}>, job?: {label: string, comparable: boolean}}} input
 */
export function verdict(input) {
  const job = input?.job ?? { label: "this job", comparable: false };
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const votes = input?.votes ?? {};
  const picked = entries.filter((entry) => votes[entry.model]?.choice);
  const costs = costSummary(entries);

  if (entries.length === 0) {
    return {
      headline: "Nothing saved to compare yet",
      detail: `No ${job.label.toLowerCase()} takes are in this workspace. A comparison is built from saved work, so there is nothing to judge and nothing was generated.`,
      basis: "empty",
      lead: null,
    };
  }
  if (entries.length === 1) {
    return {
      headline: `${job.label}: one take, no comparison`,
      detail: `Only ${entries[0].model} has a saved take for this job. That is a record of one model, not a choice between two.`,
      basis: "single",
      lead: null,
    };
  }
  if (picked.length > 0) {
    const choice = picked[0];
    const others = entries.filter((entry) => entry.model !== choice.model);
    const cheaper = others.every(
      (entry) => (entry.cost.allocatedMicro ?? Infinity) >= (choice.cost.allocatedMicro ?? Infinity),
    );
    return {
      headline: `You chose ${modelLabel(input.models ?? {}, choice.model)} for ${job.label.toLowerCase()}`,
      detail: `${votes[choice.model]?.reason ? `Your note: “${votes[choice.model].reason}”. ` : ""}${
        cheaper ? "It is also the most allocated cost per take in this set. " : ""
      }The numbers below stay as recorded; your vote decides which take you would use.`,
      basis: "vote",
      lead: choice.model,
    };
  }

  const byAllocated = [...entries].sort(
    (a, b) => (a.cost.allocatedMicro ?? Infinity) - (b.cost.allocatedMicro ?? Infinity),
  );
  const cheapest = byAllocated[0];
  const dearest = byAllocated[byAllocated.length - 1];
  const sameCost = cheapest.cost.allocatedMicro === dearest.cost.allocatedMicro;
  return {
    headline: `${job.label}: ${entries.length} takes, no pick from you yet`,
    detail: sameCost
      ? `All ${entries.length} takes allocated the same ${money(cheapest.cost.allocatedMicro)}. Nothing in the recorded numbers separates them, so the choice is yours to make on the work itself.`
      : `${cheapest.model} allocated ${money(cheapest.cost.allocatedMicro)} for its take against ${money(dearest.cost.allocatedMicro)} for ${dearest.model}. Cost is the only measured difference so far; pick the take you would use and the verdict will record it.`,
    basis: "cost",
    lead: sameCost ? null : cheapest.model,
  };
}

/**
 * One measured weakness, routed to whoever owns it. This is what turns a review
 * into a correction rather than a note.
 * @param {{entries: any[], votes?: Record<string, any>}} input
 */
export function weakness(input) {
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const votes = input?.votes ?? {};
  const rejected = entries.filter((entry) => votes[entry.model] && votes[entry.model].choice === false);
  if (rejected.length > 0) {
    const entry = rejected[0];
    const note = votes[entry.model]?.reason ?? "";
    return {
      model: entry.model,
      generationId: entry.generationId,
      reason: note || "Rejected in review without a written reason.",
      owner: "Media Studio · comparison review",
      next: "Reproduce with the same brief, change one setting at a time, then rerun this comparison.",
    };
  }
  const missingCharge = entries.filter((entry) => entry.cost.providerChargedMicro === null).length;
  if (entries.length > 0 && missingCharge === entries.length) {
    return {
      model: null,
      generationId: null,
      reason:
        "No take in this comparison carries a provider-reported charge. Every cost shown is the studio's own allocation.",
      owner: "Media Studio · provider receipts",
      next:
        "Record the provider's charge when it is available. Until then the page must keep saying the invoice is unknown.",
    };
  }
  return null;
}
