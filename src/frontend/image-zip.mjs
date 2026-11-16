// MIT. A small store-only ZIP writer. No compression, no dependency and no
// directory traversal: every entry is a basename in one flat archive.

import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES } from "./image-limits.mjs";

export const ZIP_MIME = "application/zip";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes, seed = 0) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("crc32 expects bytes");
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const value = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  const dosTime =
    ((value.getHours() & 0x1f) << 11) |
    ((value.getMinutes() & 0x3f) << 5) |
    (Math.floor(value.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((value.getMonth() + 1) & 0x0f) << 5) |
    (value.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError("ZIP entries must be bytes or text");
}

function truncateUtf8(text, maxBytes) {
  if (new TextEncoder().encode(text).length <= maxBytes) return text;
  let out = "";
  for (const character of text) {
    if (new TextEncoder().encode(out + character).length > maxBytes) break;
    out += character;
  }
  return out;
}

function sanitiseName(name, index) {
  const raw = String(name ?? "").replaceAll("\\", "/").split("/").pop() ?? "";
  let base = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (!base) base = `image-${index + 1}.bin`;
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const extension = truncateUtf8(base.slice(dot), 20);
    const stem = truncateUtf8(base.slice(0, dot), 100);
    base = `${stem}${extension}`;
  } else {
    base = truncateUtf8(base, 120);
  }
  return base || `image-${index + 1}.bin`;
}

function uniqueName(name, used) {
  const key = (value) => value.toLocaleLowerCase("en-US");
  if (!used.has(key(name))) {
    used.add(key(name));
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!used.has(key(candidate))) {
      used.add(key(candidate));
      return candidate;
    }
  }
  throw new Error("Could not make a unique ZIP entry name.");
}

/**
 * Build a valid store-only ZIP. `entries` is [{ name, data, date? }].
 * Repeated or dangerous names are reduced to unique flat basenames.
 */
export function createZip(entries, { date = new Date(), maxEntries = MAX_ZIP_ENTRIES, maxTotalBytes = MAX_ZIP_BYTES } = {}) {
  if (!Array.isArray(entries)) throw new TypeError("createZip expects an entry list");
  if (entries.length > maxEntries)
    return { ok: false, error: `ZIP export supports at most ${maxEntries} entries.` };
  const prepared = [];
  const used = new Set();
  let total = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const data = toBytes(entry?.data);
    if (!data.length) return { ok: false, error: `Entry ${index + 1} is empty.` };
    total += data.length;
    if (total > maxTotalBytes)
      return {
        ok: false,
        error: `ZIP export stays under ${Math.floor(maxTotalBytes / 1024 / 1024)} MiB. Download images separately instead.`,
      };
    const name = uniqueName(sanitiseName(entry?.name, index), used);
    const nameBytes = new TextEncoder().encode(name);
    if (nameBytes.length > 0xffff) return { ok: false, error: "A ZIP entry name is too long." };
    const { dosTime, dosDate } = dosDateTime(entry?.date ?? date);
    prepared.push({ nameBytes, data, crc: crc32(data), dosTime, dosDate });
  }

  let size = 22;
  for (const entry of prepared) size += 30 + entry.nameBytes.length + entry.data.length + 46 + entry.nameBytes.length;
  if (size > 0xffffffff) return { ok: false, error: "The ZIP is too large." };

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const localOffsets = [];
  for (const entry of prepared) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, entry.dosTime, true);
    view.setUint16(offset + 12, entry.dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;
    bytes.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
    bytes.set(entry.data, offset);
    offset += entry.data.length;
  }

  const centralStart = offset;
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, entry.dosTime, true);
    view.setUint16(offset + 14, entry.dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    offset += 46;
    bytes.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  }
  const centralSize = offset - centralStart;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
  return { ok: true, bytes, entries: prepared.map((entry) => new TextDecoder().decode(entry.nameBytes)) };
}
