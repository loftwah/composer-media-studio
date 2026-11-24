import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALPHA_REPORT_SCHEMA,
  ALPHA_REPORT_VERSION,
  alphaBounds,
  alphaMapPlan,
  writeAlphaMapBand,
  alphaProfile,
  buildAlphaReport,
  extractPalette,
  formatHsl,
  formatRgb,
  hexToRgb,
  mapBoundsThroughTransform,
  paletteToAse,
  paletteToCss,
  paletteToGpl,
  paletteToJson,
  pickImagePixel,
  rgbToHex,
  rgbToHsl,
} from "../src/frontend/image-colour.ts";

function makePixels(width, height, paint) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const offset = (y * width + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
    }
  }
  return pixels;
}

test("hex, RGB and HSL conversions are exact and reject bad input", () => {
  assert.deepEqual(hexToRgb("#336699"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(hexToRgb("369"), { r: 51, g: 102, b: 153 });
  assert.equal(hexToRgb("not-a-colour"), null);
  assert.equal(rgbToHex({ r: 51, g: 102, b: 153 }), "#336699");
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 255, b: 0 }), { h: 120, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 255 }), { h: 240, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 100 });
  assert.equal(formatRgb({ r: 51, g: 102, b: 153 }), "rgb(51, 102, 153)");
  assert.equal(formatHsl({ h: 210, s: 50, l: 40 }), "hsl(210, 50%, 40%)");
});

test("palette extraction ignores transparent pixels and merges near-duplicates", () => {
  const pixels = makePixels(4, 4, (x, y) => {
    const index = y * 4 + x;
    if (index < 8) return [255, 0, 0, 255];
    if (index < 11) return [245, 10, 5, 255];
    if (index < 13) return [0, 0, 0, 0];
    return [0, 0, 255, 255];
  });
  const palette = extractPalette(pixels, { width: 4, height: 4 });
  assert.equal(palette.ok, true);
  assert.equal(palette.colors.length, 2, "near-identical reds become one colour");
  assert.equal(palette.colors[0].count, 11);
  assert.equal(palette.colors[0].coverage, 78.6);
  assert.ok(palette.colors[0].rgb.r > 250 && palette.colors[0].rgb.g < 10);
  assert.equal(palette.colors[1].hex, "#0000ff");
  assert.equal(palette.colors[1].count, 3);
  assert.equal(palette.colors[1].coverage, 21.4);
  assert.equal(palette.sampledVisiblePixels, 14);
  assert.equal(palette.transparentPixels, 2);
  assert.equal(
    palette.colors.reduce((sum, colour) => sum + colour.count, 0),
    14,
    "no fully transparent pixel enters the histogram",
  );
});

test("an all-transparent image reports no palette instead of inventing one", () => {
  const pixels = makePixels(3, 2, () => [10, 20, 30, 0]);
  const palette = extractPalette(pixels, { width: 3, height: 2 });
  assert.equal(palette.ok, true);
  assert.deepEqual(palette.colors, []);
  assert.equal(palette.sampledVisiblePixels, 0);
  assert.equal(palette.transparentPixels, 6);
  assert.equal(palette.coveredPercent, 0);
});

test("partially transparent pixels keep their average alpha", () => {
  const pixels = makePixels(2, 1, (x) => [51, 102, 153, x === 0 ? 255 : 0]);
  const palette = extractPalette(pixels, { width: 2, height: 1 });
  assert.equal(palette.ok, true);
  assert.equal(palette.colors.length, 1);
  assert.equal(palette.colors[0].hex, "#336699");
  assert.equal(palette.colors[0].alpha, 255);
  assert.equal(palette.colors[0].coverage, 100);

  const blended = makePixels(2, 1, () => [51, 102, 153, 128]);
  const semi = extractPalette(blended, { width: 2, height: 1 });
  assert.equal(semi.colors[0].alpha, 128);
});

test("the palette is capped while coverage reports the remainder honestly", () => {
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [128, 64, 32],
    [32, 64, 128],
    [10, 20, 30],
    [40, 50, 60],
  ];
  const pixels = makePixels(10, 1, (x) => [...colours[x], 255]);
  const palette = extractPalette(pixels, { width: 10, height: 1, maxColors: 8 });
  assert.equal(palette.colors.length, 8);
  assert.ok(palette.coveredPercent < 100);
  const expected = Math.round((8 / 10) * 1000) / 10;
  assert.equal(palette.coveredPercent, expected);
});

