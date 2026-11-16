export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };
export type ImageBounds = { x: number; y: number; width: number; height: number };

export type PaletteColour = {
  hex: string;
  rgb: Rgb;
  alpha: number;
  hsl: Hsl;
  count: number;
  coverage: number;
};

export type PaletteResult =
  | {
      ok: true;
      colors: PaletteColour[];
      totalPixels: number;
      sampledPixels: number;
      sampleStride: number;
      sampledVisiblePixels: number;
      transparentPixels: number;
      complete: boolean;
      coveredPercent: number;
    }
  | { ok: false; error: string };

export type AlphaBoundsResult =
  | {
      ok: true;
      empty: boolean;
      visiblePixels: number;
      transparentPixels: number;
      bounds: ImageBounds | null;
      isFull: boolean;
    }
  | { ok: false; error: string };

export const MAX_PALETTE_COLOURS: number;
export const PALETTE_MERGE_DISTANCE: number;
export const PALETTE_MAX_SAMPLES: number;
export const PALETTE_WORKING_EDGE: number;

export function normaliseRgb(rgb?: Partial<Rgb>): Rgb;
export function rgbToHex(rgb: Partial<Rgb>): string;
export function hexToRgb(hex: string): Rgb | null;
export function rgbToHsl(rgb: Partial<Rgb>): Hsl;
export function formatRgb(rgb: Partial<Rgb>): string;
export function formatHsl(hsl: Partial<Hsl>): string;
export function paletteToGpl(colors: PaletteColour[]): string;
export function paletteToCss(colors: PaletteColour[]): string;
export function paletteToAse(colors: PaletteColour[]): Uint8Array;
export function extractPalette(
  pixels: Uint8Array | Uint8ClampedArray,
  options?: {
    width: number;
    height: number;
    maxColors?: number;
    mergeDistance?: number;
    maxSamples?: number;
  },
): PaletteResult;
export function alphaBounds(
  pixels: Uint8Array | Uint8ClampedArray,
  options?: { width: number; height: number; threshold?: number },
): AlphaBoundsResult;
export function mapBoundsThroughTransform(
  bounds: ImageBounds,
  options?: {
    width: number;
    height: number;
    rotate?: number;
    flipH?: boolean;
    flipV?: boolean;
  },
): { ok: true; bounds: ImageBounds } | { ok: false; error: string };
export function pickImagePixel(options?: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
}): { x: number; y: number } | null;
