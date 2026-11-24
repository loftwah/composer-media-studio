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

import type { ImportedCue } from "./caption-import.ts";

type SpeakerRenameResult =
  | Readonly<{ cues: ImportedCue[]; speaker: string; renamed: number }>
  | Readonly<{ problem: string }>;

type SpeakerCueChange =
  | Readonly<{ cues: ImportedCue[]; speaker: string; changed: number }>
  | Readonly<{ problem: string }>;

// The shared exact-name projection used by rename and name removal. Unmatched
// cue objects stay untouched; only the selected speaker field is replaced.
function replaceSpeakerCues(
  cues: readonly ImportedCue[],
  speaker: string,
  name: string,
): SpeakerCueChange {
  if (!speaker || !cues.some(cue => cue.speaker === speaker)) {
    return { problem: `The speaker “${speaker}” is no longer in this draft. Choose another speaker.` };
  }
  let changed = 0;
  const nextCues = cues.map(cue => {
    if (cue.speaker !== speaker) return cue;
    changed++;
    return { ...cue, speaker: name };
  });
  return { cues: nextCues, speaker: name, changed };
}

/**
 * Rename one exact speaker across the full cue list. The new name uses the same
 * bound and plain-line rule as import and manual cues. An exact existing name is
 * never merged; a case-only correction is allowed when no other exact speaker
 * already owns it. Unmatched cue objects are returned untouched.
 */
export function renameSpeakerCues(
  cues: readonly ImportedCue[],
  speaker: string,
  value: string,
): SpeakerRenameResult {
  if (!speaker || !cues.some(cue => cue.speaker === speaker)) {
    return { problem: `The speaker “${speaker}” is no longer in this draft. Choose another speaker.` };
  }
  const name = normalizeSpeaker(value);
  if (name === "") {
    return { problem: "Enter a new speaker name. The current speaker was not changed." };
  }
  if (name === null) {
    return { problem: `Use one line of up to ${MAX_SPEAKER_CHARS} plain characters. The current speaker was not changed.` };
  }
  if (name === speaker) {
    return { problem: `“${speaker}” is already this speaker’s name. Enter a different name.` };
  }
  if (cues.some(cue => cue.speaker === name)) {
    return { problem: `“${name}” already belongs to another speaker. Choose a unique name, or rename that speaker first.` };
  }
  const changed = replaceSpeakerCues(cues, speaker, name);
  if ("problem" in changed) return changed;
  return { cues: changed.cues, speaker: changed.speaker, renamed: changed.changed };
}

/**
 * Remove one exact speaker name across the full cue list. An empty string is
 * the established unnamed value; text, times and every other cue stay exact.
 */
export function removeSpeakerNameCues(
  cues: readonly ImportedCue[],
  speaker: string,
): SpeakerCueChange {
  return replaceSpeakerCues(cues, speaker, "");
}
