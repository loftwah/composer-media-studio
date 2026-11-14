/** Captions and scene times both use milliseconds from the source song. */
type Timed = { startMs: number; endMs: number };
export function captionsForScene<T extends Timed>(scene: Timed, cues: T[]): T[] {
  if (!Number.isSafeInteger(scene.startMs) || !Number.isSafeInteger(scene.endMs) || scene.endMs <= scene.startMs) return [];
  return cues.filter(cue => Number.isSafeInteger(cue.startMs) && Number.isSafeInteger(cue.endMs) && cue.endMs > cue.startMs && cue.startMs < scene.endMs && cue.endMs > scene.startMs)
    .slice().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
