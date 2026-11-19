import { sha256Hex } from "../lib/util.mjs";
import { MAX_PUBLIC_VIDEO_BYTES } from "./video-clip-source.ts";

export const POSTER_RECEIPT_SCHEMA = "media-studio/clip-poster-receipt";
export const POSTER_RECEIPT_VERSION = 1;
const MAX_POSTER_RECEIPT_BYTES = 16 * 1024;
const MAX_POSTER_BYTES = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
}

function readDigest(value: unknown, max: number): Record<string, unknown> & { bytes: number; sha256: string } {
  if (!isRecord(value) || !isInteger(value.bytes, max) ||
      typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new Error("Choose the v1 poster receipt JSON from your saved kit.");
  }
  return { ...value, bytes: value.bytes, sha256: value.sha256 };
}

export async function verifyClipPosterFiles(receiptFile: File, clipFile: File, posterFile: File) {
  if (receiptFile.size === 0 || receiptFile.size > MAX_POSTER_RECEIPT_BYTES) {
    throw new Error("Choose a poster receipt JSON file under 16 KB.");
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(await receiptFile.text());
  } catch {
    throw new Error("This poster receipt could not be read. Choose the JSON from the saved kit.");
  }
  if (!isRecord(receipt) || receipt.schema !== POSTER_RECEIPT_SCHEMA || receipt.version !== POSTER_RECEIPT_VERSION) {
    throw new Error("Choose the v1 poster receipt JSON from your saved kit.");
  }
  const { capturedSeconds } = receipt;
  const clip = readDigest(receipt.clip, MAX_PUBLIC_VIDEO_BYTES);
  const poster = readDigest(receipt.poster, MAX_POSTER_BYTES);
  const { width, height } = poster;
  if (typeof capturedSeconds !== "number" || !Number.isFinite(capturedSeconds) ||
      capturedSeconds < 0 || capturedSeconds > 60 ||
      !isInteger(width, 1280) || !isInteger(height, 1280) || width * height > 1280 * 720) {
    throw new Error("The poster receipt has an unsupported capture time or image size.");
  }

  if (posterFile.size !== poster.bytes || posterFile.size < 24) {
    throw new Error("This PNG does not match the receipt. Choose the PNG from the poster kit.");
  }
  const png = new Uint8Array(await posterFile.arrayBuffer());
  const header = new DataView(png.buffer);
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte) ||
      header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== width || header.getUint32(20) !== height ||
      await sha256Hex(png) !== poster.sha256) {
    throw new Error("This PNG does not match the receipt. Choose the PNG from the poster kit.");
  }

  if (clipFile.size !== clip.bytes || clipFile.size < 12) {
    throw new Error("This MP4 does not match the receipt. Choose the finished clip saved with the kit.");
  }
  const mp4 = new Uint8Array(await clipFile.arrayBuffer());
  if (new DataView(mp4.buffer).getUint32(4) !== 0x66747970 || await sha256Hex(mp4) !== clip.sha256) {
    throw new Error("This MP4 does not match the receipt. Choose the finished clip saved with the kit.");
  }
  return { capturedSeconds, width, height };
}
