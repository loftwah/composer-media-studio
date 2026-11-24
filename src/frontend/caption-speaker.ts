// One bound and plain-line rule for a speaker label. Video Clip import, the
// canonical WebVTT serializer and the manual cue form all use this, so a name
// accepted in one place can never be refused or rewritten by another. Blank
// means the cue is unnamed.
export const MAX_SPEAKER_CHARS = 80;
const NOT_PLAIN = /[\u0000-\u001f\u007f\ufffd]/;

/**
 * Trim a name and return it only when it is one plain line of at most 80
 * characters. Null means the value cannot be represented as a speaker label;
 * an empty string is a valid unnamed cue.
 */
export function normalizeSpeaker(value: string): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length <= MAX_SPEAKER_CHARS && !NOT_PLAIN.test(name) ? name : null;
}
