// MIT. Pure pixel adjustments for the signed-out image workbench.
// These functions read and write decoded RGBA bytes only, so the browser path
// and the Node tests use the same arithmetic. Alpha is never changed.

export type AdjustmentKey =
  | "exposure"
  | "shadows"
  | "contrast"
  | "saturation"
  | "temperature"
  | "tint";

export type Adjustments = Record<AdjustmentKey, number>;

export type AdjustmentPreset = {
  id: string;
  label: string;
  adjustments: Adjustments;
};

export type AdjustResult =
  | {
      ok: true;
      pixels: Uint8ClampedArray;
      neutral: boolean;
      changed: number;
    }
  | { ok: false; error: string };

export const ADJUSTMENT_KEYS: ReadonlyArray<AdjustmentKey> = Object.freeze([
  "exposure",
  "shadows",
  "contrast",
  "saturation",
  "temperature",
  "tint",
]);

export const ADJUSTMENT_RANGE = 100;

export const ADJUSTMENT_LABELS: Readonly<Record<AdjustmentKey, string>> = Object.freeze({
  exposure: "Exposure",
  shadows: "Shadows",
  contrast: "Contrast",
  saturation: "Saturation",
  temperature: "Temperature",
  tint: "Tint (green ↔ magenta)",
});

export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  exposure: 0,
  shadows: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
});

/**
 * Filter presets are just named adjustment values, so there is one code path
 * and the exported caption can describe the real numbers rather than a name.
 */
export const ADJUSTMENT_PRESETS: ReadonlyArray<AdjustmentPreset> = Object.freeze([
  {
    id: "none",
    label: "No preset",
    adjustments: { exposure: 0, shadows: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 },
  },
  {
    id: "punch",
    label: "Punch",
    adjustments: { exposure: 6, shadows: 0, contrast: 22, saturation: 24, temperature: 6, tint: 0 },
  },
  {
    id: "warm",
    label: "Warm",
    adjustments: { exposure: 4, shadows: 0, contrast: 6, saturation: 10, temperature: 32, tint: 0 },
  },
  {
    id: "cool",
    label: "Cool",
    adjustments: { exposure: 0, shadows: 0, contrast: 8, saturation: -6, temperature: -32, tint: 0 },
  },
  {
    id: "mono",
    label: "Mono",
    adjustments: { exposure: 4, shadows: 0, contrast: 14, saturation: -100, temperature: 0, tint: 0 },
  },
  {
    id: "fade",
    label: "Fade",
    adjustments: { exposure: 10, shadows: 0, contrast: -26, saturation: -18, temperature: 4, tint: 0 },
  },
]);

// ±100 is two photographic stops each way.
const EXPOSURE_STOPS_PER_UNIT = 1 / 50;
// ±100 shifts red and blue by this many byte values in opposite directions.
const TEMPERATURE_SHIFT = 36;
// ±100 shifts green by this many byte values: positive removes green (toward
// magenta), negative adds green. Red and blue are untouched, so Tint is an
// independent green-magenta axis rather than a second temperature control.
const TINT_SHIFT = 36;
// ±100 offsets all three channels by up to this many byte values at black,
// fading smoothly to zero by mid grey. Negative deepens shadows; positive lifts
// them without touching anything at or above the shadow midpoint.
const SHADOWS_SHIFT = 64;
const SHADOWS_MIDPOINT = 128;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;

function clampUnit(value: unknown): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return number < -ADJUSTMENT_RANGE
    ? -ADJUSTMENT_RANGE
    : number > ADJUSTMENT_RANGE
      ? ADJUSTMENT_RANGE
      : number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function clampByte(value: number): number {
  const number = Math.round(value);
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : number > 255 ? 255 : number;
}

/** Whole-number adjustments inside the documented ±100 range. */
export function normaliseAdjustments(input: Partial<Adjustments> | null = {}): Adjustments {
  return {
    exposure: clampUnit(input?.exposure),
    shadows: clampUnit(input?.shadows),
    contrast: clampUnit(input?.contrast),
    saturation: clampUnit(input?.saturation),
    temperature: clampUnit(input?.temperature),
    tint: clampUnit(input?.tint),
  };
}

export function adjustmentsAreNeutral(adjustments: Partial<Adjustments> | null = {}): boolean {
  const normalised = normaliseAdjustments(adjustments);
  return ADJUSTMENT_KEYS.every((key) => normalised[key] === 0);
}

