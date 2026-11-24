// MIT. Focused binary checks for the bounded browser-local GIF writer:
// declared limits, frame placement, GIF89a structure, shared palette and the
// 9-bit literal LZW payload that Pillow and ordinary decoders read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  GIF_DELAY_STEP_MS,
  GIF_FRAME_SIZES,
  GIF_MAX_DELAY_MS,
  GIF_MAX_FRAME_SIZE,
  GIF_MAX_FRAMES,
  GIF_MIN_DELAY_MS,
  GIF_MIN_FRAME_SIZE,
  GIF_MIN_FRAMES,
  GIF_PALETTE,
  GIF_PALETTE_SIZE,
  encodeGif,
  gifDelaySummary,
  gifDelayUnits,
  gifFrameDelaysProblem,
  gifFramePlacement,
  gifSettingsProblem,
} from "../src/frontend/image-gif.ts";

function frame(colour, width, height, alpha = 255) {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set([colour[0], colour[1], colour[2], alpha], offset);
  }
  return rgba;
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// The writer only emits Clear, literal indices and End. That makes a compact
// test decoder enough to prove the 9-bit packing and the pixel order.
function literalCodes(data) {
  const codes = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of data) {
    accumulator |= byte << bits;
    bits += 8;
    while (bits >= 9) {
      codes.push(accumulator & 0x1ff);
      accumulator >>>= 9;
      bits -= 9;
    }
  }
  return codes;
}

function decodeFrame(data) {
  const indices = [];
  for (const code of literalCodes(data)) {
    if (code === 256) continue;
    if (code === 257) break;
    indices.push(code);
  }
  return indices;
}

// A full GIF LZW decoder, including the growing dictionary and Clear resets.
// It reports the code width it actually reached so a fixed 9-bit stream can be
// proved rather than assumed.
function decodeLzw(data) {
  const clear = 256;
  const end = 257;
  const indices = [];
  let dictionary = [];
  let next = 258;
  let width = 9;
  let maxWidth = 9;
  let clears = 0;
  let maxCode = 0;
  let previous = null;
  const reset = () => {
    dictionary = [];
    for (let index = 0; index < 256; index += 1) dictionary[index] = [index];
    next = 258;
    width = 9;
  };
  reset();
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  const read = () => {
    while (bits < width) {
      if (offset >= data.length) return -1;
      accumulator |= data[offset] << bits;
      offset += 1;
      bits += 8;
    }
    const code = accumulator & ((1 << width) - 1);
    accumulator >>>= width;
    bits -= width;
    return code;
  };
  for (;;) {
    const code = read();
    assert.notEqual(code, -1, "the LZW stream ends without an End code");
    if (code === clear) {
      reset();
      previous = null;
      clears += 1;
      continue;
    }
    if (code === end) break;
    maxCode = Math.max(maxCode, code);
    let entry;
    if (code < next && dictionary[code]) entry = dictionary[code];
    else if (code === next && previous) entry = previous.concat(previous[0]);
    else assert.fail(`unexpected LZW code ${code} at next ${next}`);
    indices.push(...entry);
    if (previous) {
      dictionary[next] = previous.concat(entry[0]);
      next += 1;
      if (next === (1 << width)) {
        width += 1;
        maxWidth = Math.max(maxWidth, width);
      }
    }
    previous = entry;
  }
  return { indices, clears, maxCode, maxWidth };
}

function imageData(parsed) {
  return parsed.frames.map((block) => decodeLzw(block.data));
}

// A filled frame with flat bands and a gradient, repeated across many pixels so
// the dictionary can do realistic work. Deterministic and independent of files.
function typicalFrame(width, height, shift) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const band = ((x + shift) >> 4) + (y >> 4);
      rgba[offset] = (x * 4 + shift * 7) & 0xff;
      rgba[offset + 1] = (y * 3 + 40) & 0xff;
      rgba[offset + 2] = band % 2 ? 32 : 220;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

