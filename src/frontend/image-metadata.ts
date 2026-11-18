// MIT. Honest, dependency-free metadata inspection and lossless stripping for
// the JPEG, PNG and WebP bytes this workbench accepts. Parsing is deliberately
// conservative: an unreadable EXIF block is reported as present, not as absent.

import { crc32 } from "./image-zip.ts";

export class ImageMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageMetadataError";
  }
}

export type ImageSniff = {
  mime: string | null;
  format: string | null;
  supported: boolean;
  activeContent: boolean;
  reason: string | null;
};

export type ExifSummary = {
  present: boolean;
  bytes: number;
  orientation: number | null;
  camera: { make: string | null; model: string | null } | null;
  gps: boolean;
  dateTime: string | null;
  entries: number;
  error: string | null;
};

export type MetadataFlag = { present: boolean; bytes: number };
export type TextMetadata = { present: boolean; count: number };
export type OtherMetadata = {
  present: boolean;
  count: number;
  labels: Array<{ label: string; count: number }>;
};

export type ImageMetadataSummary = {
  mime: string;
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  orientation: number;
  orientedWidth: number;
  orientedHeight: number;
  alpha: boolean;
  /** True when VP8X animation or ANIM/ANMF chunks were read from the source bytes. */
  webpAnimated: boolean;
  exif: ExifSummary;
  gps: boolean;
  camera: { make: string | null; model: string | null } | null;
  xmp: MetadataFlag;
  icc: MetadataFlag;
  text: TextMetadata;
  other: OtherMetadata;
  hasMetadata: boolean;
  notes: string[];
  bitDepth?: number;
  colorType?: number;
};

export type StripResult = {
  bytes: Uint8Array;
  format: "jpeg" | "png" | "webp";
  mime: string;
  before: ImageMetadataSummary;
  after: ImageMetadataSummary;
  removed: string[];
  changed: boolean;
  keptOrientation: boolean;
  warning: string | null;
  verified: {
    pixelsUnchanged: boolean;
    dimensionsMatch: boolean;
    metadataRemoved: boolean;
    all: boolean;
  };
};

// Internal, non-exported structure. The public ImageMetadataSummary above is
// unchanged; the parser results carry the byte ranges the lossless stripper
// needs. This is the only seam between inspection and rewriting.
type JpegSegment = {
  marker: number;
  markerStart: number;
  payloadStart: number;
  payloadEnd: number;
  end: number;
};
type Chunk = {
  type: string;
  chunkStart: number;
  dataStart: number;
  dataEnd: number;
  chunkEnd: number;
  length: number;
};
type JpegMetadata = ImageMetadataSummary & {
  format: "jpeg";
  scanStart: number;
  segments: JpegSegment[];
};
type PngMetadata = ImageMetadataSummary & {
  format: "png";
  chunks: Chunk[];
  trailing: number;
};
type WebpMetadata = ImageMetadataSummary & {
  format: "webp";
  chunks: Chunk[];
  trailing: number;
};
type InternalMetadata = JpegMetadata | PngMetadata | WebpMetadata;
type StripInternal = {
  bytes: Uint8Array;
  removed: string[];
  keptOrientation: boolean;
  pixelsUnchanged: boolean;
};
type IfdEntry = { tag: number; type: number; count: number; bytes: Uint8Array };
type JpegCategory =
  | "exif"
  | "xmp"
  | "other"
  | "icc"
  | "app0"
  | "adobe"
  | "comment"
  | "image";
type JpegClassification = { category: JpegCategory; label: string };

const SUPPORTED = new Set<string>(["image/jpeg", "image/png", "image/webp"]);
const WEBP_ANIM_FLAG = 0x02;
const HEIC_BRANDS = new Set<string>(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS = new Set<string>(["mif1", "msf1"]);
const MAX_IFD_ENTRIES = 512;
const MAX_TAG_BYTES = 1_000_000;

function textAscii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = "";
  for (let index = start; index < end; index += 1) out += String.fromCharCode(bytes[index]);
  return out;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}
function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function fail(message: string): never {
  throw new ImageMetadataError(message);
}

function assertBounds(bytes: Uint8Array, start: number, length: number, message: string): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > bytes.length)
    fail(message);
}

function decodeAscii(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) break;
    out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : " ";
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 160);
}

function brandsFrom(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || textAscii(bytes, 4, 8) !== "ftyp") return [];
  const declared = u32be(bytes, 0);
  const end = Math.min(bytes.length, declared >= 8 ? declared : bytes.length, 128);
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= end && brands.length < 32; offset += 4) brands.push(textAscii(bytes, offset, offset + 4));
  return brands;
}

