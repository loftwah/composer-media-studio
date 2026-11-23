import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";
import { MAX_CAPTION_BYTES, clipTimeStamp, serializeClipCaptions } from "./clip-captions.ts";

export const MAX_MANUAL_CAPTION_CUES = 100;
export const MANUAL_CAPTION_SOURCE = "Manual cues in Video Clip";

export type ManualCueEntry = Readonly<{
  text: string;
  startSeconds: string;
  endSeconds: string;
}>;

export type ManualCueAddition =
  | Readonly<{ cues: ImportedCue[] }>
  | Readonly<{ problem: string }>;

// Seconds are accepted only when they name a whole millisecond, matching the
// timing offset field and the existing caption parser's precision.
function wholeMilliseconds(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const seconds = Number(text);
  if (!Number.isFinite(seconds)) return null;
  const ms = seconds * 1000;
  const whole = Math.round(ms);
  return Number.isSafeInteger(whole) && Math.abs(ms - whole) < 1e-6 ? whole : null;
}

/**
 * A hand-edited track is a new local source, never the imported file. Keep the
 * imported name as lineage but make clear the bytes were edited in this tab, so
 * the receipt's sourceName and SHA-256 describe the actual track.
 */
export function manualCaptionSourceName(current: Readonly<{ name: string; local: boolean }> | null): string {
  if (!current) return MANUAL_CAPTION_SOURCE;
  return current.local ? current.name : `${current.name} (edited in Video Clip)`;
}

/**
 * The exact full-source caption track for a local source digest. It is the same
 * serializer used by preview and export, with no trim or offset applied.
 */
export function manualCaptionTrackVtt(cues: readonly ImportedCue[]): string | null {
  if (!cues.length) return null;
  const endMs = Math.max(...cues.map(cue => cue.endMs));
  if (!Number.isSafeInteger(endMs) || endMs <= 0) return null;
  return serializeClipCaptions(cues, 0, endMs / 1000, 0);
}

/**
 * Validate one manual cue against the draft. The combined track goes back
 * through the existing caption importer, so plain-text, no-overlap, in-video
 * and size limits are the same ones a chosen file already follows. When
 * replaceIndex is null the cue is added; otherwise only that draft index is
 * replaced. An invalid entry returns a problem and leaves the caller's draft
 * untouched.
 */
function validatedManualCue(
  cues: readonly ImportedCue[],
  input: ManualCueEntry,
  durationMs: number,
  replaceIndex: number | null,
): ManualCueAddition {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    return { problem: "This video has no usable duration for captions." };
  if (!input.text.trim()) return { problem: "Enter plain caption text for the cue." };
  // A manual entry is one cue, so it cannot introduce another VTT line.
  if (/[\r\n]/.test(input.text)) return { problem: "Enter the caption on one line." };
  const startMs = wholeMilliseconds(input.startSeconds);
  const endMs = wholeMilliseconds(input.endSeconds);
  if (startMs === null || endMs === null)
    return { problem: "Enter start and end seconds with up to three decimal places." };
  if (startMs < 0 || endMs > durationMs)
    return { problem: `Choose a start and end within this video (0 to ${clipTimeStamp(durationMs)}).` };
  if (endMs <= startMs) return { problem: "The end must be after the start." };
  if (replaceIndex === null && cues.length >= MAX_MANUAL_CAPTION_CUES)
    return { problem: `This draft already has ${MAX_MANUAL_CAPTION_CUES} cues. Clear or replace the track before adding another.` };
  if (cues.some((cue, index) => index !== replaceIndex && startMs < cue.endMs && cue.startMs < endMs))
    return { problem: "This cue overlaps another cue. Choose a free start and end." };

  const edited = { startMs, endMs, text: input.text, speaker: "" };
  const next = (replaceIndex === null
    ? [...cues, edited]
    : cues.map((cue, index) => index === replaceIndex ? edited : cue))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const source = manualCaptionTrackVtt(next);
  if (!source) return { problem: "The cue times do not fit this video." };
  if (new TextEncoder().encode(source).byteLength > MAX_CAPTION_BYTES)
    return { problem: "This cue would put the caption track over 64 KB." };
  // The edited cue is already bounded by the real video. Existing imported cues
  // may extend past it, so let the importer validate order and overlap over the
  // whole draft without rejecting those untouched cues.
  const segmentEndMs = Math.max(durationMs, ...next.map(cue => cue.endMs));
  try {
    return { cues: parseCaptionFile(source, 0, segmentEndMs) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/overlaps another/.test(message))
      return { problem: "This cue overlaps another cue. Choose a free start and end." };
    if (/plain text/.test(message))
      return { problem: "Use plain text up to 300 characters without control characters." };
    return { problem: "That cue could not be saved. Check its text, start and end." };
  }
}

