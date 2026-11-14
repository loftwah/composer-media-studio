// Suggest a free window; the creator still sets the actual lyric timing.
export function nextCaptionSlot(startMs: number, endMs: number, cues: { startMs: number; endMs: number }[]) {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) return null;
  const occupied = cues.filter(cue => Number.isSafeInteger(cue.startMs) && Number.isSafeInteger(cue.endMs) && cue.endMs > cue.startMs)
    .map(cue => ({ startMs: Math.max(startMs, cue.startMs), endMs: Math.min(endMs, cue.endMs) }))
    .filter(cue => cue.endMs > cue.startMs).sort((a, b) => a.startMs - b.startMs);
  const gaps: { startMs: number; endMs: number }[] = [];
  let cursor = startMs;
  for (const cue of occupied) {
    if (cue.startMs > cursor) gaps.push({ startMs: cursor, endMs: cue.startMs });
    cursor = Math.max(cursor, cue.endMs);
  }
  if (cursor < endMs) gaps.push({ startMs: cursor, endMs });
  const lastEnd = occupied.reduce((last, cue) => Math.max(last, cue.endMs), startMs);
  const gap = gaps.find(window => window.startMs >= lastEnd) ?? gaps[0];
  return gap ? { startMs: gap.startMs, endMs: Math.min(gap.startMs + 2000, gap.endMs) } : null;
}
