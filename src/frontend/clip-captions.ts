import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";

export const MAX_CAPTION_BYTES = 64 * 1024;
// A timing offset may move imported cues at most a minute earlier or later.
export const MAX_CAPTION_OFFSET_SECONDS = 60;
// Browser-only preview track. `local` marks an authored/mixed draft so the
// finished preview can say "Captions" instead of "Imported captions"; it is
// never part of a saved or exported receipt.
export type ClipCaptionTrack = Readonly<{ url: string; english: boolean; local?: true }>;

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

export function clipTimeStamp(ms: number) {
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

type ClippedCaptionCue = Readonly<{ from: number; to: number; sourceStartMs: number; text: string; sourceIndex: number }>;

// The shared projection for every trimmed-caption surface: serialization, the
// preflight count and the review list. Times are trim-relative milliseconds.
// offsetMs is applied to every cue before it is clipped and rebased to the
// selected range: positive moves cues later, negative earlier. The default of
// 0 leaves the original timing unchanged. sourceIndex is the cue's position in
// the draft, so a clamped or shifted review row can still name its own cue.
// null means these values cannot be projected at all; an empty array means
// valid values with no surviving cues.
export function clipCaptionCues(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number, offsetMs = 0): ClippedCaptionCue[] | null {
  const start = Math.round(startSeconds * 1000);
  const end = Math.round(endSeconds * 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > MAX_CAPTION_OFFSET_SECONDS * 1000) return null;
  const kept: ClippedCaptionCue[] = [];
  for (const [sourceIndex, cue] of cues.entries()) {
    const from = Math.max(cue.startMs + offsetMs, start), to = Math.min(cue.endMs + offsetMs, end);
    if (from >= to) continue;
    kept.push({ from: from - start, to: to - start, sourceStartMs: from, text: cue.text, sourceIndex });
  }
  return kept;
}

// The All source cues projection: every stored cue at its unshifted
// original-video time, keyed by its stable position in the draft. It applies no
// trim, clamp, rebase or timing offset, so a row can name and change a cue the
// current trim does not intersect. sourceIndex is the same identity the trimmed
// projection and the existing Edit and Remove actions use.
export type SourceCaptionCue = Readonly<{ startMs: number; endMs: number; text: string; sourceIndex: number }>;

export function sourceCaptionCues(cues: readonly ImportedCue[]): SourceCaptionCue[] {
  return cues.map((cue, sourceIndex) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text, sourceIndex }));
}

export function serializeClipCaptions(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number, offsetMs = 0) {
  const kept = clipCaptionCues(cues, startSeconds, endSeconds, offsetMs);
  if (!kept) return null;
  const blocks = kept.map(({ from, to, text }) => {
    const plain = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `${clipTimeStamp(from)} --> ${clipTimeStamp(to)}\n${plain}`;
  });
  return blocks.length ? `WEBVTT\n\n${blocks.join("\n\n")}\n` : null;
}

// Preflight count for the draft trim/offset. It reads the same projection the
// serializer uses, so a count of zero predicts the null VTT an export would get
// without a second clamp/filter pass or inspecting the emitted text.
export function survivingClipCaptionCount(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number, offsetMs = 0): number | null {
  return clipCaptionCues(cues, startSeconds, endSeconds, offsetMs)?.length ?? null;
}

/**
 * Native preview of imported captions on the untouched source. It reuses the
 * same serializer and offset projection as the export, but spans 0 through the
 * full source duration so a draft trim cannot hide cues here. An invalid or
 * missing offset yields no track rather than a preview the export would reject.
 */
export function sourcePreviewVtt(cues: readonly ImportedCue[], durationSeconds: number, offsetMs: number | null): string | null {
  if (offsetMs === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return serializeClipCaptions(cues, 0, durationSeconds, offsetMs);
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