// The bytes this writer produced for the fixture before the compact option
// existed. The opt-in path must not change the default stream.
const LEGACY_FIXTURE_SHA256 = "10561d5659861891e5e933d38974501b8aefabb0acdd43a8f9080982db685b13";

function parseGif(bytes) {
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), "GIF89a");
  const width = readU16(bytes, 6);
  const height = readU16(bytes, 8);
  assert.equal(bytes[10], 0xf7, "global table, 8-bit colour resolution, 256 entries");
  assert.equal(bytes[11], 0, "background index 0");
  assert.equal(bytes[12], 0, "no pixel aspect");
  const palette = bytes.subarray(13, 13 + GIF_PALETTE_SIZE * 3);
  let offset = 13 + GIF_PALETTE_SIZE * 3;
  let loopExtension = false;
  const frames = [];
  let delayUnits = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      assert.equal(offset, bytes.length - 1, "trailer is last");
      break;
    }
    if (marker === 0x21 && bytes[offset + 1] === 0xff) {
      assert.equal(bytes[offset + 2], 0x0b);
      assert.equal(String.fromCharCode(...bytes.subarray(offset + 3, offset + 14)), "NETSCAPE2.0");
      assert.equal(bytes[offset + 14], 0x03);
      assert.equal(bytes[offset + 15], 0x01);
      assert.equal(readU16(bytes, offset + 16), 0, "infinite loop");
      loopExtension = true;
      assert.equal(bytes[offset + 18], 0, "application block terminator");
      offset += 19;
      continue;
    }
    if (marker === 0x21 && bytes[offset + 1] === 0xf9) {
      assert.equal(bytes[offset + 2], 0x04);
      assert.equal(bytes[offset + 3], 0x04, "disposal 1, opaque, no user input");
      delayUnits = readU16(bytes, offset + 4);
      assert.equal(bytes[offset + 6], 0, "no transparent index");
      assert.equal(bytes[offset + 7], 0, "graphic control terminator");
      offset += 8;
      continue;
    }
    assert.equal(marker, 0x2c, "image descriptor");
    const descriptor = {
      left: readU16(bytes, offset + 1),
      top: readU16(bytes, offset + 3),
      width: readU16(bytes, offset + 5),
      height: readU16(bytes, offset + 7),
    };
    assert.equal(bytes[offset + 9], 0, "no local table, not interlaced");
    let cursor = offset + 10;
    assert.equal(bytes[cursor], 8, "LZW minimum code size 8");
    cursor += 1;
    const chunks = [];
    while (bytes[cursor] !== 0) {
      const size = bytes[cursor];
      chunks.push(bytes.subarray(cursor + 1, cursor + 1 + size));
      cursor += 1 + size;
    }
    const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let write = 0;
    for (const chunk of chunks) {
      data.set(chunk, write);
      write += chunk.length;
    }
    assert.equal(bytes[cursor], 0, "image data terminator");
    frames.push({ delayUnits, descriptor, data });
    offset = cursor + 1;
  }
  return { width, height, palette, loopExtension, frames };
}

test("GIF limits are explicit: 2-8 stills, one square frame up to 320 px and 10 ms delay units", () => {
  assert.equal(GIF_MIN_FRAMES, 2);
  assert.equal(GIF_MAX_FRAMES, 8);
  assert.equal(GIF_MIN_FRAME_SIZE, 16);
  assert.equal(GIF_MAX_FRAME_SIZE, 320);
  assert.equal(GIF_MIN_DELAY_MS, 100);
  assert.equal(GIF_MAX_DELAY_MS, 2000);
  assert.equal(GIF_DELAY_STEP_MS, 10);
  assert.deepEqual(GIF_FRAME_SIZES, [96, 128, 160, 240, 320]);

  assert.equal(gifSettingsProblem({ frameCount: 2, frameSize: 240, delayMs: 500 }), null);
  assert.equal(gifSettingsProblem({ frameCount: 8, frameSize: 320, delayMs: 2000 }), null);
  assert.match(gifSettingsProblem({ frameCount: 1, frameSize: 240, delayMs: 500 }), /between 2 and 8/);
  assert.match(gifSettingsProblem({ frameCount: 9, frameSize: 240, delayMs: 500 }), /between 2 and 8/);
  assert.match(gifSettingsProblem({ frameCount: 2, frameSize: 15, delayMs: 500 }), /16 to 320/);
  assert.match(gifSettingsProblem({ frameCount: 2, frameSize: 321, delayMs: 500 }), /16 to 320/);
  assert.match(gifSettingsProblem({ frameCount: 2, frameSize: 240, delayMs: 90 }), /100 to 2000/);
  assert.match(gifSettingsProblem({ frameCount: 2, frameSize: 240, delayMs: 2010 }), /100 to 2000/);
  assert.match(gifSettingsProblem({ frameCount: 2, frameSize: 240, delayMs: 505 }), /10 ms steps/);
  assert.equal(gifDelayUnits(100), 10);
  assert.equal(gifDelayUnits(2000), 200);
});

