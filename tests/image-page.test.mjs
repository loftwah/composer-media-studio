import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { imagesPage, loginPage } from "../src/lib/ui.mjs";

const workbench = readFileSync(new URL("../src/frontend/images.tsx", import.meta.url), "utf8");

test("the public image page mounts the tracked wrapper with the build revision", () => {
  const html = imagesPage({ revision: "abc123" });
  assert.match(html, /<title>Image tools — Media Studio<\/title>/);
  assert.match(html, /<div id="images">/);
  assert.match(html, /src="\/images\.js\?v=abc123"/);
  assert.match(html, /JavaScript is required/);
});

test("login discovery links to the signed-out image workbench", () => {
  assert.match(loginPage({ revision: "abc123" }), /href="\/tools\/images"/);
});

test("the workbench exposes labelled colour and output controls", () => {
  assert.match(workbench, /<label>Resampling/);
  assert.match(workbench, /Nearest-neighbour · pixel art/);
  assert.match(workbench, /<label>Target size \(KiB, optional\)/);
  assert.match(workbench, /aria-describedby="image-target-note"/);
  assert.match(workbench, /id="image-target-note"/);
  assert.match(workbench, /Trim transparent edges/);
  assert.match(workbench, /Trim removes fully transparent padding/);
  assert.match(workbench, /Extract palette/);
  assert.match(workbench, /Fully transparent pixels are ignored/);
  assert.match(workbench, /<h3>Eyedropper<\/h3>/);
  assert.match(workbench, /Copy HEX/);
  assert.match(workbench, /Copy RGB/);
  assert.match(workbench, /Copy HSL/);
  assert.match(workbench, /image-swatch/);
  assert.match(workbench, /aria-label=\{`Copy HEX/);
  assert.match(workbench, /ArrowLeft/);
  assert.match(workbench, /ArrowRight/);
  assert.match(workbench, /ArrowUp/);
  assert.match(workbench, /ArrowDown/);
});

test("the export path wires trim, target search and nearest-neighbour smoothing", () => {
  assert.match(workbench, /alphaBounds\(data/);
  assert.match(workbench, /mapBoundsThroughTransform\(found\.bounds/);
  assert.match(workbench, /const smoothing = imageSmoothingFor\(settings\.resample\)/);
  assert.match(workbench, /context\.imageSmoothingEnabled = smoothing\.enabled/);
  assert.match(workbench, /searchTargetQuality\(\{/);
  assert.match(workbench, /const cropRect =[\s\S]*trimSnapshot\.itemId === item\.id/);
  assert.match(workbench, /describeTransform\(\{[\s\S]*resample: selected\.result\.settings\.resample/);
});

test("PNG states that a byte target is not achievable and offers resize guidance", () => {
  assert.match(workbench, /PNG is lossless, so a byte target is not achievable here/);
  assert.match(workbench, /Lower the output width and height, or choose JPEG or WebP/);
  assert.match(workbench, /reports the real encoded bytes/);
  assert.match(workbench, /not met/);
});

test("the new colour and trim modules stay browser-local and dependency-free", () => {
  const colour = readFileSync(
    new URL("../src/frontend/image-colour.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(colour, /from "react"|fetch\(|XMLHttpRequest|import\(/);
  assert.doesNotMatch(colour, /https?:\/\//);
});

test("the workbench ships local photo adjustments with real pixel values", () => {
  assert.match(workbench, /<legend>Light and colour<\/legend>/);
  assert.match(workbench, /ADJUSTMENT_PRESETS\.map/);
  assert.match(workbench, /presetIdFor\(settings\.adjust\)/);
  assert.match(workbench, /setAdjustment\(key, Number\(event\.target\.value\)\)/);
  assert.match(workbench, /adjustPixels\(pixels\.data, \{/);
  assert.match(workbench, /adjustmentsAreNeutral\(settings\.adjust\)/);
  assert.match(workbench, /Reset adjustments/);
  assert.match(workbench, /alpha channel is never changed/);
  assert.match(workbench, /Adjustments changed \{selected\.result\.adjustChanged\.toLocaleString\(\)\}/);
  assert.match(workbench, /adjustments: describeAdjustments\(selected\.result\.settings\.adjust\)/);
});

test("crop position and embed code are wired as honest controls", () => {
  assert.match(workbench, /<label>Crop position/);
  assert.match(workbench, /Object\.entries\(CROP_ANCHOR_LABELS\)\.map/);
  assert.match(workbench, /cropAnchor: settings\.cropAnchor/);
  assert.match(workbench, /disabled=\{running \|\| settings\.cropAspect === "original"\}/);
  assert.match(workbench, /<h2 id="image-embed-heading">Embed code<\/h2>/);
  assert.match(workbench, /buildImageSnippets\(\{/);
  assert.match(workbench, /It is not encryption, redaction/);
  assert.match(workbench, /embed code stops at/);
  assert.match(workbench, /SNIPPET_KINDS\.map/);
  assert.match(workbench, /Copy \{SNIPPET_LABELS\[snippetKind\]\}/);
  assert.match(workbench, /Move up/);
  assert.match(workbench, /Move down/);
  assert.match(workbench, /draggable=\{!running\}/);
});

test("the adjustment and snippet modules stay local and dependency-free", () => {
  for (const file of ["image-adjust.mjs", "image-snippets.mjs"]) {
    const source = readFileSync(new URL(`../src/frontend/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "react"|fetch\(|XMLHttpRequest|import\(/, file);
    assert.doesNotMatch(source, /https?:\/\//, file);
    assert.doesNotMatch(source, /from "[^"]+"/, `${file} imports no module`);
  }
});

test("the workbench straightens by a real angle and shows the kept area", () => {
  assert.match(workbench, /<legend>Rotate, straighten and flip<\/legend>/);
  assert.match(workbench, /<label>\s*Straighten\{" "\}/);
  assert.match(workbench, /min=\{-MAX_STRAIGHTEN_DEGREES\}/);
  assert.match(workbench, /max=\{MAX_STRAIGHTEN_DEGREES\}/);
  assert.match(workbench, /step="0\.1"/);
  assert.match(workbench, /aria-describedby="image-straighten-note"/);
  assert.match(workbench, /largest area that is entirely real pixels/);
  assert.match(workbench, /Reset straighten/);
  assert.match(workbench, /keptAreaPolygon\(plan\)/);
  assert.match(workbench, /className="image-keep-overlay"/);
  assert.match(workbench, /The dimmed area is discarded by the export/);
  assert.match(workbench, /Reset controls/);
  assert.match(workbench, /straighten: settings\.straighten/);
  assert.match(workbench, /drawStraightened\(stage, plan\.straighten\)/);
  assert.match(workbench, /straighten: selected\.result\.settings\.straighten/);
  assert.match(workbench, /Set straighten to 0° before trimming/);
});
