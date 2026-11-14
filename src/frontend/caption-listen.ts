// Seek against the original song clock, not the segment-relative export clock.
export async function listenFromCaption(player: Pick<HTMLMediaElement, 'currentTime' | 'play'>, startMs: number, durationMs: number): Promise<void> {
  if (!Number.isSafeInteger(startMs) || !Number.isFinite(durationMs) || startMs < 0 || startMs >= durationMs) throw new Error('Invalid caption start');
  player.currentTime = startMs / 1000;
  await player.play();
}