/**
 * Sniff local bytes without trusting the browser's declared MIME.
 * SVG/HTML are reported as active content; HEIC/HEIF are reported honestly as
 * images this slice does not decode rather than being mistaken for video.
 */
export function sniffLocalImage(bytes: Uint8Array): ImageSniff {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4)
    return { mime: null, format: null, supported: false, activeContent: false, reason: "That file is empty or too short." };
  const head = textAscii(bytes, 0, Math.min(bytes.length, 512)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", format: "jpeg", supported: true, activeContent: false, reason: null };
  if (bytes[0] === 0x89 && textAscii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a)
    return { mime: "image/png", format: "png", supported: true, activeContent: false, reason: null };
  if (textAscii(bytes, 0, 4) === "RIFF" && textAscii(bytes, 8, 12) === "WEBP")
    return { mime: "image/webp", format: "webp", supported: true, activeContent: false, reason: null };
  if (textAscii(bytes, 0, 4) === "GIF8")
    return { mime: "image/gif", format: "gif", supported: false, activeContent: false, reason: "GIF is not decoded in this slice." };
  const brands = brandsFrom(bytes);
  if (brands.length) {
    if (brands.some((brand) => brand === "avif" || brand === "avis"))
      return { mime: "image/avif", format: "avif", supported: false, activeContent: false, reason: "AVIF is not enabled in this slice." };
    if (brands.some((brand) => HEIC_BRANDS.has(brand)))
      return { mime: "image/heic", format: "heic", supported: false, activeContent: false, reason: "HEIC is not decoded in this slice." };
    if (brands.some((brand) => HEIF_BRANDS.has(brand)))
      return { mime: "image/heif", format: "heif", supported: false, activeContent: false, reason: "HEIF is not decoded in this slice." };
  }
  if (/^(?:<\?xml[\s>]|\uFEFF?<svg[\s>])/.test(head) || /<svg[\s>]/.test(head))
    return { mime: "image/svg+xml", format: "svg", supported: false, activeContent: true, reason: "SVG can contain active content and is not opened here." };
  if (/^(?:<!doctype\s+html|<html[\s>])/.test(head) || /<script[\s>]/.test(head))
    return { mime: "text/html", format: "html", supported: false, activeContent: true, reason: "HTML is not opened as an image." };
  return { mime: null, format: null, supported: false, activeContent: false, reason: "This is not a JPEG, PNG or WebP image." };
}

function orientationSize(width: number, height: number, orientation: number): { width: number; height: number } {
  const swap = orientation >= 5 && orientation <= 8;
  return { width: swap ? height : width, height: swap ? width : height };
}

function emptyExif(present = true): ExifSummary {
  return {
    present,
    bytes: 0,
    orientation: null,
    camera: null,
    gps: false,
    dateTime: null,
    entries: 0,
    error: null,
  };
}

function typeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 0;
  }
}

function readIfd(tiff: Uint8Array, offset: number, little: boolean): IfdEntry[] {
  const read16 = (at: number): number => (little ? u16le(tiff, at) : u16be(tiff, at));
  const read32 = (at: number): number => (little ? u32le(tiff, at) : u32be(tiff, at));
  if (offset < 8 || offset + 2 > tiff.length) fail("EXIF IFD is outside the block.");
  const count = read16(offset);
  if (count > MAX_IFD_ENTRIES) fail("EXIF IFD has too many entries.");
  if (offset + 2 + count * 12 > tiff.length) fail("EXIF IFD is truncated.");
  const entries: IfdEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = offset + 2 + index * 12;
    const tag = read16(at);
    const type = read16(at + 2);
    const items = read32(at + 4);
    const slotSize = typeSize(type);
    const byteLength = slotSize ? slotSize * items : 0;
    if (!slotSize || items < 1 || byteLength > MAX_TAG_BYTES) {
      entries.push({ tag, type, count: items, bytes: new Uint8Array(0) });
      continue;
    }
    let valueOffset: number;
    if (byteLength <= 4) valueOffset = at + 8;
    else valueOffset = read32(at + 8);
    if (valueOffset < 0 || valueOffset + byteLength > tiff.length) fail("EXIF value is outside the block.");
    entries.push({ tag, type, count: items, bytes: tiff.subarray(valueOffset, valueOffset + byteLength) });
  }
  return entries;
}

