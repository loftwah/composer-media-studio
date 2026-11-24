// MIT. Bounded, browser-local GIF89a writer for ordered still frames.
// No DOM, no network and no dependency: the workbench paints each admitted
// still onto one square matte and this module writes the actual GIF bytes.
// The palette is fixed for every frame, so there is no per-frame colour table
// or transparency to reconcile. Quantisation is nearest-colour with no
// dithering: smooth gradients can band, which the page says plainly.

export const GIF_MIN_FRAMES = 2;
export const GIF_MAX_FRAMES = 8;
export const GIF_MIN_FRAME_SIZE = 16;
export const GIF_MAX_FRAME_SIZE = 320;
export const GIF_MIN_DELAY_MS = 100;
export const GIF_MAX_DELAY_MS = 2_000;
export const GIF_DELAY_STEP_MS = 10;
export const GIF_DEFAULT_DELAY_MS = 500;
export const GIF_DEFAULT_FRAME_SIZE = 240;
export const GIF_FRAME_SIZES = [96, 128, 160, 240, 320] as const;
export const GIF_PALETTE_SIZE = 256;

const GIF_HEADER = "GIF89a";
const CLEAR_CODE = 256;
const END_CODE = 257;
const MIN_CODE_SIZE = 8;
// A 9-bit literal run can spend at most 250 literals before the decoder's next
// dictionary slot would reach 512 and force 10-bit codes. Emitting Clear here
// resets that slot, so every code in the stream is exactly 9 bits.
const LITERAL_RUN = 250;

/** A GIF delay is in hundredths of a second, i.e. units of 10 ms. */
export function gifDelayUnits(delayMs: number): number {
  return Math.round(delayMs / GIF_DELAY_STEP_MS);
}

export function gifSettingsProblem({
  frameCount,
  frameSize,
  delayMs,
}: {
  frameCount: number;
  frameSize: number;
  delayMs: number;
}): string | null {
  if (!Number.isSafeInteger(frameCount) || frameCount < GIF_MIN_FRAMES || frameCount > GIF_MAX_FRAMES)
    return `Choose between ${GIF_MIN_FRAMES} and ${GIF_MAX_FRAMES} images in this batch for a GIF.`;
  if (!Number.isSafeInteger(frameSize) || frameSize < GIF_MIN_FRAME_SIZE || frameSize > GIF_MAX_FRAME_SIZE)
    return `Choose one square frame size from ${GIF_MIN_FRAME_SIZE} to ${GIF_MAX_FRAME_SIZE} px.`;
  if (!Number.isFinite(delayMs) || delayMs < GIF_MIN_DELAY_MS || delayMs > GIF_MAX_DELAY_MS ||
      Math.round(delayMs) !== delayMs || delayMs % GIF_DELAY_STEP_MS !== 0)
    return `Choose one delay from ${GIF_MIN_DELAY_MS} to ${GIF_MAX_DELAY_MS} ms in ${GIF_DELAY_STEP_MS} ms steps.`;
  return null;
}

/** Fit a still inside the square frame at whole pixels and centre it. */
export function gifFramePlacement(
  frameSize: number,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (!Number.isSafeInteger(frameSize) || frameSize < 1 ||
      !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) ||
      sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError("The image does not fit this GIF frame.");
  }
  const scale = Math.min(frameSize / sourceWidth, frameSize / sourceHeight);
  const width = Math.max(1, Math.min(frameSize, Math.round(sourceWidth * scale)));
  const height = Math.max(1, Math.min(frameSize, Math.round(sourceHeight * scale)));
  return {
    x: Math.floor((frameSize - width) / 2),
    y: Math.floor((frameSize - height) / 2),
    width,
    height,
  };
}

// 216 RGB cube entries (6 levels per channel) followed by 40 neutral steps.
// The extra greys are chosen at build time; the entries never change per frame.
export const GIF_PALETTE: Uint8Array = buildPalette();

