/** Preview only: no media is edited and the caller decides whether to apply. */
type FitScene = { id: string; startMs: number; endMs: number; selectedTakeId: string | null };
type FitAsset = { id: string; kind: string; durationMs: number | null };
type FitCue = { startMs: number; endMs: number };
type FitPlan = { startMs: number; endMs: number; scenes: FitScene[] };
export type TakeFit =
  | { status: 'missing' | 'duplicate' | 'duration' | 'overflow' | 'segment'; detail: string }
  | { status: 'exact' | 'shorter' | 'captions'; endMs: number; differenceMs: number; scenes: { id: string; startMs: number; endMs: number; durationMs: number }[] };

export function previewTakeFit(plan: FitPlan, assets: FitAsset[], cues: FitCue[], savedCues: FitCue[]): TakeFit {
  if (!Number.isSafeInteger(plan.startMs) || !Number.isSafeInteger(plan.endMs) || plan.endMs <= plan.startMs) return { status: 'segment', detail: 'The song segment has invalid boundaries.' };
  const seen = new Set<string>();
  let cursor = plan.startMs;
  const scenes: { id: string; startMs: number; endMs: number; durationMs: number }[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const take = assets.find(asset => asset.id === scene.selectedTakeId && asset.kind === 'video');
    if (!take) return { status: 'missing', detail: `Choose an available saved take for scene ${index + 1}.` };
    if (seen.has(take.id)) return { status: 'duplicate', detail: `Scene ${index + 1} repeats a take; each storyboard shot must be unique.` };
    seen.add(take.id);
    if (!Number.isSafeInteger(take.durationMs) || !take.durationMs || take.durationMs < 1 || take.durationMs > 16000) return { status: 'duration', detail: `Scene ${index + 1} needs a measured take of at most 16 seconds.` };
    const endMs = cursor + take.durationMs;
    scenes.push({ id: scene.id, startMs: cursor, endMs, durationMs: take.durationMs });
    cursor = endMs;
  }
  if (cursor - plan.startMs < 2000) return { status: 'segment', detail: 'The selected takes need to cover at least two seconds.' };
  if (cursor > plan.endMs) return { status: 'overflow', detail: `The selected takes exceed this song segment by ${seconds(cursor - plan.endMs)} seconds. Choose shorter takes or a longer segment; no media has been trimmed.` };
  const differenceMs = plan.endMs - cursor;
  if (differenceMs && [...cues, ...savedCues].some(cue => cue.startMs < plan.startMs || cue.endMs > cursor)) return { status: 'captions', endMs: cursor, differenceMs, scenes };
  return { status: differenceMs ? 'shorter' : 'exact', endMs: cursor, differenceMs, scenes };
}
const seconds = (ms: number) => (ms / 1000).toFixed(3);