function parseExifBytes(source: Uint8Array): ExifSummary {
  const result = emptyExif(true);
  try {
    let tiff = source;
    if (tiff.length >= 6 && textAscii(tiff, 0, 4) === "Exif") tiff = tiff.subarray(6);
    result.bytes = source.length;
    if (tiff.length < 8) throw new Error("short TIFF header");
    const little = tiff[0] === 0x49 && tiff[1] === 0x49;
    const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
    if (!little && !big) throw new Error("unknown TIFF byte order");
    const read16 = (at: number): number => (little ? u16le(tiff, at) : u16be(tiff, at));
    const read32 = (at: number): number => (little ? u32le(tiff, at) : u32be(tiff, at));
    if (read16(2) !== 42) throw new Error("not a TIFF header");
    const ifd0 = readIfd(tiff, read32(4), little);
    result.entries = ifd0.length;
    const byTag = new Map(ifd0.map((entry) => [entry.tag, entry]));
    const asciiTag = (tag: number): string => {
      const entry = byTag.get(tag);
      return entry ? decodeAscii(entry.bytes) : "";
    };
    const shortTag = (tag: number): number | null => {
      const entry = byTag.get(tag);
      if (!entry || entry.bytes.length < 2) return null;
      return little ? u16le(entry.bytes, 0) : u16be(entry.bytes, 0);
    };
    const make = asciiTag(0x010f);
    const model = asciiTag(0x0110);
    if (make || model) result.camera = { make: make || null, model: model || null };
    const orientation = shortTag(0x0112);
    if (orientation && orientation >= 1 && orientation <= 8) result.orientation = orientation;
    result.dateTime = asciiTag(0x0132) || null;

    const exifPointer = byTag.get(0x8769);
    if (exifPointer && exifPointer.bytes.length >= 4) {
      const exifOffset = little ? u32le(exifPointer.bytes, 0) : u32be(exifPointer.bytes, 0);
      const exifIfd = readIfd(tiff, exifOffset, little);
      const exifMap = new Map(exifIfd.map((entry) => [entry.tag, entry]));
      const original = exifMap.get(0x9003);
      if (original) result.dateTime = decodeAscii(original.bytes) || result.dateTime;
    }
    const gpsPointer = byTag.get(0x8825);
    if (gpsPointer && gpsPointer.bytes.length >= 4) {
      const gpsOffset = little ? u32le(gpsPointer.bytes, 0) : u32be(gpsPointer.bytes, 0);
      const gpsIfd = readIfd(tiff, gpsOffset, little);
      result.gps = gpsIfd.length > 0;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : "EXIF could not be read.";
  }
  return result;
}

function jpegSegments(bytes: Uint8Array): { segments: JpegSegment[]; scanStart: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("That JPEG has no start marker.");
  const segments: JpegSegment[] = [];
  let offset = 2;
  let scanStart: number | null = null;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) fail("That JPEG is malformed or truncated.");
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) fail("That JPEG ends inside a marker.");
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda) {
      scanStart = markerStart;
      break;
    }
    if (offset + 2 > bytes.length) fail("That JPEG ends inside a segment length.");
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) fail("That JPEG has a malformed segment length.");
    const payloadStart = offset + 2;
    const payloadEnd = offset + length;
    segments.push({ marker, markerStart, payloadStart, payloadEnd, end: payloadEnd });
    offset = payloadEnd;
  }
  if (scanStart === null) fail("That JPEG has no image scan.");
  return { segments, scanStart };
}

function classifyJpegSegment(bytes: Uint8Array, segment: JpegSegment): JpegClassification {
  const { marker, payloadStart, payloadEnd } = segment;
  const length = payloadEnd - payloadStart;
  if (marker >= 0xe0 && marker <= 0xef) {
    const app = marker - 0xe0;
    if (app === 1) {
      if (length >= 6 && textAscii(bytes, payloadStart, payloadStart + 4) === "Exif") return { category: "exif", label: "EXIF" };
      if (length >= 29 && textAscii(bytes, payloadStart, payloadStart + 28) === "http://ns.adobe.com/xap/1.0/")
        return { category: "xmp", label: "XMP" };
      return { category: "other", label: "APP1" };
    }
    if (app === 2 && length >= 12 && textAscii(bytes, payloadStart, payloadStart + 11) === "ICC_PROFILE")
      return { category: "icc", label: "ICC profile" };
    if (app === 0) return { category: "app0", label: "JFIF" };
    if (app === 14) return { category: "adobe", label: "Adobe APP14" };
    return { category: "other", label: `APP${app}` };
  }
  if (marker === 0xfe) return { category: "comment", label: "Comment" };
  return { category: "image", label: "image data" };
}

