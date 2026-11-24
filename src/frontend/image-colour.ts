// MIT. Pure colour and alpha analysis for the signed-out image workbench.
// These functions read decoded RGBA bytes only, so the browser path and the
// Node tests use the same palette, trim and eyedropper arithmetic.

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

export type AlphaProfileResult =
  | {
      ok: true;
      width: number;
      height: number;
      totalPixels: number;
      transparent: number;
      partial: number;
      opaque: number;
    }
  | { ok: false; error: string };

export const MAX_PALETTE_COLOURS = 8;
export const PALETTE_MERGE_DISTANCE = 18;
export const PALETTE_MAX_SAMPLES = 1_000_000;
export const PALETTE_WORKING_EDGE = 1400;

type Bin = { key: number; count: number; r: number; g: number; b: number; a: number };
type Cluster = { count: number; r: number; g: number; b: number; a: number };

type PaletteOptions = {
  width: number;
  height: number;
  maxColors?: number;
  mergeDistance?: number;
  maxSamples?: number;
};

type AlphaBoundsOptions = { width: number; height: number; threshold?: number };

type TransformOptions = {
  width: number;
  height: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
};

type PickPixelOptions = {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
};

function clampByte(value: unknown): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : number > 255 ? 255 : number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function pixelLengthProblem(
  pixels: Uint8Array | Uint8ClampedArray,
  width: unknown,
  height: unknown,
): string | null {
  if (!pixels || typeof pixels.length !== "number")
    return "The decoded pixels are not readable.";
  if (!isPositiveInteger(width) || !isPositiveInteger(height))
    return "The image dimensions are not usable.";
  if (pixels.length < width * height * 4)
    return "The decoded pixels are smaller than the stated dimensions.";
  return null;
}

/** Normalise an RGB triple to whole 0–255 values. */
export function normaliseRgb({ r, g, b }: Partial<Rgb> = {}): Rgb {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

/** `#rrggbb` for an RGB triple. */
export function rgbToHex(rgb: Partial<Rgb>): string {
  const { r, g, b } = normaliseRgb(rgb);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Parse `#rgb` or `#rrggbb`; returns null for anything else. */
export function hexToRgb(hex: string): Rgb | null {
  const value = String(hex ?? "").trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short)
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  const long = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!long) return null;
  return {
    r: parseInt(long[1], 16),
    g: parseInt(long[2], 16),
    b: parseInt(long[3], 16),
  };
}

