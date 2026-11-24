// Focused checks for the title + thumbnail compare slice: the pure cover-crop
// plan shared by the CSS preview and the PNG export, the download-name rules,
// and the source-level wiring of the workbench section.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALT_MAX_LENGTH,
  FEED_SIZES,
  HYPOTHESIS_MAX_LENGTH,
  MANIFEST_SCHEMA,
  MANIFEST_VERSION,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  buildTitlePairManifest,
  bundleFileName,
  coverCropRect,
  describeExportAnchors,
  duplicateTargetPair,
  exportFileName,
  manifestFileName,
  normalizeCreatorNote,
  normalizeTestingHypothesis,
  normalizeThumbnailAlt,
  objectPositionFor,
  pairArchiveFileNames,
  pairIsEmpty,
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

test("a prepared-set label names a shared anchor or says the crops differ", () => {
  assert.equal(describeExportAnchors(["centre", "centre", "centre"]), "Centre");
  assert.equal(describeExportAnchors(["top"]), "Top");
  assert.equal(describeExportAnchors(["centre", "bottom"]), "per-pair");
  assert.equal(describeExportAnchors([]), "Centre");
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
  assert.match(workbench, /<TitleCompare preparedImage=\{preparedTitleImage\} \/>/);
});

test("every pair keeps its own crop anchor with centre defaults", () => {
  assert.match(
    section,
    /const \[anchors, setAnchors\] = useState<Record<PairId, CropAnchorKey>>\(\(\) => \(\{\s*a: "centre",\s*b: "centre",\s*c: "centre",?\s*\}\)\)/,
  );
  // The select shows and edits the active pair, and each compact preview reads
  // its own pair's anchor.
  assert.match(section, /const anchor = anchors\[selectedId\]/);
  assert.match(section, /const position = objectPositionFor\(anchors\[id\]\)/);
  assert.match(section, /\{`Preview crop position for \$\{selectedLabel\}`\}/);
  assert.match(section, /data-title-compare-anchor-pair=\{selectedId\}/);
  assert.match(
    section,
    /onChange=\{\(event\) => updateAnchor\(selectedIndex, event\.target\.value as CropAnchorKey\)\}/,
  );
  assert.match(section, /function updateAnchor\(index: number, next: CropAnchorKey\): void \{/);
  assert.match(section, /if \(anchors\[id\] === next\) return;/);
  assert.match(section, /setAnchors\(\(current\) => \(\{ \.\.\.current, \[id\]: next \}\)\)/);
});

test("a crop edit clears only the edited pair's preference", () => {
  const start = section.indexOf("function updateAnchor");
  const end = section.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start);
  const update = section.slice(start, end);
  assert.match(update, /clearPreferenceFor\(index\)/);
  assert.doesNotMatch(update, /setPreferredId|setSelectedId|discardExports/);
});