function inspectJpeg(bytes: Uint8Array): JpegMetadata {
  const { segments, scanStart } = jpegSegments(bytes);
  let width: number | null = null;
  let height: number | null = null;
  let exif = emptyExif(false);
  let xmp: MetadataFlag = { present: false, bytes: 0 };
  let icc: MetadataFlag = { present: false, bytes: 0 };
  let text: TextMetadata = { present: false, count: 0 };
  const other: string[] = [];
  let hasExif = false;
  let hasXmp = false;
  let hasIcc = false;
  for (const segment of segments) {
    const classification = classifyJpegSegment(bytes, segment);
    if (classification.category === "exif") {
      hasExif = true;
      if (!exif.present) exif = parseExifBytes(bytes.subarray(segment.payloadStart, segment.payloadEnd));
    } else if (classification.category === "xmp") {
      hasXmp = true;
      xmp = { present: true, bytes: xmp.bytes + segment.payloadEnd - segment.payloadStart };
    } else if (classification.category === "icc") {
      hasIcc = true;
      icc = { present: true, bytes: icc.bytes + segment.payloadEnd - segment.payloadStart };
    } else if (classification.category === "comment") {
      text = { present: true, count: text.count + 1 };
    } else if (classification.category === "other") {
      other.push(classification.label);
    }
    const sof = segment.marker >= 0xc0 && segment.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(segment.marker);
    if (sof && segment.payloadEnd - segment.payloadStart >= 5) {
      height = u16be(bytes, segment.payloadStart + 1);
      width = u16be(bytes, segment.payloadStart + 3);
    }
  }
  if (!width || !height) fail("That JPEG has no readable dimensions.");
  if (!hasExif) exif = emptyExif(false);
  const orientation = exif.orientation ?? 1;
  const oriented = orientationSize(width, height, orientation);
  const otherCounts = Object.entries(other.reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {}));
  return {
    mime: "image/jpeg",
    format: "jpeg",
    width,
    height,
    orientation,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    alpha: false,
    webpAnimated: false,
    exif,
    gps: exif.gps,
    camera: exif.camera,
    xmp,
    icc,
    text,
    other: {
      present: otherCounts.length > 0,
      count: otherCounts.reduce((total, [, count]) => total + count, 0),
      labels: otherCounts.map(([label, count]) => ({ label, count })),
    },
    hasMetadata: hasExif || hasXmp || hasIcc || text.present || otherCounts.length > 0,
    notes: ["JPEG metadata is read before the image scan; any trailing bytes are preserved."],
    scanStart,
    segments,
  };
}

function pngChunks(bytes: Uint8Array): { chunks: Chunk[]; trailing: number } {
  if (bytes.length < 8 || bytes[0] !== 0x89 || textAscii(bytes, 1, 4) !== "PNG") fail("That PNG has no signature.");
  const chunks: Chunk[] = [];
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    if (length > bytes.length - offset - 12) fail("That PNG has a truncated chunk.");
    const type = textAscii(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    const expected = u32be(bytes, dataEnd);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== expected) fail(`That PNG has a corrupt ${type} chunk.`);
    if (!sawIhdr && type !== "IHDR") fail("That PNG does not start with IHDR.");
    if (type === "IHDR") {
      if (length !== 13) fail("That PNG has an invalid IHDR.");
      sawIhdr = true;
    }
    chunks.push({ type, chunkStart: offset, dataStart, dataEnd, chunkEnd, length });
    offset = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIhdr || !sawIend) fail("That PNG is truncated or has no IEND.");
  return { chunks, trailing: bytes.length - offset };
}

function pngTextKeyword(bytes: Uint8Array, dataStart: number, dataEnd: number): string {
  const limit = Math.min(dataEnd, dataStart + 80);
  let end = dataStart;
  while (end < limit && bytes[end] !== 0) end += 1;
  return textAscii(bytes, dataStart, end);
}

