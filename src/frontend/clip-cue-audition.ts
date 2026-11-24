export type CueAuditionWindow = Readonly<{ startMs: number; endMs: number }>;

/**
 * The source-video window for one reviewed cue. `from` and `to` are the
 * trim-relative intersection already produced by `clipCaptionCues`, so
 * `sourceStartMs + (to - from)` is that cue's real source end after both the
 * trim clamp and the timing offset. Nothing is clamped or re-adjusted here; an
 * invalid or out-of-range window returns null rather than playing the wrong
 * seconds.
 */
export function cueAuditionWindow(
  cue: Readonly<{ sourceStartMs: number; from: number; to: number }> | null | undefined,
  durationMs: number,
): CueAuditionWindow | null {
  if (!cue) return null;
  const { sourceStartMs, from, to } = cue;
  if (![sourceStartMs, from, to, durationMs].every(Number.isSafeInteger)) return null;
  if (sourceStartMs < 0 || from < 0 || to <= from || durationMs <= 0) return null;
  const endMs = sourceStartMs + (to - from);
  if (!Number.isSafeInteger(endMs) || endMs <= sourceStartMs || endMs > durationMs) return null;
  return { startMs: sourceStartMs, endMs };
}
