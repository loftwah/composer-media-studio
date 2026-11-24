import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";
import { MAX_CAPTION_BYTES, clipCaptionSrtVariants, clipTimeStamp, type ClipCaptionSrtVariants } from "./clip-captions.ts";
import { manualCaptionTrackVtt } from "./clip-manual-cue.ts";
import { MAX_PUBLIC_VIDEO_SOURCE_SECONDS } from "./video-clip-source.ts";

export type FullSourceCaptionDownload =
  | Readonly<{ vtt: string }>
  | Readonly<{ problem: string }>;

const UNREADABLE = "This caption draft could not be saved as WebVTT that can be chosen again. Remove or edit the cue that changed.";

/**
 * The exact canonical full-source VTT for a caption draft, proven against the
 * same 64 KB file limit and parser bounds Choose captions applies. It keeps the
 * original cue times and text, includes cues outside the current trim, and never
 * applies the timing offset. Null means there is no usable caption draft, so the
 * caller should offer no action at all.
 */
export function fullSourceCaptionDownload(cues: readonly ImportedCue[]): FullSourceCaptionDownload | null {
  if (!cues.length) return null;
  const vtt = manualCaptionTrackVtt(cues);
  if (!vtt) return { problem: UNREADABLE };
  const bytes = new TextEncoder().encode(vtt).byteLength;
  if (vtt.length > MAX_CAPTION_BYTES || bytes > MAX_CAPTION_BYTES)
    return { problem: `This caption draft is ${Math.ceil(bytes / 1024)} KB as WebVTT, over the ${MAX_CAPTION_BYTES / 1024} KB limit, so it can’t be chosen again. Remove cues or shorten their text.` };
  let reparsed: ImportedCue[];
  try {
    reparsed = parseCaptionFile(vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000, { voices: true });
  } catch {
    return { problem: UNREADABLE };
  }
  if (reparsed.length !== cues.length) return { problem: UNREADABLE };
  for (let index = 0; index < cues.length; index++) {
    const source = cues[index]!, roundTrip = reparsed[index]!;
    if (source.startMs !== roundTrip.startMs || source.endMs !== roundTrip.endMs ||
      source.text !== roundTrip.text || source.speaker !== roundTrip.speaker) return { problem: UNREADABLE };
  }
  return { vtt };
}

/**
 * Both optional full-source SRT sidecars, derived once from the exact canonical
 * full-source VTT. The plain candidate keeps the earlier unnamed-only meaning;
 * the speaker-text candidate folds each named cue's speaker into its line. Both
 * span the whole source timebase, so every original-time cue survives, including
 * cues the current trim excludes. No trim, timing offset or preview placement
 * reaches either. A missing or unreadable VTT yields null; a candidate is null
 * when that form cannot be represented exactly.
 */
export function fullSourceCaptionSrtVariants(vtt: string | null): ClipCaptionSrtVariants | null {
  return vtt ? clipCaptionSrtVariants(vtt, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000) : null;
}

/**
 * The optional unnamed-only full-source SRT sidecar. Legacy callers keep exactly
 * this result; a named cue still withholds it rather than dropping the speaker.
 */
export function fullSourceCaptionSrt(vtt: string | null): string | null {
  return fullSourceCaptionSrtVariants(vtt)?.plain ?? null;
}

/**
 * A readable archival transcript derived only from the exact full-source VTT.
 * The same bounded, voice-aware parser supplies ordered cues at their original
 * video times; no trim, timing offset, source fingerprint or media is involved.
 * Each cue occupies one LF-terminated line with an optional supplied speaker.
 * Literal Unicode text is left unescaped, and null withholds an unusable draft.
 */
export function fullSourceCaptionTranscript(vtt: string | null): string | null {
  if (!vtt || vtt.length > MAX_CAPTION_BYTES || new TextEncoder().encode(vtt).byteLength > MAX_CAPTION_BYTES) return null;
  let cues: ImportedCue[];
  try {
    cues = parseCaptionFile(vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000, { voices: true });
  } catch {
    return null;
  }
  if (!cues.length) return null;
  return cues.map(cue => {
    const speaker = cue.speaker ? `${cue.speaker}: ` : "";
    return `[${clipTimeStamp(cue.startMs)} --> ${clipTimeStamp(cue.endMs)}] ${speaker}${cue.text}`;
  }).join("\n") + "\n";
}
