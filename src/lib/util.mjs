// MIT. Small, dependency-free helpers shared by the worker, job engine and tests.

export const now = () => Date.now();

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function slug(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function problem(message, status = 400, code = "invalid_request") {
  return json({ error: { code, message } }, status);
}

export function text(value, max, label, { required = true } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text`);
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .trim();
  if (required && !clean) throw new HttpError(400, `${label} is required`);
  if (clean.length > max)
    throw new HttpError(400, `${label} must be ${max} characters or fewer`);
  return clean;
}

export class HttpError extends Error {
  constructor(status, message, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1)
    diff |= left[index] ^ right[index];
  return diff === 0;
}

/** Decode PNG/JPEG/WebP dimensions without trusting the client. */
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20), format: "png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          format: "jpeg",
        };
      }
      offset += 2 + length;
    }
    return { width: null, height: null, format: "jpeg" };
  }
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height, format: "webp" };
    }
    if (chunk === "VP8L") {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        format: "webp",
      };
    }
    if (chunk === "VP8 ") {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
        format: "webp",
      };
    }
  }
  return { width: null, height: null, format: null };
}

/** Best-effort MP4 duration and display dimensions from mvhd/tkhd boxes. */
export function videoInfo(bytes) {
  let durationMs = null;
  let width = null;
  let height = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  const readBoxes = (start, end, depth = 0) => {
    if (depth > 3) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = ascii(offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return;

      if (type === "moov" || type === "trak" || type === "mdia") {
        readBoxes(offset + header, offset + size, depth + 1);
      }
      if (type === "mvhd" && durationMs === null) {
        const version = bytes[offset + header];
        const base = offset + header + 4;
        if (base + (version === 1 ? 32 : 20) <= end) {
          const timescale = version === 1 ? view.getUint32(base + 16) : view.getUint32(base + 8);
          const duration = version === 1 ? Number(view.getBigUint64(base + 20)) : view.getUint32(base + 12);
          if (timescale > 0 && Number.isFinite(duration))
            durationMs = Math.round((duration / timescale) * 1000);
        }
      }
      if (type === "tkhd" && width === null) {
        const version = bytes[offset + header];
        const payload = offset + header;
        const widthOffset = version === 1 ? 88 : 76;
        const heightOffset = widthOffset + 4;
        if (payload + heightOffset + 4 <= end) {
          const w = view.getUint32(payload + widthOffset) / 65536;
          const h = view.getUint32(payload + heightOffset) / 65536;
          if (w >= 16 && h >= 16) {
            width = Math.round(w);
            height = Math.round(h);
          }
        }
      }
      offset += size;
    }
  };

  readBoxes(0, bytes.length);
  return { durationMs, width, height };
}

/** WAV, MP3 and MP4-family audio, read from the bytes rather than the label. */
export function audioInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length = 4) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    let offset = 12;
    let channels = null;
    let sampleRate = null;
    let byteRate = null;
    let durationMs = null;
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (chunk === "fmt " && start + 16 <= bytes.length) {
        channels = view.getUint16(start + 2, true) || null;
        sampleRate = view.getUint32(start + 4, true) || null;
        byteRate = view.getUint32(start + 8, true) || null;
      }
      if (chunk === "data") {
        const dataSize = Math.min(size, bytes.length - start);
        if (byteRate) durationMs = Math.round((dataSize / byteRate) * 1000);
      }
      offset = start + size + (size % 2);
    }
    return { durationMs, sampleRate, channels, format: "wav" };
  }

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return readMp3(bytes, view, Math.min(10 + size, bytes.length));
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return readMp3(bytes, view, 0);

  if (ascii(4, 4) === "ftyp") {
    const duration = videoInfo(bytes).durationMs;
    return { durationMs: duration, sampleRate: null, channels: null, format: "m4a" };
  }

  return { durationMs: null, sampleRate: null, channels: null, format: null };
}

function readMp3(bytes, view, start) {
  let offset = start;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (bytes[offset + 1] >> 3) & 0x03;
    const layerBits = (bytes[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const padding = (bytes[offset + 2] >> 1) & 0x01;
    const mode = (bytes[offset + 3] >> 6) & 0x03;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      offset += 1;
      continue;
    }
    const mpeg1 = versionBits === 3;
    const bitrates = mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const rates = mpeg1
      ? [44100, 48000, 32000]
      : versionBits === 2
        ? [22050, 24000, 16000]
        : [11025, 12000, 8000];
    const bitrateKbps = bitrates[bitrateIndex];
    const sampleRate = rates[rateIndex];
    const samplesPerFrame = mpeg1 ? 1152 : 576;
    const frameLength = Math.floor((samplesPerFrame / 8) * ((bitrateKbps * 1000) / sampleRate)) + padding;

    // A Xing/Info header carries the real frame count, so a VBR file is not
    // misreported as its first frame's bitrate.
    const xingOffset = offset + 4 + (mpeg1 ? (mode === 3 ? 17 : 32) : mode === 3 ? 9 : 17);
    const tag = String.fromCharCode(...bytes.slice(xingOffset, xingOffset + 4));
    if (tag === "Xing" || tag === "Info") {
      const flags = view.getUint32(xingOffset + 4);
      if (flags & 0x0001) {
        const frames = view.getUint32(xingOffset + 8);
        return {
          durationMs: Math.round((frames * samplesPerFrame * 1000) / sampleRate),
          sampleRate,
          channels: mode === 3 ? 1 : 2,
          format: "mp3",
        };
      }
    }
    const audioBytes = Math.max(0, bytes.length - offset);
    return {
      durationMs: Math.round((audioBytes * 8 * 1000) / (bitrateKbps * 1000)),
      sampleRate,
      channels: mode === 3 ? 1 : 2,
      format: "mp3",
    };
  }
  return { durationMs: null, sampleRate: null, channels: null, format: null };
}

export function sniffMedia(bytes, declaredMime) {
  const head = bytes.slice(0, 16);
  const ascii = (start, end) => String.fromCharCode(...head.slice(start, end));
  if (head[0] === 0xff && head[1] === 0xd8) return { mime: "image/jpeg", kind: "image" };
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { mime: "audio/wav", kind: "audio" };
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return { mime: "audio/mpeg", kind: "audio" };
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg", kind: "audio" };
  if (ascii(4, 8) === "ftyp") {
    // ISO base media brands include HEIC/HEIF still images. Reading only the
    // major brand let those files fall through to video/mp4, which was wrong.
    const brands = [];
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

export function extensionFor(mime) {
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

export function periodKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function money(micro) {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return constantTimeEqual(a, b);
}
