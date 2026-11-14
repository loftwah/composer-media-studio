type Scene = { id: string; startMs: number; endMs: number; direction: string; referenceAssetId: string | null; selectedTakeId: string | null };
type ScenePlan = { title: string; treatment: string; aspect: string; startMs: number; endMs: number; scenes: Scene[] };

// Only fields saved by the scene-plan editor count as scene edits. Caption saves
// also change server metadata and the revision, but must not dirty the scenes.
export function scenePlanChanged(draft: ScenePlan, saved: ScenePlan): boolean {
  const fields = (plan: ScenePlan) => [plan.title, plan.treatment, plan.aspect, plan.startMs, plan.endMs,
    plan.scenes.map(scene => [scene.id, scene.startMs, scene.endMs, scene.direction, scene.referenceAssetId, scene.selectedTakeId])];
  return JSON.stringify(fields(draft)) !== JSON.stringify(fields(saved));
}
