// MIT. Focused geometry and pixel checks for the browser-local soft blur
// treatment. The fixtures are synthetic RGBA buffers with exact expected
// values, so they prove rectangle bounds, outside-pixel preservation and
// alpha weighting without a canvas or network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  BLUR_MAX_RADIUS,
  BLUR_PIXEL_BUDGET,
  BLUR_RADIUS,
  blurFitsPixelBudget,
  blurPixels,
} from "../src/frontend/image-blur.ts";

const region = (left, top, width, height) => ({ left, top, width, height });

function pixels(width, height, value = () => [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(value(x, y), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function at(image, x, y) {
  const index = (y * image.width + x) * 4;
  return Array.from(image.data.slice(index, index + 4));
}

function fill(image, area, value) {
  for (let y = area.top; y < area.top + area.height; y += 1) {
    for (let x = area.left; x < area.left + area.width; x += 1) {
      image.data.set(value, (y * image.width + x) * 4);
    }
  }
}

test("the blur budget counts all rectangles before export", () => {
  const half = region(0, 0, 1000, 1000);
  assert.equal(BLUR_PIXEL_BUDGET, 2_000_000);
  assert.equal(blurFitsPixelBudget([half, half]), true);
  assert.equal(blurFitsPixelBudget([half, half, region(0, 0, 1, 1)]), false);
  assert.equal(BLUR_RADIUS, 8);
  assert.equal(Number.isSafeInteger(BLUR_MAX_RADIUS), true);
  assert.ok(BLUR_MAX_RADIUS >= BLUR_RADIUS);
});

test("alpha weighting keeps transparent colour from darkening the result", () => {
  const image = pixels(3, 1, (x) => x === 0
    ? [255, 0, 0, 255]
    : x === 1
      ? [0, 0, 255, 0]
      : [0, 0, 0, 0]);
  blurPixels(image, region(0, 0, 3, 1), 1);
  assert.deepEqual(at(image, 0, 0), [255, 0, 0, 128]);
  assert.deepEqual(at(image, 1, 0), [255, 0, 0, 85]);
  assert.deepEqual(at(image, 2, 0), [0, 0, 0, 0]);
});

test("the sample window clips to the rectangle, so outside pixels never bleed in", () => {
  const outside = [9, 18, 27, 36];
  const image = pixels(4, 4, () => outside);
  const area = region(1, 1, 2, 2);
  fill(image, area, [255, 255, 255, 255]);
  const before = image.data.slice();
  blurPixels(image, area, 1);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const inside = x >= area.left && x < area.left + area.width &&
        y >= area.top && y < area.top + area.height;
      if (inside) {
        assert.deepEqual(at(image, x, y), [255, 255, 255, 255]);
      } else {
        const index = (y * image.width + x) * 4;
        assert.deepEqual(Array.from(image.data.slice(index, index + 4)), Array.from(before.slice(index, index + 4)));
      }
    }
  }
});

test("a one-pixel rectangle is already its own average", () => {
  const image = pixels(3, 2, () => [40, 80, 120, 200]);
  const before = image.data.slice();
  blurPixels(image, region(1, 0, 1, 1));
  assert.deepEqual(image.data, before);
});

test("the same rectangle and pixels always produce the same export bytes", () => {
  const area = region(3, 2, 17, 11);
  const pattern = (x, y) => [x * 17 % 256, y * 29 % 256, (x + y) * 13 % 256, 255];
  const first = pixels(24, 16, pattern);
  const second = pixels(24, 16, pattern);
  blurPixels(first, area);
  blurPixels(second, { ...area });
  assert.deepEqual(first.data, second.data);
});

test("an invalid rectangle or radius is refused before any pixel changes", () => {
  const image = pixels(6, 4);
  const before = image.data.slice();
  for (const bad of [region(-1, 0, 2, 2), region(0, 0, 7, 2), region(5, 3, 2, 1), region(0, 0, 1.5, 1)]) {
    assert.throws(() => blurPixels(image, bad), /whole pixels/);
  }
  for (const badRadius of [0, -1, 1.5, BLUR_MAX_RADIUS + 1]) {
    assert.throws(() => blurPixels(image, region(0, 0, 2, 2), badRadius), /whole number/);
  }
  assert.deepEqual(image.data, before);
});