test("each still is fitted inside the square frame at whole pixels and centred", () => {
  assert.deepEqual(gifFramePlacement(320, 640, 480), { x: 0, y: 40, width: 320, height: 240 });
  assert.deepEqual(gifFramePlacement(240, 480, 640), { x: 30, y: 0, width: 180, height: 240 });
  assert.deepEqual(gifFramePlacement(320, 1, 2000), { x: 159, y: 0, width: 1, height: 320 });
  assert.throws(() => gifFramePlacement(0, 1, 1), RangeError);
  assert.throws(() => gifFramePlacement(240, Number.NaN, 1), RangeError);
});

test("the fixed palette is 256 RGB entries with 216 cube colours and 40 greys", () => {
  assert.equal(GIF_PALETTE.length, GIF_PALETTE_SIZE * 3);
  assert.deepEqual([...GIF_PALETTE.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...GIF_PALETTE.subarray(180 * 3, 180 * 3 + 3)], [255, 0, 0]);
  assert.deepEqual([...GIF_PALETTE.subarray(216 * 3, 216 * 3 + 3)], [0, 0, 0]);
  assert.deepEqual([...GIF_PALETTE.subarray(255 * 3, 255 * 3 + 3)], [255, 255, 255]);
});

test("a looping GIF89a carries the shared palette, per-frame delay and literal LZW pixels", () => {
  const width = 4;
  const height = 4;
  const bytes = encodeGif({
    frames: [frame([255, 0, 0], width, height), frame([0, 0, 255], width, height)],
    width,
    height,
    delayMs: 500,
    loop: true,
  });
  const parsed = parseGif(bytes);
  assert.equal(parsed.width, 4);
  assert.equal(parsed.height, 4);
  assert.equal(parsed.loopExtension, true);
  assert.deepEqual([...parsed.palette], [...GIF_PALETTE]);
  assert.equal(parsed.frames.length, 2);
  assert.deepEqual(parsed.frames[0].descriptor, { left: 0, top: 0, width: 4, height: 4 });
  assert.deepEqual(parsed.frames[1].descriptor, { left: 0, top: 0, width: 4, height: 4 });
  assert.equal(parsed.frames[0].delayUnits, 50, "500 ms is 50 hundredths");
  assert.equal(parsed.frames[1].delayUnits, 50);

  const red = decodeFrame(parsed.frames[0].data);
  const blue = decodeFrame(parsed.frames[1].data);
  assert.equal(red.length, 16);
  assert.equal(blue.length, 16);
  assert.equal(new Set(red).size, 1, "one solid colour per frame");
  assert.equal(new Set(blue).size, 1, "one solid colour per frame");
  const redEntry = red[0];
  const blueEntry = blue[0];
  assert.deepEqual([...GIF_PALETTE.subarray(redEntry * 3, redEntry * 3 + 3)], [255, 0, 0]);
  assert.deepEqual([...GIF_PALETTE.subarray(blueEntry * 3, blueEntry * 3 + 3)], [0, 0, 255]);
});

