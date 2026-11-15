// Scene selection and saved-revision recovery for the promo workbench.
// Kept free of React so the state rules can be tested without a browser.

export function clampScene(index: number, sceneCount: number): number {
  const last = Math.max(0, sceneCount - 1);
  return Math.min(Math.max(0, index), last);
}

/** A new scene is appended, so its zero-based index is the previous count. */
export function activeSceneAfterAdd(sceneCount: number): number {
  return Math.max(0, sceneCount);
}

/** Removing the active scene selects the scene that takes its place, or the last one. */
export function activeSceneAfterRemove(index: number, sceneCount: number): number {
  return clampScene(index, Math.max(0, sceneCount - 1));
}

/** The refreshed saved brief that a conflict must be resolved against.
 * The id, not a stale local copy, decides; a deleted brief has no base. */
export function conflictBase<T extends { id: string }>(savedId: string | null, briefs: T[]): T | null {
  if (!savedId) return null;
  return briefs.find(brief => brief.id === savedId) ?? null;
}
