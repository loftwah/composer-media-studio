import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../src/frontend/image-cover.tsx", import.meta.url), "utf8");

test("solid cover stays the opaque default beside the decorative treatments", () => {
  assert.match(panel, /useState<CoverMode>\("solid"\)/);
  assert.match(panel, /label: "Solid cover"/);
  assert.match(panel, /label: "Mosaic"/);
  assert.match(panel, /label: "Soft blur"/);
  assert.match(panel, /ctx\.fillStyle = "#000"/);
  assert.match(panel, /ctx\.fillRect\(area\.left, area\.top, area\.width, area\.height\)/);
});

test("soft blur is wired as a local decorative export with an honest label", () => {
  assert.match(panel, /value: "blur"/);
  assert.match(panel, /Decorative local softening inside each area\. It can leave content recognisable and does not conceal it; use Solid cover for private or identifying content\./);
  assert.match(panel, /<summary>Cover, mosaic or blur an area<\/summary>/);
  assert.match(panel, /blurPixels\(pixels, \{ left: 0, top: 0, width: area\.width, height: area\.height \}\)/);
  assert.match(panel, /file: "media-studio-soft-blur\.png"/);
  assert.match(panel, /make: "Make soft blur PNG"/);
  assert.match(panel, /download: "Download soft blur PNG"/);
  assert.match(panel, /add: "Add soft blur PNG to batch"/);
});
