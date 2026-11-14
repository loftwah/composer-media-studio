/** Validate fades against the part of the selected music that can actually be heard. */
export function musicFadeDuration(videoDuration: number, musicDuration: number, musicOffset: number, fadeIn: number, fadeOut: number) {
  const audible = Math.min(videoDuration, musicDuration - musicOffset);
  if (![videoDuration, musicDuration, musicOffset, fadeIn, fadeOut].every(Number.isFinite) || videoDuration <= 0 || musicOffset < 0 || audible <= 0 || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > audible) throw new Error("Music fades must fit within the part of the track used by this video.");
  return audible;
}
