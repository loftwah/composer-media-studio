// MIT. A small, deterministic edge-contrast pass for the signed-out image
// workbench. It adjusts decoded RGBA bytes in place and never reconstructs
// detail. Three rolling source rows keep additional memory bounded by width.

export const SHARPEN_RADIUS = 1;
export const SHARPEN_AMOUNT_MAX = 1;
export const SHARPEN_AMOUNT_STEP = 0.05;

export type SharpenSettings = {
  radius: typeof SHARPEN_RADIUS;
  amount: number;
};

export type SharpenResult =
  | {
      ok: true;
      pixels: Uint8ClampedArray;
      neutral: boolean;
      changed: number;
    }
  | { ok: false; error: string };

/** A fixed one-pixel radius and a whole five-percent strength from 0–100%. */
export function normaliseSharpen(input?: unknown): SharpenSettings | null {
  if (input === undefined || input === null) return { radius: SHARPEN_RADIUS, amount: 0 };
  if (typeof input !== "object") return null;
  const { radius = SHARPEN_RADIUS, amount = 0 } = input as {
    radius?: unknown;
    amount?: unknown;
  };
  if (radius !== SHARPEN_RADIUS) return null;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const bounded = Math.min(SHARPEN_AMOUNT_MAX, Math.max(0, amount));
  const steps = Math.round(1 / SHARPEN_AMOUNT_STEP);
  return {
    radius: SHARPEN_RADIUS,
    amount: Math.round(bounded / SHARPEN_AMOUNT_STEP) / steps,
  };
}

/** A caption fragment naming the actual strength, or an empty neutral string. */
export function describeSharpen(input?: unknown): string {
  const sharpen = normaliseSharpen(input);
  if (!sharpen || sharpen.amount === 0) return "";
  return `sharpen edges ${Math.round(sharpen.amount * 100)}% (${sharpen.radius}px)`;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function addNeighbour(
  row: Uint8ClampedArray,
  column: number,
  sums: Uint32Array,
): void {
  const source = column * 4;
  if (row[source + 3] === 0) return;
  sums[0] += 1;
  sums[1] += row[source];
  sums[2] += row[source + 1];
  sums[3] += row[source + 2];
}

/**
 * Increase each visible pixel's contrast from the mean of its visible up, down,
 * left and right neighbours. Missing and fully transparent neighbours are
 * ignored rather than treated as black. Fully transparent pixels keep their
 * RGB, every alpha byte is untouched, and a flat visible area is unchanged.
 *
 * `pixels` is mutated in place. Only three original row buffers are allocated;
 * there is no whole-frame copy. `changed` counts pixels whose RGB actually moved.
 */
export function sharpenPixels(
  pixels: Uint8ClampedArray,
  {
    width,
    height,
    sharpen,
  }: {
    width: number;
    height: number;
    sharpen?: unknown;
  } = { width: 0, height: 0 },
): SharpenResult {
  if (!pixels || typeof pixels.length !== "number")
    return { ok: false, error: "The decoded pixels are not readable." };
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return { ok: false, error: "The image dimensions are not usable." };
  const byteLength = width * height * 4;
  if (!Number.isSafeInteger(byteLength) || pixels.length < byteLength)
    return { ok: false, error: "The decoded pixels are smaller than the stated dimensions." };

  const settings = normaliseSharpen(sharpen);
  if (!settings)
    return { ok: false, error: "Sharpen edges must use a 1 px radius and a finite amount." };
  if (settings.amount === 0) return { ok: true, pixels, neutral: true, changed: 0 };

  const rowBytes = width * 4;
  const above = new Uint8ClampedArray(rowBytes);
  const current = new Uint8ClampedArray(rowBytes);
  const below = new Uint8ClampedArray(rowBytes);
  above.set(pixels.subarray(0, rowBytes));
  const amount = settings.amount;
  const sums = new Uint32Array(4);
  let changed = 0;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    current.set(pixels.subarray(rowStart, rowStart + rowBytes));
    if (y + 1 < height)
      below.set(pixels.subarray(rowStart + rowBytes, rowStart + rowBytes * 2));

    for (let x = 0; x < width; x += 1) {
      const index = rowStart + x * 4;
      if (pixels[index + 3] === 0) continue;

      sums[0] = 0;
      sums[1] = 0;
      sums[2] = 0;
      sums[3] = 0;
      if (y > 0) addNeighbour(above, x, sums);
      if (y + 1 < height) addNeighbour(below, x, sums);
      if (x > 0) addNeighbour(current, x - 1, sums);
      if (x + 1 < width) addNeighbour(current, x + 1, sums);
      const neighbours = sums[0];
      if (neighbours === 0) continue;

      const red0 = current[x * 4];
      const green0 = current[x * 4 + 1];
      const blue0 = current[x * 4 + 2];
      const red = clampByte(red0 + amount * (red0 - sums[1] / neighbours));
      const green = clampByte(green0 + amount * (green0 - sums[2] / neighbours));
      const blue = clampByte(blue0 + amount * (blue0 - sums[3] / neighbours));
      if (red !== red0 || green !== green0 || blue !== blue0) changed += 1;
      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
    }
    above.set(current);
  }

  return { ok: true, pixels, neutral: false, changed };
}