test("a non-looping GIF omits the Netscape extension and reports one delay for every frame", () => {
  const bytes = encodeGif({
    frames: [frame([0, 255, 0], 3, 3), frame([0, 0, 0], 3, 3), frame([255, 255, 255], 3, 3)],
    width: 3,
    height: 3,
    delayMs: 100,
    loop: false,
  });
  const parsed = parseGif(bytes);
  assert.equal(parsed.loopExtension, false);
  assert.equal(parsed.frames.length, 3);
  for (const block of parsed.frames) assert.equal(block.delayUnits, 10);
});

test("different exact per-frame delays emit one matching control block per image", () => {
  const frames = [
    frame([255, 0, 0], 3, 3),
    frame([0, 255, 0], 3, 3),
    frame([0, 0, 255], 3, 3),
  ];
  const frameDelaysMs = [100, 500, 2000];
  const bytes = encodeGif({ frames, width: 3, height: 3, delayMs: 500, frameDelaysMs, loop: false });
  const parsed = parseGif(bytes);
  assert.equal(parsed.frames.length, 3);
  assert.deepEqual(parsed.frames.map((block) => block.delayUnits), [10, 50, 200]);
  assert.deepEqual(parsed.frames.map((block) => block.descriptor), [
    { left: 0, top: 0, width: 3, height: 3 },
    { left: 0, top: 0, width: 3, height: 3 },
    { left: 0, top: 0, width: 3, height: 3 },
  ]);

  const summary = gifDelaySummary(frameDelaysMs);
  assert.equal(summary.uniform, false);
  assert.equal(summary.token, "delays-100-500-2000ms");
  assert.equal(summary.phrase, "per-frame delays 100, 500, 2000 ms");

  const uniform = gifDelaySummary([500, 500, 500]);
  assert.equal(uniform.uniform, true);
  assert.equal(uniform.token, "500ms");
  assert.equal(uniform.phrase, "500 ms per frame");

  // An explicit uniform vector keeps the original uniform-delay bytes exactly.
  const defaultBytes = encodeGif({ frames, width: 3, height: 3, delayMs: 500, loop: false });
  const uniformBytes = encodeGif({
    frames,
    width: 3,
    height: 3,
    delayMs: 500,
    frameDelaysMs: [500, 500, 500],
    loop: false,
  });
  assert.deepEqual([...uniformBytes], [...defaultBytes]);
});

test("per-frame delays must name every frame inside 100–2000 ms in 10 ms steps", () => {
  const frames = [frame([1, 2, 3], 2, 2), frame([4, 5, 6], 2, 2)];
  assert.throws(
    () => encodeGif({ frames, width: 2, height: 2, delayMs: 500, frameDelaysMs: [500] }),
    /exactly 2/,
  );
  assert.throws(
    () => encodeGif({ frames, width: 2, height: 2, delayMs: 500, frameDelaysMs: [90, 500] }),
    /100 to 2000/,
  );
  assert.throws(
    () => encodeGif({ frames, width: 2, height: 2, delayMs: 500, frameDelaysMs: [500, 505] }),
    /10 ms steps/,
  );
  assert.throws(
    () => encodeGif({ frames, width: 2, height: 2, delayMs: 500, frameDelaysMs: Array(2) }),
    /Frame 1 delay/,
  );
  assert.equal(gifFrameDelaysProblem({ frameCount: 2, frameDelaysMs: [100, 2000] }), null);
  assert.match(
    gifFrameDelaysProblem({ frameCount: 2, frameDelaysMs: [100] }),
    /exactly 2/,
  );
  assert.match(
    gifFrameDelaysProblem({ frameCount: 2, frameDelaysMs: [100, 2010] }),
    /Frame 2 delay must be from 100 to 2000/,
  );
  assert.match(
    gifFrameDelaysProblem({ frameCount: 2, frameDelaysMs: [100, 505] }),
    /10 ms steps/,
  );
});

