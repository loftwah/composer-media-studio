// Darkroom originals may contain provider metadata. Allow only known image
// structures on public routes and serve the exact inspected bytes.
import { HttpError, safeJson, sha256Hex } from "./util.mjs";

// Narrow structural seams. Only the binding members and row/asset fields this
// module actually touches are described: no Cloudflare types are imported, and
// every annotation here is erased at runtime. Callers keep passing the same
// Worker env and asset rows they always did.
interface PrivacyStatement {
  bind(...values: unknown[]): {
    first<Row>(): Promise<Row | null>;
  };
}

interface PrivacyObject {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PublicImageEnv {
  DB: { prepare(query: string): PrivacyStatement };
  MEDIA: { get(key: string): Promise<PrivacyObject | null> };
}

/** The asset columns the public-image check reads. */
export interface PublicImageAsset {
  kind: string;
  generation_id?: string | null;
  project_id: string;
  r2_key: string;
  mime: string;
  bytes: number;
  sha256: string;
}

interface PrivacyGeneration {
  request_json?: string | null;
}

const maxBytes = 32 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const jpegCodingMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xda, 0xdb, 0xdd]);

function tag(bytes: Uint8Array, offset: number, length = 4): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isPngColorSetting(
  bytes: Uint8Array,
  view: DataView,
  type: string,
  offset: number,
  length: number,
): boolean {
  if (type === "sRGB") return length === 1 && bytes[offset] <= 3;
  if (type === "gAMA") return length === 4 && view.getUint32(offset) <= 1_000_000;
  if (type === "pHYs") {
    return length === 9 && bytes[offset + 8] <= 1 &&
      view.getUint32(offset) <= 1_000_000 && view.getUint32(offset + 4) <= 1_000_000;
  }
  if (type === "cHRM" && length === 32) {
    for (let index = offset; index < offset + length; index += 4) {
      if (view.getUint32(index) > 100_000) return false;
    }
    return true;
  }
  return false;
}

function pngHasOnlyImageChunks(bytes: Uint8Array, view: DataView): boolean {
  if (!pngSignature.every((byte, index) => bytes[index] === byte)) return false;
  let offset = 8;
  let hasImage = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = tag(bytes, offset + 4);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return false;
    } else if (type === "IEND") {
      return hasImage && length === 0 && end === bytes.length;
    } else if (type === "IDAT") {
      hasImage ||= length > 0;
    } else if (type === "PLTE") {
      if (length < 3 || length > 768 || length % 3 !== 0) return false;
    } else if (type === "tRNS") {
      if (length < 1 || length > 256) return false;
    } else if (!isPngColorSetting(bytes, view, type, offset + 8, length)) {
      return false;
    }
    offset = end;
  }
  return false;
}

function jpegHasOnlyImageSegments(bytes: Uint8Array, view: DataView): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let scanning = false;
  let hasScan = false;
  while (offset + 1 < bytes.length) {
    if (scanning && bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9) return hasScan && offset === bytes.length;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    const payload = offset + 2;
    const jfif = marker === 0xe0 && length === 16 && tag(bytes, payload, 5) === "JFIF\0" &&
      bytes[payload + 12] === 0 && bytes[payload + 13] === 0;
    const adobe = marker === 0xee && length === 14 && tag(bytes, payload, 5) === "Adobe";
    if (!jpegCodingMarkers.has(marker) && !jfif && !adobe) return false;
    scanning = marker === 0xda;
    hasScan ||= scanning;
    offset += length;
  }
  return false;
}

function webpHasOnlyImageChunks(bytes: Uint8Array, view: DataView): boolean {
  if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== bytes.length) return false;
  let offset = 12;
  let hasImage = false;
  let alphaAllowed = false;
  let hasAlphaChunk = false;
  while (offset + 8 <= bytes.length) {
    const type = tag(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    const end = payload + length + (length % 2);
    if (end > bytes.length || (length % 2 && bytes[end - 1] !== 0)) return false;
    if (type === "VP8 " || type === "VP8L") {
      if (hasImage || length === 0) return false;
      hasImage = true;
    } else if (type === "VP8X") {
      // The alpha flag is the only optional extended feature this policy admits.
      if (offset !== 12 || length !== 10 || (bytes[payload] & ~0x10) ||
          bytes[payload + 1] || bytes[payload + 2] || bytes[payload + 3]) return false;
      alphaAllowed = Boolean(bytes[payload] & 0x10);
    } else {
      if (type !== "ALPH" || !alphaAllowed || hasAlphaChunk || hasImage || length === 0) return false;
      hasAlphaChunk = true;
    }
    offset = end;
  }
  return hasImage && offset === bytes.length;
}

export function hasPublicImageStructure(bytes: Uint8Array, mime: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") return pngHasOnlyImageChunks(bytes, view);
  if (mime === "image/jpeg") return jpegHasOnlyImageSegments(bytes, view);
  if (mime === "image/webp") return webpHasOnlyImageChunks(bytes, view);
  return false;
}

/** Return inspected Darkroom bytes, or null for an asset outside this policy. */
export async function checkPublicImage(
  env: PublicImageEnv,
  asset: PublicImageAsset,
  requestJson?: string | null,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (asset.kind !== "image" || !asset.generation_id) return null;
  if (requestJson === undefined) {
    const generation = await env.DB.prepare("SELECT request_json FROM generations WHERE id=?1 AND project_id=?2")
      .bind(asset.generation_id, asset.project_id).first<PrivacyGeneration>();
    requestJson = generation?.request_json;
  }
  if (typeof safeJson<{ darkroomVersion?: unknown }>(requestJson as string, {})?.darkroomVersion !== "string") return null;
  const blocked = () => new HttpError(409, "Studio could not verify this original for public sharing. Its private copy is unchanged.", "publication_metadata_unverified");
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > maxBytes) throw blocked();
  const original = await env.MEDIA.get(asset.r2_key);
  if (!original || original.size !== asset.bytes) throw blocked();
  const bytes = new Uint8Array(await original.arrayBuffer());
  if (bytes.length !== asset.bytes || !hasPublicImageStructure(bytes, asset.mime) ||
      await sha256Hex(bytes) !== asset.sha256) throw blocked();
  return bytes;
}
