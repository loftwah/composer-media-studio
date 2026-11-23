// MIT. Browser-local decorative mosaic for the image region panel.
// Solid cover stays the privacy treatment; these rules only describe a visible
// block pattern inside the same validated, whole-pixel rectangles.

import type { CoverRegion } from "./image-cover-region.ts";

export const MOSAIC_MIN_BLOCK_SIZE = 2;
export const MOSAIC_MAX_BLOCK_SIZE = 24;
const MOSAIC_PIXEL_BUDGET = 8_000_000;

/** Bound canvas readback and averaging across every rectangle in one export. */
export function mosaicFitsPixelBudget(regions: readonly CoverRegion[]): boolean {
  return regions.reduce((pixels, region) => pixels + region.width * region.height, 0) <= MOSAIC_PIXEL_BUDGET;
}

/**
 * One deterministic rule for every rectangle: a block edge of a tenth of the
 * rectangle's shorter side, rounded, then clamped to 2–24 px. The same
 * rectangle always produces the same blocks. Blocks start at the rectangle's
 * own top-left edge, so the right and bottom blocks may be partial.
 */
export function mosaicBlockSize(region: CoverRegion): number {
  const shorter = Math.max(1, Math.min(region.width, region.height));
  return Math.min(MOSAIC_MAX_BLOCK_SIZE, Math.max(MOSAIC_MIN_BLOCK_SIZE, Math.round(shorter / 10)));
}

/** Every block of a rectangle, in row-major order, clipped to its exact edges. */
export function mosaicBlocks(region: CoverRegion, blockSize = mosaicBlockSize(region)): CoverRegion[] {
  const size = Number.isSafeInteger(blockSize) && blockSize >= 1 ? blockSize : mosaicBlockSize(region);
  const right = region.left + region.width;
  const bottom = region.top + region.height;
  const blocks: CoverRegion[] = [];
  for (let top = region.top; top < bottom; top += size) {
    const height = Math.min(size, bottom - top);
    for (let left = region.left; left < right; left += size) {
      blocks.push({ left, top, width: Math.min(size, right - left), height });
    }
  }
  return blocks;
}

export type MosaicPixels = { data: Uint8ClampedArray; width: number; height: number };

function isWholeRectangle(region: CoverRegion, width: number, height: number): boolean {
  return [region.left, region.top, region.width, region.height].every(Number.isSafeInteger) &&
    region.left >= 0 && region.top >= 0 &&
    region.width >= 1 && region.height >= 1 &&
    region.left + region.width <= width && region.top + region.height <= height;
}

/**
 * Replace each block inside `region` with that block's alpha-weighted average
 * so transparent pixels cannot darken the visible colour. Pixels outside the
 * region are untouched. Each block uses its mean opacity and a fully
 * transparent block stays fully transparent. The buffer is RGBA in
 * `width` × `height` order, as returned by `getImageData`.
 */
export function pixelateMosaic(
  pixels: MosaicPixels,
  region: CoverRegion,
  blockSize = mosaicBlockSize(region),
): void {
  const { data, width, height } = pixels;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error("The pixel buffer does not match its dimensions.");
  }
  if (!isWholeRectangle(region, width, height)) {
    throw new Error("The mosaic rectangle must be whole pixels inside the image.");
  }
  for (const block of mosaicBlocks(region, blockSize)) {
    const count = block.width * block.height;
    let alpha = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let y = block.top; y < block.top + block.height; y += 1) {
      let index = (y * width + block.left) * 4;
      for (let x = 0; x < block.width; x += 1, index += 4) {
        const a = data[index + 3];
        alpha += a;
        red += data[index] * a;
        green += data[index + 1] * a;
        blue += data[index + 2] * a;
      }
    }
    const outAlpha = Math.round(alpha / count);
    const outRed = alpha > 0 ? Math.round(red / alpha) : 0;
    const outGreen = alpha > 0 ? Math.round(green / alpha) : 0;
    const outBlue = alpha > 0 ? Math.round(blue / alpha) : 0;
    for (let y = block.top; y < block.top + block.height; y += 1) {
      let index = (y * width + block.left) * 4;
      for (let x = 0; x < block.width; x += 1, index += 4) {
        data[index] = outRed;
        data[index + 1] = outGreen;
        data[index + 2] = outBlue;
        data[index + 3] = outAlpha;
      }
    }
  }
}
