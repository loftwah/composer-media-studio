import type { ImportedCue } from "./caption-import";

export const MAX_CAPTION_BYTES = 64 * 1024;
// A timing offset may move imported cues at most a minute earlier or later.
export const MAX_CAPTION_OFFSET_SECONDS = 60;
export type ClipCaptionTrack = Readonly<{ url: string; english: boolean }>;

// A receipt records the source caption file's identity, never its cue text.
// Zero offset stays absent so earlier receipts keep the same shape.
export function captionReceiptFields(caption: Readonly<{ name: string; sourceSha256: string; vtt: string | null }>, offsetMs: number) {
  return {
    sourceName: caption.name,
    included: Boolean(caption.vtt),
    sourceSha256: caption.sourceSha256,
    ...(offsetMs ? { offsetMs } : {}),
  };
}

function stamp(ms: number) {
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

// offsetMs is applied to every cue before it is clipped and rebased to the
// selected range: positive moves cues later, negative earlier. The default of
// 0 leaves the original timing (and therefore the emitted bytes) unchanged.
export function serializeClipCaptions(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number, offsetMs = 0) {
  const start = Math.round(startSeconds * 1000);
  const end = Math.round(endSeconds * 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > MAX_CAPTION_OFFSET_SECONDS * 1000) return null;
  const blocks: string[] = [];
  for (const cue of cues) {
    const from = Math.max(cue.startMs + offsetMs, start), to = Math.min(cue.endMs + offsetMs, end);
    if (from >= to) continue;
    const text = cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    blocks.push(`${stamp(from - start)} --> ${stamp(to - start)}\n${text}`);
  }
  return blocks.length ? `WEBVTT\n\n${blocks.join("\n\n")}\n` : null;
}
