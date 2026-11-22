// MIT. Strict TypeScript media sniffing read from the bytes themselves, with
// no storage, network or DOM access. util.mjs re-exports these same names so
// the original import paths keep working.

/** The kind a sniffed payload resolves to, or null when nothing matched. */
export type SniffedMediaKind = "image" | "audio" | "video" | null;

export interface SniffedMedia {
  mime: string;
  kind: SniffedMediaKind;
}

/** Read the media type from magic bytes rather than the declared label. */
export function sniffMedia(bytes: Uint8Array, declaredMime?: string): SniffedMedia {
  const head = bytes.slice(0, 16);
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...head.slice(start, end));
  if (head[0] === 0xff && head[1] === 0xd8) return { mime: "image/jpeg", kind: "image" };
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { mime: "audio/wav", kind: "audio" };
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return { mime: "audio/mpeg", kind: "audio" };
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg", kind: "audio" };
  if (ascii(4, 8) === "ftyp") {
    // ISO base media brands include HEIC/HEIF still images. Reading only the
    // major brand let those files fall through to video/mp4, which was wrong.
    const brands: string[] = [];
    const declaredSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const end = Math.min(bytes.length, declaredSize >= 8 ? declaredSize : 64, 128);
    for (let offset = 8; offset + 4 <= end && brands.length < 32; offset += 4)
      brands.push(String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]));
    if (brands.some((brand) => brand === "avif" || brand === "avis")) return { mime: "image/avif", kind: "image" };
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)))
      return { mime: "image/heic", kind: "image" };
    if (brands.some((brand) => ["heif", "mif1", "msf1"].includes(brand)))
      return { mime: "image/heif", kind: "image" };
    if (brands.some((brand) => ["M4A ", "M4B ", "M4P ", "F4A "].includes(brand)))
      return { mime: "audio/mp4", kind: "audio" };
    return { mime: "video/mp4", kind: "video" };
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return { mime: "video/webm", kind: "video" };
  return { mime: declaredMime || "application/octet-stream", kind: null };
}

/** Storage key extension for a sniffed or declared MIME type. */
export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    default:
      return "bin";
  }
}