function inspectPng(bytes: Uint8Array): PngMetadata {
  const { chunks, trailing } = pngChunks(bytes);
  const ihdr = chunks[0];
  const width = u32be(bytes, ihdr.dataStart);
  const height = u32be(bytes, ihdr.dataStart + 4);
  const bitDepth = bytes[ihdr.dataStart + 8];
  const colorType = bytes[ihdr.dataStart + 9];
  if (!width || !height) fail("That PNG has no readable dimensions.");
  const alphaByType = colorType === 4 || colorType === 6;
  let alpha = alphaByType;
  let exif = emptyExif(false);
  let xmp: MetadataFlag = { present: false, bytes: 0 };
  let icc: MetadataFlag = { present: false, bytes: 0 };
  let text: TextMetadata = { present: false, count: 0 };
  const other: string[] = [];
  for (const chunk of chunks.slice(1)) {
    const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
    if (chunk.type === "eXIf") {
      if (!exif.present) exif = parseExifBytes(data);
    } else if (chunk.type === "iCCP") {
      icc = { present: true, bytes: icc.bytes + data.length };
    } else if (chunk.type === "iTXt") {
      text = { present: true, count: text.count + 1 };
      if (pngTextKeyword(bytes, chunk.dataStart, chunk.dataEnd) === "XML:com.adobe.xmp")
        xmp = { present: true, bytes: xmp.bytes + data.length };
    } else if (chunk.type === "tEXt" || chunk.type === "zTXt") {
      text = { present: true, count: text.count + 1 };
    } else if (chunk.type === "tRNS") {
      alpha = true;
    } else if (chunk.type !== "IDAT" && chunk.type !== "IEND") {
      other.push(chunk.type);
    }
  }
  const orientation = exif.orientation ?? 1;
  const oriented = orientationSize(width, height, orientation);
  const otherCounts = Object.entries(other.reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {}));
  return {
    mime: "image/png",
    format: "png",
    width,
    height,
    bitDepth,
    colorType,
    orientation,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    alpha,
    webpAnimated: false,
    exif,
    gps: exif.gps,
    camera: exif.camera,
    xmp,
    icc,
    text,
    other: {
      present: otherCounts.length > 0 || trailing > 0,
      count: otherCounts.reduce((total, [, count]) => total + count, 0) + (trailing > 0 ? 1 : 0),
      labels: [
        ...otherCounts.map(([label, count]) => ({ label, count })),
        ...(trailing > 0 ? [{ label: "trailing bytes", count: 1 }] : []),
      ],
    },
    hasMetadata: exif.present || xmp.present || icc.present || text.present || otherCounts.length > 0 || trailing > 0,
    notes: alphaByType ? [] : alpha ? ["A tRNS chunk adds transparency to this PNG."] : [],
    chunks,
    trailing,
  };
}