function buildPalette(): Uint8Array {
  const palette = new Uint8Array(GIF_PALETTE_SIZE * 3);
  const levels = [0, 51, 102, 153, 204, 255];
  let offset = 0;
  for (const red of levels) {
    for (const green of levels) {
      for (const blue of levels) {
        palette[offset++] = red;
        palette[offset++] = green;
        palette[offset++] = blue;
      }
    }
  }
  for (let index = 0; index < GIF_PALETTE_SIZE - 216; index += 1) {
    const grey = Math.round((index * 255) / 39);
    palette[offset++] = grey;
    palette[offset++] = grey;
    palette[offset++] = grey;
  }
  return palette;
}

// A 32 × 32 × 32 lookup of the nearest fixed palette entry for each 5-bit RGB
// cell. Built once on the first GIF; 32 KiB and no per-pixel palette scan.
let nearestPalette: Uint8Array | null = null;

function nearestPaletteEntries(): Uint8Array {
  if (nearestPalette) return nearestPalette;
  const table = new Uint8Array(32 * 32 * 32);
  for (let red = 0; red < 32; red += 1) {
    const r = red * 8 + 4;
    for (let green = 0; green < 32; green += 1) {
      const g = green * 8 + 4;
      for (let blue = 0; blue < 32; blue += 1) {
        const b = blue * 8 + 4;
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let entry = 0; entry < GIF_PALETTE_SIZE; entry += 1) {
          const dr = r - GIF_PALETTE[entry * 3];
          const dg = g - GIF_PALETTE[entry * 3 + 1];
          const db = b - GIF_PALETTE[entry * 3 + 2];
          const distance = dr * dr + dg * dg + db * db;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = entry;
            if (distance === 0) break;
          }
        }
        table[(red << 10) | (green << 5) | blue] = best;
      }
    }
  }
  nearestPalette = table;
  return table;
}

function quantise(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.byteLength !== width * height * 4)
    throw new RangeError("The GIF frame does not match its dimensions.");
  const table = nearestPaletteEntries();
  const indices = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < indices.length; pixel += 1, offset += 4) {
    const key = ((rgba[offset] >> 3) << 10) | ((rgba[offset + 1] >> 3) << 5) | (rgba[offset + 2] >> 3);
    indices[pixel] = table[key];
  }
  return indices;
}

/**
 * Valid 9-bit literal LZW. Every run starts with Clear, then up to 250 literal
 * colour indices, then Clear again. The decoder builds at most 250 dictionary
 * entries before each reset, so no code ever needs 10 bits. This is larger than
 * an optimised LZW stream but simple, bounded and accepted by ordinary decoders.
 */
function literalLzw(indices: Uint8Array): Uint8Array {
  const clears = Math.floor(indices.length / LITERAL_RUN);
  const capacity = Math.ceil(((indices.length + clears + 2) * 9) / 8) + 4;
  const out = new Uint8Array(capacity);
  let offset = 0;
  let accumulator = 0;
  let bits = 0;
  const emit = (code: number): void => {
    accumulator |= code << bits;
    bits += 9;
    while (bits >= 8) {
      out[offset++] = accumulator & 0xff;
      accumulator >>>= 8;
      bits -= 8;
    }
  };

  let run = 0;
  emit(CLEAR_CODE);
  for (const index of indices) {
    if (run === LITERAL_RUN) {
      emit(CLEAR_CODE);
      run = 0;
    }
    emit(index);
    run += 1;
  }
  emit(END_CODE);
  if (bits > 0) out[offset++] = accumulator & 0xff;
  return out.slice(0, offset);
}

type GifWriter = {
  byte: (value: number) => void;
  u16: (value: number) => void;
  bytes: (values: Uint8Array) => void;
  ascii: (value: string) => void;
  finish: () => Uint8Array;
};

