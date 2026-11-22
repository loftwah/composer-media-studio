// MIT. Validate caption fields the same way in the draft and on save.
interface CaptionFields {
  startMs: unknown;
  endMs: unknown;
  text: unknown;
  speaker?: unknown;
}

export const maxSongCaptions = 100;

export function readSongCaptionFields(cue: CaptionFields, startMs: number, endMs: number) {
  const { startMs: start, endMs: end, text } = cue;
  const speaker = cue.speaker ?? '';
  if (typeof start !== 'number' || !Number.isSafeInteger(start)) return { problem: 'start' } as const;
  if (typeof end !== 'number' || !Number.isSafeInteger(end)) return { problem: 'end' } as const;
  if (start < startMs || end > endMs) return { problem: 'segment' } as const;
  if (end <= start) return { problem: 'order' } as const;
  if (typeof text !== 'string' || !text.trim()) return { problem: 'missing_words' } as const;
  if (text.length > 300 || /[\u0000-\u001f\u007f]/.test(text)) return { problem: 'words' } as const;
  if (typeof speaker !== 'string' || speaker.length > 80 || /[\u0000-\u001f\u007f]/.test(speaker)) return { problem: 'speaker' } as const;
  return { problem: null, startMs: start, endMs: end, text: text.trim(), speaker: speaker.trim() };
}
