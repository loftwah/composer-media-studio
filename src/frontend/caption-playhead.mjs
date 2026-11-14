// Capture is a suggestion until the creator explicitly applies it to the draft.
export function captionPlayheadProposal(cue, edge, currentTime, segmentStart, segmentEnd) {
  if (!cue || !['startMs', 'endMs'].includes(edge) || !Number.isFinite(currentTime) || currentTime < 0) return null;
  const value = Math.round(currentTime * 1000);
  const startMs = edge === 'startMs' ? value : cue.startMs;
  const endMs = edge === 'endMs' ? value : cue.endMs;
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < segmentStart || endMs > segmentEnd || startMs >= endMs) return null;
  return { edge, value, startMs, endMs };
}
