import type { CompositionV1, ComposeStateV1 } from "./contracts";

export function draftMatchesSaved(compose: ComposeStateV1, saved?: CompositionV1): boolean {
  if (!saved) return false;
  const draftShots = compose.shotIds.map((assetId) => {
    const trim = compose.shotTrims[assetId];
    return trim ? { assetId, trimStartMs: trim.trimStartMs, trimEndMs: trim.trimEndMs } : { assetId };
  });
  const savedShots = saved.shots.map((shot) =>
    shot.trimStartMs !== undefined && shot.trimEndMs !== undefined
      ? { assetId: shot.assetId, trimStartMs: shot.trimStartMs, trimEndMs: shot.trimEndMs }
      : { assetId: shot.assetId },
  );
  return (
    compose.title === saved.title &&
    JSON.stringify(draftShots) === JSON.stringify(savedShots) &&
    (compose.audioAssetId ?? null) === (saved.audioAssetId ?? null) &&
    JSON.stringify(compose.audioTracks) === JSON.stringify(saved.audioTracks ?? []) &&
    (compose.slateAssetId ?? null) === (saved.slateAssetId ?? null)
  );
}
