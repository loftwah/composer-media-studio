// MIT. Synthetic image fixtures for the local image-tool tests. Nothing here
// is a real photograph; the fixtures only exercise parsers and byte rewriting.

import { crc32 } from "../../src/frontend/image-zip.mjs";

export function bytes(...values) {
  return Uint8Array.from(values.flat());
}

export function ascii(value) {
  return new TextEncoder().encode(value);
}

export function concat(...parts) {
  const total = parts.reduce((size, part) => size + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16le(value) {
  return bytes([value & 0xff, (value >>> 8) & 0xff]);
}

function u32le(value) {
  return bytes([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function u32be(value) {
  return bytes([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function u16be(value) {
  return bytes([(value >>> 8) & 0xff, value & 0xff]);
}

/**
 * A small little-endian TIFF/EXIF block with Make, Model, Orientation and a
 * GPS IFD that contains GPSLatitudeRef. No coordinate values are invented.
 */
export function tiffExif({
  make = "Fixture Camera Co",
  model = "Local 1",
  orientation = 6,
  gps = true,
} = {}) {
  const makeBytes = ascii(`${make}\0`);
  const modelBytes = ascii(`${model}\0`);
  const ifd0Offset = 8;
  const ifd0Count = gps ? 4 : 3;
  const ifd0End = ifd0Offset + 2 + ifd0Count * 12 + 4;
  const makeOffset = ifd0End;
  const modelOffset = makeOffset + makeBytes.length;
  const gpsOffset = modelOffset + modelBytes.length + ((modelOffset + modelBytes.length) % 2);
  const gpsEntryCount = gps ? 1 : 0;
  const gpsEnd = gpsOffset + 2 + gpsEntryCount * 12 + 4;
  const total = Math.max(modelOffset + modelBytes.length, gpsEnd);
  const output = new Uint8Array(total);
  output.set(ascii("II"), 0);
  output.set(u16le(42), 2);
  output.set(u32le(ifd0Offset), 4);
  output.set(u16le(ifd0Count), ifd0Offset);
  let at = ifd0Offset + 2;
  const writeEntry = (tag, type, count, value) => {
    output.set(u16le(tag), at);
    output.set(u16le(type), at + 2);
    output.set(u32le(count), at + 4);
    output.set(value, at + 8);
    at += 12;
  };
  writeEntry(0x010f, 2, makeBytes.length, u32le(makeOffset));
  writeEntry(0x0110, 2, modelBytes.length, u32le(modelOffset));
  writeEntry(0x0112, 3, 1, concat(u16le(orientation), bytes([0, 0])));
  if (gps) writeEntry(0x8825, 4, 1, u32le(gpsOffset));
  output.set(u32le(0), at);
  output.set(makeBytes, makeOffset);
  output.set(modelBytes, modelOffset);
  if (gps) {
    output.set(u16le(1), gpsOffset);
    output.set(u16le(1), gpsOffset + 2);
    output.set(u16le(2), gpsOffset + 4);
    output.set(u32le(2), gpsOffset + 6);
    output.set(ascii("S\0"), gpsOffset + 10);
    output.set(u32le(0), gpsOffset + 14);
  }
  return output;
}

function jpegSegment(marker, payload) {
  return concat(bytes([0xff, marker]), u16be(payload.length + 2), payload);
}

export function jpegFixture({ width = 200, height = 100, orientation = 6, gps = true, icc = true } = {}) {
  const tiff = tiffExif({ orientation, gps });
  const sof = bytes([8, (height >>> 8) & 0xff, height & 0xff, (width >>> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0]);
  const scan = bytes([0x01, 0x02, 0xff, 0x00, 0x03]);
  return concat(
    bytes([0xff, 0xd8]),
    jpegSegment(0xe0, ascii("JFIF\0\x01\x02")),
    jpegSegment(0xe1, concat(ascii("Exif\0\0"), tiff)),
    jpegSegment(0xe1, concat(ascii("http://ns.adobe.com/xap/1.0/\0"), ascii("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>"))),
    ...(icc ? [jpegSegment(0xe2, concat(ascii("ICC_PROFILE\0\x01\x01"), new Uint8Array(32)))] : []),
    jpegSegment(0xdb, bytes([0, ...new Uint8Array(64)])),
    jpegSegment(0xc0, sof),
    jpegSegment(0xda, bytes([1, 1, 0, 0, 0x3f, 0])),
    scan,
    bytes([0xff, 0xd9]),
  );
}

function pngChunk(type, data) {
  const typeBytes = ascii(type);
  return concat(u32be(data.length), typeBytes, data, u32be(crc32(concat(typeBytes, data))));
}

export function pngFixture({ width = 3, height = 2, orientation = 1, colorType = 6 } = {}) {
  const ihdr = concat(
    u32be(width),
    u32be(height),
    bytes([8, colorType, 0, 0, 0]),
  );
  return concat(
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("iCCP", concat(ascii("sRGB\0\0"), new Uint8Array(16))),
    pngChunk("eXIf", tiffExif({ orientation, gps: true })),
    pngChunk("tEXt", ascii("Comment\0A synthetic local fixture")),
    pngChunk("iTXt", concat(ascii("XML:com.adobe.xmp\0\0\0\0\0"), ascii("<x:xmpmeta/>"))),
    pngChunk("IDAT", bytes([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    pngChunk("tIME", bytes([0x07, 0xea, 0x0b, 0x10, 0x0c, 0x00, 0x00])),
    pngChunk("IEND", new Uint8Array(0)),
  );
}

function webpChunk(type, data) {
  return concat(ascii(type), u32le(data.length), data, data.length % 2 ? bytes([0]) : new Uint8Array(0));
}

export function webpFixture({ width = 120, height = 80, alpha = true, exif = true, xmp = true, icc = true, orientation = 1 } = {}) {
  const flags = (icc ? 0x20 : 0) | (alpha ? 0x10 : 0) | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0);
  const vp8x = concat(
    bytes([flags, 0, 0, 0]),
    bytes([(width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff]),
    bytes([(height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff]),
  );
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | (alpha ? 1 << 28 : 0);
  const vp8l = concat(bytes([0x2f]), u32le(bits >>> 0), bytes([0, 0, 0, 0]));
  const body = concat(
    ascii("WEBP"),
    webpChunk("VP8X", vp8x),
    webpChunk("VP8L", vp8l),
    ...(icc ? [webpChunk("ICCP", new Uint8Array(24))] : []),
    ...(exif ? [webpChunk("EXIF", tiffExif({ orientation, gps: true }))] : []),
    ...(xmp ? [webpChunk("XMP ", ascii("<x:xmpmeta/>"))] : []),
  );
  return concat(ascii("RIFF"), u32le(body.length), body);
}

export function heifFtyp(brand = "heic", compatible = ["mif1", "heic"]) {
  const brands = [brand, ...compatible];
  const size = 16 + brands.length * 4;
  return concat(
    u32be(size),
    ascii("ftyp"),
    ascii(brand.padEnd(4, " ")),
    u32be(0),
    ...brands.map((value) => ascii(value.padEnd(4, " "))),
  );
}
