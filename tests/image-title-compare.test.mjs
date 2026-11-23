// Focused checks for the title + thumbnail compare slice: the pure cover-crop
// plan shared by the CSS preview and the PNG export, the download-name rules,
// and the source-level wiring of the workbench section.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEED_SIZES,
  MANIFEST_SCHEMA,
  MANIFEST_VERSION,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  buildTitlePairManifest,
  bundleFileName,
  coverCropRect,
  exportFileName,
  manifestFileName,
  normalizeCreatorNote,
  objectPositionFor,
  pairArchiveFileNames,
  preferredPairForExport,
  preparedPairsBundleFileName,
  safeTitleStem,
} from "../src/frontend/image-title-compare-plan.ts";
import { createZip } from "../src/frontend/image-zip.ts";

const section = readFileSync(new URL("../src/frontend/image-title-compare.tsx", import.meta.url), "utf8");
const plan = readFileSync(new URL("../src/frontend/image-title-compare-plan.ts", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../src/frontend/images.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/frontend/image-title-compare.css", import.meta.url), "utf8");

test("the feed sizes are the claimed real pixel boxes", () => {
  assert.deepEqual(
    FEED_SIZES.map(({ key, width, height }) => ({ key, width, height })),
    [
      { key: "row", width: 168, height: 94 },
      { key: "card", width: 640, height: 360 },
    ],
  );
  assert.equal(TITLE_MAX_LENGTH, 200);
});

test("an exact 16:9 source fills the card box with no crop", () => {
  assert.deepEqual(coverCropRect(1920, 1080, 640, 360, "centre"), {
    left: 0,
    top: 0,
    width: 1920,
    height: 1080,
  });
});

test("a wider source crops horizontally by the anchor and never vertically", () => {
  const plan = { width: 1920, height: 1080 };
  assert.deepEqual(coverCropRect(2000, 1080, 640, 360, "centre"), { left: 40, top: 0, ...plan });
  assert.deepEqual(coverCropRect(2000, 1080, 640, 360, "right"), { left: 80, top: 0, ...plan });
  assert.deepEqual(coverCropRect(2000, 1080, 640, 360, "top"), { left: 40, top: 0, ...plan });
  assert.deepEqual(coverCropRect(2000, 1080, 640, 360, "topRight"), { left: 80, top: 0, ...plan });
});

test("a taller source crops vertically and the anchors stay inside the source", () => {
  assert.deepEqual(coverCropRect(1080, 1920, 640, 360, "centre"), {
    left: 0,
    top: 656,
    width: 1080,
    height: 608,
  });
  const bottom = coverCropRect(1080, 1920, 640, 360, "bottom");
  assert.ok(bottom);
  assert.equal(bottom.top + bottom.height, 1920);
  const top = coverCropRect(1080, 1920, 640, 360, "top");
  assert.ok(top);
  assert.equal(top.top, 0);
});

test("a tiny source is scaled up, exactly like the CSS cover preview", () => {
  assert.deepEqual(coverCropRect(80, 45, 640, 360, "centre"), { left: 0, top: 0, width: 80, height: 45 });
  assert.deepEqual(coverCropRect(80, 45, 168, 94, "centre"), { left: 0, top: 0, width: 80, height: 45 });
});

test("the row box's rounded aspect still crops from one whole-pixel plan", () => {
  const plan = coverCropRect(1920, 1080, 168, 94, "centre");
  assert.ok(plan);
  // The row box is a hair taller than 16:9, so a little height is cropped.
  assert.deepEqual(plan, { left: 0, top: 3, width: 1920, height: 1074 });
});

test("invalid sizes return no plan instead of a wrong one", () => {
  assert.equal(coverCropRect(0, 1080, 640, 360), null);
  assert.equal(coverCropRect(1920, 0, 640, 360), null);
  assert.equal(coverCropRect(1920, 1080, 0, 360), null);
  assert.equal(coverCropRect(1920, 1080, 640, 0), null);
  assert.equal(coverCropRect(Number.NaN, 1080, 640, 360), null);
});

test("every plan stays inside the source bounds", () => {
  const sizes = [
    [1920, 1080],
    [1080, 1920],
    [123, 7],
    [7, 123],
    [3, 3],
    [16_384, 16_384],
  ];
  const anchors = ["centre", "top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight"];
  for (const [sourceWidth, sourceHeight] of sizes) {
    for (const size of FEED_SIZES) {
      for (const anchor of anchors) {
        const plan = coverCropRect(sourceWidth, sourceHeight, size.width, size.height, anchor);
        assert.ok(plan, `${sourceWidth}x${sourceHeight} → ${size.key} @ ${anchor}`);
        assert.ok(plan.left >= 0 && plan.top >= 0);
        assert.ok(plan.width >= 1 && plan.height >= 1);
        assert.ok(plan.left + plan.width <= sourceWidth);
        assert.ok(plan.top + plan.height <= sourceHeight);
      }
    }
  }
});

test("object-position is the CSS form of the same anchor", () => {
  assert.equal(objectPositionFor("centre"), "50% 50%");
  assert.equal(objectPositionFor("topLeft"), "0% 0%");
  assert.equal(objectPositionFor("bottomRight"), "100% 100%");
  assert.equal(objectPositionFor("left"), "0% 50%");
  assert.equal(objectPositionFor("top"), "50% 0%");
});

test("the download stem follows the workbench's name rules", () => {
  assert.equal(safeTitleStem("My Great Title!"), "My-Great-Title");
  assert.equal(safeTitleStem("   "), "thumbnail");
  assert.equal(safeTitleStem("shot:v2?.png"), "shot-v2");
  assert.equal(safeTitleStem("naïve—café"), "naïve-café");
  // Underscore-only names keep the workbench's exact behaviour.
  assert.equal(safeTitleStem("-__-"), "__");
  assert.equal(safeTitleStem("x".repeat(100)), "x".repeat(70));
});

test("the export name prefers the title and carries the real feed size", () => {
  const card = FEED_SIZES[1];
  assert.equal(exportFileName("After Hours", "ignored.png", card), "After-Hours-feed-640x360.png");
  assert.equal(exportFileName("", "still_01.png", FEED_SIZES[0]), "still_01-feed-168x94.png");
});

test("the section keeps the workbench's local-only and keyboard promises", () => {
  assert.match(section, /aria-labelledby="image-title-compare-heading"/);
  assert.match(section, /name="image-title-compare-pair"/);
  assert.match(section, /type="radio"/);
  assert.match(section, /Preview crop position/);
  assert.match(section, /aria-label=\{`Thumbnail \$\{PAIR_LABELS\[id\]\}`\}/);
  assert.match(section, /role="status" aria-live="polite"/);
  assert.match(section, /role="alert"/);
  assert.match(section, /accept=\{IMAGE_ACCEPT_ATTRIBUTE\}/);
  assert.match(section, /sniffLocalImage\(bytes\)/);
  assert.match(section, /inspectImage\(bytes\)/);
  assert.match(section, /imageInputProblem\(/);
  assert.match(section, /imagePixelProblem\(/);
  assert.match(section, /createImageBitmap\(image\.file\)/);
  assert.match(section, /canvas\.toBlob/);
  assert.match(section, /URL\.createObjectURL/);
  assert.match(section, /URL\.revokeObjectURL/);
  // The workbench mounts the section.
  assert.match(workbench, /<TitleCompare \/>/);
});

test("decoded bitmaps are closed on every outcome, not just a successful draw", () => {
  // The helper's finally covers the crop-plan and context failures too, and
  // both the PNG and the manifest export go through the same encode.
  assert.match(
    section,
    /let rect: CoverRect;\s*let canvas: HTMLCanvasElement;\s*(?:\/\/[^\n]*\n\s*)?try \{\s*const plan = coverCropRect\([\s\S]*?\} finally \{\s*bitmap\.close\(\);\s*\}/,
  );
  assert.match(section, /const bitmap = await createImageBitmap\(image\.file\)/);
  // PNG, single-pair manifest and prepared-set export share the encode helper.
  assert.equal(section.match(/await encodeCropPng\(image, size, forAnchor\)/g).length, 3);
});

test("stale intake and export runs are ignored after a newer choice or unmount", () => {
  assert.match(section, /const run = \+\+loadRuns\.current\[index\]/);
  assert.match(section, /loadRuns\.current\[index\] \+= 1/);
  assert.match(section, /mounted\.current && loadRuns\.current\[index\] === run/);
  assert.match(section, /const run = \+\+exportRun\.current/);
  assert.match(section, /mounted\.current && exportRun\.current === run/);
  // A stale export returns before minting its blob URL.
  assert.match(section, /if \(!current\(\)\) return;\s*const name = exportFileName/);
});

test("the export revokes URLs outside the state updater and labels the captured pair", () => {
  assert.doesNotMatch(section, /setExports\(\(current\)/);
  assert.match(section, /function replaceExports\(next: ExportEntry\[\]\)/);
  assert.match(section, /setExports\(next\)/);
  assert.match(section, /pairLabel: PAIR_LABELS\[forPair\]/);
  assert.match(section, /anchorLabel: CROP_ANCHOR_LABELS\[forAnchor\]/);
  assert.match(section, /coverCropRect\(bitmap\.width, bitmap\.height, size\.width, size\.height, anchor\)/);
});

test("the manifest names the exact PNG the same run encoded, hashed over those bytes", () => {
  // One encode feeds both the header check and the digest, so the SHA-256
  // always describes the shipped pixels.
  assert.match(section, /const encoded = inspectImage\(pngBytes\)/);
  assert.match(section, /const sha256 = await sha256Hex\(pngBytes\)/);
  assert.match(section, /subtle\.digest\("SHA-256", bytes\)/);
  assert.match(section, /png: \{ fileName: name, bytes: blob\.size, sha256 \}/);
  assert.match(section, /type: "application\/json"/);
  assert.match(section, /manifestFileName\(title \|\| image\.fileName, image\.fileName, size\)/);
});

test("a stale or unmounted manifest run never hashes for publication or mints a URL", () => {
  // The shared export run guard: encode → staleness check → hash → rebuild →
  // staleness check → publish.
  assert.match(section, /if \(!current\(\)\) return;\s*const name = exportFileName\([\s\S]{0,200}?const sha256 = await sha256Hex\(pngBytes\)/);
  assert.match(section, /if \(!current\(\)\) return;\s*const manifestName = manifestFileName/);
  assert.doesNotMatch(section, /trackUrl\((?:blob|manifestBlob)\)[\s\S]*?if \(!current\(\)\) return;\s*replaceExports/);
});

test("the manifest button stays honest about what it exports", () => {
  assert.match(section, /Export \$\{selectedLabel\} manifest \(JSON, card 640 × 360\)/);
  assert.match(section, /void exportSelectedPairManifest\(FEED_SIZES\[1\]\)/);
  assert.match(section, /MANIFEST_VERSION/);
  // The manifest carries only locally captured facts: no work, rights or
  // performance claims this tab cannot know.
  assert.match(plan, /local: \{ uploaded: false, serverInvolved: false \}/);
});

test("the manifest builder records the captured facts under a versioned schema", () => {
  assert.equal(MANIFEST_SCHEMA, "studio.title-thumbnail-pair-manifest");
  assert.equal(MANIFEST_VERSION, 1);
  const size = FEED_SIZES[1];
  const input = {
    generatedAt: "2026-11-22T07:00:00.000Z",
    pairId: "b",
    title: "After Hours — trailer",
    source: { fileName: "still_01.png", mime: "image/png", bytes: 42_000, width: 1920, height: 1080 },
    anchor: "bottom",
    size,
    sourceRect: { left: 0, top: 0, width: 1920, height: 1080 },
    png: { fileName: "After-Hours-trailer-feed-640x360.png", bytes: 51_234, sha256: "a".repeat(64) },
  };
  const manifest = buildTitlePairManifest(input);
  assert.deepEqual(manifest, {
    schema: "studio.title-thumbnail-pair-manifest",
    version: 1,
    generatedAt: "2026-11-22T07:00:00.000Z",
    generator: "Media Studio Image Tools — Title + thumbnail compare (browser-local)",
    pair: { id: "b", label: "B" },
    title: { text: "After Hours — trailer", maxLength: 200 },
    source: { fileName: "still_01.png", mime: "image/png", bytes: 42_000, width: 1920, height: 1080 },
    crop: { mode: "cover", anchor: "bottom", sourceRect: { left: 0, top: 0, width: 1920, height: 1080 } },
    render: {
      sizeKey: "card",
      width: 640,
      height: 360,
      format: "image/png",
      png: { fileName: "After-Hours-trailer-feed-640x360.png", bytes: 51_234, sha256: "a".repeat(64) },
    },
    local: { uploaded: false, serverInvolved: false },
  });
  assert.deepEqual(buildTitlePairManifest({ ...input, preferredPairId: "a" }), { ...manifest, preferredPairId: "a" });
  const serialized = JSON.stringify(manifest);
  for (const invented of ["rights", "assetId", "workId", "score", "uplift", "views", "claim"]) {
    assert.ok(!serialized.includes(invented), `the manifest must not invent "${invented}"`);
  }
});

function noteManifestInput() {
  return {
    generatedAt: "2026-11-23T09:00:00.000Z",
    pairId: "b",
    title: "Quiet margin",
    source: { fileName: "still.png", mime: "image/png", bytes: 900, width: 640, height: 360 },
    anchor: "centre",
    size: FEED_SIZES[1],
    sourceRect: { left: 0, top: 0, width: 640, height: 360 },
    png: { fileName: "Quiet-margin-feed-640x360.png", bytes: 1200, sha256: "b".repeat(64) },
  };
}

test("a creator note is bounded plain text and absent when empty", () => {
  assert.equal(NOTE_MAX_LENGTH, 240);
  assert.equal(normalizeCreatorNote(""), undefined);
  assert.equal(normalizeCreatorNote("   \n\t "), undefined);
  assert.equal(normalizeCreatorNote("  check the safe area  "), "check the safe area");
  assert.equal(normalizeCreatorNote("line one\r\nline two"), "line one\nline two");
  // C0/C1 controls and DEL never reach the JSON as invisible bytes.
  assert.equal(normalizeCreatorNote("a\u0001b\u007fc\u0085d"), "abcd");
  assert.equal(normalizeCreatorNote("x".repeat(NOTE_MAX_LENGTH + 50))?.length, NOTE_MAX_LENGTH);
});

test("the manifest carries a bounded note only when one was captured", () => {
  const base = noteManifestInput();
  const without = buildTitlePairManifest(base);
  assert.equal(Object.hasOwn(without, "note"), false);
  // An empty or whitespace-only note leaves the no-note manifest bytes exact.
  for (const empty of ["", "   ", "\n\t "]) {
    assert.equal(JSON.stringify(buildTitlePairManifest({ ...base, note: empty })), JSON.stringify(without));
  }
  const withNote = buildTitlePairManifest({ ...base, note: "  Watch the crop on small screens  " });
  assert.equal(withNote.note, "Watch the crop on small screens");
  const { note, ...rest } = withNote;
  assert.deepEqual(rest, without);
  assert.equal(buildTitlePairManifest({ ...base, note: "x".repeat(NOTE_MAX_LENGTH + 10) }).note?.length, NOTE_MAX_LENGTH);
  // Additive V1 metadata composes with the existing preference field.
  const both = buildTitlePairManifest({ ...base, preferredPairId: "a", note: "hello" });
  assert.equal(both.preferredPairId, "a");
  assert.equal(both.note, "hello");
  assert.equal(both.version, MANIFEST_VERSION);
});

test("the note-bearing manifest bytes are the exact bytes carried in the package ZIP", () => {
  const size = FEED_SIZES[1];
  const base = noteManifestInput();
  const manifest = buildTitlePairManifest({ ...base, note: "Keep the safe area clear." });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  assert.match(manifestText, /"note": "Keep the safe area clear\."/);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const pngName = exportFileName(base.title, base.source.fileName, size);
  const manifestName = manifestFileName(base.title, base.source.fileName, size);
  const result = createZip(
    [
      { name: pngName, data: pngBytes },
      { name: manifestName, data: manifestText },
    ],
    { date: new Date(2026, 10, 23, 9, 0) },
  );
  assert.equal(result.ok, true);
  const data = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  const found = new Map();
  let offset = 0;
  while (offset + 30 <= result.bytes.length && data.getUint32(offset, true) === 0x04034b50) {
    const length = data.getUint32(offset + 18, true);
    const nameLength = data.getUint16(offset + 26, true);
    const extraLength = data.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(result.bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    found.set(name, result.bytes.subarray(start, start + length));
    offset = start + length;
  }
  assert.deepEqual(found.get(pngName), pngBytes);
  assert.deepEqual(found.get(manifestName), new TextEncoder().encode(manifestText));
  assert.match(new TextDecoder().decode(found.get(manifestName)), /"note": "Keep the safe area clear\."/);
});

test("each pair editor writes a local note that only reaches its manifest", () => {
  assert.match(section, /Creator note \{PAIR_LABELS\[id\]\} \(optional\)/);
  assert.match(section, /<textarea\s+value=\{pair\.note\}\s+maxLength=\{NOTE_MAX_LENGTH\}/);
  assert.match(section, /onChange=\{\(event\) => setPair\(index, \{ note: event\.target\.value \}\)\}/);
  // Both note and title are captured before either export's first await.
  assert.match(section, /const title = pair\.title;\s*const note = pair\.note;/);
  assert.match(section, /return \[\{ id, title: pair\.title, note: pair\.note, image: pair\.image \}\];/);
  // The single-pair and prepared-set paths feed their captured note to the
  // same builder whose bytes are reused unchanged in the package ZIPs.
  assert.match(section, /pairId: forPair,\s*title,\s*note,\s*source:/);
  assert.match(section, /pairId: prepared\.id,\s*title: prepared\.title,\s*note: prepared\.note,\s*source:/);
  // The note never enters the PNG pixels or the clipboard title copy.
  assert.doesNotMatch(section, /writeText\([^)]*note/);
  assert.doesNotMatch(section, /context\.[a-z]+\([^)]*note/);
});

test("the manifest download name is versioned and follows the same stem rules", () => {
  const card = FEED_SIZES[1];
  assert.equal(manifestFileName("After Hours", "ignored.png", card), "After-Hours-feed-640x360-manifest-v1.json");
  assert.equal(manifestFileName("", "still_01.png", FEED_SIZES[0]), "still_01-feed-168x94-manifest-v1.json");
  assert.equal(manifestFileName("x", "y.png", card, 2), "x-feed-640x360-manifest-v2.json");
});

test("the package name follows the pair's stem and stays a plain ZIP basename", () => {
  const card = FEED_SIZES[1];
  assert.equal(bundleFileName("After Hours", "ignored.png", card), "After-Hours-feed-640x360-package.zip");
  assert.equal(bundleFileName("", "still_01.png", FEED_SIZES[0]), "still_01-feed-168x94-package.zip");
  assert.equal(bundleFileName("shot:v2?", "ignored.png", card), "shot-v2-feed-640x360-package.zip");
  assert.doesNotMatch(bundleFileName("After Hours", "ignored.png", card), /[/\\]/);
});

test("the package ZIP carries the exact PNG and manifest bytes under their own names", () => {
  const card = FEED_SIZES[1];
  const pngName = exportFileName("After Hours", "still_01.png", card);
  const manifestName = manifestFileName("After Hours", "still_01.png", card);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const manifestText = `${JSON.stringify({ version: MANIFEST_VERSION, png: pngName }, null, 2)}\n`;
  const result = createZip(
    [
      { name: pngName, data: pngBytes },
      { name: manifestName, data: manifestText },
    ],
    { date: new Date(2026, 10, 22, 7, 53) },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, [pngName, manifestName]);
  const data = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= result.bytes.length && data.getUint32(offset, true) === 0x04034b50) {
    const size = data.getUint32(offset + 18, true);
    const nameLength = data.getUint16(offset + 26, true);
    const extraLength = data.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(result.bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.push({ name, data: result.bytes.subarray(start, start + size) });
    offset = start + size;
  }
  assert.deepEqual(entries.map((entry) => entry.name), [pngName, manifestName]);
  assert.deepEqual(entries[0].data, pngBytes);
  assert.deepEqual(entries[1].data, new TextEncoder().encode(manifestText));
});

test("the manifest export offers one ZIP over the bytes it already made", () => {
  // The same encode feeds the PNG, the manifest digest and the package; the
  // JSON text is one string used by both the download and the ZIP entry.
  assert.match(section, /import \{ createZip, ZIP_MIME(?:, type ZipEntryInput)? \} from "\.\/image-zip\.ts"/);
  assert.match(section, /const manifestText = `\$\{JSON\.stringify\(manifest, null, 2\)\}\\n`/);
  assert.match(section, /const manifestBlob = new Blob\(\[manifestText\]/);
  assert.match(section, /createZip\(\[\s*\{ name, data: pngBytes \},\s*\{ name: manifestName, data: manifestText \},?\s*\]\)/);
  assert.match(section, /bundleFileName\(title \|\| image\.fileName, image\.fileName, size\)/);
  assert.match(section, /kind: "bundle"/);
  assert.match(section, /Download pair package \(ZIP\)/);
  const start = section.indexOf("async function exportSelectedPairManifest");
  const end = section.indexOf("async function exportPreparedPairs", start + 1);
  assert.ok(start >= 0 && end > start);
  assert.equal(section.slice(start, end).match(/await encodeCropPng\(image, size, forAnchor\)/g).length, 1);
});

test("the selected title can be copied through the browser Clipboard", () => {
  assert.match(section, /async function copySelectedTitle\(\): Promise<void>/);
  assert.match(section, /navigator\.clipboard\.writeText\(title\)/);
  assert.match(section, /Copy selected title/);
  assert.match(section, /aria-label=\{`Copy selected title from \$\{selectedLabel\}`\}/);
  assert.match(section, /disabled=\{!selected\.title\.trim\(\)\}/);
});

test("a refused clipboard leaves the exact title selectable in the same panel", () => {
  assert.match(section, /setTitleFallback\(title\)/);
  assert.match(section, /className="image-copy-fallback"/);
  assert.match(section, /readOnly/);
  assert.match(section, /value=\{titleFallback\}/);
  assert.match(section, /aria-label=\{`Exact \$\{selectedLabel\} title to copy`\}/);
  assert.match(section, /event\.currentTarget\.select\(\)/);
});

test("copy feedback is retired when the selected pair or its title changes", () => {
  assert.match(
    section,
    /function clearCopyFeedback\(\): void \{\s*copyRun\.current \+= 1;\s*setCopyMessage\(""\);\s*setTitleFallback\(null\);/,
  );
  assert.match(
    section,
    /function selectPair\(id: PairId\): void \{\s*if \(id === selectedId\) return;\s*clearCopyFeedback\(\);\s*setSelectedId\(id\);/,
  );
  assert.match(
    section,
    /function updateTitle\(index: number, title: string\): void \{\s*if \(index === PAIR_IDS\.indexOf\(selectedId\)\) clearCopyFeedback\(\);\s*setPair\(index, \{ title \}\);/,
  );
  assert.match(section, /copyRun\.current === run/);
});

test("the stylesheet renders real pixel boxes and real truncation", () => {
  assert.match(stylesheet, /aspect-ratio: 16 \/ 9/);
  assert.match(stylesheet, /max-width: 640px/);
  assert.match(stylesheet, /-webkit-line-clamp: 2/);
  assert.match(stylesheet, /object-fit: cover/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.match(stylesheet, /max-width: 820px/);
});

test("the title fit note uses the rendered, nonempty preview box", () => {
  assert.match(section, /title\.clientHeight === 0/);
  assert.match(section, /title\.scrollHeight - title\.clientHeight > 1/);
  assert.match(section, /rowClipped = hasTitle && titleClips/);
  assert.match(section, /cardClipped = hasTitle && titleClips/);
  assert.match(section, /className="title-compare-fit-note"/);
  assert.doesNotMatch(section, /title-compare-fit-note[^\n]*aria-live/);
});

test("the section catches a deep link that lands before React mounts", () => {
  // Proven gap: the heading only exists after React mounts, so the browser's
  // native fragment scroll never runs and the heading is not focusable.
  assert.match(section, /<h2 id="image-title-compare-heading" tabIndex=\{-1\}>/);
  assert.match(
    section,
    /if \(window\.location\.hash !== "#image-title-compare-heading"\) return;\s*const heading = document\.getElementById\("image-title-compare-heading"\);\s*heading\?\.scrollIntoView\(\{ block: "start" \}\);\s*heading\?\.focus\(\{ preventScroll: true \}\);/,
  );
});

test("prepared pairs keep distinct stable names inside the packaging ZIP", () => {
  const size = FEED_SIZES[1];
  const a = pairArchiveFileNames("a", size);
  const b = pairArchiveFileNames("b", size);
  const names = [a.png, a.manifest, b.png, b.manifest];
  assert.equal(new Set(names).size, 4);
  const archive = createZip(names.map(name => ({ name, data: "fixture" })));
  assert.equal(archive.ok, true);
  assert.deepEqual(archive.entries, names);
  assert.equal(preparedPairsBundleFileName(size, 2), "prepared-pairs-2-feed-640x360-package.zip");
});

test("a preferred pair is included only when the exact export contains it", () => {
  assert.equal(preferredPairForExport("b", ["a", "b"]), "b");
  assert.equal(preferredPairForExport("c", ["a", "b"]), undefined);
  assert.equal(preferredPairForExport(null, ["a", "b"]), undefined);
});
