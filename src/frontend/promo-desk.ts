// Truthful, read-only promo-desk predicates for Studio #489's first delivery.
//
// Every stage state is a small typed predicate over records this project
// already saved: the promo brief itself, Studio Voice narration jobs whose
// persisted request prompt equals the brief's script, storyboards that use the
// matched narration take, the render jobs attached to such a storyboard, and
// review rooms pinned to the rendered cut. Exact prompt/text equality is an
// inferred match, not a link persisted with one brief revision, so ambiguous
// candidates, stale cuts and revoked rooms are disclosed rather than promoted
// to approval. Nothing here infers packaging or handoff: those contracts do not
// exist yet, so the desk stops at the recorded review decision and points at
// the existing surfaces.
//
// Kept free of React and the DOM so the rules can be tested without a browser.

import type { CompositionV1, ComposeGenerationV1, MediaAssetV1 } from "./contracts";

/** The saved promo brief fields the desk reads (a listPromoBriefs view). */
export interface PromoBriefLite {
  id: string;
  title: string;
  revision: number;
  aspect: string;
  targetSeconds: number;
  scenes: { spoken: string; visual: string }[];
}

/** The owner review-room fields the desk reads (a listReviewRooms view). */
export interface PromoReviewRoomLite {
  id: string;
  assetId: string;
  versionLabel: string;
  status: string;
  decision: string | null;
  unresolvedCount: number;
  feedbackCount: number;
}

/** Parse the owner review-room envelope without turning malformed data into absence. */
export function parseReviewRoomsResponse(value: unknown): PromoReviewRoomLite[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid review rooms response");
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) throw new Error("Invalid review rooms response");
  return rooms.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid review room");
    const room = value as Record<string, unknown>;
    const { id, assetId, status, decision, unresolvedCount, feedbackCount } = room;
    const versionLabel = room.versionLabel ?? room.assetTitle;
    if (
      typeof id !== "string" || !id.trim() ||
      typeof assetId !== "string" || !assetId.trim() ||
      (status !== "open" && status !== "expired" && status !== "revoked") ||
      typeof versionLabel !== "string" ||
      (decision !== null && typeof decision !== "string") ||
      typeof unresolvedCount !== "number" || !Number.isSafeInteger(unresolvedCount) || unresolvedCount < 0 ||
      typeof feedbackCount !== "number" || !Number.isSafeInteger(feedbackCount) || feedbackCount < 0
    ) throw new Error("Invalid review room");
    return { id, assetId, versionLabel, status, decision, unresolvedCount, feedbackCount };
  });
}

/** A saved narration or render job the desk can name. */
export interface DeskJob {
  id: string;
  status: string;
  assetId: string | null;
  error: { code: string; message: string } | null;
}

export type ScriptStage = {
  state: "ready" | "missing";
  /** Zero-based indexes of scenes with no spoken words. */
  missingSpoken: number[];
  visualOnly: boolean;
  words: number;
  seconds: number;
  script: string;
};

export type NarrationStage =
  | { state: "not-applicable" }
  | { state: "missing" }
  | { state: "waiting"; job: DeskJob }
  | { state: "failed"; job: DeskJob }
  | { state: "unknown"; job: DeskJob }
  | {
      state: "ready";
      job: DeskJob;
      asset: MediaAssetV1;
      /** True when more than one saved take has exactly this script. */
      ambiguous: boolean;
      matchingSaved: number;
    };

export type StoryboardStage =
  | { state: "blocked"; because: "narration" }
  | { state: "unlinked" }
  | { state: "missing" }
  | { state: "not-rendered"; composition: CompositionV1 }
  | { state: "waiting"; composition: CompositionV1; job: DeskJob }
  | { state: "failed"; composition: CompositionV1; job: DeskJob }
  | { state: "unknown"; composition: CompositionV1; job: DeskJob }
  | {
      state: "ready";
      composition: CompositionV1;
      job: DeskJob;
      cut: MediaAssetV1;
      stale: boolean;
      extraCompositions: number;
      /** True when the take or cut was chosen from more than one candidate. */
      ambiguous: boolean;
    };

export type ReviewStage =
  | { state: "blocked" }
  | { state: "stale" }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "missing"; revokedCount?: number }
  | { state: "changes"; unresolvedCount: number; roomCount: number }
  | { state: "approved"; roomCount: number }
  | { state: "unresolved"; unresolvedCount: number; roomCount: number }
  | { state: "open"; roomCount: number }
  | { state: "ambiguous"; roomCount: number };

export type DeskNextAction = {
  text: string;
  link?: { href: string; label: string };
};

export const PROMO_DESK_READ_ONLY_STATUS = "Read-only · inferred from saved records, not linked by this brief revision";

