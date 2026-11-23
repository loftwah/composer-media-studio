// The Review cues search is a read-only display filter. It is given a copy of
// the trimmed-cue projection and never receives the draft, the export or the
// preview track, so a query can only change which rows are shown.

import type { ImportedCue } from "./caption-import.ts";
import { canMergeClipDraftCues } from "./clip-manual-cue.ts";

// A pasted page of text must not make every keystroke scan an unbounded string.
export const MAX_CUE_SEARCH_CHARS = 120;

type SearchableCue = Readonly<{ text: string; sourceIndex: number }>;

/** Plain, bounded, case-insensitive Unicode substring query. No regex syntax. */
export function cueSearchQuery(raw: string): string {
  return raw.slice(0, MAX_CUE_SEARCH_CHARS).trim().normalize("NFC").toLowerCase();
}

/** Filter the review rows in place-order, keeping each cue's sourceIndex. */
export function filterCuesByText<C extends SearchableCue>(cues: readonly C[], raw: string): C[] {
  const query = cueSearchQuery(raw);
  if (!query) return [...cues];
  return cues.filter(cue => cue.text.normalize("NFC").toLowerCase().includes(query));
}

export type CueMergeVisibility<C> = Readonly<{
  /** The genuine next cue in the full trimmed list, hidden or not. */
  next: C | null;
  /** The neighbour a merge button may target: visible and truly adjacent. */
  mergeWith: C | null;
  /** A mergeable neighbour the search currently hides; tell the owner how to reveal it. */
  hiddenMergeWith: C | null;
}>;

/**
 * Merge adjacency comes from the FULL trimmed list, never from neighbouring
 * search matches. A cue hidden by the query can never be skipped: two matches
 * are offered a merge only when the cue between them is visible and genuinely
 * adjacent in the draft. A hidden but otherwise mergeable neighbour is named
 * so the UI can explain how to reveal it.
 */
export function cueMergeVisibility<C extends SearchableCue>(
  full: readonly C[],
  cue: C,
  visible: readonly C[],
  draftCues: readonly ImportedCue[],
): CueMergeVisibility<C> {
  const at = full.findIndex(item => item.sourceIndex === cue.sourceIndex);
  const next = at < 0 ? null : full[at + 1] ?? null;
  if (!next) return { next: null, mergeWith: null, hiddenMergeWith: null };
  if (!canMergeClipDraftCues(draftCues, cue.sourceIndex, next.sourceIndex))
    return { next, mergeWith: null, hiddenMergeWith: null };
  return visible.some(item => item.sourceIndex === next.sourceIndex)
    ? { next, mergeWith: next, hiddenMergeWith: null }
    : { next, mergeWith: null, hiddenMergeWith: next };
}