function writer(capacity: number): GifWriter {
  let data = new Uint8Array(Math.max(64, capacity));
  let offset = 0;
  const need = (count: number): void => {
    if (offset + count <= data.length) return;
    let size = data.length * 2;
    while (size < offset + count) size *= 2;
    const next = new Uint8Array(size);
    next.set(data.subarray(0, offset));
    data = next;
  };
  return {
    byte(value) {
      need(1);
      data[offset++] = value & 0xff;
    },
    u16(value) {
      need(2);
      data[offset++] = value & 0xff;
      data[offset++] = (value >>> 8) & 0xff;
    },
    bytes(values) {
      need(values.length);
      data.set(values, offset);
      offset += values.length;
    },
    ascii(value) {
      need(value.length);
      for (let index = 0; index < value.length; index += 1)
        data[offset++] = value.charCodeAt(index) & 0x7f;
    },
    finish() {
      return data.slice(0, offset);
    },
  };
}

export type GifEncodeOptions = {
  /** One RGBA byte run per frame, each exactly width × height × 4 bytes. */
  frames: Uint8Array[];
  width: number;
  height: number;
  delayMs: number;
  loop?: boolean;
};

/**
 * Write a complete GIF89a file: one shared 256-colour global table, one Graphic
 * Control Extension per frame, optional Netscape looping extension and a single
 * trailer. Frames are in the array order, which is the workbench's list order.
 */
export function encodeGif({ frames, width, height, delayMs, loop = true }: GifEncodeOptions): Uint8Array {
  if (!Number.isSafeInteger(width) || width < 1 || width > GIF_MAX_FRAME_SIZE ||
      !Number.isSafeInteger(height) || height < 1 || height > GIF_MAX_FRAME_SIZE)
    throw new RangeError(`GIF dimensions must be whole pixels from 1 to ${GIF_MAX_FRAME_SIZE}.`);
  if (!frames.length || frames.length > GIF_MAX_FRAMES)
    throw new RangeError(`A GIF can contain up to ${GIF_MAX_FRAMES} frames.`);
  const units = gifDelayUnits(delayMs);
  if (!Number.isSafeInteger(delayMs) || delayMs < GIF_DELAY_STEP_MS ||
      Math.round(delayMs) !== delayMs || units * GIF_DELAY_STEP_MS !== delayMs ||
      units > 0xffff)
    throw new RangeError("A GIF delay must be whole 10 ms units.");
  const expected = width * height * 4;
  for (const frame of frames) {
    if (frame.byteLength !== expected)
      throw new RangeError("Every GIF frame must match the declared dimensions.");
  }

  const output = writer(64 + GIF_PALETTE_SIZE * 3 + frames.length * 128 + frames.length * width * height);

  output.ascii(GIF_HEADER);
  output.u16(width);
  output.u16(height);
  // Global colour table present, 8-bit colour resolution, 256 entries.
  output.byte(0xf7);
  output.byte(0);
  output.byte(0);
  output.bytes(GIF_PALETTE);

  if (loop) {
    output.byte(0x21);
    output.byte(0xff);
    output.byte(0x0b);
    output.ascii("NETSCAPE2.0");
    output.byte(0x03);
    output.byte(0x01);
    output.u16(0);
    output.byte(0);
  }

  for (const frame of frames) {
    output.byte(0x21);
    output.byte(0xf9);
    output.byte(0x04);
    // Disposal 1 (leave in place), no transparency and no user input.
    output.byte(0x04);
    output.u16(units);
    output.byte(0);
    output.byte(0x00);

    output.byte(0x2c);
    output.u16(0);
    output.u16(0);
    output.u16(width);
    output.u16(height);
    output.byte(0x00);

    const data = literalLzw(quantise(frame, width, height));
    output.byte(MIN_CODE_SIZE);
    for (let offset = 0; offset < data.length; offset += 255) {
      const size = Math.min(255, data.length - offset);
      output.byte(size);
      output.bytes(data.subarray(offset, offset + size));
    }
    output.byte(0);
  }

  output.byte(0x3b);
  return output.finish();
}
