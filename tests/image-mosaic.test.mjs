// MIT. Focused geometry and pixel checks for the browser-local mosaic
// treatment. The pixel fixtures are synthetic RGBA buffers with distinct
// values, not photographs; they prove block bounds, outside-pixel preservation
// and alpha-weighted averaging without a canvas or network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MOSAIC_MAX_BLOCK_SIZE,
  MOSAIC_MIN_BLOCK_SIZE,
  mosaicBlockSize,
  mosaicBlocks,
  mosaicFitsPixelBudget,
  pixelateMosaic,
} from "../src/frontend/image-mosaic.ts";

const region = (left, top, width, height) => ({ left, top, width, height });

test("the mosaic budget counts all rectangles before export", () => {
  const half = region(0, 0, 2000, 2000);
  assert.equal(mosaicFitsPixelBudget([half, half]), true);
  assert.equal(mosaicFitsPixelBudget([half, half, region(0, 0, 1, 1)]), false);
});

function pixels(width, height, value = (x, y) => [x * 17 % 256, y * 29 % 256, (x + y) * 13 % 256, 255]) {
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

test("the block rule is deterministic and bounded for every rectangle", () => {
  for (const [width, height] of [[1, 1], [4, 9], [40, 60], [100, 100], [400, 300], [16384, 16384]]) {
    const area = region(0, 0, width, height);
    const size = mosaicBlockSize(area);
    assert.equal(mosaicBlockSize(area), size);
    assert.equal(Number.isSafeInteger(size), true);
    assert.ok(size >= MOSAIC_MIN_BLOCK_SIZE && size <= MOSAIC_MAX_BLOCK_SIZE, `${width}x${height} -> ${size}`);
  }
  assert.equal(mosaicBlockSize(region(0, 0, 40, 60)), 4);
  assert.equal(mosaicBlockSize(region(0, 0, 400, 300)), 24);
});

test("blocks tile the rectangle exactly, including partial right and bottom blocks", () => {
  const area = region(10, 20, 11, 7);
  const blocks = mosaicBlocks(area, 3);
  assert.equal(blocks.length, 4 * 3);
  const covered = new Map();
  for (const block of blocks) {
    assert.ok(block.left >= area.left && block.top >= area.top);
    assert.ok(block.left + block.width <= area.left + area.width);
    assert.ok(block.top + block.height <= area.top + area.height);
    for (let y = block.top; y < block.top + block.height; y += 1) {
      for (let x = block.left; x < block.left + block.width; x += 1) {
        const key = `${x},${y}`;
        assert.equal(covered.has(key), false, `${key} is covered twice`);
        covered.set(key, true);
      }
    }
  }
  assert.equal(covered.size, area.width * area.height);
  assert.deepEqual(blocks[3], region(19, 20, 2, 3));
  assert.deepEqual(blocks[8], region(10, 26, 3, 1));
  assert.deepEqual(blocks[11], region(19, 26, 2, 1));
});

test("pixelation changes only whole blocks inside the rectangle", () => {
  const image = pixels(12, 8);
  const before = image.data.slice();
  const area = region(2, 1, 5, 3);
  pixelateMosaic(image, area);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const inside = x >= area.left && x < area.left + area.width &&
        y >= area.top && y < area.top + area.height;
      if (!inside) assert.deepEqual(at(image, x, y), at({ data: before, width: image.width }, x, y));
    }
  }
  let changed = 0;
  for (const block of mosaicBlocks(area)) {
    const first = at(image, block.left, block.top);
    for (let y = block.top; y < block.top + block.height; y += 1) {
      for (let x = block.left; x < block.left + block.width; x += 1) {
        assert.deepEqual(at(image, x, y), first, "each pixel in a block carries the same value");
      }
    }
    changed += 1;
  }
  assert.equal(changed, 6);
  assert.notDeepEqual(at(image, area.left, area.top), at({ data: before, width: image.width }, area.left, area.top));
});

test("alpha-weighted averaging keeps transparent pixels from darkening the block", () => {
  const image = pixels(4, 1, (x) => x === 0
    ? [255, 0, 0, 255]
    : x === 1
      ? [0, 0, 255, 0]
      : [0, 0, 0, 0]);
  pixelateMosaic(image, region(0, 0, 4, 1), 2);
  assert.deepEqual(at(image, 0, 0), [255, 0, 0, 128]);
  assert.deepEqual(at(image, 1, 0), [255, 0, 0, 128]);
  assert.deepEqual(at(image, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(image, 3, 0), [0, 0, 0, 0]);
});

test("the same rectangle and pixels always produce the same export bytes", () => {
  const area = region(3, 2, 17, 11);
  const first = pixels(24, 16);
  const second = pixels(24, 16);
  pixelateMosaic(first, area);
  pixelateMosaic(second, { ...area });
  assert.deepEqual(first.data, second.data);
});

test("an invalid rectangle is refused before any pixel changes", () => {
  const image = pixels(6, 4);
  const before = image.data.slice();
  for (const bad of [region(-1, 0, 2, 2), region(0, 0, 7, 2), region(5, 3, 2, 1), region(0, 0, 1.5, 1)]) {
    assert.throws(() => pixelateMosaic(image, bad), /whole pixels/);
  }
  assert.deepEqual(image.data, before);
});
