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
    new URL("../src/frontend/image-colour.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(colour, /from "react"|fetch\(|XMLHttpRequest|import\(/);
  assert.doesNotMatch(colour, /https?:\/\//);
});
