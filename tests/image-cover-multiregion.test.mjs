import assert from "node:assert/strict";
import test from "node:test";
import { coverAreas, MAX_COVER_AREAS } from "../src/frontend/image-cover-region.ts";

const blank = { left: "0", top: "0", width: "", height: "" };
const region = (left, top, width, height) => ({ left, top, width, height });
const fields = (left, top, width, height) => ({
  left: String(left), top: String(top), width: String(width), height: String(height),
});

test("one valid current rectangle keeps the original single-area export", () => {
  const state = coverAreas(fields(10, 20, 40, 60), [], 50, 80);
  assert.deepEqual(state.regions, [region(10, 20, 40, 60)]);
  assert.deepEqual(state.current, region(10, 20, 40, 60));
  assert.equal(state.pending, false);
  assert.equal(state.canExport, true);
  assert.equal(state.canRetain, true);
});

test("two disjoint whole-pixel areas are both painted by one export", () => {
  const first = region(5, 5, 20, 10);
  const second = region(40, 30, 10, 25);
  const state = coverAreas(fields(40, 30, 10, 25), [first], 100, 100);
  assert.deepEqual(state.regions, [first, second]);
  assert.equal(state.canExport, true);
  // Within the 100 x 100 image the two rectangles share no pixel.
  const overlap = Math.max(0, Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left)) *
    Math.max(0, Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top));
  assert.equal(overlap, 0);
});

test("a retained area alone exports after the current fields are cleared", () => {
  const first = region(5, 5, 20, 10);
  const state = coverAreas(blank, [first], 100, 100);
  assert.deepEqual(state.regions, [first]);
  assert.equal(state.pending, false);
  assert.equal(state.canExport, true);
});

test("incomplete or invalid edited input blocks a silent under-redacted export", () => {
  const first = region(5, 5, 20, 10);
  for (const edited of [
    fields(40, 30, "", ""), fields(40, 30, 10, ""), fields(40, 30, "", 25),
    fields(40, 30, 0, 25), fields(40, 30, 10, 0.5), fields(-1, 30, 10, 25),
    fields(90, 90, 20, 20), { ...blank, left: "3" }, { ...blank, width: "Infinity" },
  ]) {
    const state = coverAreas(edited, [first], 100, 100);
    assert.equal(state.pending, true, JSON.stringify(edited));
    assert.equal(state.canExport, false, JSON.stringify(edited));
    assert.equal(state.canRetain, false, JSON.stringify(edited));
    assert.deepEqual(state.regions, [first], "the invalid current area must not be painted");
  }
});

test("at most eight areas can be retained", () => {
  const eight = Array.from({ length: MAX_COVER_AREAS }, (_, i) => region(i, 0, 1, 1));
  assert.equal(MAX_COVER_AREAS, 8);
  assert.equal(coverAreas(blank, eight.slice(0, 7), 100, 100).canRetain, false); // nothing valid to retain yet
  assert.equal(coverAreas(fields(20, 20, 1, 1), eight.slice(0, 7), 100, 100).canRetain, false);
  assert.equal(coverAreas(fields(20, 20, 1, 1), eight.slice(0, 7), 100, 100).canExport, true);
  assert.equal(coverAreas(fields(20, 20, 1, 1), eight, 100, 100).canRetain, false);
  assert.equal(coverAreas(fields(20, 20, 1, 1), eight, 100, 100).canExport, false);
});