function webpChunks(bytes: Uint8Array): { chunks: Chunk[]; end: number; trailing: number } {
  if (bytes.length < 12 || textAscii(bytes, 0, 4) !== "RIFF" || textAscii(bytes, 8, 12) !== "WEBP") fail("That WebP has no RIFF header.");
  const riffSize = u32le(bytes, 4);
  if (riffSize + 8 > bytes.length) fail("That WebP is truncated.");
  const end = riffSize + 8;
  const chunks: Chunk[] = [];
  let offset = 12;
  while (offset + 8 <= end) {
    const type = textAscii(bytes, offset, offset + 4);
    const length = u32le(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (dataEnd > end || paddedEnd > end) fail("That WebP has a truncated chunk.");
    chunks.push({ type, chunkStart: offset, dataStart, dataEnd, chunkEnd: paddedEnd, length });
    offset = paddedEnd;
  }
  if (!chunks.length) fail("That WebP has no chunks.");
  return { chunks, end, trailing: bytes.length - end };
}

function webpDimensions(
  bytes: Uint8Array,
  chunks: Chunk[],
): { width: number; height: number; alpha: boolean; flags: number | null } {
  let width: number | null = null;
  let height: number | null = null;
  let alpha = false;
  let flags: number | null = null;
  for (const chunk of chunks) {
    if (chunk.type === "VP8X" && chunk.length >= 10) {
      flags = bytes[chunk.dataStart];
      alpha = (flags & 0x10) !== 0;
      width = 1 + u24le(bytes, chunk.dataStart + 4);
      height = 1 + u24le(bytes, chunk.dataStart + 7);
      break;
    }
    if (chunk.type === "VP8L" && chunk.length >= 5) {
      const bits = u32le(bytes, chunk.dataStart + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      alpha = ((bits >>> 28) & 1) === 1;
      break;
    }
    if (chunk.type === "VP8 " && chunk.length >= 10) {
      if (bytes[chunk.dataStart + 3] !== 0x9d || bytes[chunk.dataStart + 4] !== 0x01 || bytes[chunk.dataStart + 5] !== 0x2a)
        fail("That WebP has an invalid VP8 frame header.");
      width = u16le(bytes, chunk.dataStart + 6) & 0x3fff;
      height = u16le(bytes, chunk.dataStart + 8) & 0x3fff;
      break;
    }
  }
  if (!width || !height) fail("That WebP has no readable dimensions.");
  return { width, height, alpha, flags };
}

function inspectWebp(bytes: Uint8Array): WebpMetadata {
  const { chunks, trailing } = webpChunks(bytes);
  const { width, height, alpha, flags } = webpDimensions(bytes, chunks);
  // WebP marks animation in VP8X bit 1 and in the ANIM/ANMF chunks. Both come
  // from the bounded chunk walk above, so neither a declared MIME type nor a
  // missing flag can let an animated file through the ordinary-file path.
  const webpAnimated =
    (flags !== null && (flags & WEBP_ANIM_FLAG) !== 0) ||
    chunks.some((chunk) => chunk.type === "ANIM" || chunk.type === "ANMF");
  let exif = emptyExif(false);
  let xmp: MetadataFlag = { present: false, bytes: 0 };
  let icc: MetadataFlag = { present: false, bytes: 0 };
  const other: string[] = [];
  for (const chunk of chunks) {
    const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
    if (chunk.type === "EXIF") {
      if (!exif.present) exif = parseExifBytes(data);
    } else if (chunk.type === "XMP ") {
      xmp = { present: true, bytes: xmp.bytes + data.length };
    } else if (chunk.type === "ICCP") {
      icc = { present: true, bytes: icc.bytes + data.length };
    } else if (!["VP8X", "VP8 ", "VP8L", "ALPH", "ANIM", "ANMF"].includes(chunk.type)) {
      other.push(chunk.type);
    }
  }
  const orientation = exif.orientation ?? 1;
  const oriented = orientationSize(width, height, orientation);
  const otherCounts = Object.entries(other.reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {}));
  return {
    mime: "image/webp",
    format: "webp",
    width,
    height,
    orientation,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    alpha,
    webpAnimated,
    exif,
    gps: exif.gps,
    camera: exif.camera,
    xmp,
    icc,
    text: { present: false, count: 0 },
    other: {
      present: otherCounts.length > 0 || trailing > 0,
      count: otherCounts.reduce((total, [, count]) => total + count, 0) + (trailing > 0 ? 1 : 0),
      labels: [
        ...otherCounts.map(([label, count]) => ({ label, count })),
        ...(trailing > 0 ? [{ label: "trailing bytes", count: 1 }] : []),
      ],
    },
    hasMetadata: exif.present || xmp.present || icc.present || otherCounts.length > 0 || trailing > 0,
    notes: [],
    chunks,
    trailing,
  };
}

function inspectImageInternal(bytes: Uint8Array): InternalMetadata {
  if (!(bytes instanceof Uint8Array)) throw new ImageMetadataError("Image bytes are required.");
  const sniffed = sniffLocalImage(bytes);
  if (!sniffed.supported) throw new ImageMetadataError(sniffed.reason ?? "This image format is not supported.");
  if (sniffed.format === "jpeg") return inspectJpeg(bytes);
  if (sniffed.format === "png") return inspectPng(bytes);
  return inspectWebp(bytes);
}

export function inspectImage(bytes: Uint8Array): ImageMetadataSummary {
  return inspectImageInternal(bytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function samePayloads(
  leftBytes: Uint8Array,
  leftChunks: Chunk[],
  rightBytes: Uint8Array,
  rightChunks: Chunk[],
  types: string[],
): boolean {
  const pick = (bytes: Uint8Array, chunks: Chunk[]): Uint8Array[] =>
    chunks
      .filter((chunk) => types.includes(chunk.type))
      .map((chunk) => bytes.subarray(chunk.dataStart, chunk.dataEnd));
  const left = pick(leftBytes, leftChunks);
  const right = pick(rightBytes, rightChunks);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (!bytesEqual(left[index], right[index])) return false;
  return true;
}

function jpegScanStartFor(bytes: Uint8Array): number {
  return jpegSegments(bytes).scanStart;
}

// Orientation is display-critical. Removing it from an otherwise lossless
// metadata strip would rotate the picture, so a one-tag EXIF block is retained
// when the source declared a non-default orientation.
function minimalOrientationTiff(orientation: number): Uint8Array {
  const output = new Uint8Array(26);
  output[0] = 0x49;
  output[1] = 0x49;
  output[2] = 42;
  output[3] = 0;
  output[4] = 8;
  output[5] = 0;
  output[6] = 0;
  output[7] = 0;
  output[8] = 1;
  output[9] = 0;
  output[10] = 0x12;
  output[11] = 0x01;
  output[12] = 3;
  output[13] = 0;
  output[14] = 1;
  output[15] = 0;
  output[16] = 0;
  output[17] = 0;
  output[18] = orientation & 0xff;
  output[19] = 0;
  output[20] = 0;
  output[21] = 0;
  return output;
}

function jpegApp1(tiff: Uint8Array): Uint8Array {
  const payloadLength = 6 + tiff.length;
  const output = new Uint8Array(4 + payloadLength);
  output.set([0xff, 0xe1, ((payloadLength + 2) >>> 8) & 0xff, (payloadLength + 2) & 0xff], 0);
  output.set(new TextEncoder().encode("Exif\0\0"), 4);
  output.set(tiff, 10);
  return output;
}

const PNG_ORIENTATION_TIFF = (orientation: number): Uint8Array => minimalOrientationTiff(orientation);

function pngChunkBytes(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)));
  return output;
}

