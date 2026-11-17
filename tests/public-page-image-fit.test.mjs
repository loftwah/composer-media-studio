// MIT. A published still keeps its own aspect ratio inside the dark media frame.
// The width/height attributes on the public <img> exist for layout stability, so
// the stylesheet must not also treat the height attribute as a fixed CSS height.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../public/studio.css", import.meta.url), "utf8");

test("the public page still follows its image ratio instead of the height attribute", () => {
  const rule = css.match(/\.public-page \.media img \{[^}]*\}/);
  assert.ok(rule, "the public page image rule is present");
  assert.match(rule[0], /width: 100%/);
  assert.match(rule[0], /height: auto/);
  assert.match(rule[0], /max-height: 82vh/);
});
