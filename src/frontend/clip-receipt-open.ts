import type { CompletedClip } from "./clip-receipt";
import { MAX_CAPTION_OFFSET_SECONDS } from "./clip-captions.ts";

export type ReceiptSourceProof = Readonly<{
  duration: number;
  maxSeconds: number;
  sourceBytes: number;
  sourceSha256: string;
}>;

// Caption timing is a separate, optional restore: it can only be applied when
// the receipt proves which exact caption file the offset belongs to.
export type ClipReceiptCaptions = Readonly<{ sourceSha256: string; offsetMs: number }>;
export type ClipReceiptRestore = Readonly<{
  edit: CompletedClip["edit"];
  captions?: ClipReceiptCaptions;
}>;

export const MAX_RECEIPT_BYTES = 16 * 1024;

const SCHEMA = "media-studio/video-clip-receipt";
const VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
const frames = ["portrait", "landscape", "square"] as const;
const qualities = ["standard", "hd"] as const;
const fits = ["cover", "contain"] as const;
const cropAnchors = ["topLeft", "bottomRight"] as const;

const fail: (message: string) => never = message => { throw new Error(message); };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

/**
 * Validate a v1 receipt against the already-accepted source and local decoded
 * duration. Returns the editable visual settings and, only when the receipt
 * carries a valid caption hash and bounded offset, a separate caption-only
 * setting. Old receipts without that supplementary data still restore trim and
 * frame. Everything else (output digests, cue text, Watch URL) stays inert.
 */
export function parseClipReceipt(text: string, proof: ReceiptSourceProof): ClipReceiptRestore {
  const { duration, maxSeconds, sourceBytes, sourceSha256 } = proof;
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_RECEIPT_BYTES)
    fail(`Choose a Clip receipt JSON file under ${MAX_RECEIPT_BYTES / 1024} KB.`);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(maxSeconds) || maxSeconds <= 0)
    fail("This video has no usable duration to restore against.");

  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("That receipt is not valid JSON."); }
  if (!record(value)) fail("That is not a Clip receipt v1.");
  const parsed = value;
  if (parsed.schema !== SCHEMA || parsed.version !== VERSION) fail("That is not a Clip receipt v1.");

  const source = parsed.source;
  if (!record(source) || typeof source.bytes !== "number" || !Number.isSafeInteger(source.bytes) || source.bytes <= 0)
    fail("The receipt has no valid source description.");
  if (source.bytes !== sourceBytes) fail("This receipt is for different source bytes. Your current video is unchanged.");
  if (typeof source.sha256 !== "string" || !SHA256.test(source.sha256) || source.sha256 !== sourceSha256)
    fail("This receipt is for a different source. Your current video is unchanged.");

  const edit = parsed.edit;
  if (!record(edit)) fail("The receipt has no editable settings.");
  const { startSeconds, endSeconds, frame, quality, fit, cropAnchor, muteRequested } = edit;
  if (typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > duration)
    fail("The receipt's start is outside this video.");
  if (typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > duration)
    fail("The receipt's end is outside this video.");
  if (endSeconds - startSeconds > maxSeconds) fail("The receipt's clip is longer than 60 seconds.");
  if (!oneOf(frame, frames)) fail("The receipt uses an unsupported frame.");
  if (!oneOf(quality, qualities)) fail("The receipt uses an unsupported quality.");
  if (!oneOf(fit, fits)) fail("The receipt uses an unsupported fit.");
  if (typeof muteRequested !== "boolean") fail("The receipt has an invalid mute setting.");
  if (cropAnchor !== undefined && !oneOf(cropAnchor, cropAnchors)) fail("The receipt uses an unsupported crop position.");

  // Supplementary caption data is optional and inert unless both parts are
  // valid. A missing or malformed hash/offset never supplies a setting to the
  // caller, so it cannot quietly change the captions already on this device.
  let captions: ClipReceiptCaptions | undefined;
  const savedCaptions = parsed.captions;
  if (record(savedCaptions)) {
    const { sourceSha256: captionSha256, offsetMs } = savedCaptions;
    if (typeof captionSha256 === "string" && SHA256.test(captionSha256)
      && (offsetMs === undefined || (typeof offsetMs === "number" && Number.isSafeInteger(offsetMs) && Math.abs(offsetMs) <= MAX_CAPTION_OFFSET_SECONDS * 1000)))
      captions = { sourceSha256: captionSha256, offsetMs: offsetMs ?? 0 };
  }

  return {
    edit: {
      startSeconds, endSeconds, frame, quality, fit, muteRequested,
      ...(cropAnchor !== undefined ? { cropAnchor } : {}),
    },
    ...(captions ? { captions } : {}),
  };
}