type KeptJpegSegment = { bytes: Uint8Array; app0: boolean };

function stripJpeg(bytes: Uint8Array, before: JpegMetadata, keepColorProfile: boolean): StripInternal {
  const keepOrientation = before.orientation !== 1;
  const kept: KeptJpegSegment[] = [];
  const removed: string[] = [];
  for (const segment of before.segments) {
    const classification = classifyJpegSegment(bytes, segment);
    const remove =
      classification.category === "exif" ||
      classification.category === "xmp" ||
      classification.category === "other" ||
      classification.category === "comment" ||
      (classification.category === "icc" && !keepColorProfile);
    if (remove) {
      removed.push(classification.category === "exif" && keepOrientation ? "EXIF (privacy tags)" : classification.label);
    } else {
      kept.push({
        bytes: bytes.subarray(segment.markerStart, segment.end),
        app0: classification.category === "app0",
      });
    }
  }
  const pieces: Uint8Array[] = [bytes.subarray(0, 2)];
  let inserted = false;
  if (keepOrientation && !kept.some((entry) => entry.app0)) {
    pieces.push(jpegApp1(minimalOrientationTiff(before.orientation)));
    inserted = true;
  }
  for (const entry of kept) {
    pieces.push(entry.bytes);
    if (keepOrientation && !inserted && entry.app0) {
      pieces.push(jpegApp1(minimalOrientationTiff(before.orientation)));
      inserted = true;
    }
  }
  pieces.push(bytes.subarray(before.scanStart));
  const output = concat(pieces);
  const afterScanStart = jpegScanStartFor(output);
  return {
    bytes: output,
    removed,
    keptOrientation: keepOrientation,
    pixelsUnchanged: bytesEqual(bytes.subarray(before.scanStart), output.subarray(afterScanStart)),
  };
}

const PNG_METADATA_CHUNKS = new Set<string>([
  "eXIf",
  "tEXt",
  "zTXt",
  "iTXt",
  "tIME",
  "dSIG",
  "sPLT",
  "hIST",
  "pCAL",
  "sCAL",
  "oFFs",
  "sTER",
]);

function stripPng(bytes: Uint8Array, before: PngMetadata, keepColorProfile: boolean): StripInternal {
  const keepOrientation = before.orientation !== 1;
  const pieces: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  for (const chunk of before.chunks) {
    const remove =
      PNG_METADATA_CHUNKS.has(chunk.type) || (chunk.type === "iCCP" && !keepColorProfile);
    if (remove) {
      removed.push(chunk.type === "eXIf" && keepOrientation ? "EXIF (privacy tags)" : chunk.type);
    } else {
      pieces.push(bytes.subarray(chunk.chunkStart, chunk.chunkEnd));
      if (chunk.type === "IHDR" && keepOrientation)
        pieces.push(pngChunkBytes("eXIf", PNG_ORIENTATION_TIFF(before.orientation)));
    }
  }
  if (before.trailing > 0) removed.push("trailing bytes");
  const output = concat(pieces);
  const after = pngChunks(output);
  return {
    bytes: output,
    removed,
    keptOrientation: keepOrientation,
    pixelsUnchanged: samePayloads(bytes, before.chunks, output, after.chunks, ["IDAT"]),
  };
}