test("bad palette inputs fail with a readable reason", () => {
  assert.match(extractPalette(new Uint8ClampedArray(3), { width: 1, height: 1 }).error, /smaller/);
  assert.match(extractPalette(new Uint8ClampedArray(4), { width: 1, height: 1, maxColors: 0 }).error, /palette colours/);
});

test("GPL palette exports extracted RGB channels and HEX names", () => {
  const { colors } = extractPalette(makePixels(2, 1, () => [255, 0, 0, 255]), {
    width: 2,
    height: 1,
  });
  assert.equal(paletteToGpl(colors), "GIMP Palette\nName: Studio palette\nColumns: 8\n#\n255   0   0\t#ff0000\n");
});

test("CSS palette exports the exact swatches as valid :root custom properties", () => {
  const rgb = [[255, 0, 0], [0, 0, 255], [255, 0, 0]];
  const { colors } = extractPalette(
    makePixels(3, 1, (x) => [...rgb[x], 255]),
    { width: 3, height: 1 },
  );
  const css = paletteToCss(colors);
  assert.equal(
    css,
    "/* Studio palette - extracted swatches */\n:root {\n  --swatch-1: #ff0000;\n  --swatch-2: #0000ff;\n}\n",
  );
  // Every exact swatch HEX is a custom-property value, in palette order, with
  // no invented or dropped colour.
  const values = [...css.matchAll(/--swatch-\d+:\s*(#[0-9a-f]{6});/g)].map((match) => match[1]);
  assert.deepEqual(values, colors.map((colour) => colour.hex));
  assert.equal(values.length, colors.length);
});

test("JSON palette is a versioned, swatch-only document with clear colour semantics", () => {
  const rgb = [[255, 0, 0], [0, 0, 255], [51, 102, 153]];
  const { colors } = extractPalette(
    makePixels(rgb.length, 1, (x) => [...rgb[x], x === 0 ? 128 : 255]),
    { width: rgb.length, height: 1 },
  );
  const text = paletteToJson(colors);
  const doc = JSON.parse(text);

  assert.equal(doc.format, "media-studio-palette");
  assert.equal(doc.version, 1, "version 1 is the immutable schema");
  assert.deepEqual(Object.keys(doc), ["format", "version", "units", "colors"]);
  assert.match(doc.units.hex, /rrggbb/);
  assert.match(doc.units.rgb, /0-255/);
  assert.match(doc.units.hsl, /degrees/);
  assert.match(doc.units.alpha, /255/);

  assert.equal(doc.colors.length, colors.length);
  assert.equal(doc.colors.find((swatch) => swatch.hex === "#ff0000").alpha, 128);
  assert.deepEqual(
    doc.colors.map((swatch) => swatch.hex),
    colors.map((colour) => colour.hex),
    "same order and exact HEX values as the CSS/GPL exports",
  );
  doc.colors.forEach((swatch, index) => {
    const colour = colors[index];
    assert.deepEqual(Object.keys(swatch), ["hex", "rgb", "hsl", "alpha"]);
    assert.deepEqual(swatch.rgb, colour.rgb);
    assert.deepEqual(swatch.hsl, colour.hsl);
    assert.equal(swatch.alpha, colour.alpha);
  });

  // No source filename, private extraction metadata, pixels, credentials or timestamps.
  assert.ok(
    !/\b(count|coverage|filename|pixel|timestamp|created|updated|credential|token|secret)\b/i.test(text),
  );
});

test("ASE palette writes a valid ASEF 1.0 header and one normal RGB block per exact swatch", () => {
  const source = [[255, 0, 0], [0, 0, 255], [51, 102, 153]];
  const { colors } = extractPalette(
    makePixels(source.length, 1, (x) => [...source[x], 255]),
    { width: source.length, height: 1 },
  );
  assert.equal(colors.length, 3);
  const bytes = paletteToAse(colors);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Standard header: "ASEF", version 1.0, one block per swatch.
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "ASEF");
  assert.equal(view.getUint16(4), 1, "major version");
  assert.equal(view.getUint16(6), 0, "minor version");
  assert.equal(view.getUint32(8), colors.length);

  let offset = 12;
  for (const colour of colors) {
    assert.equal(view.getUint16(offset), 0x0001, "colour entry block signature");
    const blockLength = view.getUint32(offset + 2);
    const nameLen = view.getUint16(offset + 6);
    assert.equal(nameLen, colour.hex.length + 1, "name length includes null terminator");
    let name = "";
    for (let index = 0; index < nameLen; index += 1)
      name += String.fromCharCode(view.getUint16(offset + 8 + index * 2));
    assert.equal(name, `${colour.hex}\0`, "UTF-16BE HEX name");

    const modelAt = offset + 8 + nameLen * 2;
    assert.equal(String.fromCharCode(...bytes.subarray(modelAt, modelAt + 4)), "RGB ");
    const floatsAt = modelAt + 4;
    [colour.rgb.r, colour.rgb.g, colour.rgb.b].forEach((channel, index) => {
      assert.ok(Math.abs(view.getFloat32(floatsAt + index * 4) - channel / 255) < 1e-6);
    });
    assert.equal(view.getUint16(floatsAt + 12), 2, "normal colour type");
    assert.equal(blockLength, 2 + nameLen * 2 + 4 + 12 + 2, "block length excludes signature and length");
    offset += 6 + blockLength;
  }
  assert.equal(offset, bytes.length, "no trailing bytes");
  assert.deepEqual(
    colors.map((colour) => colour.hex).sort(),
    ["#0000ff", "#336699", "#ff0000"],
    "the file is built from the exact extracted swatches",
  );

  const empty = paletteToAse([]);
  assert.equal(empty.length, 12, "an empty palette is just the header");
  assert.equal(new DataView(empty.buffer).getUint32(8), 0);
});

test("alpha bounds find transparent padding without silently cropping opaque images", () => {
  const padded = makePixels(5, 4, (x, y) =>
    (x === 1 && y === 1) || (x === 2 && y === 1) || (x === 3 && y === 2)
      ? [255, 255, 255, 255]
      : [0, 0, 0, 0],
  );
  const trimmed = alphaBounds(padded, { width: 5, height: 4 });
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.empty, false);
  assert.deepEqual(trimmed.bounds, { x: 1, y: 1, width: 3, height: 2 });
  assert.equal(trimmed.isFull, false);
  assert.equal(trimmed.visiblePixels, 3);
  assert.equal(trimmed.transparentPixels, 17);

  const opaque = makePixels(3, 3, () => [12, 34, 56, 255]);
  const full = alphaBounds(opaque, { width: 3, height: 3 });
  assert.equal(full.isFull, true);
  assert.deepEqual(full.bounds, { x: 0, y: 0, width: 3, height: 3 });

  const empty = alphaBounds(makePixels(2, 2, () => [0, 0, 0, 0]), { width: 2, height: 2 });
  assert.equal(empty.empty, true);
  assert.equal(empty.bounds, null);
  assert.equal(empty.isFull, false);
});

test("alpha profile counts exact transparent, partial and opaque pixels", () => {
  const pixels = makePixels(2, 2, (x, y) => {
    if (x === 0 && y === 0) return [0, 0, 0, 0];
    if (x === 1 && y === 0) return [1, 2, 3, 1];
    if (x === 0 && y === 1) return [1, 2, 3, 254];
    return [1, 2, 3, 255];
  });
  const profile = alphaProfile(pixels, { width: 2, height: 2 });
  assert.equal(profile.ok, true);
  assert.equal(profile.totalPixels, 4);
  assert.equal(profile.width, 2);
  assert.equal(profile.height, 2);
  assert.deepEqual(
    {
      transparent: profile.transparent,
      partial: profile.partial,
      opaque: profile.opaque,
    },
    { transparent: 1, partial: 2, opaque: 1 },
  );
});

test("alpha profile reports fully opaque and fully transparent results honestly", () => {
  const opaque = alphaProfile(makePixels(2, 1, () => [7, 8, 9, 255]), { width: 2, height: 1 });
  assert.equal(opaque.ok, true);
  assert.equal(opaque.opaque, 2);
  assert.equal(opaque.transparent, 0);
  assert.equal(opaque.partial, 0);

  const empty = alphaProfile(makePixels(2, 1, () => [7, 8, 9, 0]), { width: 2, height: 1 });
  assert.equal(empty.ok, true);
  assert.equal(empty.transparent, 2);
  assert.equal(empty.opaque, 0);
  assert.equal(empty.partial, 0);
});

test("alpha profile refuses buffers that do not match the result dimensions", () => {
  assert.match(alphaProfile(new Uint8ClampedArray(4), { width: 2, height: 2 }).error, /smaller/);
  assert.match(alphaProfile(new Uint8ClampedArray(20), { width: 2, height: 2 }).error, /do not match/);
  assert.match(alphaProfile(new Uint8ClampedArray(16), { width: 0, height: 2 }).error, /dimensions/);
});

test("alpha report is a v1 snapshot of exact counts and the finished result", () => {
  const result = {
    mime: "image/webp",
    width: 3,
    height: 2,
    bytes: 98765,
    sha256: "A".repeat(64),
  };
  const profile = {
    ok: true,
    width: 3,
    height: 2,
    totalPixels: 6,
    transparent: 1,
    partial: 3,
    opaque: 2,
  };
  const report = buildAlphaReport({ result, profile });

  assert.deepEqual(Object.keys(report), ["schema", "version", "note", "output", "alpha"]);
  assert.equal(report.schema, ALPHA_REPORT_SCHEMA);
  assert.equal(report.version, ALPHA_REPORT_VERSION);
  assert.equal(ALPHA_REPORT_VERSION, 1);
  assert.deepEqual(report.output, {
    mime: "image/webp",
    width: 3,
    height: 2,
    bytes: 98765,
    sha256: "a".repeat(64),
  });
  assert.deepEqual(report.alpha, {
    transparent: 1,
    partial: 3,
    opaque: 2,
    total: 6,
  });
  assert.equal(report.alpha.total, report.alpha.transparent + report.alpha.partial + report.alpha.opaque);
});

test("alpha report carries no source, path, filename, map or sampled pixels", () => {
  const profile = alphaProfile(
    makePixels(2, 2, (x, y) => [4, 5, 6, [0, 128, 254, 255][y * 2 + x]]),
    { width: 2, height: 2 },
  );
  const report = buildAlphaReport({
    result: {
      mime: "image/png",
      width: 2,
      height: 2,
      bytes: 101,
      sha256: "b".repeat(64),
      filename: "/private/secret/art.png",
      title: "Private artwork",
      sourceHash: "c".repeat(64),
    },
    profile,
    map: { width: 2, height: 2, sampled: false, pixels: new Uint8ClampedArray(16) },
  });

  const json = JSON.stringify(report);
  for (const banned of [
    "filename", "path", "title", "sourceHash", "map", "pixels", "sampled",
    "secret", "Private artwork", "blob", "url", "createdAt",
  ])
    assert.equal(json.includes(banned), false, `alpha report must not carry ${banned}`);
  assert.match(report.note, /Counted on this device; nothing uploaded/);
});

test("alpha map keeps each exact alpha byte at native size", () => {
  const alphas = [0, 1, 128, 254, 255, 64];
  const pixels = makePixels(3, 2, (x, y) => [11, 22, 33, alphas[y * 3 + x]]);
  const plan = alphaMapPlan(3, 2);
  assert.ok(plan);
  writeAlphaMapBand(plan, pixels, 0);
  const { map } = plan;
  assert.equal(map.sampled, false);
  assert.equal(map.width, 3);
  assert.equal(map.height, 2);
  assert.deepEqual([...map.pixels], [
    0, 0, 0, 255,
    1, 1, 1, 255,
    128, 128, 128, 255,
    254, 254, 254, 255,
    255, 255, 255, 255,
    64, 64, 64, 255,
  ]);
});

test("alpha map takes one deterministic nearest pixel per cell above 512 px", () => {
  const width = 1024;
  const height = 512;
  const pixels = makePixels(width, height, (x, y) => [9, 9, 9, (x * 7 + y * 13) % 256]);
  const plan = alphaMapPlan(width, height);
  assert.ok(plan);
  const midpoint = width * height * 2;
  writeAlphaMapBand(plan, pixels.subarray(0, midpoint), 0);
  writeAlphaMapBand(plan, pixels.subarray(midpoint), height / 2);
  const { map } = plan;
  assert.equal(map.sampled, true);
  assert.equal(map.width, 512);
  assert.equal(map.height, 256);
  for (const [mapX, mapY] of [
    [0, 0],
    [1, 0],
    [256, 128],
    [511, 255],
  ]) {
    const sourceX = Math.min(width - 1, Math.floor(((mapX + 0.5) * width) / map.width));
    const sourceY = Math.min(height - 1, Math.floor(((mapY + 0.5) * height) / map.height));
    const expected = (sourceX * 7 + sourceY * 13) % 256;
    const offset = (mapY * map.width + mapX) * 4;
    assert.equal(map.pixels[offset], expected);
    assert.equal(map.pixels[offset + 1], expected);
    assert.equal(map.pixels[offset + 2], expected);
    assert.equal(map.pixels[offset + 3], 255);
  }
  assert.equal(alphaMapPlan(0, 2), null);
});

test("alpha bounds respect an explicit threshold", () => {
  const pixels = makePixels(3, 1, (x) => [255, 255, 255, x === 0 ? 4 : 255]);
  const bounds = alphaBounds(pixels, { width: 3, height: 1, threshold: 8 });
  assert.deepEqual(bounds.bounds, { x: 1, y: 0, width: 2, height: 1 });
});

test("alpha bounds map through flips and quarter turns", () => {
  const bounds = { x: 0, y: 0, width: 2, height: 3 };
  const rotated = mapBoundsThroughTransform(bounds, { width: 4, height: 3, rotate: 1 });
  assert.deepEqual(rotated.bounds, { x: 0, y: 0, width: 3, height: 2 });
  const rotatedOther = mapBoundsThroughTransform(
    { x: 2, y: 0, width: 2, height: 3 },
    { width: 4, height: 3, rotate: 1 },
  );
  assert.deepEqual(rotatedOther.bounds, { x: 0, y: 2, width: 3, height: 2 });
  const flipped = mapBoundsThroughTransform(bounds, { width: 4, height: 3, flipH: true });
  assert.deepEqual(flipped.bounds, { x: 2, y: 0, width: 2, height: 3 });
  const turned = mapBoundsThroughTransform({ x: 1, y: 1, width: 2, height: 1 }, {
    width: 4,
    height: 3,
    rotate: 2,
  });
  assert.deepEqual(turned.bounds, { x: 1, y: 1, width: 2, height: 1 });
  assert.match(
    mapBoundsThroughTransform(bounds, { width: 2, height: 2 }).error,
    /bounds/,
  );
});

test("pointer coordinates map to intrinsic pixels independent of DPR scaling", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(
    pickImagePixel({ clientX: 110, clientY: 70, rect, imageWidth: 800, imageHeight: 400 }),
    { x: 400, y: 200 },
  );
  assert.deepEqual(
    pickImagePixel({ clientX: 85, clientY: 90, rect, imageWidth: 800, imageHeight: 400 }),
    { x: 300, y: 280 },
  );
  // The CSS box is 300 px wide on a high-DPR screen while the image is 1200 px.
  assert.deepEqual(
    pickImagePixel({
      clientX: 75,
      clientY: 30,
      rect: { left: 0, top: 0, width: 300, height: 200 },
      imageWidth: 1200,
      imageHeight: 800,
    }),
    { x: 300, y: 120 },
  );
  assert.equal(
    pickImagePixel({ clientX: 9, clientY: 70, rect, imageWidth: 800, imageHeight: 400 }),
    null,
  );
  assert.equal(
    pickImagePixel({ clientX: 210, clientY: 70, rect, imageWidth: 800, imageHeight: 400 }),
    null,
  );
  assert.equal(
    pickImagePixel({ clientX: 110, clientY: 70, rect: { ...rect, width: 0 }, imageWidth: 800, imageHeight: 400 }),
    null,
  );
  assert.equal(
    pickImagePixel({ clientX: 110, clientY: 70, rect, imageWidth: 0, imageHeight: 400 }),
    null,
  );
});