/** One identity for the visible instruction and the exact saved brief it describes. */
export function promoDeskHandoffKey(
  brief: Pick<PromoBriefLite, "id" | "title" | "revision">,
  next: DeskNextAction,
): string {
  return JSON.stringify([brief.id, brief.title, brief.revision, next.text, next.link?.href ?? null, next.link?.label ?? null]);
}

/** Only the desk's existing in-app hash destination can become a handoff link. */
const safeHandoffDestination = (link: { href: string; label: string }, origin?: string): string | null => {
  if (!/^#\/[^?#\u0000-\u0020\u007f<>]*$/u.test(link.href)) return null;
  if (!/^[^\[\]\u0000-\u001f\u007f]+$/u.test(link.label)) return null;
  const href = origin ? new URL(link.href, origin).href : link.href;
  return `[${link.label}](<${href}>)`;
};

/** Plain text for the visible next action, never the script, raw records or media. */
export function promoDeskHandoffText(
  brief: Pick<PromoBriefLite, "title" | "revision">,
  next: DeskNextAction,
  origin?: string,
): string {
  const lines = [`Next: ${next.text}`, `Brief: ${brief.title} · v${brief.revision}`];
  const destination = next.link ? safeHandoffDestination(next.link, origin) : null;
  if (destination) lines.push(`Destination: ${destination}`);
  lines.push(`Status: ${PROMO_DESK_READ_ONLY_STATUS}`);
  return lines.join("\n");
}

const wordsIn = (value: string) => (value.trim() ? value.trim().split(/\s+/u).length : 0);

/** The combined spoken script, built exactly like the promo workbench does. */
export function promoScript(scenes: { spoken: string }[]): string {
  return scenes.map((scene) => scene.spoken.trim()).filter(Boolean).join("\n\n");
}

/** Studio Voice jobs whose persisted prompt is exactly this script. */
export function narrationJobsForScript(
  generations: ComposeGenerationV1[],
  script: string,
): ComposeGenerationV1[] {
  if (!script) return [];
  return generations.filter((job) => job.kind === "audio" && job.model === "studio-voice" && job.prompt === script);
}

const pendingStatuses = new Set(["admitted", "submitting", "submitted", "running", "provider_complete", "saving", "cancel_requested"]);

/** One shared job-to-stage mapping for narration and render jobs. */
function jobOutcome(
  job: DeskJob,
  asset: MediaAssetV1 | undefined,
): "waiting" | "failed" | "unknown" | "ready" | "missing" {
  if (pendingStatuses.has(job.status)) return "waiting";
  if (job.status === "saved") return asset && asset.bytes > 0 ? "ready" : "missing";
  if (job.status === "failed") return "failed";
  if (job.status === "unknown") return "unknown";
  return "missing";
}

/** Read the brief's own script state: what is missing, and how long it runs. */
export function scriptStage(brief: PromoBriefLite): ScriptStage {
  const missingSpoken = brief.scenes.map((scene, index) => (scene.spoken.trim() ? -1 : index)).filter((index) => index >= 0);
  const script = promoScript(brief.scenes);
  const words = wordsIn(script);
  return {
    state: missingSpoken.length ? "missing" : "ready",
    missingSpoken,
    visualOnly: words === 0,
    words,
    seconds: words ? Math.round((words / 140) * 60) : 0,
    script,
  };
}

/** The narration stage: exact script-text matches only, with ambiguity disclosed. */
export function narrationStage(
  script: ScriptStage,
  generations: ComposeGenerationV1[],
  assets: MediaAssetV1[],
): NarrationStage {
  if (script.visualOnly) return { state: "not-applicable" };
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const candidates = narrationJobsForScript(generations, script.script).sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
  const savedCandidates = candidates.filter((job) => job.status === "saved");
  const savedFirst = savedCandidates[0];
  const waitingFirst = candidates.find((job) => pendingStatuses.has(job.status));
  const failedFirst = candidates.find((job) => job.status === "failed" || job.status === "unknown");
  const chosen = savedFirst ?? waitingFirst ?? failedFirst ?? candidates[0];
  if (!chosen) return { state: "missing" };
  const asJob: DeskJob = { id: chosen.id, status: chosen.status, assetId: chosen.assetId ?? null, error: chosen.error ?? null };
  const outcome = jobOutcome(asJob, chosen.assetId ? byId.get(chosen.assetId) : undefined);
  if (outcome === "ready" && chosen.assetId) {
    const asset = byId.get(chosen.assetId);
    if (asset)
      return {
        state: "ready",
        job: asJob,
        asset,
        ambiguous: savedCandidates.length > 1,
        matchingSaved: savedCandidates.length,
      };
    return { state: "missing" };
  }
  if (outcome === "waiting") return { state: "waiting", job: asJob };
  if (outcome === "failed") return { state: "failed", job: asJob };
  if (outcome === "unknown") return { state: "unknown", job: asJob };
  return { state: "missing" };
}

/** Saved storyboards that use the narration take as a track or the mixed bed. */
export function storyboardsUsingAsset(
  compositions: CompositionV1[],
  assetId: string,
): CompositionV1[] {
  return compositions.filter(
    (composition) =>
      composition.audioAssetId === assetId ||
      (composition.audioTracks ?? []).some((track) => track.assetId === assetId),
  );
}

const newerThan = (a: string | number | undefined, b: string | number | undefined) => Number(a ?? 0) - Number(b ?? 0);

/** The storyboard stage: anchored on the matched narration take, if one is ready. */
export function storyboardStage(
  narration: NarrationStage,
  compositions: CompositionV1[],
  generations: ComposeGenerationV1[],
  assets: MediaAssetV1[],
): StoryboardStage {
  if (narration.state === "not-applicable") return { state: "unlinked" };
  if (narration.state === "waiting" || narration.state === "failed" || narration.state === "unknown" || narration.state === "missing")
    return { state: "blocked", because: "narration" };
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const users = storyboardsUsingAsset(compositions, narration.asset.id).sort((a, b) => newerThan(b.updatedAt ?? b.createdAt, a.updatedAt ?? a.createdAt));
  if (users.length === 0) return { state: "missing" };
  const composition = users[0];
  const renders = generations
    .filter((job) => job.compositionId === composition.id)
    .sort((a, b) => newerThan(b.createdAt, a.createdAt));
  const latest = renders[0];
  if (!latest) return { state: "not-rendered", composition };
  const asJob: DeskJob = { id: latest.id, status: latest.status, assetId: latest.assetId ?? null, error: latest.error ?? null };
  const outcome = jobOutcome(asJob, latest.assetId ? byId.get(latest.assetId) : undefined);
  if (outcome === "ready" && latest.assetId) {
    const cut = byId.get(latest.assetId);
    if (cut) {
      const stale = Number(composition.updatedAt ?? composition.createdAt ?? 0) > Number(latest.createdAt ?? 0);
      return {
        state: "ready",
        composition,
        job: asJob,
        cut,
        stale,
        extraCompositions: users.length - 1,
        ambiguous: narration.ambiguous === true || users.length > 1,
      };
    }
    return { state: "missing" };
  }
  if (outcome === "waiting") return { state: "waiting", composition, job: asJob };
  if (outcome === "failed") return { state: "failed", composition, job: asJob };
  if (outcome === "unknown") return { state: "unknown", composition, job: asJob };
  return { state: "missing" };
}

/**
 * The review stage: only rooms pinned to the current rendered cut count, and
 * only while the cut still matches the saved storyboard. Rooms that were
 * revoked are history, never active approval; `rooms === null` means the
 * project-scoped read is still in flight, not that no room exists.
 */
export function reviewStage(
  storyboard: StoryboardStage,
  rooms: PromoReviewRoomLite[] | null,
  roomsUnavailable: boolean,
): ReviewStage {
  if (storyboard.state === "unlinked") return { state: "blocked" };
  if (storyboard.state !== "ready") return { state: "blocked" };
  // A cut rendered before later storyboard edits is not the current edit, so
  // its review cannot stand in for approval of this brief.
  if (storyboard.stale) return { state: "stale" };
  if (roomsUnavailable) return { state: "unavailable" };
  if (rooms === null) return { state: "loading" };
  const cutId = storyboard.cut.id;
  const forCut = rooms.filter((room) => room.assetId === cutId);
  const active = forCut.filter((room) => room.status !== "revoked");
  const revokedCount = forCut.length - active.length;
  if (active.length === 0) return revokedCount ? { state: "missing", revokedCount } : { state: "missing" };
  const unresolved = active.reduce((sum, room) => sum + (room.unresolvedCount || 0), 0);
  if (active.some((room) => room.decision === "changes_requested")) return { state: "changes", unresolvedCount: unresolved, roomCount: active.length };
  if (active.some((room) => room.decision === "approved")) {
    // Several saved takes, cuts or storyboards make the link to this brief an
    // inference. Approval stays attached to the exact cut, not to the brief.
    if (storyboard.ambiguous) return { state: "ambiguous", roomCount: active.length };
    return { state: "approved", roomCount: active.length };
  }
  if (unresolved > 0) return { state: "unresolved", unresolvedCount: unresolved, roomCount: active.length };
  if (active.some((room) => room.status === "open")) return { state: "open", roomCount: active.length };
  return { state: "missing" };
}

/** The single most useful next action; the fallback asks for inspection, not sharing. */
export function nextAction(
  script: ScriptStage,
  narration: NarrationStage,
  storyboard: StoryboardStage,
  review: ReviewStage,
  projectId: string,
): DeskNextAction {
  const history = { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" };
  const reviewTab = { href: `#/p/${encodeURIComponent(projectId)}/review`, label: "Open Review" };
  if (script.state === "missing") {
    const first = script.missingSpoken[0] ?? 0;
    return { text: `Finish the spoken words for scene ${first + 1} in the brief below.` };
  }
  if (narration.state === "missing") {
    return { text: script.seconds ? `Open the script in Studio Voice below to record the narration (about ${script.seconds}s).` : "Open the script in Studio Voice below to record the narration." };
  }
  if (narration.state === "waiting") return { text: `The narration job is ${narration.job.status}. Check it in History.`, link: history };
  if (narration.state === "failed") return { text: "The narration job failed. Read its saved error in History; a new attempt is a separate request.", link: history };
  if (narration.state === "unknown") return { text: "The narration job never reported an outcome. Reconcile it in History before relying on it.", link: history };
  if (storyboard.state === "missing") {
    return { text: "Add the narration and your shots to a storyboard below, then save it." };
  }
  if (storyboard.state === "not-rendered") return { text: `The storyboard “${storyboard.composition.title}” is saved. Render the cut below when you are ready.` };
  if (storyboard.state === "waiting") return { text: `The cut for “${storyboard.composition.title}” is ${storyboard.job.status}. Check it in History.`, link: history };
  if (storyboard.state === "failed") return { text: `The last render of “${storyboard.composition.title}” failed. Read its saved error in History; rendering again is a separate request.`, link: history };
  if (storyboard.state === "unknown") return { text: `The render of “${storyboard.composition.title}” never reported an outcome. Reconcile it in History.`, link: history };
  if (storyboard.state === "ready" && storyboard.stale) {
    return { text: `“${storyboard.composition.title}” changed since this cut. Render again to include the latest edits; the earlier cut is kept.` };
  }
  if (review.state === "loading") return { text: "Review rooms are still loading. This desk has not read a review decision yet; it will update when they arrive." };
  if (review.state === "stale") return { text: "The saved cut predates later storyboard edits. Render again before relying on its review.", link: reviewTab };
  if (review.state === "missing") return { text: "Create a private review link for the current cut in Review.", link: reviewTab };
  if (review.state === "changes") return { text: `Changes were requested in review${review.unresolvedCount ? ` (${review.unresolvedCount} unresolved note${review.unresolvedCount === 1 ? "" : "s"})` : ""}. Address them, then render a new version — a new render never inherits approval.`, link: reviewTab };
  if (review.state === "unresolved") return { text: `Reviewers left ${review.unresolvedCount} unresolved note${review.unresolvedCount === 1 ? "" : "s"} on the cut. Read and resolve them in Review.`, link: reviewTab };
  if (review.state === "open") return { text: "The review room is open. Check Review for feedback.", link: reviewTab };
  if (review.state === "ambiguous") {
    return { text: `Review recorded a decision for the matched cut, but the cut was one of several possible matches. It is not treated as approval for this brief; check the cut in Review first.`, link: reviewTab };
  }
  if (review.state === "approved") {
    return {
      text: "Review approved this exact cut (feedback only, not permission to publish). Share or hand it off deliberately from Publish.",
      link: { href: `#/p/${encodeURIComponent(projectId)}/publish`, label: "Open Publish" },
    };
  }
  if (review.state === "unavailable") return { text: "Review state could not be loaded. Open Review to check the rooms yourself.", link: reviewTab };
  return { text: "No exact linked cut is confirmed from saved records. Inspect this brief's jobs and saved cuts in History before continuing.", link: history };
}

/** The whole desk for one saved brief, as plain data. */
export function promoDesk(
  brief: PromoBriefLite,
  assets: MediaAssetV1[],
  compositions: CompositionV1[],
  generations: ComposeGenerationV1[],
  rooms: PromoReviewRoomLite[] | null,
  roomsUnavailable: boolean,
  projectId: string,
): { script: ScriptStage; narration: NarrationStage; storyboard: StoryboardStage; review: ReviewStage; next: DeskNextAction } {
  const script = scriptStage(brief);
  const narration = narrationStage(script, generations, assets);
  const storyboard = storyboardStage(narration, compositions, generations, assets);
  const review = reviewStage(storyboard, rooms, roomsUnavailable);
  return { script, narration, storyboard, review, next: nextAction(script, narration, storyboard, review, projectId) };
}
