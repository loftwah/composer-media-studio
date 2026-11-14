// Shot times are integer milliseconds from the original saved clip's start.
export function shotRange(shot, asset) {
  const duration = asset?.durationMs;
  if (!Number.isSafeInteger(duration) || duration <= 0) return null;
  const hasStart = shot.trimStartMs !== undefined;
  const hasEnd = shot.trimEndMs !== undefined;
  if (hasStart !== hasEnd) return null;
  const start = hasStart ? shot.trimStartMs : 0;
  const end = hasEnd ? shot.trimEndMs : duration;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end || end > duration) return null;
  if (shot.durationMs !== undefined && shot.durationMs !== end - start) return null;
  return { start, end, durationMs: end - start };
}
