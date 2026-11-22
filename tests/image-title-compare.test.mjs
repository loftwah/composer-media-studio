// Focused checks for the title + thumbnail compare slice: the pure cover-crop
// plan shared by the CSS preview and the PNG export, the download-name rules,
// and the source-level wiring of the workbench section.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEED_SIZES,
  TITLE_MAX_LENGTH,
  coverCropRect,
  exportFileName,
  objectPositionFor,
  safeTitleStem,
} from "../src/frontend/image-title-compare-plan.ts";

const section = readFileSync(new URL("../src/frontend/image-title-compare.tsx", import.meta.url), "utf8");
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
  // The inner finally covers the crop-plan and context failures too.
  assert.match(section, /try \{\s*const rect = coverCropRect\([\s\S]*?\} finally \{\s*bitmap\.close\(\);\s*\}/);
  assert.match(section, /const bitmap = await createImageBitmap\(image\.file\)/);
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
  assert.match(section, /coverCropRect\(bitmap\.width, bitmap\.height, size\.width, size\.height, forAnchor\)/);
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
