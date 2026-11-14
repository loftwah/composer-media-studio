type Cue = { id: string; startMs: number; endMs: number; text: string; speaker: string };

// Only contiguous cues with the same speaker can be joined without changing their coverage.
export function joinCaptions(first: Cue, next: Cue | undefined): Cue | null {
  if (!next || first.id === next.id || !Number.isSafeInteger(first.startMs) || !Number.isSafeInteger(first.endMs) || !Number.isSafeInteger(next.endMs) || first.startMs >= first.endMs || first.endMs !== next.startMs || next.startMs >= next.endMs || first.speaker !== next.speaker) return null;
  const text = [first.text.trim(), next.text.trim()].filter(Boolean).join(' ');
  if (!text || text.length > 300) return null;
  return { ...first, endMs: next.endMs, text };
}