function stripWebp(bytes: Uint8Array, before: WebpMetadata, keepColorProfile: boolean): StripInternal {
  const keepOrientation = before.orientation !== 1;
  const keep: Array<{ type: string; data: Uint8Array }> = [];
  const removed: string[] = [];
  let removeIcc = false;
  let removeExif = false;
  let removeXmp = false;
  let hasVp8x = false;
  for (const chunk of before.chunks) {
    if (chunk.type === "EXIF") {
      removed.push(keepOrientation ? "EXIF (privacy tags)" : "EXIF");
      removeExif = true;
      continue;
    }
    if (chunk.type === "XMP ") {
      removed.push("XMP");
      removeXmp = true;
      continue;
    }
    if (chunk.type === "ICCP" && !keepColorProfile) {
      removed.push("ICC profile");
      removeIcc = true;
      continue;
    }
    if (chunk.type === "VP8X") {
      hasVp8x = true;
      keep.push({ type: chunk.type, data: bytes.slice(chunk.dataStart, chunk.dataEnd) });
    } else {
      keep.push({ type: chunk.type, data: bytes.subarray(chunk.dataStart, chunk.dataEnd) });
    }
  }
  if (keepOrientation && !hasVp8x) {
    const vp8x = new Uint8Array(10);
    vp8x[0] = (before.alpha ? 0x10 : 0) | 0x08;
    vp8x[4] = (before.width - 1) & 0xff;
    vp8x[5] = ((before.width - 1) >>> 8) & 0xff;
    vp8x[6] = ((before.width - 1) >>> 16) & 0xff;
    vp8x[7] = (before.height - 1) & 0xff;
    vp8x[8] = ((before.height - 1) >>> 8) & 0xff;
    vp8x[9] = ((before.height - 1) >>> 16) & 0xff;
    keep.unshift({ type: "VP8X", data: vp8x });
    hasVp8x = true;
  }
  for (const chunk of keep) {
    if (chunk.type !== "VP8X") continue;
    if (removeIcc) chunk.data[0] &= ~0x20;
    if (removeExif) chunk.data[0] &= ~0x08;
    if (removeXmp) chunk.data[0] &= ~0x04;
    if (keepOrientation) chunk.data[0] |= 0x08;
  }
  if (keepOrientation) keep.push({ type: "EXIF", data: minimalOrientationTiff(before.orientation) });
  if (before.trailing > 0) removed.push("trailing bytes");
  let size = 4;
  for (const chunk of keep) size += 8 + chunk.data.length + (chunk.data.length % 2);
  const output = new Uint8Array(size + 8);
  output.set(new TextEncoder().encode("RIFF"), 0);
  const view = new DataView(output.buffer);
  view.setUint32(4, size, true);
  output.set(new TextEncoder().encode("WEBP"), 8);
  let offset = 12;
  for (const chunk of keep) {
    output.set(new TextEncoder().encode(chunk.type), offset);
    view.setUint32(offset + 4, chunk.data.length, true);
    output.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.length;
    if (chunk.data.length % 2) output[offset] = 0;
    offset += chunk.data.length % 2;
  }
  const after = webpChunks(output);
  const sameImageData = samePayloads(
    bytes,
    before.chunks,
    output,
    after.chunks,
    ["VP8 ", "VP8L", "ANMF"],
  );
  return { bytes: output, removed, keptOrientation: keepOrientation, pixelsUnchanged: sameImageData };
}

function concat(pieces: Uint8Array[]): Uint8Array {
  const total = pieces.reduce((size, piece) => size + piece.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    output.set(piece, offset);
    offset += piece.length;
  }
  return output;
}

/**
 * Remove metadata without re-encoding pixels. The optional ICC removal is the
 * only operation that can change how colours appear.
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  { keepColorProfile = true }: { keepColorProfile?: boolean } = {},
): StripResult {
  if (!(bytes instanceof Uint8Array)) throw new ImageMetadataError("Image bytes are required.");
  const before = inspectImageInternal(bytes);
  let stripped: StripInternal;
  if (before.format === "jpeg") stripped = stripJpeg(bytes, before, keepColorProfile);
  else if (before.format === "png") stripped = stripPng(bytes, before, keepColorProfile);
  else stripped = stripWebp(bytes, before, keepColorProfile);
  const after = inspectImageInternal(stripped.bytes);
  const metadataRemoved =
    !after.xmp.present &&
    !after.text.present &&
    !after.gps &&
    !after.camera &&
    !after.exif.dateTime &&
    (!after.exif.present || (after.exif.entries <= 1 && !after.exif.error)) &&
    (keepColorProfile || !after.icc.present);
  const warnings: string[] = [];
  if (!keepColorProfile)
    warnings.push("Removing the ICC colour profile can change how colours appear in other apps.");
  if (before.orientation !== 1 && !stripped.keptOrientation)
    warnings.push("The orientation tag could not be retained; some viewers may rotate this image.");
  return {
    bytes: stripped.bytes,
    format: before.format,
    mime: before.mime,
    before,
    after,
    removed: stripped.removed,
    changed: !bytesEqual(stripped.bytes, bytes),
    keptOrientation: stripped.keptOrientation,
    warning: warnings.length ? warnings.join(" ") : null,
    verified: {
      pixelsUnchanged: stripped.pixelsUnchanged,
      dimensionsMatch:
        before.width === after.width &&
        before.height === after.height &&
        before.orientation === after.orientation,
      metadataRemoved,
      all: stripped.pixelsUnchanged &&
        before.width === after.width &&
        before.height === after.height &&
        before.orientation === after.orientation &&
        metadataRemoved,
    },
  };
}