test("each export captures its pair's anchor before the first await", () => {
  // Single-pair PNG and manifest capture the selected pair's own anchor.
  assert.equal(
    (section.match(/const forPair = selectedId;\s*const forAnchor = anchors\[forPair\];/g) ?? []).length,
    2,
  );
  assert.match(
    section,
    /return \[\{ id, title: pair\.title, note: pair\.note, anchor: anchors\[id\], image: pair\.image, alt: pair\.alt, hypothesis: pair\.hypothesis \}\];/,
  );
  // The set snapshot carries each pair's anchor and the loop encodes with it.
  assert.match(
    section,
    /const setAnchorLabel = describeExportAnchors\(captured\.map\(\(pair\) => pair\.anchor\)\)/,
  );
  assert.match(
    section,
    /for \(const prepared of captured\) \{\s*const image = prepared\.image;\s*const forAnchor = prepared\.anchor;/,
  );
  assert.match(section, /anchor: forAnchor,/);
  assert.match(section, /anchorLabel: setAnchorLabel,/);
  assert.doesNotMatch(section, /const forAnchor = anchor;/);
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

test("centre stays the default and the legacy manifest shape is unchanged", () => {
  // All pairs default to centre, and a centre plan is still the same
  // whole-pixel rect the preview and PNG have always used.
  assert.deepEqual(coverCropRect(2000, 1080, 640, 360, "centre"), {
    left: 40,
    top: 0,
    width: 1920,
    height: 1080,
  });
  const manifest = buildTitlePairManifest({ ...noteManifestInput(), anchor: "centre" });
  assert.equal(manifest.version, 1);
  assert.equal(manifest.crop.anchor, "centre");
  assert.equal(JSON.stringify(manifest).includes("per-pair"), false);
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
  assert.match(section, /return \[\{ id, title: pair\.title, note: pair\.note, anchor: anchors\[id\], image: pair\.image, alt: pair\.alt, hypothesis: pair\.hypothesis \}\];/);
  // The single-pair and prepared-set paths feed their captured note to the
  // same builder whose bytes are reused unchanged in the package ZIPs.
  assert.match(section, /pairId: forPair,\s*title,\s*note,\s*source:/);
  assert.match(section, /pairId: prepared\.id,\s*title: prepared\.title,\s*note: prepared\.note,\s*source:/);
  // The note never enters the PNG pixels or the clipboard title copy.
  assert.doesNotMatch(section, /writeText\([^)]*note/);
  assert.doesNotMatch(section, /context\.[a-z]+\([^)]*note/);
});

test("thumbnail alt text is bounded plain text and absent when blank", () => {
  assert.equal(ALT_MAX_LENGTH, 160);
  assert.equal(normalizeThumbnailAlt(""), undefined);
  assert.equal(normalizeThumbnailAlt("   \n\t "), undefined);
  assert.equal(normalizeThumbnailAlt("  Red tram crossing the wet street  "), "Red tram crossing the wet street");
  assert.equal(normalizeThumbnailAlt("line one\r\nline two"), "line one\nline two");
  // C0/C1 controls and DEL never reach the JSON as invisible bytes.
  assert.equal(normalizeThumbnailAlt("a\u0001b\u007fc\u0085d"), "abcd");
  assert.equal(normalizeThumbnailAlt("x".repeat(ALT_MAX_LENGTH + 20))?.length, ALT_MAX_LENGTH);
});

test("the manifest carries alt text only when one was captured", () => {
  const base = noteManifestInput();
  const without = buildTitlePairManifest(base);
  assert.equal(Object.hasOwn(without, "alt"), false);
  // An empty or whitespace-only alt leaves the no-alt manifest bytes exact.
  for (const empty of ["", "   ", "\n\t "]) {
    assert.equal(JSON.stringify(buildTitlePairManifest({ ...base, alt: empty })), JSON.stringify(without));
  }
  const withAlt = buildTitlePairManifest({ ...base, alt: "  A red tram crossing the wet street  " });
  assert.equal(withAlt.alt, "A red tram crossing the wet street");
  const { alt, ...rest } = withAlt;
  assert.deepEqual(rest, without);
  assert.equal(withAlt.version, MANIFEST_VERSION);
  assert.equal(buildTitlePairManifest({ ...base, alt: "x".repeat(ALT_MAX_LENGTH + 10) }).alt?.length, ALT_MAX_LENGTH);
  // Additive V1 metadata composes with the preference and note fields.
  const both = buildTitlePairManifest({ ...base, preferredPairId: "a", note: "Keep left", alt: "Red tram" });
  assert.equal(both.preferredPairId, "a");
  assert.equal(both.note, "Keep left");
  assert.equal(both.alt, "Red tram");
});

test("thumbnail alt text is retained per pair for single and prepared exports", () => {
  assert.match(section, /const title = pair\.title;\s*const note = pair\.note;\s*const alt = pair\.alt;/);
  assert.match(
    section,
    /return \[\{ id, title: pair\.title, note: pair\.note, anchor: anchors\[id\], image: pair\.image, alt: pair\.alt, hypothesis: pair\.hypothesis \}\];/,
  );
  // Both export paths pass the captured alt text to the one manifest builder.
  assert.match(section, /png: \{ fileName: name, bytes: blob\.size, sha256 \},\s*alt,/);
  assert.match(
    section,
    /png: \{ fileName: names\.png, bytes: pngBytes\.byteLength, sha256 \},\s*preferredPairId: preferredForExport,\s*alt: prepared\.alt,/,
  );
  assert.match(section, /pairId: prepared\.id,\s*title: prepared\.title,\s*note: prepared\.note,\s*source:/);
  // The selected-pair control is visible, bounded and named for that pair.
  assert.match(section, /Thumbnail alt text for \$\{selectedLabel\} \(optional, up to \$\{ALT_MAX_LENGTH\} characters\)/);
  assert.match(section, /<input\s+type="text"\s+value=\{selected\.alt\}\s+maxLength=\{ALT_MAX_LENGTH\}/);
  assert.match(section, /data-title-compare-alt-pair=\{selectedId\}/);
  assert.match(section, /onChange=\{\(event\) => updateAlt\(selectedIndex, event\.target\.value\)\}/);
});

test("an alt edit retires prepared output and leaves pixels, crop and preference alone", () => {
  const start = section.indexOf("function updateAlt");
  const end = section.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start);
  const update = section.slice(start, end);
  assert.match(update, /setPair\(index, \{ alt: next \}\)/);
  assert.match(update, /retirePreparedOutput\(\)/);
  assert.doesNotMatch(
    update,
    /clearPreferenceFor|setPreferredId|setAnchors|encodeCropPng|toBlob|createImageBitmap|canvas/,
  );

  const retireStart = section.indexOf("function retirePreparedOutput");
  const retireEnd = section.indexOf("\n  }", retireStart);
  assert.ok(retireStart >= 0 && retireEnd > retireStart);
  const retire = section.slice(retireStart, retireEnd);
  assert.match(retire, /exportRun\.current \+= 1/);
  assert.match(retire, /setExportBusy\(false\)/);
  assert.match(retire, /setExportMessage\(""\)/);
  assert.match(retire, /discardExports\(\)/);
  // Only export state is retired: the pair, crop, preference and selection stay.
  assert.doesNotMatch(retire, /setPair|setAnchors|setPreferredId|setSelectedId|setTitleFallback/);
});

test("alt text is independent per pair and the full-size image keeps its fallback", () => {
  const base = noteManifestInput();
  const a = buildTitlePairManifest({ ...base, pairId: "a", title: "Same title", alt: "Pair A description" });
  const b = buildTitlePairManifest({ ...base, pairId: "b", title: "Same title" });
  assert.equal(a.alt, "Pair A description");
  assert.equal(Object.hasOwn(b, "alt"), false);
  assert.match(section, /const selectedAlt = normalizeThumbnailAlt\(selected\.alt\);/);
  assert.match(section, /alt=\{selectedAlt \?\? `Full-size source thumbnail for \$\{selectedLabel\}`\}/);
  const empty = { title: "", alt: "", note: "", hasImage: false, busy: false, anchor: "centre" };
  assert.equal(pairIsEmpty({ ...empty, alt: "Described" }), false);
  assert.equal(pairIsEmpty({ ...empty, alt: "   " }), true);
  assert.equal(pairIsEmpty({ ...empty, alt: undefined }), true);
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

test("selection and title changes retire the applicable copy feedback and prepared exports", () => {
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
    /function updateTitle\(index: number, title: string\): void \{\s*if \(pairs\[index\]\?\.title === title\) return;\s*if \(index === PAIR_IDS\.indexOf\(selectedId\)\) clearCopyFeedback\(\);\s*setPair\(index, \{ title \}\);\s*clearPreferenceFor\(index\);\s*retirePreparedOutput\(\);/,
  );
  assert.match(section, /copyRun\.current === run/);
});

test("a prepared PNG is copied from the exact download blob, with no re-encode", () => {
  assert.match(section, /pngBlob\?: Blob;/);
  // Only the row/card PNG export and the manifest export's PNG carry the blob.
  assert.equal(section.match(/pngBlob: blob,/g)?.length, 2);
  assert.match(section, /new window\.ClipboardItem\(\{ "image\/png": entry\.pngBlob \}\)/);
  assert.match(section, /await navigator\.clipboard\.write\(\[png\]\)/);
  const start = section.indexOf("async function copyEntryPng");
  const end = section.indexOf("\n  }", start);
  const copy = section.slice(start, end);
  assert.match(copy, /copyEntryPng\(entry: ExportEntry\)/);
  assert.doesNotMatch(copy, /encodeCropPng|createObjectURL|trackUrl|fetch\(/);
});

test("a prepared manifest is copied from its one captured JSON text under the existing stale guard", () => {
  assert.match(section, /manifestText\?: string;/);
  // The exact text built for the download blob is captured once and reused.
  assert.match(section, /const manifestText = `\$\{JSON\.stringify\(manifest, null, 2\)\}\\n`/);
  assert.equal(section.match(/manifestText,/g)?.length, 1);
  const start = section.indexOf("async function copyEntryManifest");
  const end = section.indexOf("\n  }", start);
  const copy = section.slice(start, end);
  assert.match(copy, /copyEntryManifest\(entry: ExportEntry\)/);
  assert.match(copy, /copyAttemptFor\(entry\.url\)/);
  assert.match(copy, /navigator\.clipboard\.writeText\(entry\.manifestText\)/);
  assert.doesNotMatch(copy, /encodeCropPng|createObjectURL|trackUrl|fetch\(/);
  // Only a prepared manifest with text support offers the action; the
  // download link stays alongside it in the same export row.
  assert.match(
    section,
    /const canCopyManifest =\s*typeof navigator !== "undefined" &&\s*typeof navigator\.clipboard\?\.writeText === "function"/,
  );
  assert.match(section, /entry\.kind === "manifest" && entry\.manifestText && canCopyManifest/);
  assert.match(section, /data-title-compare-copy-manifest=\{entry\.url\}/);
  assert.match(section, /data-title-compare-copy-pair=\{entry\.pairLabel\}/);
  assert.match(section, /Copy Pair \$\{entry\.pairLabel\} manifest JSON/);
  assert.match(section, /Could not copy the manifest JSON for Pair \$\{entry\.pairLabel\}\. Download it instead\./);
  assert.match(stylesheet, /button\[data-title-compare-copy-manifest\]/);
});

test("the copy control names its pair, size and exact prepared PNG beside the download", () => {
  assert.match(section, /data-title-compare-copy-png=\{entry\.url\}/);
  assert.match(section, /data-title-compare-copy-pair=\{entry\.pairLabel\}/);
  assert.match(section, /data-title-compare-copy-size=\{entry\.label\}/);
  assert.match(section, /Copy the \$\{entry\.label\} PNG for Pair \$\{entry\.pairLabel\}/);
  assert.match(section, /\$\{entry\.name\} \(\$\{entry\.width\} × \$\{entry\.height\} px\) to the clipboard/);
  assert.match(section, /href=\{entry\.url\}/);
  assert.match(section, /download=\{entry\.name\}/);
  assert.match(section, /typeof window\.ClipboardItem === "function"/);
  assert.match(section, /typeof navigator\.clipboard\?\.write === "function"/);
  assert.match(stylesheet, /title-compare-export button\[data-title-compare-copy-png\]/);
});

test("PNG copy feedback cannot outlive the prepared PNG it describes", () => {
  const start = section.indexOf("function replaceExports");
  const end = section.indexOf("\n  }", start);
  assert.match(section.slice(start, end), /pngCopyRun\.current \+= 1/);
  assert.match(section.slice(start, end), /setPngCopy\(null\)/);
  // Once when the export list is replaced or cleared, once on unmount.
  assert.equal(section.match(/pngCopyRun\.current \+= 1/g)?.length, 2);
  assert.match(section, /attempt === pngCopyRun\.current/);
  assert.match(section, /exportsRef\.current\.some\(\(entry\) => entry\.url === key\)/);
  assert.match(section, /pngCopy\?\.key === entry\.url/);
  assert.match(section, /Could not copy the PNG\. Download it instead\./);
  assert.match(stylesheet, /\.title-compare-export-copy-status\.is-error/);
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

test("the workbench offers its exact finished result to the packaging compare", () => {
  assert.match(workbench, /const preparedTitleImage: PreparedTitleImage \| null = selected\?\.result/);
  assert.match(workbench, /blob: selected\.result\.blob/);
  assert.match(workbench, /filename: renderedFileName\(selected\.file\.name, selected\.result\)/);
  assert.match(workbench, /mime: selected\.result\.mime/);
  assert.match(workbench, /<TitleCompare preparedImage=\{preparedTitleImage\} \/>/);
  // The offer does not add an input file, upload or save path of its own.
  assert.doesNotMatch(workbench, /<TitleCompare[^>]*(?:onUpload|autoApply|save)/);
});

test("the prepared handoff is explicit and wraps the exact blob without re-encoding", () => {
  assert.match(section, /function usePreparedImage\(index: number\): void \{/);
  assert.match(
    section,
    /new File\(\[preparedImage\.blob\], preparedImage\.filename, \{\s*type: preparedImage\.mime \|\| preparedImage\.blob\.type,?\s*\}\)/,
  );
  assert.match(section, /void chooseImage\(index, file\)/);
  assert.match(section, /onClick=\{\(\) => usePreparedImage\(index\)\}/);
  // One definition and one button handler: no effect or prop watcher applies it.
  assert.equal((section.match(/usePreparedImage\(/g) ?? []).length, 2);
  const start = section.indexOf("function usePreparedImage");
  const end = section.indexOf("function removeImage", start);
  assert.ok(start >= 0 && end > start);
  const handoff = section.slice(start, end);
  assert.doesNotMatch(handoff, /toBlob|createImageBitmap|canvas/);
  assert.doesNotMatch(handoff, /fetch\(|XMLHttpRequest|localStorage/);
});

test("the prepared action names the offered image and any thumbnail it replaces", () => {
  assert.match(section, /data-title-compare-prepared-offer/);
  assert.match(section, /Prepared image: \$\{preparedImage\.filename\}/);
  assert.match(section, /preparedImage\.width\} × \$\{preparedImage\.height\} px/);
  assert.match(section, /data-title-compare-prepared-use=\{id\}/);
  assert.match(section, /Use prepared image for Pair \$\{PAIR_LABELS\[id\]\}/);
  assert.match(section, /\(replaces current thumbnail\)/);
  assert.match(section, /Replaces \$\{pair\.image\.fileName\}/);
  assert.match(section, /Replacing the thumbnail clears this pair’s preference/);
  // The offer is already bounded by the same input limit chooseImage enforces.
  assert.match(section, /preparedImage\.bytes > MAX_IMAGE_INPUT_BYTES/);
});

test("the prepared handoff keeps the pair's text and shares the existing preference rule", () => {
  assert.match(section, /clearPreferenceFor\(index\);\s*retirePreparedOutput\(\);/);
  const start = section.indexOf("function usePreparedImage");
  const end = section.indexOf("function removeImage", start);
  const handoff = section.slice(start, end);
  assert.match(handoff, /void chooseImage\(index, file\)/);
  assert.doesNotMatch(handoff, /setPair\([^)]*(?:title|note)|setPreferredId|setSelectedId/);
});

test("the local picker and drop keep their existing intake rules", () => {
  assert.match(section, /void chooseImage\(index, event\.dataTransfer\.files\[0\]\)/);
  assert.match(section, /void chooseImage\(index, file\);/);
  assert.match(section, /const previous = pairs\[index\]\.image;\s*releaseUrl\(previous\?\.url\);/);
  assert.match(section, /clearPreferenceFor\(index\);\s*retirePreparedOutput\(\);/);
});

test("the full-size framing preview is a bounded, honest browser-local overlay", () => {
  const start = section.indexOf("<details");
  const end = section.indexOf("</details>", start);
  assert.ok(start >= 0 && end > start);
  const disclosure = section.slice(start, end);
  // A native disclosure keeps focus, pair switching and every other control live.
  assert.match(disclosure, /className="title-compare-full"/);
  assert.match(disclosure, /<summary>/);
  assert.match(disclosure, /data-title-compare-full-size/);
  assert.match(disclosure, /data-title-compare-full-crop/);
  // It shows the existing blob URL at 1:1 — no display-time decode or re-encode.
  assert.match(disclosure, /src=\{selectedImage\.url\}/);
  assert.match(disclosure, /width=\{selectedImage\.width\}/);
  assert.doesNotMatch(disclosure, /toBlob|createImageBitmap|[< ]canvas/);
  // Genuine labelling and the real intrinsic dimensions of the source.
  assert.match(disclosure, /Simulated framing/);
  assert.match(disclosure, /The outline shows the crop used in the PNG export/);
  assert.match(disclosure, /aria-label="Scrollable full-size thumbnail"\s+tabIndex=\{0\}/);
  assert.match(disclosure, /source \$\{selectedImage\.width\} × \$\{selectedImage\.height\} px/);
  // One shared crop plan drives the preview frame and the exported pixels.
  assert.match(
    section,
    /coverCropRect\(selectedImage\.width, selectedImage\.height, fullViewSize\.width, fullViewSize\.height, anchor\)/,
  );
  // The bounded scroll box keeps phone pages free of horizontal overflow.
  assert.match(stylesheet, /max-height: min\(65vh, 34rem\)/);
  assert.match(stylesheet, /\.title-compare-full-viewport/);
  assert.match(stylesheet, /\.title-compare-full-crop/);
});

const emptyOccupancy = { title: "", note: "", hasImage: false, busy: false, anchor: "centre" };

test("only an empty pair can receive a duplicate", () => {
  assert.equal(pairIsEmpty(emptyOccupancy), true);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, title: "   " }), true);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, note: " \n " }), true);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, title: "After Hours" }), false);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, note: "keep the safe area" }), false);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, hasImage: true }), false);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, busy: true }), false);
  assert.equal(pairIsEmpty({ ...emptyOccupancy, anchor: "right" }), false);
});

