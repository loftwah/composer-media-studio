type TimedCue = { startMs: number; endMs: number };

// Shift a draft as a whole; never clip a cue or fill a gap.
export function shiftCaptionTimes<T extends TimedCue>(cues: T[], offset: string, startMs: number, endMs: number): T[] | null {
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(offset) || !cues.length || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs) return null;
  const delta = Math.round(Number(offset) * 1000);
  if (!Number.isSafeInteger(delta) || !delta) return null;
  const shifted = cues.map(cue => ({ ...cue, startMs: cue.startMs + delta, endMs: cue.endMs + delta }));
  if (shifted.some(cue => !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < startMs || cue.endMs > endMs || cue.startMs >= cue.endMs)) return null;
  return shifted;
}
