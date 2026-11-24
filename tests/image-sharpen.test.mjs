import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHARPEN_AMOUNT_MAX,
  SHARPEN_AMOUNT_STEP,
  SHARPEN_RADIUS,
  describeSharpen,
  normaliseSharpen,
  sharpenPixels,
} from "../src/frontend/image-sharpen.ts";

function pixels(...values) {
  return new Uint8ClampedArray(values);
}

function greyRow(...values) {
  return pixels(...values.flatMap((value) => [value, value, value, 255]));
}

function render(source, width, height, sharpen = { radius: SHARPEN_RADIUS, amount: 1 }) {
  const result = sharpenPixels(source, { width, height, sharpen });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result;
}

test("sharpen is bounded, neutral by default and described by its real strength", () => {
  assert.equal(SHARPEN_RADIUS, 1);
  assert.equal(SHARPEN_AMOUNT_MAX, 1);
  assert.equal(SHARPEN_AMOUNT_STEP, 0.05);
  assert.deepEqual(normaliseSharpen(), { radius: 1, amount: 0 });
  assert.deepEqual(normaliseSharpen({ radius: 1, amount: 0.53 }), { radius: 1, amount: 0.55 });
  assert.deepEqual(normaliseSharpen({ radius: 1, amount: 4 }), { radius: 1, amount: 1 });
  assert.deepEqual(normaliseSharpen({ radius: 1, amount: -4 }), { radius: 1, amount: 0 });
  assert.equal(normaliseSharpen({ radius: 2, amount: 0.5 }), null);
  assert.equal(normaliseSharpen({ radius: 1, amount: Number.NaN }), null);
  assert.equal(describeSharpen(), "");
  assert.equal(describeSharpen({ radius: 1, amount: 0 }), "");
  assert.equal(describeSharpen({ radius: 1, amount: 0.5 }), "sharpen edges 50% (1px)");
});

test("neutral sharpen returns the same bytes without writing", () => {
  const source = greyRow(120, 40, 200);
  const implicit = sharpenPixels(source, { width: 3, height: 1 });
  assert.equal(implicit.ok, true);
  assert.equal(implicit.neutral, true);
  assert.equal(implicit.changed, 0);
  assert.equal(implicit.pixels, source);

  const explicit = render(source, 3, 1, { radius: 1, amount: 0 });
  assert.equal(explicit.neutral, true);
  assert.equal(explicit.changed, 0);
  assert.equal(explicit.pixels, source);
  assert.deepEqual([...source], [...greyRow(120, 40, 200)]);
});

test("flat visible areas are unchanged", () => {
  const source = greyRow(...Array.from({ length: 12 }, () => 73));
  const result = render(source, 4, 3);
  assert.equal(result.changed, 0);
  assert.deepEqual([...source], [...greyRow(...Array.from({ length: 12 }, () => 73))]);
});

test("a softened edge gains contrast in both directions", () => {
  const horizontal = greyRow(100, 100, 100, 200, 200);
  const result = render(horizontal, 5, 1);
  assert.deepEqual([...horizontal], [...greyRow(100, 100, 50, 250, 200)]);
  assert.equal(result.changed, 2);

  const vertical = greyRow(100, 100, 100, 200, 200, 200);
  render(vertical, 3, 2);
  assert.deepEqual([...vertical], [...greyRow(50, 67, 50, 250, 233, 250)]);
});

test("small borders use only real four-neighbours and channels clamp", () => {
  const bordered = greyRow(10, 20, 30, 40, 100, 60, 70, 80, 90);
  render(bordered, 3, 3, { radius: 1, amount: 0.5 });
  assert.deepEqual([...bordered], [...greyRow(0, 7, 25, 30, 125, 53, 75, 77, 100)]);

  const clamped = greyRow(10, 200);
  const result = render(clamped, 2, 1);
  assert.deepEqual([...clamped], [...greyRow(0, 255)]);
  assert.equal(result.changed, 2);

  const alone = greyRow(120);
  const unchanged = render(alone, 1, 1);
  assert.deepEqual([...alone], [...greyRow(120)]);
  assert.equal(unchanged.changed, 0);
});

test("alpha is preserved, transparent neighbours are ignored and transparent RGB never moves", () => {
  const source = pixels(
    255, 0, 0, 255,
    1, 2, 3, 0,
    0, 255, 0, 255,
    120, 100, 80, 64,
    200, 100, 50, 128,
    100, 120, 140, 255,
    9, 8, 7, 0,
    0, 0, 255, 255,
    255, 255, 255, 255,
  );
  const alpha = [...source].filter((_value, index) => index % 4 === 3);
  render(source, 3, 3, { radius: 1, amount: 0.5 });

  assert.deepEqual([...source.slice(16, 20)], [255, 113, 0, 128], "the transparent upper neighbour is ignored");
  assert.deepEqual([...source.slice(4, 8)], [1, 2, 3, 0], "transparent left neighbour keeps hidden RGB");
  assert.deepEqual([...source.slice(24, 28)], [9, 8, 7, 0], "transparent down neighbour keeps hidden RGB");
  assert.deepEqual([...source].filter((_value, index) => index % 4 === 3), alpha);
});

test("invalid input is refused before mutation and repeated runs are deterministic", () => {
  const source = greyRow(20, 100, 180);
  const before = [...source];
  for (const options of [
    { width: 0, height: 1, sharpen: { radius: 1, amount: 1 } },
    { width: 3, height: 1, sharpen: { radius: 2, amount: 1 } },
    { width: 3, height: 1, sharpen: { radius: 1, amount: Number.NaN } },
    { width: 4, height: 1, sharpen: { radius: 1, amount: 1 } },
  ]) {
    const result = sharpenPixels(source, options);
    assert.equal(result.ok, false);
    assert.deepEqual([...source], before);
  }

  const first = render(greyRow(20, 100, 180), 3, 1, { radius: 1, amount: 0.5 });
  const second = render(greyRow(20, 100, 180), 3, 1, { radius: 1, amount: 0.5 });
  assert.deepEqual([...first.pixels], [...second.pixels]);
  assert.equal(first.changed, second.changed);
});