test("the duplicate target is the first empty other pair in A/B/C order", () => {
  assert.equal(duplicateTargetPair([emptyOccupancy, emptyOccupancy, emptyOccupancy], "a"), "b");
  assert.equal(duplicateTargetPair([emptyOccupancy, emptyOccupancy, emptyOccupancy], "b"), "a");
  assert.equal(duplicateTargetPair([emptyOccupancy, emptyOccupancy, emptyOccupancy], "c"), "a");
  const named = { ...emptyOccupancy, title: "Named" };
  assert.equal(duplicateTargetPair([emptyOccupancy, named, emptyOccupancy], "a"), "c");
  assert.equal(duplicateTargetPair([emptyOccupancy, named, emptyOccupancy], "c"), "a");
  // A pending decode or an existing crop, image or note keeps its pair.
  for (const occupied of [
    { ...emptyOccupancy, busy: true },
    { ...emptyOccupancy, anchor: "right" },
    { ...emptyOccupancy, hasImage: true },
    { ...emptyOccupancy, note: "rationale" },
  ]) {
    assert.equal(duplicateTargetPair([emptyOccupancy, occupied, occupied], "a"), null);
  }
});

test("the duplicate action copies one complete pair into an empty pair and selects it", () => {
  assert.match(section, /function duplicateSelectedPair\(\): void \{/);
  const start = section.indexOf("function duplicateSelectedPair");
  const end = section.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start);
  const duplicate = section.slice(start, end);
  assert.match(duplicate, /if \(!source \|\| !completePair\(source\)\) return;/);
  assert.match(duplicate, /const target = duplicateTarget;/);
  assert.match(duplicate, /if \(!target\) return;/);
  assert.match(duplicate, /title: source\.title,/);
  assert.match(duplicate, /note: "",/);
  assert.match(duplicate, /image: \{ \.\.\.sourceImage, url \},/);
  assert.match(duplicate, /setAnchors\(\(current\) => \(\{ \.\.\.current, \[target\]: sourceAnchor \}\)\);/);
  assert.match(duplicate, /setSelectedId\(target\);/);
  // The original keeps its preference and creator rationale; the copy's note
  // starts empty and no other pair is edited.
  assert.doesNotMatch(duplicate, /setPreferredId|clearPreferenceFor|note: source\.note/);
});