/** The preset whose values exactly match, or `custom`, or `none`. */
export function presetIdFor(adjustments: Partial<Adjustments> | null = {}): string {
  const normalised = normaliseAdjustments(adjustments);
  const match = ADJUSTMENT_PRESETS.find((preset) =>
    ADJUSTMENT_KEYS.every((key) => preset.adjustments[key] === normalised[key]),
  );
  return match ? match.id : "custom";
}

export function presetAdjustments(id: string): Adjustments {
  const preset = ADJUSTMENT_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return { ...DEFAULT_ADJUSTMENTS };
  return { ...preset.adjustments };
}

/** A caption fragment naming the real numbers, or an empty string. */
export function describeAdjustments(adjustments: Partial<Adjustments> | null = {}): string {
  const normalised = normaliseAdjustments(adjustments);
  const parts = ADJUSTMENT_KEYS.filter((key) => normalised[key] !== 0).map(
    (key) => `${key} ${normalised[key] > 0 ? "+" : ""}${normalised[key]}`,
  );
  return parts.join(", ");
}

/**
 * Apply exposure, temperature and tint, then shadows, then contrast and
 * saturation to decoded RGBA bytes. Shadows adds a luminance-weighted RGB offset
 * that is strongest at black and tapers smoothly to zero at mid grey, so it only
 * moves dark tones before the contrast pivot. Temperature moves the red/blue
 * axis; tint independently moves the green/magenta axis. Fully transparent
 * pixels keep their RGB values, and the alpha byte is never written.
 *
 * `pixels` is mutated in place and returned, because a 40-megapixel copy would
 * double the memory a batch already holds. `changed` counts the pixels whose
 * visible colour actually moved.
 */
export function adjustPixels(
  pixels: Uint8ClampedArray,
  {
    width,
    height,
    adjustments,
  }: {
    width: number;
    height: number;
    adjustments?: Partial<Adjustments> | null;
  } = { width: 0, height: 0 },
): AdjustResult {
  if (!pixels || typeof pixels.length !== "number")
    return { ok: false, error: "The decoded pixels are not readable." };
  if (!isPositiveInteger(width) || !isPositiveInteger(height))
    return { ok: false, error: "The image dimensions are not usable." };
  if (pixels.length < width * height * 4)
    return { ok: false, error: "The decoded pixels are smaller than the stated dimensions." };

  const values = normaliseAdjustments(adjustments);
  if (adjustmentsAreNeutral(values))
    return { ok: true, pixels, neutral: true, changed: 0 };

  const exposure = 2 ** (values.exposure * EXPOSURE_STOPS_PER_UNIT);
  const contrast = 1 + values.contrast / 100;
  const saturation = 1 + values.saturation / 100;
  const temperature = (values.temperature / 100) * TEMPERATURE_SHIFT;
  const tint = (values.tint / 100) * TINT_SHIFT;
  const shadows = (values.shadows / 100) * SHADOWS_SHIFT;
  let changed = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const red0 = pixels[index];
    const green0 = pixels[index + 1];
    const blue0 = pixels[index + 2];

    let red = red0 * exposure;
    let green = green0 * exposure;
    let blue = blue0 * exposure;

    red += temperature;
    blue -= temperature;

    // Tint is the opponent green-magenta axis, so it only moves green.
    // Positive tint reduces green (toward magenta); negative adds green.
    green -= tint;

    // Shadows weights the offset by luminance: full at black, smoothly zero by
    // mid grey. The same offset moves all three channels, so a dark pixel gets
    // lighter or deeper before the final channel clamp.
    if (shadows !== 0) {
      const shadowLuma = red * LUMA_RED + green * LUMA_GREEN + blue * LUMA_BLUE;
      const darkness = Math.min(1, Math.max(0, 1 - shadowLuma / SHADOWS_MIDPOINT));
      const shadowOffset = shadows * darkness * darkness * (3 - 2 * darkness);
      red += shadowOffset;
      green += shadowOffset;
      blue += shadowOffset;
    }

    red = (red - 128) * contrast + 128;
    green = (green - 128) * contrast + 128;
    blue = (blue - 128) * contrast + 128;

    const luma = red * LUMA_RED + green * LUMA_GREEN + blue * LUMA_BLUE;
    red = luma + (red - luma) * saturation;
    green = luma + (green - luma) * saturation;
    blue = luma + (blue - luma) * saturation;

    const nextRed = clampByte(red);
    const nextGreen = clampByte(green);
    const nextBlue = clampByte(blue);
    if (nextRed !== red0 || nextGreen !== green0 || nextBlue !== blue0) changed += 1;
    pixels[index] = nextRed;
    pixels[index + 1] = nextGreen;
    pixels[index + 2] = nextBlue;
  }

  return { ok: true, pixels, neutral: false, changed };
}
