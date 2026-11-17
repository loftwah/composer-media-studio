import assert from "node:assert/strict";
import test from "node:test";
import { coverRegion } from "../src/frontend/image-cover-region.ts";

const selection = { left: "10", top: "20", width: "40", height: "60" };

test("a cover rectangle keeps its exact integer edges including the image boundary", () => {
  assert.deepEqual(coverRegion(selection, 50, 80), { left: 10, top: 20, width: 40, height: 60 });
  assert.deepEqual(coverRegion({ left: "0", top: "0", width: "1", height: "1" }, 1, 1),
    { left: 0, top: 0, width: 1, height: 1 });
});
test("out-of-bounds or incomplete cover coordinates cannot produce a rectangle", () => {
  assert.equal(coverRegion(selection, 49, 80), null);
  assert.equal(coverRegion(selection, 50, 79), null);
  assert.equal(coverRegion(selection, Number.NaN, 80), null);
  for (const invalid of [{ left: "-1" }, { top: "0.1" }, { width: "0" }, { height: "" }, { width: "Infinity" }]) {
    assert.equal(coverRegion({ ...selection, ...invalid }, 1000, 1000), null);
  }
});
