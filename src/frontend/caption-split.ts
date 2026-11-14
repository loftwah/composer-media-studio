type Cue = { id: string; startMs: number; endMs: number; text: string; speaker: string };

// Splitting is an editable starting point, not an alignment of words to audio.
export function splitCaption(cue: Cue, nextId: string): [Cue, Cue] | null {
  if (!Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.endMs - cue.startMs < 2 || !nextId || nextId === cue.id) return null;
  const text = cue.text.trim();
  const boundaries = [...text.matchAll(/\s+/gu)].map(match => ({ at: match.index!, length: match[0].length }));
  if (!boundaries.length) return null;
  const boundary = boundaries.reduce((best, current) => Math.abs(current.at - text.length / 2) < Math.abs(best.at - text.length / 2) ? current : best);
  const middle = cue.startMs + Math.floor((cue.endMs - cue.startMs) / 2);
  return [
    { ...cue, endMs: middle, text: text.slice(0, boundary.at) },
    { ...cue, id: nextId, startMs: middle, text: text.slice(boundary.at + boundary.length) },
  ];
}