/**
 * Add one plain-text cue to the local draft. An invalid entry returns a
 * problem and leaves the caller's draft untouched.
 */
export function appendManualClipCue(
  cues: readonly ImportedCue[],
  input: ManualCueEntry,
  durationMs: number,
): ManualCueAddition {
  return validatedManualCue(cues, input, durationMs, null);
}

/**
 * Replace exactly one cue by its index in the draft, the identity carried by
 * the shared trim projection. An offset or trim can clamp or shift what the
 * review row shows, so its displayed times cannot identify the underlying cue.
 * Only that index changes; every other cue keeps its text and original-video
 * times, and an out-of-range index leaves the draft untouched.
 */
export function replaceClipDraftCue(
  cues: readonly ImportedCue[],
  sourceIndex: number,
  input: ManualCueEntry,
  durationMs: number,
): ManualCueAddition {
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= cues.length)
    return { problem: "That cue is no longer in this draft. Choose Edit again." };
  return validatedManualCue(cues, input, durationMs, sourceIndex);
}

/**
 * Two draft cues are truly adjacent only when their source indexes are next to
 * each other, their original times touch without a gap or overlap, and they
 * share a speaker. The review calls this only for rows it currently shows, so a
 * cue hidden by the trim or timing offset can never be pulled into a merge.
 */
function adjacentClipDraftCues(
  cues: readonly ImportedCue[],
  firstSourceIndex: number,
  nextSourceIndex: number,
): Readonly<{ first: ImportedCue; next: ImportedCue }> | null {
  if (!Number.isSafeInteger(firstSourceIndex) || !Number.isSafeInteger(nextSourceIndex)) return null;
  if (nextSourceIndex !== firstSourceIndex + 1) return null;
  if (firstSourceIndex < 0 || nextSourceIndex >= cues.length) return null;
  const first = cues[firstSourceIndex], next = cues[nextSourceIndex];
  if (!first || !next) return null;
  if (first.startMs >= first.endMs || next.startMs >= next.endMs) return null;
  if (first.endMs !== next.startMs || first.speaker !== next.speaker) return null;
  return { first, next };
}

/** Whether the review can offer Merge with next for these two visible cues. */
export function canMergeClipDraftCues(
  cues: readonly ImportedCue[],
  firstSourceIndex: number,
  nextSourceIndex: number,
): boolean {
  return adjacentClipDraftCues(cues, firstSourceIndex, nextSourceIndex) !== null;
}

/**
 * Merge exactly two adjacent cues by their draft indexes, the identity carried
 * by the shared trim projection. The first cue's original start and the next
 * cue's original end are kept, and their exact texts are joined with one space.
 * The merged track goes through the same plain-text, duration, overlap and size
 * validation as Add cue and Update cue. A refusal changes nothing, so the
 * caller's draft remains exactly as it was.
 */
export function mergeClipDraftCues(
  cues: readonly ImportedCue[],
  firstSourceIndex: number,
  nextSourceIndex: number,
  durationMs: number,
): ManualCueAddition {
  const pair = adjacentClipDraftCues(cues, firstSourceIndex, nextSourceIndex);
  if (!pair) {
    const stale = !Number.isSafeInteger(firstSourceIndex) || firstSourceIndex < 0 || firstSourceIndex >= cues.length
      || !Number.isSafeInteger(nextSourceIndex) || nextSourceIndex < 0 || nextSourceIndex >= cues.length;
    return { problem: stale
      ? "That cue is no longer in this draft. Choose Merge again."
      : "Only two adjacent cues with matching speakers and no gap can be merged." };
  }
  const { first, next } = pair;
  // Remove the second cue first so the existing replacement validator sees the
  // exact draft a successful merge would leave, including its overlap checks.
  const remaining = cues.filter((_, index) => index !== nextSourceIndex);
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  return validatedManualCue(remaining, {
    text: `${first.text} ${next.text}`,
    startSeconds: seconds(first.startMs),
    endSeconds: seconds(next.endMs),
  }, durationMs, firstSourceIndex);
}

/**
 * Remove one cue by its index in the draft, the identity carried by the shared
 * trim projection. An offset or trim can clamp or shift what the review row
 * shows, so its displayed times cannot identify the underlying cue. Cues
 * outside the current trim stay untouched, and an out-of-range index changes
 * nothing.
 */
export function removeClipDraftCue(cues: readonly ImportedCue[], sourceIndex: number): ImportedCue[] | null {
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= cues.length) return null;
  return cues.filter((_, index) => index !== sourceIndex);
}