test("a duplicated thumbnail gets its own URL and never revokes the source's", () => {
  const start = section.indexOf("function duplicateSelectedPair");
  const end = section.indexOf("\n  }", start);
  const duplicate = section.slice(start, end);
  // A fresh URL over the same immutable File bytes, tracked by the same set.
  assert.match(duplicate, /const url = trackUrl\(sourceImage\.file\);/);
  assert.doesNotMatch(duplicate, /sourceImage\.url|releaseUrl|URL\.revokeObjectURL/);
  assert.match(duplicate, /image: \{ \.\.\.sourceImage, url \},/);
  // The existing remove paths revoke only the URL the named pair owns.
  assert.match(section, /releaseUrl\(pairs\[index\]\.image\?\.url\)/);
  assert.match(
    section,
    /function releaseUrl\(url: string \| undefined\): void \{\s*if \(url && urls\.current\.delete\(url\)\) URL\.revokeObjectURL\(url\);/,
  );
});

test("the duplicate action names its target and shows a clear inactive state", () => {
  assert.match(section, /const duplicateTarget = duplicateTargetPair\(\s*pairs\.map\(\(pair, index\) => pairOccupancy\(pair, anchors\[PAIR_IDS\[index\]\]\)\), selectedId,\s*\);/);
  assert.match(section, /const canDuplicatePair = duplicateSourceComplete && duplicateTarget !== null;/);
  assert.match(section, /data-title-compare-duplicate-group/);
  assert.match(section, /data-title-compare-duplicate\n/);
  assert.match(section, /data-title-compare-duplicate-state=\{/);
  assert.match(section, /canDuplicatePair \? "ready" : duplicateSourceComplete \? "no-empty" : "incomplete"/);
  assert.match(section, /data-title-compare-duplicate-target=\{duplicateTarget \?\? undefined\}/);
  assert.match(section, /disabled=\{!canDuplicatePair\}/);
  assert.match(section, /aria-describedby="image-title-compare-duplicate-note"/);
  assert.match(section, /id="image-title-compare-duplicate-note"/);
  assert.match(section, /onClick=\{duplicateSelectedPair\}/);
  assert.match(section, /Duplicate \$\{selectedLabel\} into Pair \$\{PAIR_LABELS\[duplicateTarget\]\}/);
  assert.match(section, /To free a pair, clear its title, alt text, hypothesis, note and thumbnail and set its crop to Centre/);
  assert.match(section, /Add a title and thumbnail to \$\{selectedLabel\} to duplicate it/);
  assert.match(section, /Copies the title, thumbnail, alt text, testing hypothesis and crop/);
  assert.match(stylesheet, /\.title-compare-duplicate/);
});

test("a duplicate keeps the source bytes, crop and title, with a note-free manifest", () => {
  const input = noteManifestInput();
  const source = buildTitlePairManifest({
    ...input,
    pairId: "a",
    title: "Shared title",
    anchor: "top",
    note: "Original rationale",
  });
  const copy = buildTitlePairManifest({ ...input, pairId: "b", title: "Shared title", anchor: "top" });
  // Same source facts, title, crop plan and PNG facts; only the pair identity
  // differs and the copy carries no note until its creator writes one.
  assert.deepEqual(copy.source, source.source);
  assert.deepEqual(copy.title, source.title);
  assert.deepEqual(copy.crop, source.crop);
  assert.deepEqual(copy.render, source.render);
  assert.deepEqual(copy.pair, { id: "b", label: "B" });
  assert.equal(Object.hasOwn(copy, "note"), false);
  assert.equal(source.note, "Original rationale");
  assert.equal(copy.preferredPairId, undefined);
  // The action copies the validated File and the source's own anchor; it does
  // not re-pick, re-decode or re-encode anything.
  const start = section.indexOf("function duplicateSelectedPair");
  const end = section.indexOf("\n  }", start);
  const duplicate = section.slice(start, end);
  assert.match(duplicate, /const sourceAnchor = anchors\[selectedId\];/);
  assert.match(duplicate, /image: \{ \.\.\.sourceImage, url \},/);
  assert.doesNotMatch(duplicate, /chooseImage|usePreparedImage|toBlob|createImageBitmap|canvas/);
});

// A creator's testing hypothesis: one bounded, optional, per-pair expectation
// carried through the same v1 manifest, ZIP and pair-ownership paths as an alt
// description. It is text only — never a score, a measured result or a route.

test("a testing hypothesis is bounded plain text and absent when blank", () => {
  assert.equal(HYPOTHESIS_MAX_LENGTH, NOTE_MAX_LENGTH);
  assert.equal(normalizeTestingHypothesis(""), undefined);
  assert.equal(normalizeTestingHypothesis("  \n\t "), undefined);
  assert.equal(normalizeTestingHypothesis("  Try the quieter title first  "), "Try the quieter title first");
  assert.equal(normalizeTestingHypothesis("line one\r\nline two"), "line one\nline two");
  // C0/C1 controls and DEL never reach the JSON as invisible bytes.
  assert.equal(normalizeTestingHypothesis("a\u0001b\u007fc\u0085d"), "abcd");
  assert.equal(normalizeTestingHypothesis("x".repeat(HYPOTHESIS_MAX_LENGTH + 50))?.length, HYPOTHESIS_MAX_LENGTH);
});

test("the manifest carries a hypothesis only when one was captured", () => {
  const base = noteManifestInput();
  const without = buildTitlePairManifest(base);
  assert.equal(Object.hasOwn(without, "hypothesis"), false);
  // Empty or whitespace-only input leaves the pre-hypothesis bytes exact.
  for (const empty of ["", "   ", "\n\t "]) {
    assert.equal(JSON.stringify(buildTitlePairManifest({ ...base, hypothesis: empty })), JSON.stringify(without));
  }
  const withHypothesis = buildTitlePairManifest({ ...base, hypothesis: "  Expect the quiet title to hold on mobile  " });
  assert.equal(withHypothesis.hypothesis, "Expect the quiet title to hold on mobile");
  const { hypothesis, ...rest } = withHypothesis;
  assert.deepEqual(rest, without);
  assert.equal(withHypothesis.version, MANIFEST_VERSION);
  assert.equal(buildTitlePairManifest({ ...base, hypothesis: "x".repeat(HYPOTHESIS_MAX_LENGTH + 10) }).hypothesis?.length, HYPOTHESIS_MAX_LENGTH);
  // It composes with every other additive V1 field, still under version 1.
  const both = buildTitlePairManifest({
    ...base,
    preferredPairId: "a",
    note: "Keep left",
    alt: "Red tram",
    hypothesis: "Quieter title wins",
  });
  assert.equal(both.preferredPairId, "a");
  assert.equal(both.note, "Keep left");
  assert.equal(both.alt, "Red tram");
  assert.equal(both.hypothesis, "Quieter title wins");
  assert.equal(both.version, MANIFEST_VERSION);
  // No analytic score, measured uplift or audience experiment is invented.
  const serialized = JSON.stringify(withHypothesis);
  for (const invented of ["score", "uplift", "views", "ctr", "experiment", "audience"]) {
    assert.ok(!serialized.includes(invented), `the manifest must not invent "${invented}"`);
  }
});

test("the hypothesis-bearing manifest JSON is the exact text the package ZIP carries", () => {
  const size = FEED_SIZES[1];
  const base = noteManifestInput();
  const manifest = buildTitlePairManifest({ ...base, hypothesis: "Expect the quieter cut to hold." });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  assert.match(manifestText, /"hypothesis": "Expect the quieter cut to hold\."/);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
  const pngName = exportFileName(base.title, base.source.fileName, size);
  const manifestName = manifestFileName(base.title, base.source.fileName, size);
  const result = createZip(
    [
      { name: pngName, data: pngBytes },
      { name: manifestName, data: manifestText },
    ],
    { date: new Date(2026, 10, 24, 3, 12) },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, [pngName, manifestName]);
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
  // The PNG bytes are untouched by the text field, and the JSON is byte-exact.
  assert.deepEqual(found.get(pngName), pngBytes);
  assert.deepEqual(found.get(manifestName), new TextEncoder().encode(manifestText));
  assert.match(new TextDecoder().decode(found.get(manifestName)), /"hypothesis": "Expect the quieter cut to hold\."/);
});

test("the encoder never reads the hypothesis, so initial PNG pixels stay exact", () => {
  const start = section.indexOf("async function encodeCropPng");
  const end = section.indexOf("/** SHA-256 over", start);
  assert.ok(start >= 0 && end > start);
  const encode = section.slice(start, end);
  assert.doesNotMatch(encode, /hypothesis|note|alt|title/);
  assert.match(encode, /context\.drawImage\(bitmap, plan\.left, plan\.top, plan\.width, plan\.height, 0, 0, size\.width, size\.height\)/);
});

test("the selected-pair hypothesis control is labelled, bounded and pair-scoped", () => {
  assert.match(section, /Testing hypothesis for \$\{selectedLabel\} \(optional\)/);
  assert.match(section, /<input\s+type="text"\s+value=\{selected\.hypothesis\}\s+maxLength=\{HYPOTHESIS_MAX_LENGTH\}/);
  assert.match(section, /data-title-compare-hypothesis-pair=\{selectedId\}/);
  assert.match(section, /onChange=\{\(event\) => updateHypothesis\(selectedIndex, event\.target\.value\)\}/);
  assert.match(section, /What do you expect this pair to do\?/);
  assert.match(section, /disabled=\{selected\.busy\}/);
  assert.match(section, /aria-describedby="image-title-compare-hypothesis-note"/);
  assert.match(stylesheet, /\.title-compare-hypothesis input/);
  // It is browser-local text: no route, provider, storage or new dependency.
  assert.doesNotMatch(section, /hypothesis[^\n]*(?:fetch\(|localStorage|sessionStorage|indexedDB)/);
});

test("an hypothesis edit retires prepared exports without touching the pair", () => {
  const start = section.indexOf("function updateHypothesis");
  const end = section.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start);
  const update = section.slice(start, end);
  assert.match(update, /if \(pairs\[index\]\?\.hypothesis === next\) return;/);
  assert.match(update, /setPair\(index, \{ hypothesis: next \}\)/);
  assert.match(update, /retirePreparedOutput\(\)/);
  assert.doesNotMatch(
    update,
    /clearPreferenceFor|setPreferredId|setAnchors|setSelectedId|encodeCropPng|toBlob|createImageBitmap|canvas/,
  );
  const retireStart = section.indexOf("function retirePreparedOutput");
  const retire = section.slice(retireStart, section.indexOf("\n  }", retireStart));
  assert.match(retire, /exportRun\.current \+= 1/);
  assert.match(retire, /discardExports\(\)/);
});

test("the hypothesis belongs to its pair, follows duplication and clears with replaced media", () => {
  assert.match(section, /hypothesis: string;/);
  assert.match(section, /hypothesis: ""/); // emptyPair
  assert.match(section, /hypothesis: pair\.hypothesis/); // occupancy
  // Both export paths capture the same pair's hypothesis before the first await.
  assert.match(section, /const alt = pair\.alt;\s*const hypothesis = pair\.hypothesis;/);
  assert.match(section, /alt,\s*hypothesis,/);
  assert.match(section, /alt: prepared\.alt,\s*hypothesis: prepared\.hypothesis,/);
  // Explicit duplication of a complete pair carries the expectation with it;
  // the source keeps its own text and the copy's note still starts empty.
  const start = section.indexOf("function duplicateSelectedPair");
  const duplicate = section.slice(start, section.indexOf("\n  }", start));
  assert.match(duplicate, /hypothesis: source\.hypothesis,/);
  assert.match(duplicate, /note: "",/);
  assert.doesNotMatch(duplicate, /note: source\.note|setPreferredId|clearPreferenceFor/);
  // A hypothesis occupies a pair, so it cannot be overwritten by a duplicate.
  const empty = { title: "", alt: "", hypothesis: "", note: "", hasImage: false, busy: false, anchor: "centre" };
  assert.equal(pairIsEmpty(empty), true);
  assert.equal(pairIsEmpty({ ...empty, hypothesis: "Expect a quieter title" }), false);
  assert.equal(pairIsEmpty({ ...empty, hypothesis: "   " }), true);
  assert.equal(pairIsEmpty({ ...empty, hypothesis: undefined }), true);
  // Replacing or removing the owner media clears text tied to the old pair,
  // while the title, creator note and crop are preserved.
  assert.match(section, /\.\.\.\(previous \? \{ alt: "", hypothesis: "" \} : \{\}\)/);
  assert.match(section, /setPair\(index, \{ image: null, alt: "", hypothesis: "", error: null, busy: false \}\)/);
});
