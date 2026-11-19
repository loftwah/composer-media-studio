import type { CompletedClip } from "./clip-receipt";

export type ReceiptSourceProof = Readonly<{
  duration: number;
  maxSeconds: number;
  sourceBytes: number;
  sourceSha256: string;
}>;

export const MAX_RECEIPT_BYTES = 16 * 1024;

const SCHEMA = "media-studio/video-clip-receipt";
const VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
const frames = ["portrait", "landscape", "square"] as const;
const qualities = ["standard", "hd"] as const;
const fits = ["cover", "contain"] as const;

const fail: (message: string) => never = message => { throw new Error(message); };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

/**
 * Validate a v1 receipt against the already-accepted source and local decoded
 * duration. Returns only the editable settings, or throws a visitor-facing
 * reason. Everything else in the receipt (output digests, captions, Watch URL)
 * stays inert data.
 */
export function parseClipReceipt(text: string, proof: ReceiptSourceProof): CompletedClip["edit"] {
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
  const { startSeconds, endSeconds, frame, quality, fit, muteRequested } = edit;
  if (typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > duration)
    fail("The receipt's start is outside this video.");
  if (typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > duration)
    fail("The receipt's end is outside this video.");
  if (endSeconds - startSeconds > maxSeconds) fail("The receipt's clip is longer than 60 seconds.");
  if (!oneOf(frame, frames)) fail("The receipt uses an unsupported frame.");
  if (!oneOf(quality, qualities)) fail("The receipt uses an unsupported quality.");
  if (!oneOf(fit, fits)) fail("The receipt uses an unsupported fit.");
  if (typeof muteRequested !== "boolean") fail("The receipt has an invalid mute setting.");

  return { startSeconds, endSeconds, frame, quality, fit, muteRequested };
}
