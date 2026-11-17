import { test } from "node:test";
import assert from "node:assert/strict";

import { createZip, crc32, ZIP_MIME } from "../src/frontend/image-zip.ts";

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

function localEntries(bytes) {
  const data = view(bytes);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && data.getUint32(offset, true) === 0x04034b50) {
    const flags = data.getUint16(offset + 6, true);
    const method = data.getUint16(offset + 8, true);
    const crc = data.getUint32(offset + 14, true);
    const compressed = data.getUint32(offset + 18, true);
    const size = data.getUint32(offset + 22, true);
    const nameLength = data.getUint16(offset + 26, true);
    const extraLength = data.getUint16(offset + 28, true);
    const name = decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.push({
      flags,
      method,
      crc,
      compressed,
      size,
      name,
      data: bytes.subarray(start, start + compressed),
      end: start + compressed,
    });
    offset = start + compressed;
  }
  return entries;
}

function endRecord(bytes) {
  const data = view(bytes);
  const offset = bytes.length - 22;
  assert.equal(data.getUint32(offset, true), 0x06054b50);
  return {
    offset,
    count: data.getUint16(offset + 10, true),
    centralSize: data.getUint32(offset + 12, true),
    centralOffset: data.getUint32(offset + 16, true),
  };
}

test("the ZIP writer emits valid store-only local headers, data and central directory", () => {
  const date = new Date(2026, 10, 16, 12, 34, 56);
  const first = new TextEncoder().encode("first image bytes");
  const second = new TextEncoder().encode("second");
  const result = createZip(
    [
      { name: "one.png", data: first, date },
      { name: "two.webp", data: second, date },
    ],
    { date },
  );
  assert.equal(result.ok, true);
  assert.equal(ZIP_MIME, "application/zip");
  assert.deepEqual(result.entries, ["one.png", "two.webp"]);
  const entries = localEntries(result.bytes);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.name), ["one.png", "two.webp"]);
  for (const entry of entries) {
    assert.equal(entry.method, 0);
    assert.equal(entry.flags, 0x0800);
    assert.equal(entry.compressed, entry.size);
    assert.equal(entry.crc, crc32(entry.data));
  }
  assert.equal(decode(entries[0].data), "first image bytes");
  assert.equal(decode(entries[1].data), "second");
  const end = endRecord(result.bytes);
  assert.equal(end.count, 2);
  assert.equal(end.centralOffset, entries.at(-1).end);
  assert.equal(end.centralOffset + end.centralSize, end.offset);
});

test("entry names are flat, unique and traversal-safe", () => {
  const result = createZip(
    [
      { name: "../evil.png", data: new Uint8Array([1]) },
      { name: "folder/a.txt", data: new Uint8Array([2]) },
      { name: "a.txt", data: new Uint8Array([3]) },
      { name: "A.TXT", data: new Uint8Array([4]) },
      { name: "café image.png", data: new Uint8Array([5]) },
      { name: "bad\u0000name.png", data: new Uint8Array([6]) },
    ],
    { date: new Date(2026, 0, 1) },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, ["evil.png", "a.txt", "a-2.txt", "A-3.TXT", "café image.png", "bad-name.png"]);
  assert.equal(result.entries.some((name) => name.includes("/") || name.includes("..")), false);
  assert.deepEqual(
    localEntries(result.bytes).map((entry) => decode(entry.data)),
    ["\u0001", "\u0002", "\u0003", "\u0004", "\u0005", "\u0006"],
  );
});

test("empty archives and writer bounds are explicit", () => {
  const empty = createZip([], { date: new Date(2026, 0, 1) });
  assert.equal(empty.ok, true);
  assert.equal(empty.bytes.length, 22);
  assert.equal(endRecord(empty.bytes).count, 0);

  const tooMany = createZip(
    Array.from({ length: 3 }, (_, index) => ({ name: `${index}.png`, data: new Uint8Array([index]) })),
    { maxEntries: 2 },
  );
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /at most 2/);

  const tooLarge = createZip([{ name: "one.png", data: new Uint8Array(10) }], { maxTotalBytes: 9 });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.error, /MiB/);

  const emptyEntry = createZip([{ name: "one.png", data: new Uint8Array(0) }]);
  assert.equal(emptyEntry.ok, false);
  assert.match(emptyEntry.error, /empty/);
});

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});