test("a frame whose byte length does not match the declared square is refused", () => {
  assert.throws(
    () => encodeGif({ frames: [frame([1, 2, 3], 4, 4), frame([1, 2, 3], 3, 4)], width: 4, height: 4, delayMs: 100 }),
    RangeError,
  );
  assert.throws(
    () => encodeGif({ frames: [frame([1, 2, 3], 1, 1)], width: 1, height: 1, delayMs: 5 }),
    RangeError,
  );
});

test("compact mode is opt-in and leaves the legacy literal bytes exactly as they were", () => {
  const settings = {
    frames: [typicalFrame(64, 64, 0), typicalFrame(64, 64, 5)],
    width: 64,
    height: 64,
    delayMs: 350,
    loop: true,
  };
  const legacy = encodeGif(settings);
  assert.equal(legacy.length, 10137);
  assert.equal(createHash("sha256").update(legacy).digest("hex"), LEGACY_FIXTURE_SHA256);
  assert.deepEqual([...encodeGif({ ...settings, compact: false })], [...legacy]);

  const compact = encodeGif({ ...settings, compact: true });
  assert.ok(compact.length < legacy.length, "compact mode should be smaller");
  assert.equal(String.fromCharCode(...compact.subarray(0, 6)), "GIF89a");
  assert.equal(compact.at(-1), 0x3b);
});

test("compact LZW keeps the palette, bounds, delays, loop and decoded pixels", () => {
  const width = 64;
  const height = 64;
  const frameDelaysMs = [120, 480];
  const settings = {
    frames: [typicalFrame(width, height, 0), typicalFrame(width, height, 5)],
    width,
    height,
    delayMs: 350,
    frameDelaysMs,
    loop: true,
  };
  const legacy = parseGif(encodeGif(settings));
  const compact = parseGif(encodeGif({ ...settings, compact: true }));

  assert.deepEqual([...compact.palette], [...legacy.palette]);
  assert.deepEqual([...compact.palette], [...GIF_PALETTE]);
  assert.equal(compact.loopExtension, true);
  assert.equal(legacy.loopExtension, true);
  assert.equal(compact.frames.length, legacy.frames.length);
  for (let index = 0; index < compact.frames.length; index += 1) {
    assert.deepEqual(compact.frames[index].descriptor, legacy.frames[index].descriptor);
    assert.deepEqual(compact.frames[index].descriptor, {
      left: 0,
      top: 0,
      width,
      height,
    });
    assert.equal(compact.frames[index].delayUnits, legacy.frames[index].delayUnits);
    assert.equal(compact.frames[index].delayUnits, frameDelaysMs[index] / 10);
  }

  const legacyPixels = imageData(legacy);
  const compactPixels = imageData(compact);
  assert.deepEqual(compactPixels.map((block) => block.indices), legacyPixels.map((block) => block.indices));
  assert.equal(compactPixels[0].indices.length, width * height);

  // Filled frames build real dictionary entries, then reset before the decoder
  // would need a 10-bit code. Every compact code stayed 9 bits wide.
  for (const block of compactPixels) {
    assert.ok(block.clears > 1, "the compact stream should reset the dictionary");
    assert.ok(block.maxCode > 257, "the compact stream should use dictionary codes");
    assert.equal(block.maxWidth, 9, "compact codes must stay 9 bits wide");
  }
});

test("compact mode measurably shrinks typical filled frames", () => {
  const width = 320;
  const height = 320;
  const frames = [typicalFrame(width, height, 0), typicalFrame(width, height, 40)];
  const legacy = encodeGif({ frames, width, height, delayMs: 500, loop: true });
  const compact = encodeGif({ frames, width, height, delayMs: 500, loop: true, compact: true });
  assert.ok(
    compact.length * 2 < legacy.length,
    `expected at least half the bytes, got ${compact.length} of ${legacy.length}`,
  );
  const compactPixels = imageData(parseGif(compact));
  const legacyPixels = imageData(parseGif(legacy));
  assert.deepEqual(compactPixels.map((block) => block.indices), legacyPixels.map((block) => block.indices));
});
