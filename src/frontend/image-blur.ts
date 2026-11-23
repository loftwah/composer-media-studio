// MIT. Browser-local decorative soft blur for the image region panel.
// Solid cover stays the privacy treatment; this only softens pixels inside the
// same validated, whole-pixel rectangles.

import type { CoverRegion } from "./image-cover-region.ts";

export const BLUR_RADIUS = 8;
export const BLUR_MAX_RADIUS = 12;
export const BLUR_PIXEL_BUDGET = 2_000_000;

/**
 * Bound the readback and two-pass work for one export. At the default radius
 * each selected pixel is read at most 17 times horizontally and 17 times
 * vertically, so 2 million selected pixels cap the export at 68 million
 * samples across both passes.
 */
export function blurFitsPixelBudget(regions: readonly CoverRegion[]): boolean {
  return regions.reduce((pixels, region) => pixels + region.width * region.height, 0) <= BLUR_PIXEL_BUDGET;
}

export type BlurPixels = { data: Uint8ClampedArray; width: number; height: number };

function isWholeRectangle(region: CoverRegion, width: number, height: number): boolean {
  return [region.left, region.top, region.width, region.height].every(Number.isSafeInteger) &&
    region.left >= 0 && region.top >= 0 &&
    region.width >= 1 && region.height >= 1 &&
    region.left + region.width <= width && region.top + region.height <= height;
}

/**
 * Soften only `region` with one horizontal box pass and one vertical box pass.
 * Both passes clip their sample window to the rectangle, so pixels outside it
 * never enter the result. Colour is alpha-weighted: transparent samples add
 * their opacity to the average but cannot darken the visible colour. A fully
 * transparent window stays fully transparent. The buffer is RGBA in
 * `width` × `height` order, as returned by `getImageData`.
 */
export function blurPixels(
  pixels: BlurPixels,
  region: CoverRegion,
  radius = BLUR_RADIUS,
): void {
  const { data, width, height } = pixels;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error("The pixel buffer does not match its dimensions.");
  }
  if (!isWholeRectangle(region, width, height)) {
    throw new Error("The blur rectangle must be whole pixels inside the image.");
  }
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > BLUR_MAX_RADIUS) {
    throw new Error(`The blur radius must be a whole number from 1 to ${BLUR_MAX_RADIUS}.`);
  }

  const regionWidth = region.width;
  const regionHeight = region.height;
  const regionRight = region.left + regionWidth;
  const regionBottom = region.top + regionHeight;
  // One region-sized RGBA scratch pass; the vertical pass writes the canvas
  // buffer directly. No full-image copy is made beyond the current canvas.
  const horizontal = new Uint8ClampedArray(regionWidth * regionHeight * 4);

  for (let offsetY = 0; offsetY < regionHeight; offsetY += 1) {
    const y = region.top + offsetY;
    const row = y * width;
    for (let offsetX = 0; offsetX < regionWidth; offsetX += 1) {
      const x = region.left + offsetX;
      const left = Math.max(region.left, x - radius);
      const right = Math.min(regionRight - 1, x + radius);
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sampleX = left; sampleX <= right; sampleX += 1) {
        const index = (row + sampleX) * 4;
        const a = data[index + 3];
        alpha += a;
        red += data[index] * a;
        green += data[index + 1] * a;
        blue += data[index + 2] * a;
      }
      const count = right - left + 1;
      const out = (offsetY * regionWidth + offsetX) * 4;
      horizontal[out + 3] = Math.round(alpha / count);
      if (alpha > 0) {
        horizontal[out] = Math.round(red / alpha);
        horizontal[out + 1] = Math.round(green / alpha);
        horizontal[out + 2] = Math.round(blue / alpha);
      }
    }
  }

  for (let offsetY = 0; offsetY < regionHeight; offsetY += 1) {
    const y = region.top + offsetY;
    const top = Math.max(region.top, y - radius);
    const bottom = Math.min(regionBottom - 1, y + radius);
    for (let offsetX = 0; offsetX < regionWidth; offsetX += 1) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
        const index = ((sampleY - region.top) * regionWidth + offsetX) * 4;
        const a = horizontal[index + 3];
        alpha += a;
        red += horizontal[index] * a;
        green += horizontal[index + 1] * a;
        blue += horizontal[index + 2] * a;
      }
      const count = bottom - top + 1;
      const out = (y * width + region.left + offsetX) * 4;
      data[out + 3] = Math.round(alpha / count);
      data[out] = alpha > 0 ? Math.round(red / alpha) : 0;
      data[out + 1] = alpha > 0 ? Math.round(green / alpha) : 0;
      data[out + 2] = alpha > 0 ? Math.round(blue / alpha) : 0;
    }
  }
}
