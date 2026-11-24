import { parseCaptionFile, type ImportedCue } from "./caption-import.ts";
import { MAX_CAPTION_BYTES, MAX_CAPTION_OFFSET_SECONDS } from "./clip-captions.ts";
import { fullSourceCaptionDownload } from "./clip-full-source-captions.ts";
import { manualCaptionTrackVtt } from "./clip-manual-cue.ts";
import { MAX_PUBLIC_VIDEO_SOURCE_SECONDS } from "./video-clip-source.ts";

// One small JSON sidecar for the editable caption draft. It carries the exact
// original-video fingerprint, the canonical full-source WebVTT (every cue at
// its original time, never shifted) and the selected timing offset. No media,
// receipt, trim or framing data belongs in this file.
export const CAPTION_DRAFT_SCHEMA = "media-studio/video-clip-caption-draft";
export const CAPTION_DRAFT_VERSION = 1;
// A 64 KB VTT whose text is mostly quotes or backslashes can grow past 64 KB
// once JSON-escaped. Keep the whole sidecar small while still leaving room for
// the exact canonical track.
export const MAX_CAPTION_DRAFT_BYTES = 128 * 1024;

export type CaptionDraftSource = Readonly<{ bytes: number; sha256: string }>;
export type CaptionDraftRestore = Readonly<{ cues: ImportedCue[]; offsetMs: number }>;
export type CaptionDraftSave =
  | Readonly<{ text: string; bytes: number }>
  | Readonly<{ problem: string }>;

const SHA256 = /^[0-9a-f]{64}$/;
const fail: (message: string) => never = message => { throw new Error(message); };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validSource = (value: CaptionDraftSource): boolean =>
  Number.isSafeInteger(value.bytes) && value.bytes > 0 && SHA256.test(value.sha256);
const validOffset = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value)
  && Math.abs(value) <= MAX_CAPTION_OFFSET_SECONDS * 1000;
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Build the v1 caption draft JSON for an already-verified original video. The
 * full-source VTT comes from the same canonical formatter and bounds as Save
 * full-source caption draft, so the payload re-imports as exactly these cues.
 * A problem is returned instead of a file when there are no cues, the source
 * fingerprint is unusable, the offset is outside the advertised bound or the
 * canonical WebVTT cannot be saved.
 */
export function captionDraftFileText(
  source: CaptionDraftSource,
  cues: readonly ImportedCue[],
  offsetMs: number,
): CaptionDraftSave {
  if (!validSource(source)) return { problem: "This video has no usable fingerprint for a caption draft." };
  if (!validOffset(offsetMs))
    return { problem: `Keep the timing offset between −${MAX_CAPTION_OFFSET_SECONDS} and ${MAX_CAPTION_OFFSET_SECONDS} seconds in whole milliseconds.` };
  const full = fullSourceCaptionDownload(cues);
  if (!full) return { problem: "There are no caption cues to save in a draft." };
  if ("problem" in full) return full;
  const text = JSON.stringify({
    schema: CAPTION_DRAFT_SCHEMA,
    version: CAPTION_DRAFT_VERSION,
    source: { bytes: source.bytes, sha256: source.sha256 },
    captions: { offsetMs, vtt: full.vtt },
  }, null, 2) + "\n";
  const bytes = utf8Bytes(text);
  if (bytes > MAX_CAPTION_DRAFT_BYTES)
    return { problem: `This caption draft is ${Math.ceil(bytes / 1024)} KB, over the ${MAX_CAPTION_DRAFT_BYTES / 1024} KB draft limit. Remove cues or shorten their text.` };
  return { text, bytes };
}

/**
 * Read a v1 caption draft only against the exact original video already chosen
 * in this tab. The proof must be the SHA-256 and byte length of that file's
 * current bytes. Schema, version, size, field, fingerprint and WebVTT failures
 * all throw before any cue or offset is returned, so a caller can keep its
 * working cues and offset untouched. The VTT must be the canonical full-source
 * form and re-import through the same 64 KB and three-minute Choose captions
 * bounds.
 */
export function parseCaptionDraftFile(text: string, proof: CaptionDraftSource): CaptionDraftRestore {
  if (typeof text !== "string" || utf8Bytes(text) > MAX_CAPTION_DRAFT_BYTES)
    fail(`Choose a Video Clip caption draft JSON file under ${MAX_CAPTION_DRAFT_BYTES / 1024} KB.`);
  if (!validSource(proof)) fail("This video has no usable fingerprint to check the caption draft against.");

  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("That caption draft is not valid JSON."); }
  if (!record(value)) fail("That is not a Video Clip caption draft v1.");
  if (value.schema !== CAPTION_DRAFT_SCHEMA || value.version !== CAPTION_DRAFT_VERSION)
    fail("That is not a Video Clip caption draft v1.");

  const source = value.source;
  if (!record(source) || typeof source.bytes !== "number" || !Number.isSafeInteger(source.bytes) || source.bytes <= 0)
    fail("The caption draft has no valid source description.");
  if (source.bytes !== proof.bytes)
    fail("This caption draft is for different source bytes. Your caption cues and timing offset are unchanged.");
  if (typeof source.sha256 !== "string" || !SHA256.test(source.sha256) || source.sha256 !== proof.sha256)
    fail("This caption draft is for a different video. Your caption cues and timing offset are unchanged.");

  const captions = value.captions;
  if (!record(captions)) fail("The caption draft has no editable captions.");
  const { offsetMs, vtt } = captions;
  if (!validOffset(offsetMs))
    fail(`The caption draft's timing offset must be a whole number of milliseconds between −${MAX_CAPTION_OFFSET_SECONDS} and ${MAX_CAPTION_OFFSET_SECONDS} seconds.`);
  if (typeof vtt !== "string" || !vtt.length)
    fail("The caption draft has no caption file to restore.");
  if (vtt.length > MAX_CAPTION_BYTES || utf8Bytes(vtt) > MAX_CAPTION_BYTES)
    fail(`The caption draft's caption file is over the ${MAX_CAPTION_BYTES / 1024} KB import limit.`);

  let cues: ImportedCue[];
  try {
    cues = parseCaptionFile(vtt, 0, MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000, { voices: true });
  } catch {
    return fail("The caption draft's caption file is not valid SRT or WebVTT within the import bounds.");
  }
  if (!cues.length) fail("The caption draft has no caption cues to restore.");
  if (manualCaptionTrackVtt(cues) !== vtt)
    fail("The caption draft's caption file is not the canonical full-source WebVTT. Your caption cues and timing offset are unchanged.");
  return { cues, offsetMs };
}
