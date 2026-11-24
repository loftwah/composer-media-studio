// Focused checks for the browser-local "Verify a packaging PNG" disclosure:
// the bounded manifest subset, the PNG type/size/dimensions/SHA-256 comparison,
// and the stale-response wiring that keeps a result tied to both selections.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEED_SIZES,
  MANIFEST_SCHEMA,
  MANIFEST_VERSION,
} from "../src/frontend/image-title-compare-plan.ts";
import {
  MAX_PACKAGING_MANIFEST_BYTES,
  parsePackagingManifest,
  verifyPackagingFiles,
} from "../src/frontend/image-title-compare-verify.ts";
import { crc32 } from "../src/frontend/image-zip.ts";

const section = readFileSync(new URL("../src/frontend/image-title-compare.tsx", import.meta.url), "utf8");
const verifier = readFileSync(
  new URL("../src/frontend/image-title-compare-verify.ts", import.meta.url),
  "utf8",
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(body));
  return out;
}

/** A real, inspectable PNG with one IDAT byte, so changing the payload keeps
 * the exact byte length while changing the digest. */
function png(width, height, payload = 7) {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", Uint8Array.of(payload)), chunk("IEND", new Uint8Array())];
  return concat(parts);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function manifest(pngBytes, overrides = {}) {
  const card = FEED_SIZES[1];
  const base = {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    generatedAt: "2026-11-24T00:00:00.000Z",
    generator: "test",
    pair: { id: "a", label: "A" },
    title: { text: "Unvalidated <title> text", maxLength: 200 },
    source: {
      fileName: "private-source.png",
      mime: "image/png",
      bytes: 12,
      width: 1920,
      height: 1080,
    },
    crop: { mode: "cover", anchor: "centre", sourceRect: { left: 0, top: 0, width: 1920, height: 1080 } },
    render: {
      sizeKey: card.key,
      width: card.width,
      height: card.height,
      format: "image/png",
      png: {
        fileName: "Private-title-feed-640x360.png",
        bytes: pngBytes.byteLength,
        sha256: sha256(pngBytes),
      },
    },
    local: { uploaded: false, serverInvolved: false },
  };
  const render = { ...base.render, ...(overrides.render ?? {}) };
  return {
    ...base,
    ...overrides,
    render: {
      ...render,
      png: { ...base.render.png, ...(overrides.render?.png ?? {}) },
    },
  };
}

function fileFor(value, name = "payload.bin", type = "application/octet-stream") {
  return new File([typeof value === "string" ? value : value], name, { type });
}

async function verify(manifestValue, pngBytes) {
  return verifyPackagingFiles(
    fileFor(JSON.stringify(manifestValue), "manifest.json", "application/json"),
    fileFor(pngBytes, "export.png", "image/png"),
  );
}

test("the required manifest subset yields facts and nothing free-text", () => {
  const bytes = png(FEED_SIZES[1].width, FEED_SIZES[1].height);
  const facts = parsePackagingManifest(JSON.stringify(manifest(bytes)));
  assert.equal(facts.size.key, "card");
  assert.equal(facts.width, 640);
  assert.equal(facts.height, 360);
  assert.equal(facts.pngBytes, bytes.byteLength);
  assert.equal(facts.sha256, sha256(bytes));
  // The verifier only carries comparable facts; a title, note or filename can
  // never be echoed by the UI from this object.
  assert.deepEqual(Object.keys(facts).sort(), ["height", "pngBytes", "sha256", "size", "width"]);
  assert.doesNotMatch(JSON.stringify(facts), /Unvalidated|Private|private-source|note/);
});

test("unsupported schema, version, dimensions and digest are rejected", () => {
  const bytes = png(640, 360);
  const parse = (value) => () => parsePackagingManifest(JSON.stringify(value));
  assert.throws(parse(manifest(bytes, { schema: "other/manifest" })), /not a Title \+ thumbnail/);
  assert.throws(parse(manifest(bytes, { version: MANIFEST_VERSION + 1 })), /version 1 is supported/);
  assert.throws(parse(manifest(bytes, { render: { sizeKey: "row" } })), /does not support/);
  assert.throws(parse(manifest(bytes, { render: { width: 641 } })), /does not support/);
  assert.throws(
    parse(manifest(bytes, { render: { png: { sha256: "A".repeat(64) } } })),
    /lowercase SHA-256/,
  );
  assert.throws(parse(manifest(bytes, { render: { png: { sha256: "a".repeat(63) } } })), /SHA-256/);
  assert.throws(parse(manifest(bytes, { render: { png: { bytes: 0 } } })), /byte size/);
  assert.throws(parse(manifest(bytes, { render: { format: "image/jpeg" } })), /PNG export/);
  assert.throws(() => parsePackagingManifest("not json"), /could not be read/);
  assert.throws(() => parsePackagingManifest("[]"), /not a packaging manifest/);
});

test("the manifest JSON is bounded before it is parsed", () => {
  const bytes = png(640, 360);
  const value = manifest(bytes);
  value.padding = "x".repeat(MAX_PACKAGING_MANIFEST_BYTES);
  assert.throws(
    () => parsePackagingManifest(JSON.stringify(value)),
    /32 KiB or less/,
  );
});

test("a matching PNG is reported as matched, with only validated facts", async () => {
  const bytes = png(640, 360, 11);
  const outcome = await verify(manifest(bytes), bytes);
  assert.equal(outcome.status, "matched");
  assert.equal(outcome.facts.width, 640);
  assert.equal(outcome.facts.height, 360);
  assert.equal(outcome.facts.sha256, sha256(bytes));
  assert.doesNotMatch(JSON.stringify(outcome), /Private|Unvalidated|private-source/);
});

test("an alt-bearing manifest still verifies and never echoes its free text", async () => {
  const bytes = png(640, 360);
  const withAlt = manifest(bytes, { alt: "A red tram crossing the wet street" });
  const without = manifest(bytes);
  // The optional field is compatible: the verifier reads the same facts.
  assert.deepEqual(
    parsePackagingManifest(JSON.stringify(withAlt)),
    parsePackagingManifest(JSON.stringify(without)),
  );
  const outcome = await verify(withAlt, bytes);
  assert.equal(outcome.status, "matched");
  assert.doesNotMatch(JSON.stringify(outcome), /red tram|wet street/);
});

test("a hypothesis-bearing manifest still verifies and never echoes its text", async () => {
  const bytes = png(640, 360);
  const withHypothesis = manifest(bytes, { hypothesis: "Expect the quieter cut to hold" });
  const without = manifest(bytes);
  // The additive V1 field is compatible: the verifier reads the same facts.
  assert.deepEqual(
    parsePackagingManifest(JSON.stringify(withHypothesis)),
    parsePackagingManifest(JSON.stringify(without)),
  );
  const outcome = await verify(withHypothesis, bytes);
  assert.equal(outcome.status, "matched");
  assert.doesNotMatch(JSON.stringify(outcome), /quieter cut|hypothesis/);
});

test("exact byte size, dimensions and SHA-256 differences stay distinguishable", async () => {
  const bytes = png(640, 360, 7);

  const wrongSize = await verify(manifest(bytes, { render: { png: { bytes: bytes.byteLength + 1 } } }), bytes);
  assert.equal(wrongSize.status, "different");
  assert.equal(wrongSize.reason, "size");
  assert.equal(wrongSize.actualBytes, bytes.byteLength);

  const row = png(168, 94, 7);
  const wrongDimensions = await verify(manifest(row), row);
  assert.equal(wrongDimensions.status, "different");
  assert.equal(wrongDimensions.reason, "dimensions");
  assert.equal(wrongDimensions.actualWidth, 168);
  assert.equal(wrongDimensions.actualHeight, 94);

  const sameLengthDifferentBytes = png(640, 360, 8);
  assert.equal(sameLengthDifferentBytes.byteLength, bytes.byteLength);
  const wrongDigest = await verify(manifest(bytes), sameLengthDifferentBytes);
  assert.equal(wrongDigest.status, "different");
  assert.equal(wrongDigest.reason, "sha256");
});

test("a non-PNG or unreadable PNG is invalid, never a match", async () => {
  const notPng = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const wrongType = await verify(manifest(notPng), notPng);
  assert.equal(wrongType.status, "invalid");
  assert.match(wrongType.message, /not a PNG/);

  const bytes = png(640, 360);
  const truncated = bytes.subarray(0, bytes.length - 4);
  const unreadable = await verify(manifest(truncated), truncated);
  assert.equal(unreadable.status, "invalid");
  assert.match(unreadable.message, /could not be read/);
});

test("empty, oversized and missing files are refused before reading", async () => {
  const bytes = png(640, 360);
  const goodManifest = fileFor(JSON.stringify(manifest(bytes)), "manifest.json", "application/json");

  const bigManifest = fileFor(
    "x".repeat(MAX_PACKAGING_MANIFEST_BYTES + 1),
    "manifest.json",
    "application/json",
  );
  const bigManifestOutcome = await verifyPackagingFiles(bigManifest, fileFor(bytes, "export.png", "image/png"));
  assert.equal(bigManifestOutcome.status, "invalid");
  assert.match(bigManifestOutcome.message, /32 KiB or less/);

  const bigPng = { name: "export.png", type: "image/png", size: 32 * 1024 * 1024 + 1 };
  const bigPngOutcome = await verifyPackagingFiles(goodManifest, bigPng);
  assert.equal(bigPngOutcome.status, "invalid");
  assert.match(bigPngOutcome.message, /32 MiB/);

  const emptyOutcome = await verifyPackagingFiles(null, null);
  assert.equal(emptyOutcome.status, "invalid");
  assert.match(emptyOutcome.message, /manifest JSON/);
});

test("either selection retires an in-flight check and its old result", () => {
  const start = section.indexOf("function clearVerify");
  const end = section.indexOf("const selectedIndex", start);
  assert.ok(start >= 0 && end > start);
  const block = section.slice(start, end);
  assert.match(block, /verifyRun\.current \+= 1/);
  assert.match(block, /const attempt = \+\+verifyRun\.current/);
  assert.match(block, /mounted\.current && verifyRun\.current === attempt/);
  assert.match(block, /if \(!current\(\)\) return/);
  assert.match(block, /setVerifyPhase\("idle"\)/);
  assert.match(block, /setVerifyOutcome\(null\)/);
  // The check never edits the source, selection, note, crops, preference or
  // prepared downloads; it only writes its own display state.
  for (const forbidden of [
    "setPair(",
    "setAnchors(",
    "setPreferredId(",
    "setSelectedId(",
    "setExports(",
    "replaceExports(",
    "discardExports(",
    "trackUrl(",
    "setTitleFallback(",
  ])
    assert.ok(!block.includes(forbidden), `the verify block must not call ${forbidden}`);
});

test("the disclosure is wired to both separate file inputs and a distinct status", () => {
  assert.match(section, /from "\.\/image-title-compare-verify\.ts"/);
  assert.match(section, /className="title-compare-verify"/);
  assert.match(section, /data-title-compare-verify/);
  assert.match(section, /data-title-compare-verify-manifest/);
  assert.match(section, /data-title-compare-verify-png/);
  assert.match(section, /data-title-compare-verify-check/);
  assert.match(section, /data-title-compare-verify-status=\{verifyPhase\}/);
  assert.match(section, /role=\{verifyPhase === "invalid" \? "alert" : "status"\}/);
  assert.match(section, /<details className="title-compare-verify"/);
  assert.ok(section.includes("setVerifyManifestFile(event.currentTarget.files?.[0] ?? null);"));
  assert.ok(section.includes("setVerifyPngFile(event.currentTarget.files?.[0] ?? null);"));
  // No selected filename or manifest free text reaches the panel.
  assert.doesNotMatch(section, /verifyManifestFile\.name|verifyPngFile\.name/);
  assert.doesNotMatch(section, /verifyOutcome\.facts\.(?:title|note|source|png\.fileName)/);

  // The verifier itself never reaches the network or persists anything.
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator.sendBeacon",
    "URL.createObjectURL",
  ])
    assert.ok(!verifier.includes(forbidden), `the verifier must not use ${forbidden}`);
});
