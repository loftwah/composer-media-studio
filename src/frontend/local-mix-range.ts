/** Map a decoded audio chunk onto a video-relative timeline. */
export function localMixRange(timestamp: number, chunkDuration: number, videoStart: number, videoDuration: number) {
  if (![timestamp, chunkDuration, videoStart, videoDuration].every(Number.isFinite) || chunkDuration <= 0 || videoDuration <= 0) throw new Error("The original soundtrack has unsupported timing or format.");
  const at = timestamp - videoStart;
  const skip = Math.max(0, -at);
  const duration = Math.min(chunkDuration - skip, videoDuration - Math.max(0, at));
  return duration > 0 ? { start: Math.max(0, at), skip, duration } : null;
}
