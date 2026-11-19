/** Validate fades against the part of the selected music that can actually be heard. */
export function musicFadeDuration(videoDuration: number, musicDuration: number, musicOffset: number, fadeIn: number, fadeOut: number) {
  const audible = Math.min(videoDuration, musicDuration - musicOffset);
  if (![videoDuration, musicDuration, musicOffset, fadeIn, fadeOut].every(Number.isFinite) || videoDuration <= 0 || musicOffset < 0 || audible <= 0 || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > audible) throw new Error("Music fades must fit within the part of the track used by this video.");
  return audible;
}

/**
 * Place added audio on the video timeline. `delay` is a video-time opener and
 * is independent of the offset into the music file. At delay 0 the returned
 * envelope is identical to the original start-at-zero placement.
 */
export function musicPlacement(videoDuration: number, musicDuration: number, musicOffset: number, fadeIn: number, fadeOut: number, delay: number) {
  if (!Number.isFinite(delay) || delay < 0 || delay >= videoDuration) throw new Error("Start added audio within the video.");
  const overlap = musicFadeDuration(videoDuration - delay, musicDuration, musicOffset, fadeIn, fadeOut);
  return {
    start: delay,
    overlap,
    fadeInStart: delay,
    fadeInEnd: delay + fadeIn,
    fadeOutStart: delay + overlap - fadeOut,
    fadeOutEnd: delay + overlap,
  };
}
