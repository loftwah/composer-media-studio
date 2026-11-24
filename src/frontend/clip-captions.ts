import { parseCaptionFile, type CaptionImportOptions, type ImportedCue } from "./caption-import.ts";
import { normalizeSpeaker } from "./caption-speaker.ts";

export const MAX_CAPTION_BYTES = 64 * 1024;
// A timing offset may move imported cues at most a minute earlier or later.
export const MAX_CAPTION_OFFSET_SECONDS = 60;
// Browser-only preview track. `local` marks an authored/mixed draft so the
// finished preview can say "Captions" instead of "Imported captions"; it is
// never part of a saved or exported receipt.
export type ClipCaptionTrack = Readonly<{ url: string; english: boolean; local?: true }>;

/**
 * Preview-only cue placement on the original video. No download, trim, source
 * cue, snapshot, receipt or MP4 export reads this. The default emits the exact
 * bytes the preview has always used; "top" adds the W3C WebVTT line cue setting
 * at a fixed safe percentage so captions clear the lower frame.
 * https://www.w3.org/TR/webvtt1/#webvtt-line-cue-setting
 */
export type CaptionPreviewPlacement = "default" | "top";
const TOP_PREVIEW_CUE_SETTING = " line:12%";

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

type ClippedCaptionCue = Readonly<{ from: number; to: number; sourceStartMs: number; text: string; speaker: string; sourceIndex: number }>;

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
    kept.push({ from: from - start, to: to - start, sourceStartMs: from, text: cue.text, speaker: cue.speaker, sourceIndex });
  }
  return kept;
}

// The All source cues projection: every stored cue at its unshifted
// original-video time, keyed by its stable position in the draft. It applies no
// trim, clamp, rebase or timing offset, so a row can name and change a cue the
// current trim does not intersect. sourceIndex is the same identity the trimmed
// projection and the existing Edit and Remove actions use.
export type SourceCaptionCue = Readonly<{ startMs: number; endMs: number; text: string; speaker: string; sourceIndex: number }>;

export function sourceCaptionCues(cues: readonly ImportedCue[]): SourceCaptionCue[] {
  return cues.map((cue, sourceIndex) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text, speaker: cue.speaker, sourceIndex }));
}

const escapeVtt = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function serializeClipCaptions(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number, offsetMs = 0, placement: CaptionPreviewPlacement = "default", options: CaptionImportOptions = {}) {
  const kept = clipCaptionCues(cues, startSeconds, endSeconds, offsetMs);
  if (!kept) return null;
  // Only the original-video preview passes a placement; every other caller
  // takes the default and keeps byte-identical output. Text escaping stays in
  // this one serializer so placement cannot change cue content. Voice
  // annotations are opt-in for Video Clip; unnamed cues keep their prior bytes.
  const setting = placement === "top" ? TOP_PREVIEW_CUE_SETTING : "";
  const blocks: string[] = [];
  for (const { from, to, text, speaker } of kept) {
    const plain = escapeVtt(text);
    let body = plain;
    if (options.voices === true && speaker) {
      // The same name bound the importer and manual form enforce. An invalid
      // name makes the whole track unrepresentable rather than silently
      // dropping the speaker or emitting an annotation that cannot re-import.
      const name = normalizeSpeaker(speaker);
      if (name === null) return null;
      if (name) body = `<v ${escapeVtt(name)}>${plain}</v>`;
    }
    blocks.push(`${clipTimeStamp(from)} --> ${clipTimeStamp(to)}${setting}\n${body}`);
  }
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
 * Placement changes cue settings only; times, text and escaping are shared.
 */
export function sourcePreviewVtt(cues: readonly ImportedCue[], durationSeconds: number, offsetMs: number | null, placement: CaptionPreviewPlacement = "default", options: CaptionImportOptions = {}): string | null {
  if (offsetMs === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return serializeClipCaptions(cues, 0, durationSeconds, offsetMs, placement, options);
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
const srtLine = (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The speaker-name-as-text variant keeps the same timeline and folds the name
// into the cue line. An unnamed cue keeps its exact prior text.
const srtCueText = (cue: ImportedCue, speakerText: boolean) =>
  speakerText && cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;

function serializeSrt(cues: readonly ImportedCue[], speakerText = false) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(cue.endMs)}\n${srtLine(srtCueText(cue, speakerText))}\n`)
    .join("\n");
}

// Re-read the exact candidate through the same bounded importer and compare
// relative times and the text the cue is meant to carry. A folded speaker name
// can make a line too long for the 300-character cue bound or push the sidecar
// over 64 KiB as multibyte text; either failure withholds this SRT only.
function srtFromCues(cues: readonly ImportedCue[], durationMs: number, speakerText: boolean): string | null {
  const srt = serializeSrt(cues, speakerText);
  if (speakerText && new TextEncoder().encode(srt).byteLength > MAX_CAPTION_BYTES) return null;
  let check: ImportedCue[];
  try {
    check = parseCaptionFile(srt, 0, durationMs);
  } catch {
    return null;
  }
  if (check.length !== cues.length) return null;
  for (let i = 0; i < cues.length; i++) {
    const source = cues[i]!, roundTrip = check[i]!;
    if (source.startMs !== roundTrip.startMs || source.endMs !== roundTrip.endMs
      || srtCueText(source, speakerText) !== roundTrip.text || roundTrip.speaker !== "") return null;
  }
  return srt;
}

export type ClipCaptionSrtVariants = Readonly<{
  // The unnamed-only SRT every earlier caller has always received.
  plain: string | null;
  // A speaker-name-as-text SRT, only when the VTT actually names a cue.
  speakerText: string | null;
  // True when the parsed VTT names at least one cue, even if the speaker-text
  // SRT cannot be represented (for example a combined line over 300 characters).
  named: boolean;
}>;

/**
 * Parse one canonical VTT once and derive both optional SRT sidecars. The same
 * bounded importer used for caption upload re-reads that VTT at zero offset;
 * both candidates then go back through it. A download is exposed only when the
 * parser yields exact relative millisecond times and the expected plain text.
 * The plain candidate withholds every named cue, preserving the earlier
 * stricter meaning, while the speaker-text candidate folds each name into the
 * cue line. Any parser failure or text mismatch hides that candidate rather
 * than falling back to divergent logic.
 */
export function clipCaptionSrtVariants(vtt: string | null, durationMs: number): ClipCaptionSrtVariants | null {
  if (!vtt || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
  let cues: ImportedCue[];
  try {
    cues = parseCaptionFile(vtt, 0, durationMs, { voices: true });
  } catch {
    return null;
  }
  if (!cues.length) return null;
  const named = cues.some(cue => cue.speaker);
  return {
    named,
    plain: named ? null : srtFromCues(cues, durationMs, false),
    speakerText: named ? srtFromCues(cues, durationMs, true) : null,
  };
}

export type ClipSrtOptions = Readonly<{ speakerText?: boolean }>;

/**
 * Derive an optional SRT sidecar from the exact trimmed WebVTT the receipt has
 * already prepared. The default is unchanged: SRT has no voice annotation, so a
 * named cue withholds the download instead of silently dropping its speaker.
 * Callers that deliberately want names as text can pass speakerText, which
 * returns the same plain export when no cue is named.
 */
export function srtForClipVtt(vtt: string | null, durationMs: number, options: ClipSrtOptions = {}): string | null {
  const variants = clipCaptionSrtVariants(vtt, durationMs);
  if (!variants) return null;
  if (options.speakerText === true) return variants.speakerText ?? variants.plain;
  return variants.plain;
}
