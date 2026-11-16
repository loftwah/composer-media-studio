import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADJUSTMENT_KEYS,
  ADJUSTMENT_PRESETS,
  adjustPixels,
  adjustmentsAreNeutral,
  describeAdjustments,
  normaliseAdjustments,
  presetAdjustments,
  presetIdFor,
} from "../src/frontend/image-adjust.mjs";

function pixels(...values) {
  return new Uint8ClampedArray(values);
}

function single(r, g, b, a = 255) {
  return pixels(r, g, b, a);
}

test("adjustments are whole numbers inside the documented range", () => {
  assert.deepEqual(normaliseAdjustments({ exposure: 12.4, contrast: -120, saturation: 7.6 }), {
    exposure: 12,
    contrast: -100,
    saturation: 8,
    temperature: 0,
  });
  assert.deepEqual(normaliseAdjustments(null), {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  });
  assert.deepEqual(normaliseAdjustments({ exposure: "abc" }), {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  });
  assert.equal(adjustmentsAreNeutral({ exposure: 0, contrast: 0 }), true);
  assert.equal(adjustmentsAreNeutral({ exposure: 1 }), false);
});

test("presets are named values and never hide the real numbers", () => {
  assert.equal(presetIdFor({ exposure: 0, contrast: 0, saturation: 0, temperature: 0 }), "none");
  assert.equal(presetIdFor(presetAdjustments("mono")), "mono");
  assert.equal(presetIdFor({ exposure: 1, contrast: 0, saturation: 0, temperature: 0 }), "custom");
  for (const preset of ADJUSTMENT_PRESETS) {
    for (const key of ADJUSTMENT_KEYS) {
      assert.equal(Number.isInteger(preset.adjustments[key]), true, `${preset.id} ${key}`);
    }
    assert.equal(presetIdFor(preset.adjustments), preset.id);
  }
  assert.equal(
    describeAdjustments({ exposure: 20, contrast: -10, saturation: 0, temperature: 5 }),
    "exposure +20, contrast -10, temperature +5",
  );
  assert.equal(describeAdjustments({}), "");
});

test("neutral adjustments return the same buffer without writing", () => {
  const source = single(120, 40, 200);
  const result = adjustPixels(source, { width: 1, height: 1, adjustments: {} });
  assert.equal(result.ok, true);
  assert.equal(result.neutral, true);
  assert.equal(result.changed, 0);
  assert.equal(result.pixels, source);
  assert.deepEqual([...source], [120, 40, 200, 255]);
});

test("exposure is a real stop scale and preserves alpha", () => {
  const oneStop = adjustPixels(single(100, 100, 100, 128), {
    width: 1,
    height: 1,
    adjustments: { exposure: 50 },
  });
  assert.deepEqual([...oneStop.pixels], [200, 200, 200, 128], "one stop doubles, alpha untouched");
  assert.equal(oneStop.changed, 1);

  const clipped = adjustPixels(single(200, 10, 0), {
    width: 1,
    height: 1,
    adjustments: { exposure: 100 },
  });
  assert.deepEqual([...clipped.pixels], [255, 40, 0, 255], "clamping is per channel");
});

test("contrast pivots on mid grey", () => {
  const darker = adjustPixels(single(64, 64, 64), {
    width: 1,
    height: 1,
    adjustments: { contrast: 100 },
  });
  assert.deepEqual([...darker.pixels], [0, 0, 0, 255]);
  const brighter = adjustPixels(single(192, 192, 192), {
    width: 1,
    height: 1,
    adjustments: { contrast: 100 },
  });
  assert.deepEqual([...brighter.pixels], [255, 255, 255, 255]);
  const flat = adjustPixels(single(10, 20, 30), {
    width: 1,
    height: 1,
    adjustments: { contrast: -100 },
  });
  assert.deepEqual([...flat.pixels], [128, 128, 128, 255], "full negative contrast is flat grey");
});

test("saturation -100 gives a true grey and +100 doubles the distance", () => {
  const grey = adjustPixels(single(255, 0, 0), {
    width: 1,
    height: 1,
    adjustments: { saturation: -100 },
  });
  const [r, g, b] = grey.pixels;
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(r, 54, "Rec.709 luma of pure red");

  const boosted = adjustPixels(single(200, 100, 100), {
    width: 1,
    height: 1,
    adjustments: { saturation: 100 },
  });
  assert.ok(boosted.pixels[0] > 200, "the dominant channel moves further out");
  assert.ok(boosted.pixels[1] < 100);
});

test("temperature warms red and cools blue", () => {
  const warm = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { temperature: 100 },
  });
  assert.deepEqual([...warm.pixels], [164, 128, 92, 255]);

  const cool = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { temperature: -50 },
  });
  assert.deepEqual([...cool.pixels], [110, 128, 146, 255]);
});

test("fully transparent pixels keep their colour and every alpha byte", () => {
  const source = pixels(
    10, 20, 30, 0,
    200, 100, 50, 255,
  );
  const result = adjustPixels(source, {
    width: 2,
    height: 1,
    adjustments: { saturation: -100, contrast: 50 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual([...source.slice(0, 4)], [10, 20, 30, 0], "transparent padding is untouched");
  assert.equal(result.changed, 1);
  for (let index = 3; index < source.length; index += 4)
    assert.equal(source[index], index === 3 ? 0 : 255, `alpha at ${index}`);
});

test("bad buffers and dimensions are refused", () => {
  assert.equal(adjustPixels(null, { width: 1, height: 1 }).ok, false);
  assert.match(adjustPixels(single(1, 2, 3), { width: 0, height: 1 }).error, /dimensions/);
  assert.match(adjustPixels(pixels(1, 2, 3, 255), { width: 2, height: 2 }).error, /smaller/);
});

test("adjustments are deterministic for the same input", () => {
  const run = () => {
    const buffer = pixels(
      12, 200, 90, 255,
      250, 240, 230, 128,
      0, 0, 0, 0,
    );
    adjustPixels(buffer, {
      width: 3,
      height: 1,
      adjustments: { exposure: 12, contrast: 18, saturation: -22, temperature: 9 },
    });
    return [...buffer];
  };
  assert.deepEqual(run(), run());
});