/** HSL with whole-number hue (0–359), saturation and lightness (0–100). */
export function rgbToHsl(rgb: Partial<Rgb>): Hsl {
  const { r, g, b } = normaliseRgb(rgb);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(lightness * 100) };
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  return {
    h: Math.round(hue) % 360,
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

export function formatRgb(rgb: Partial<Rgb>): string {
  const { r, g, b } = normaliseRgb(rgb);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl(hsl: Partial<Hsl>): string {
  const { h: hue, s: saturation, l: lightness } = hsl ?? {};
  const h = typeof hue === "number" && Number.isFinite(hue) ? Math.round(hue) % 360 : 0;
  const s = typeof saturation === "number" && Number.isFinite(saturation) ? Math.round(saturation) : 0;
  const l = typeof lightness === "number" && Number.isFinite(lightness) ? Math.round(lightness) : 0;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Export only the extracted swatches, without the source filename or image metadata.
export function paletteToGpl(colors: PaletteColour[]): string {
  const lines = ["GIMP Palette", "Name: Studio palette", "Columns: 8", "#"];
  for (const { rgb, hex } of colors) {
    const channels = [rgb.r, rgb.g, rgb.b]
      .map((value) => String(value).padStart(3, " "))
      .join(" ");
    lines.push(`${channels}\t${hex}`);
  }
  return `${lines.join("\n")}\n`;
}

// The same swatches as :root custom properties for an owned app. Values are the
// exact extracted HEX strings, in palette order; no filename or image metadata.
export function paletteToCss(colors: PaletteColour[]): string {
  const lines = ["/* Studio palette - extracted swatches */", ":root {"];
  colors.forEach(({ hex }, index) => {
    lines.push(`  --swatch-${index + 1}: ${hex};`);
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

// A small, self-describing JSON document for deliberate reuse in another
// project. Version 1 is immutable: the same swatches in the same order and
// exact HEX values as the GPL/CSS exports, with no source filename, image
// metadata, sampled pixels, credentials or timestamps. The units block gives
// each exported colour field an explicit meaning.
export function paletteToJson(colors: PaletteColour[]): string {
  const document = {
    format: "media-studio-palette",
    version: 1,
    units: {
      hex: "lowercase #rrggbb",
      rgb: "sRGB channels, 0-255",
      hsl: "hue 0-359 degrees; saturation and lightness 0-100 percent",
      alpha: "average alpha per swatch, 0-255; 255 is opaque",
    },
    colors: colors.map(({ hex, rgb, hsl, alpha }) => ({
      hex,
      rgb: { r: rgb.r, g: rgb.g, b: rgb.b },
      hsl: { h: hsl.h, s: hsl.s, l: hsl.l },
      alpha,
    })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

// Adobe Swatch Exchange (.ase) bytes for the exact same swatches. A standard
// ASEF 1.0 header, one colour block per swatch with an "RGB " model and 0-1
// float channels, UTF-16BE HEX names and the normal colour type. The file
// contains only swatch names and values.
export function paletteToAse(colors: PaletteColour[]): Uint8Array {
  const blocks = colors.map(({ rgb, hex }) => {
    const name = `${hex}\0`; // ASE names are null-terminated UTF-16BE
    const nameBytes = name.length * 2;
    // name length field + name + "RGB " + three floats + colour type
    const blockLength = 2 + nameBytes + 4 + 12 + 2;
    const block = new Uint8Array(6 + blockLength); // + block signature and length
    const view = new DataView(block.buffer);
    view.setUint16(0, 0x0001, false); // colour entry block
    view.setUint32(2, blockLength, false);
    view.setUint16(6, name.length, false); // name length in UTF-16 code units
    for (let index = 0; index < name.length; index += 1)
      view.setUint16(8 + index * 2, name.charCodeAt(index), false);
    let offset = 8 + nameBytes;
    block.set([0x52, 0x47, 0x42, 0x20], offset); // "RGB "
    offset += 4;
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      view.setFloat32(offset, channel / 255, false);
      offset += 4;
    }
    view.setUint16(offset, 2, false); // colour type: normal
    return block;
  });

  const totalBytes = 12 + blocks.reduce((sum, block) => sum + block.length, 0);
  const bytes = new Uint8Array(totalBytes);
  const header = new DataView(bytes.buffer);
  bytes.set([0x41, 0x53, 0x45, 0x46], 0); // "ASEF"
  header.setUint16(4, 1, false); // major version
  header.setUint16(6, 0, false); // minor version
  header.setUint32(8, colors.length, false);
  let offset = 12;
  for (const block of blocks) {
    bytes.set(block, offset);
    offset += block.length;
  }
  return bytes;
}

const PALETTE_BIN_SHIFT = 3;

/**
 * Dominant colours from decoded RGBA pixels.
 *
 * - Fully transparent pixels (alpha 0) are ignored.
 * - Pixels are sampled with a deterministic stride on very large images.
 * - A 5-bit RGB histogram is merged by Euclidean distance so near-duplicates
 *   become one colour instead of crowding the list.
 * - Coverage is the share of sampled visible pixels, not of all pixels.
 */
export function extractPalette(
  pixels: Uint8Array | Uint8ClampedArray,
  {
    width,
    height,
    maxColors = MAX_PALETTE_COLOURS,
    mergeDistance = PALETTE_MERGE_DISTANCE,
    maxSamples = PALETTE_MAX_SAMPLES,
  }: PaletteOptions = { width: 0, height: 0 },
): PaletteResult {
  const problem = pixelLengthProblem(pixels, width, height);
  if (problem) return { ok: false, error: problem };
  if (!isPositiveInteger(maxColors) || maxColors > 64)
    return { ok: false, error: "Choose between 1 and 64 palette colours." };
  if (!Number.isFinite(mergeDistance) || mergeDistance < 0)
    return { ok: false, error: "The merge distance is invalid." };
  if (!isPositiveInteger(maxSamples))
    return { ok: false, error: "The sample limit is invalid." };

  const totalPixels = width * height;
  const sampleStride = Math.max(1, Math.ceil(totalPixels / maxSamples));
  const bins = new Map<number, Bin>();
  let sampledPixels = 0;
  let sampledVisiblePixels = 0;
  let transparentPixels = 0;

  for (let index = 0; index < totalPixels; index += sampleStride) {
    const offset = index * 4;
    const alpha = pixels[offset + 3];
    sampledPixels += 1;
    if (alpha === 0) {
      transparentPixels += 1;
      continue;
    }
    sampledVisiblePixels += 1;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const key =
      ((red >> PALETTE_BIN_SHIFT) << 10) |
      ((green >> PALETTE_BIN_SHIFT) << 5) |
      (blue >> PALETTE_BIN_SHIFT);
    const bin = bins.get(key);
    if (bin) {
      bin.count += 1;
      bin.r += red;
      bin.g += green;
      bin.b += blue;
      bin.a += alpha;
    } else {
      bins.set(key, { key, count: 1, r: red, g: green, b: blue, a: alpha });
    }
  }

  if (!sampledVisiblePixels) {
    return {
      ok: true,
      colors: [],
      totalPixels,
      sampledPixels,
      sampleStride,
      sampledVisiblePixels,
      transparentPixels,
      complete: sampleStride === 1,
      coveredPercent: 0,
    };
  }

  const orderedBins = [...bins.values()].sort(
    (left, right) => right.count - left.count || left.key - right.key,
  );
  const clusters: Cluster[] = [];
  for (const bin of orderedBins) {
    const red = bin.r / bin.count;
    const green = bin.g / bin.count;
    const blue = bin.b / bin.count;
    let match: Cluster | null = null;
    let matchDistance = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const distance = Math.hypot(
        red - cluster.r / cluster.count,
        green - cluster.g / cluster.count,
        blue - cluster.b / cluster.count,
      );
      if (distance <= mergeDistance && distance < matchDistance) {
        match = cluster;
        matchDistance = distance;
      }
    }
    if (match) {
      match.count += bin.count;
      match.r += bin.r;
      match.g += bin.g;
      match.b += bin.b;
      match.a += bin.a;
    } else {
      clusters.push({
        count: bin.count,
        r: bin.r,
        g: bin.g,
        b: bin.b,
        a: bin.a,
      });
    }
  }

  const colors = clusters
    .map((cluster) => {
      const rgb = normaliseRgb({
        r: cluster.r / cluster.count,
        g: cluster.g / cluster.count,
        b: cluster.b / cluster.count,
      });
      return {
        hex: rgbToHex(rgb),
        rgb,
        alpha: clampByte(cluster.a / cluster.count),
        hsl: rgbToHsl(rgb),
        count: cluster.count,
        coverage: Math.round((cluster.count / sampledVisiblePixels) * 1000) / 10,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count || (left.hex < right.hex ? -1 : left.hex > right.hex ? 1 : 0),
    )
    .slice(0, maxColors);

  const coveredPercent =
    Math.round(
      (colors.reduce((sum, colour) => sum + colour.count, 0) /
        sampledVisiblePixels) *
        1000,
    ) / 10;

  return {
    ok: true,
    colors,
    totalPixels,
    sampledPixels,
    sampleStride,
    sampledVisiblePixels,
    transparentPixels,
    complete: sampleStride === 1 && sampledPixels === totalPixels,
    coveredPercent,
  };
}

/**
 * Exact alpha bounds over every decoded pixel. `threshold` is the alpha value
 * that still counts as content, so the default trims only fully transparent
 * padding. An opaque image comes back as `isFull`, never as a silent crop.
 */
export function alphaBounds(
  pixels: Uint8Array | Uint8ClampedArray,
  { width, height, threshold = 0 }: AlphaBoundsOptions = { width: 0, height: 0 },
): AlphaBoundsResult {
  const problem = pixelLengthProblem(pixels, width, height);
  if (problem) return { ok: false, error: problem };
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255)
    return { ok: false, error: "The alpha threshold must be between 0 and 255." };

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  let transparentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > threshold) {
        visiblePixels += 1;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      } else {
        transparentPixels += 1;
      }
    }
  }

  if (!visiblePixels) {
    return {
      ok: true,
      empty: true,
      visiblePixels,
      transparentPixels,
      bounds: null,
      isFull: false,
    };
  }

  const bounds = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  return {
    ok: true,
    empty: false,
    visiblePixels,
    transparentPixels,
    bounds,
    isFull: bounds.width === width && bounds.height === height,
  };
}

/**
 * Classify every decoded alpha byte of a completed result. Counts are exact:
 * no sampling, no scaling, no rounding. The byte length must match the stated
 * dimensions, so a stale or oversized buffer cannot contribute a pixel.
 */
export function alphaProfile(
  pixels: Uint8Array | Uint8ClampedArray,
  { width, height }: { width: number; height: number },
): AlphaProfileResult {
  const problem = pixelLengthProblem(pixels, width, height);
  if (problem) return { ok: false, error: problem };
  if (pixels.length !== width * height * 4)
    return { ok: false, error: "The decoded pixels do not match the stated dimensions." };
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    if (alpha === 0) transparent += 1;
    else if (alpha === 255) opaque += 1;
    else partial += 1;
  }
  return {
    ok: true,
    width,
    height,
    totalPixels: width * height,
    transparent,
    partial,
    opaque,
  };
}

const ALPHA_MAP_MAX_EDGE = 512;

export type AlphaMap = {
  width: number;
  height: number;
  sampled: boolean;
  pixels: Uint8ClampedArray;
};

type AlphaMapPlan = {
  map: AlphaMap;
  sourceWidth: number;
  columns: Uint32Array;
  rows: Uint32Array;
};

function nearestIndices(source: number, target: number): Uint32Array {
  return Uint32Array.from({ length: target }, (_, index) =>
    Math.min(source - 1, Math.floor(((index + 0.5) * source) / target)));
}

/** Allocate only the display grid, capped at 512 pixels on its long edge. */
export function alphaMapPlan(width: number, height: number): AlphaMapPlan | null {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return null;
  const scale = Math.min(1, ALPHA_MAP_MAX_EDGE / Math.max(width, height));
  const mapWidth = Math.max(1, Math.round(width * scale));
  const mapHeight = Math.max(1, Math.round(height * scale));
  return {
    map: {
      width: mapWidth,
      height: mapHeight,
      sampled: scale < 1,
      pixels: new Uint8ClampedArray(mapWidth * mapHeight * 4),
    },
    sourceWidth: width,
    columns: nearestIndices(width, mapWidth),
    rows: nearestIndices(height, mapHeight),
  };
}

/** Copy alpha bytes into grayscale map pixels whose source is in this band. */
export function writeAlphaMapBand(
  { map, sourceWidth, columns, rows }: AlphaMapPlan,
  band: Uint8Array | Uint8ClampedArray,
  sourceY: number,
): void {
  const bandRows = Math.floor(band.length / (sourceWidth * 4));
  for (let mapY = 0; mapY < map.height; mapY += 1) {
    const bandRow = rows[mapY] - sourceY;
    if (bandRow < 0 || bandRow >= bandRows) continue;
    for (let mapX = 0; mapX < map.width; mapX += 1) {
      const alpha = band[(bandRow * sourceWidth + columns[mapX]) * 4 + 3];
      const offset = (mapY * map.width + mapX) * 4;
      map.pixels[offset] = alpha;
      map.pixels[offset + 1] = alpha;
      map.pixels[offset + 2] = alpha;
      map.pixels[offset + 3] = 255;
    }
  }
}

/**
 * Move an alpha-bounds rectangle into the rotated/flipped canvas space used by
 * `drawUserTransform` (flips first, then the clockwise quarter turns).
 */
export function mapBoundsThroughTransform(
  bounds: ImageBounds,
  {
    width,
    height,
    rotate = 0,
    flipH = false,
    flipV = false,
  }: TransformOptions = { width: 0, height: 0 },
): { ok: true; bounds: ImageBounds } | { ok: false; error: string } {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return { ok: false, error: "The image dimensions are not usable." };
  }
  if (!Number.isInteger(rotate) || rotate < 0 || rotate > 3)
    return { ok: false, error: "Rotation must be a quarter turn between 0 and 3." };
  if (typeof flipH !== "boolean" || typeof flipV !== "boolean")
    return { ok: false, error: "Flip settings are invalid." };
  if (
    !bounds ||
    !Number.isSafeInteger(bounds.x) ||
    !Number.isSafeInteger(bounds.y) ||
    !isPositiveInteger(bounds.width) ||
    !isPositiveInteger(bounds.height) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > width ||
    bounds.y + bounds.height > height
  ) {
    return { ok: false, error: "The bounds do not fit inside the image." };
  }

  let x = bounds.x;
  let y = bounds.y;
  let w = bounds.width;
  let h = bounds.height;
  if (flipH) x = width - (x + w);
  if (flipV) y = height - (y + h);
  if (rotate === 1) {
    const nextX = height - (y + h);
    const nextY = x;
    const nextWidth = h;
    const nextHeight = w;
    x = nextX;
    y = nextY;
    w = nextWidth;
    h = nextHeight;
  } else if (rotate === 2) {
    x = width - (x + w);
    y = height - (y + h);
  } else if (rotate === 3) {
    const nextX = y;
    const nextY = width - (x + w);
    const nextWidth = h;
    const nextHeight = w;
    x = nextX;
    y = nextY;
    w = nextWidth;
    h = nextHeight;
  }

  return { ok: true, bounds: { x, y, width: w, height: h } };
}

/**
 * Map a pointer position in CSS pixels inside a rendered image box to the
 * intrinsic decoded pixel. The browser reports CSS pixels, so device pixel
 * ratio is already folded into `rect`; a high-DPR screen does not shift the
 * source pixel. Returns null outside the image.
 */
export function pickImagePixel(options?: PickPixelOptions): { x: number; y: number } | null {
  if (options === undefined) return null;
  const { clientX, clientY, rect, imageWidth, imageHeight } = options;
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  if (!isPositiveInteger(imageWidth) || !isPositiveInteger(imageHeight)) return null;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height)
    return null;
  const x = Math.floor((localX / rect.width) * imageWidth);
  const y = Math.floor((localY / rect.height) * imageHeight);
  if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return null;
  return { x, y };
}
