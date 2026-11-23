import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";
import { MAX_CAPTION_BYTES } from "./clip-captions.ts";
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
    reparsed = parseCaptionFile(vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000);
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
