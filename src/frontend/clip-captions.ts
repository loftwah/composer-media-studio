import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";

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

// SRT stamps carry hours and use a comma before milliseconds; WebVTT omits
// hours and uses a dot. Both are built from the same relative millisecond cue
// times, so the two sidecars describe one timeline.
function srtStamp(ms: number) {
  const hours = Math.floor(ms / 3_600_000).toString().padStart(2, "0");
  const minutes = Math.floor((ms % 3_600_000) / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds},${millis}`;
}

// Keep ampersands literal (SRT readers such as FFmpeg show entities verbatim)
// but neutralise angle brackets so plain text is not mistaken for markup.
const srtLine = (cue: ImportedCue) => cue.text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function serializeSrt(cues: readonly ImportedCue[]) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(cue.endMs)}\n${srtLine(cue)}\n`)
    .join("\n");
}

/**
 * Derive an optional SRT sidecar from the exact trimmed WebVTT the receipt has
 * already prepared. No second parser is introduced: the same bounded importer
 * used for caption upload re-reads that VTT at zero offset. The download is
 * exposed only when that parser yields exact relative millisecond times and
 * plain text, and agrees with an SRT round-trip. Any parser failure or text
 * mismatch hides the download rather than falling back to divergent logic.
 */
export function srtForClipVtt(vtt: string | null, durationMs: number): string | null {
  if (!vtt || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
  let cues: ImportedCue[], srt: string, check: ImportedCue[];
  try {
    cues = parseCaptionFile(vtt, 0, durationMs);
    if (!cues.length) return null;
    srt = serializeSrt(cues);
    check = parseCaptionFile(srt, 0, durationMs);
  } catch {
    return null;
  }
  if (check.length !== cues.length) return null;
  for (let i = 0; i < cues.length; i++) {
    const source = cues[i]!, roundTrip = check[i]!;
    if (source.startMs !== roundTrip.startMs || source.endMs !== roundTrip.endMs || source.text !== roundTrip.text || source.speaker !== roundTrip.speaker) return null;
  }
  return srt;
}
