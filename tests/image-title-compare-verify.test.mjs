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
  TITLE_MAX_LENGTH,
  pairIsEmpty,
} from "../src/frontend/image-title-compare-plan.ts";
import {
  MAX_PACKAGING_MANIFEST_BYTES,
  parsePackagingManifest,
  readPackagingTitle,
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

test("only the explicit title reader accepts bounded nonblank v1 title text", async () => {
  const bytes = png(640, 360);
  const title = '  <img src=x onerror="alert(1)"> & editable title  ';
  const value = manifest(bytes, {
    // The editor's existing limit, not an untrusted maxLength field, is authoritative.
    title: { text: title, maxLength: 1 },
    note: "Do not import this note",
    alt: "Do not import this description",
    hypothesis: "Do not import this expectation",
    preferredPairId: "b",
    crop: { mode: "cover", anchor: "left", sourceRect: { left: 0, top: 0, width: 640, height: 360 } },
  });
  const titleFile = fileFor(JSON.stringify(value), "manifest.json", "application/json");
  assert.equal(await readPackagingTitle(titleFile), title);
  // Reading a title never widens the verify-only facts contract.
  assert.doesNotMatch(JSON.stringify(parsePackagingManifest(JSON.stringify(value))), /img src|editable title|Do not import/);

  for (const invalidValue of [
    manifest(bytes, { schema: "other/manifest" }),
    manifest(bytes, { version: String(MANIFEST_VERSION) }),
    manifest(bytes, { version: MANIFEST_VERSION + 1 }),
    manifest(bytes, { title: null }),
    manifest(bytes, { title: { text: 7, maxLength: TITLE_MAX_LENGTH } }),
    manifest(bytes, { title: { text: " \n\t ", maxLength: TITLE_MAX_LENGTH } }),
    manifest(bytes, { title: { text: "x".repeat(TITLE_MAX_LENGTH + 1), maxLength: TITLE_MAX_LENGTH } }),
  ])
    await assert.rejects(
      readPackagingTitle(fileFor(JSON.stringify(invalidValue), "manifest.json", "application/json")),
      /manifest|version|title/,
    );

  const atLimit = manifest(bytes, {
    title: { text: "x".repeat(TITLE_MAX_LENGTH), maxLength: TITLE_MAX_LENGTH },
  });
  assert.equal(
    await readPackagingTitle(fileFor(JSON.stringify(atLimit), "manifest.json", "application/json")),
    "x".repeat(TITLE_MAX_LENGTH),
  );
});

test("title recovery bounds the selected manifest before reading it", async () => {
  for (const size of [0, MAX_PACKAGING_MANIFEST_BYTES + 1]) {
    let reads = 0;
    const oversized = {
      size,
      async arrayBuffer() {
        reads += 1;
        return "{}";
      },
    };
    await assert.rejects(readPackagingTitle(oversized), /32 KiB or less/);
    assert.equal(reads, 0);
  }

  let reads = 0;
  const unreadable = {
    size: 1,
    async arrayBuffer() {
      reads += 1;
      throw new Error("private read failure");
    },
  };
  await assert.rejects(readPackagingTitle(unreadable), /could not be read/);
  assert.equal(reads, 1);
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
  const end = section.indexOf("\n  async function reuseVerifiedPng", start);
  assert.ok(start >= 0 && end > start);
  const block = section.slice(start, end);
  assert.match(block, /verifyRun\.current \+= 1/);
  assert.match(block, /verifiedPngRef\.current = null/);
  assert.match(block, /const manifestFile = verifyManifestFile;\s*const pngFile = verifyPngFile;/);
  assert.match(block, /const attempt = \+\+verifyRun\.current/);
  assert.match(block, /verifyPackagingFiles\(manifestFile, pngFile\)/);
  assert.match(block, /mounted\.current && verifyRun\.current === attempt/);
  assert.match(block, /if \(!current\(\)\) return/);
  assert.match(block, /verifiedPngRef\.current = pngFile/);
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
  assert.doesNotMatch(section, /dangerouslySetInnerHTML/);

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

test("changing either verification source synchronously retires the exact reusable File", () => {
  for (const field of ["manifest", "png"]) {
    const setter = field === "manifest" ? "setVerifyManifestFile" : "setVerifyPngFile";
    assert.match(
      section,
      new RegExp(`${setter}\\(event\\.currentTarget\\.files\\?\\.\\[0\\] \\?\\? null\\);\\s*clearVerify\\(\\);`),
    );
  }
  const clearStart = section.indexOf("function clearVerify");
  const clear = section.slice(clearStart, section.indexOf("\n  }", clearStart));
  assert.match(clear, /verifyRun\.current \+= 1;\s*verifiedPngRef\.current = null;/);
  assert.match(clear, /verifiedManifestRef\.current = null;/);
  assert.match(clear, /setVerifyReuseMessage\(""\)/);
});

test("normal image intake can guard an empty-only claim until its last await", () => {
  const start = section.indexOf("async function chooseImage");
  const end = section.indexOf("\n  /** Use the finished Image Tools result", start);
  assert.ok(start >= 0 && end > start);
  const intake = section.slice(start, end);
  assert.match(intake, /options: \{ emptyRevision\?: number; canCommit\?: \(\) => boolean; title\?: string \}/);
  assert.match(intake, /pairEdits\.current\[index\] !== options\.emptyRevision\)\s*return false;/);
  assert.match(intake, /const run = \+\+loadRuns\.current\[index\];/);
  assert.match(intake, /const revision = pairEdits\.current\[index\];/);
  assert.match(intake, /const accepted = \(\) => unchanged\(\) && \(options\.canCommit\?\.\(\) \?\? true\);/);
  assert.match(intake, /if \(!accepted\(\)\) \{\s*setPair\(index, \{ busy: false \}\);\s*return false;/);
  assert.match(intake, /\.\.\.\(options\.title !== undefined \? \{ title: options\.title \} : \{\}\),/);
  assert.ok(intake.indexOf("if (!accepted())") < intake.indexOf("options.title !== undefined"));
  assert.match(intake, /await validateTitleThumbnail\(file\)/);
  assert.ok(intake.indexOf("await validateTitleThumbnail(file)") < intake.indexOf("if (!accepted())"));
  const validationStart = section.indexOf("async function validateTitleThumbnail");
  const validation = section.slice(validationStart, section.indexOf("export function TitleCompare", validationStart));
  assert.match(validation, /new Uint8Array\(await file\.arrayBuffer\(\)\)/);
  assert.match(validation, /inspectImage\(bytes\)/);
  assert.match(validation, /imagePixelProblem\(source\.orientedWidth, source\.orientedHeight\)/);
  assert.match(validation, /await createImageBitmap\(file\)/);
  assert.match(intake, /return true;/);
  // Every pair field change advances the occupancy revision, including the
  // note control, crop changes and the existing duplicate path.
  assert.match(section, /function setPair\(index: number, patch: Partial<Pair>\): void \{\s*pairEdits\.current\[index\] \+= 1;/);
  assert.match(section, /onChange=\{\(event\) => updateNote\(index, event\.target\.value\)\}/);
  assert.match(section, /function updateNote\(index: number, note: string\): void \{[^}]+setPair\(index, \{ note \}\);/);
  assert.match(section, /pairEdits\.current\[index\] \+= 1;\s*setAnchors/);
  assert.match(section, /pairEdits\.current\[targetIndex\] \+= 1;/);
});

test("the reuse action claims only an empty pair and passes the exact verified File through chooseImage", () => {
  const start = section.indexOf("async function reuseVerifiedPng");
  const end = section.indexOf("\n  /** The distinct recovery action", start);
  assert.ok(start >= 0 && end > start);
  const reuse = section.slice(start, end);
  assert.match(reuse, /const file = verifiedPngRef\.current;/);
  assert.match(reuse, /verifyPhase !== "matched" \|\| verifyOutcome\?\.status !== "matched" \|\| !file \|\| file !== verifyPngFile/);
  assert.match(reuse, /pairEdits\.current\[targetIndex\] !== emptyRevision/);
  assert.match(reuse, /pairIsEmpty\(pairOccupancy\(pairs\[targetIndex\], anchors\[target\]\)\)/);
  assert.match(reuse, /selectPair\(target\);/);
  assert.match(reuse, /await chooseImage\(targetIndex, file, \{/);
  assert.match(reuse, /canCommit: \(\) => verifyRun\.current === attempt && verifiedPngRef\.current === file,/);
  assert.doesNotMatch(reuse, /verifyManifestFile|facts\.|title:|note:|alt:|hypothesis:|setAnchors|setPreferredId|setPairs/);

  // The existing emptiness rule refuses each kind of occupied or pending pair.
  const empty = { title: "", alt: "", hypothesis: "", note: "", hasImage: false, busy: false, anchor: "centre" };
  assert.equal(pairIsEmpty(empty), true);
  for (const occupied of [
    { ...empty, title: "Existing" },
    { ...empty, alt: "Existing description" },
    { ...empty, hypothesis: "Existing expectation" },
    { ...empty, note: "Existing note" },
    { ...empty, hasImage: true },
    { ...empty, busy: true },
    { ...empty, anchor: "left" },
  ])
    assert.equal(pairIsEmpty(occupied), false);
});

test("one matched-only reuse option names the first empty pair or explains that all are occupied", () => {
  assert.match(section, /const verifiedReuseTarget = hasCurrentVerifiedPng\s*\? PAIR_IDS\.find\(\(id, index\) => pairIsEmpty\(pairOccupancy\(pairs\[index\], anchors\[id\]\)\)\) \?\? null/);
  assert.match(section, /verifiedPngRef\.current === verifyPngFile/);
  assert.match(section, /Use verified PNG in an empty pair/);
  assert.match(section, /data-title-compare-verify-reuse-use/);
  assert.match(section, /data-title-compare-verify-reuse-target=\{verifiedReuseTarget \?\? undefined\}/);
  assert.match(section, /data-title-compare-verify-reuse-state=\{verifiedReuseTarget \? "ready" : "no-empty"\}/);
  assert.match(section, /disabled=\{!verifiedReuseTarget\}/);
  assert.match(section, /aria-describedby="image-title-compare-verify-reuse-note"/);
  assert.match(section, /All pairs are occupied\. Clear one pair completely to make room\./);
  assert.match(section, /Adds the verified PNG as the thumbnail for Pair/);
  assert.match(section, /data-title-compare-verify-reuse-status/);
  const stylesheet = readFileSync(new URL("../src/frontend/image-title-compare.css", import.meta.url), "utf8");
  assert.match(stylesheet, /\.title-compare-verify-reuse \{/);
});

test("the distinct restore action keeps the exact source and generation current through title intake", () => {
  const start = section.indexOf("async function restoreVerifiedTitleAndPng");
  const end = section.indexOf("\n  const selectedIndex", start);
  assert.ok(start >= 0 && end > start);
  const restore = section.slice(start, end);
  assert.match(restore, /const file = verifiedPngRef\.current;/);
  assert.match(restore, /const manifestFile = verifiedManifestRef\.current;/);
  assert.match(restore, /const attempt = verifyRun\.current;/);
  assert.match(restore, /verifyPhase !== "matched"\s*\|\|\s*verifyOutcome\?\.status !== "matched"/);
  assert.match(restore, /file !== verifyPngFile/);
  assert.match(restore, /manifestFile !== verifyManifestFile/);
  assert.match(restore, /pairEdits\.current\[targetIndex\] !== emptyRevision/);
  assert.match(restore, /pairIsEmpty\(pairOccupancy\(pairs\[targetIndex\], anchors\[target\]\)\)/);
  assert.match(restore, /verifyRun\.current === attempt &&\s*verifiedPngRef\.current === file &&\s*verifiedManifestRef\.current === manifestFile;/);
  assert.match(restore, /await readPackagingTitle\(manifestFile\)/);
  assert.match(restore, /if \(!current\(\)\) return;/);
  assert.match(restore, /await chooseImage\(targetIndex, file, \{\s*emptyRevision,\s*title,\s*canCommit: current,\s*\}\);/);
  // A title refusal changes only recovery feedback, never the matched facts or
  // the independent PNG-only action. Only title + image reach the pair.
  assert.doesNotMatch(restore, /setVerifyPhase|setVerifyOutcome|setVerifyMessage|setAnchors|setPreferredId|setPairs|note:|alt:|hypothesis:/);
});

test("the PNG-only action stays exact beside a distinct React-text title restore", () => {
  assert.equal(section.split("Use verified PNG in an empty pair").length, 2);
  assert.equal(section.split("Restore title and PNG in an empty pair").length, 2);
  assert.ok(section.indexOf("Use verified PNG in an empty pair") < section.indexOf("Restore title and PNG in an empty pair"));
  assert.match(section, /className="image-control-actions title-compare-verify-reuse-actions"/);
  assert.match(section, /data-title-compare-verify-restore-use/);
  assert.match(section, /data-title-compare-verify-restore-target=\{verifiedReuseTarget \?\? undefined\}/);
  assert.match(section, /data-title-compare-verify-restore-state=\{verifiedReuseTarget \? "ready" : "no-empty"\}/);
  assert.match(section, /void restoreVerifiedTitleAndPng\(verifiedReuseTarget, verifiedReuseRevision\)/);
  assert.match(section, /Restore the editable title from the manifest\. The PNG uses its original exported crop\./);
  assert.match(section, /value=\{pair\.title\}/);
  assert.match(section, /\{pair\.title \|\| <em>Untitled \{PAIR_LABELS\[id\]\}<\/em>\}/);
  assert.doesNotMatch(section, /dangerouslySetInnerHTML/);
});
