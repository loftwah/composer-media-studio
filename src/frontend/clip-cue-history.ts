// One-step Undo and Redo for the editable caption draft. A history entry is the
// exact prior draft object: its source name, SHA-256 and cues are never rebuilt
// here, so both directions restore the same bytes the edit was made against.
// New successful edits replace the undo slot and discard the redo branch; a
// failed validation never calls these helpers, so it cannot disturb either.

export type CueHistory<T> = Readonly<{
  /** The exact draft before the most recent cue edit, or null. */
  undo: T | null;
  /** The draft undone most recently. `draft` may itself be null when a final cue was removed. */
  redo: Readonly<{ draft: T | null }> | null;
}>;

export const EMPTY_CUE_HISTORY = Object.freeze({ undo: null, redo: null }) as CueHistory<never>;

/** Record a successful edit; this also invalidates any older redo state. */
export function cueEditHistory<T>(previous: T): CueHistory<T> {
  return { undo: previous, redo: null };
}

/** Undo one edit, remembering the current draft (including null) for Redo. */
export function undoLastCueChange<T>(
  history: CueHistory<T>,
  current: T | null,
): Readonly<{ history: CueHistory<T>; draft: T | null }> | null {
  if (history.undo === null) return null;
  return { history: { undo: null, redo: { draft: current } }, draft: history.undo };
}

/** Redo the undone edit, offering the draft it replaced as the next Undo. */
export function redoLastCueChange<T>(
  history: CueHistory<T>,
  current: T | null,
): Readonly<{ history: CueHistory<T>; draft: T | null }> | null {
  if (history.redo === null) return null;
  return { history: { undo: current, redo: null }, draft: history.redo.draft };
}
