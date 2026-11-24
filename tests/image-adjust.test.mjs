import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADJUSTMENT_KEYS,
  ADJUSTMENT_PRESETS,
  DEFAULT_ADJUSTMENTS,
  adjustPixels,
  adjustmentsAreNeutral,
  describeAdjustments,
  normaliseAdjustments,
  presetAdjustments,
  presetIdFor,
} from "../src/frontend/image-adjust.ts";

function pixels(...values) {
  return new Uint8ClampedArray(values);
}

function single(r, g, b, a = 255) {
  return pixels(r, g, b, a);
}

test("adjustments are whole numbers inside the documented range", () => {
  assert.deepEqual(normaliseAdjustments({ exposure: 12.4, contrast: -120, saturation: 7.6 }), {
    exposure: 12,
    shadows: 0,
    highlights: 0,
    contrast: -100,
    saturation: 8,
    temperature: 0,
    tint: 0,
  });
  assert.deepEqual(normaliseAdjustments(null), {
    exposure: 0,
    shadows: 0,
    highlights: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
  });
  assert.deepEqual(normaliseAdjustments({ exposure: "abc" }), {
    exposure: 0,
    shadows: 0,
    highlights: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
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

test("tint shifts the green-magenta axis independently of temperature", () => {
  const magenta = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { tint: 100 },
  });
  assert.deepEqual([...magenta.pixels], [128, 92, 128, 255], "positive tint removes green toward magenta");

  const green = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { tint: -100 },
  });
  assert.deepEqual([...green.pixels], [128, 164, 128, 255], "negative tint adds green");

  const half = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { tint: 50 },
  });
  assert.deepEqual([...half.pixels], [128, 110, 128, 255], "bounded and deterministic");

  const both = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { temperature: 100, tint: 100 },
  });
  assert.deepEqual([...both.pixels], [164, 92, 92, 255], "temperature moves red/blue, tint only green");
});

test("tint keeps alpha and transparent pixels and preserves prior pixel compatibility", () => {
  const source = pixels(
    10, 20, 30, 0,
    200, 100, 50, 128,
  );
  const result = adjustPixels(source, {
    width: 2,
    height: 1,
    adjustments: { tint: 100 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual([...source.slice(0, 4)], [10, 20, 30, 0], "transparent padding is untouched");
  assert.deepEqual([...source.slice(4)], [200, 64, 50, 128], "green shifts, alpha and other channels do not");
  assert.equal(result.changed, 1);

  const defaults = single(120, 40, 200);
  const neutral = adjustPixels(defaults, { width: 1, height: 1, adjustments: { tint: 0 } });
  assert.equal(neutral.neutral, true);
  assert.equal(neutral.changed, 0);
  assert.equal(neutral.pixels, defaults);
  assert.deepEqual([...defaults], [120, 40, 200, 255], "zero writes nothing");

  const render = (adjustments) => [...adjustPixels(single(120, 40, 200), {
    width: 1,
    height: 1,
    adjustments,
  }).pixels];
  assert.deepEqual(
    render({ exposure: 8, contrast: 4 }),
    render({ exposure: 8, contrast: 4, tint: 0 }),
    "saved partial settings without tint render identically",
  );
  for (const preset of ADJUSTMENT_PRESETS)
    assert.equal(preset.adjustments.tint, 0, `${preset.id} keeps its prior pixels`);
});

test("highlights lighten or darken only tones above mid grey", () => {
  const tones = pixels(
    0, 0, 0, 255,
    64, 64, 64, 255,
    128, 128, 128, 255,
    192, 192, 192, 255,
    255, 255, 255, 255,
  );
  const lighterPixels = new Uint8ClampedArray(tones);
  const lighter = adjustPixels(lighterPixels, {
    width: 5,
    height: 1,
    adjustments: { highlights: 100 },
  });
  assert.deepEqual(
    [...lighterPixels],
    [0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 224, 224, 224, 255, 255, 255, 255, 255],
    "the smooth weight starts above mid grey and leaves dark tones exact",
  );
  assert.equal(lighter.changed, 1, "clipped white has no retained detail to brighten");

  const darkerPixels = new Uint8ClampedArray(tones);
  const darker = adjustPixels(darkerPixels, {
    width: 5,
    height: 1,
    adjustments: { highlights: -100 },
  });
  assert.deepEqual(
    [...darkerPixels],
    [0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 160, 160, 160, 255, 191, 191, 191, 255],
    "negative darkens bright values without moving dark or mid tones",
  );
  assert.equal(darker.changed, 2);

  const gradual = adjustPixels(single(160, 160, 160), {
    width: 1,
    height: 1,
    adjustments: { highlights: 100 },
  });
  assert.deepEqual([...gradual.pixels], [170, 170, 170, 255], "the lift ramps smoothly toward white");

  const colouredDark = adjustPixels(single(64, 0, 0), {
    width: 1,
    height: 1,
    adjustments: { highlights: -100 },
  });
  assert.deepEqual([...colouredDark.pixels], [64, 0, 0, 255], "a low-luma colour is not a highlight");
  assert.equal(colouredDark.changed, 0);
});

test("highlights keeps alpha and transparent pixels and preserves prior pixel compatibility", () => {
  const source = pixels(
    10, 20, 30, 0,
    192, 192, 192, 1,
    224, 224, 224, 128,
    240, 240, 240, 254,
    255, 255, 255, 255,
  );
  const alphas = [...source.filter((_, index) => index % 4 === 3)];
  const result = adjustPixels(source, {
    width: 5,
    height: 1,
    adjustments: { highlights: 100 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual([...source.slice(0, 4)], [10, 20, 30, 0], "transparent padding is untouched");
  assert.deepEqual([...source.filter((_, index) => index % 4 === 3)], alphas, "every alpha byte is untouched");
  assert.deepEqual([...source.slice(4, 8)], [224, 224, 224, 1], "partial alpha changes only visible RGB");
  assert.equal(result.changed, 3);

  const defaults = single(120, 40, 200);
  const neutral = adjustPixels(defaults, { width: 1, height: 1, adjustments: { highlights: 0 } });
  assert.equal(neutral.neutral, true);
  assert.equal(neutral.changed, 0);
  assert.equal(neutral.pixels, defaults);
  assert.deepEqual([...defaults], [120, 40, 200, 255], "zero writes nothing");

  const render = (adjustments) => [...adjustPixels(single(120, 40, 200), {
    width: 1,
    height: 1,
    adjustments,
  }).pixels];
  assert.deepEqual(
    render({ exposure: 8, contrast: 4 }),
    render({ exposure: 8, contrast: 4, highlights: 0 }),
    "saved partial settings without highlights render identically",
  );
  for (const preset of ADJUSTMENT_PRESETS)
    assert.equal(preset.adjustments.highlights, 0, `${preset.id} keeps its prior pixels`);
});

test("highlights is clamped, neutralised, reset and described like the other adjustments", () => {
  assert.equal(normaliseAdjustments({ highlights: 150 }).highlights, 100);
  assert.equal(normaliseAdjustments({ highlights: -150 }).highlights, -100);
  assert.equal(normaliseAdjustments({}).highlights, 0);
  assert.equal(DEFAULT_ADJUSTMENTS.highlights, 0);
  assert.deepEqual(presetAdjustments("none"), { ...DEFAULT_ADJUSTMENTS });
  assert.equal(adjustmentsAreNeutral({ highlights: 0 }), true);
  assert.equal(adjustmentsAreNeutral({ highlights: 1 }), false);
  assert.equal(
    presetIdFor({ exposure: 4, highlights: 0, contrast: 6, saturation: 10, temperature: 32 }),
    "warm",
    "a saved partial preset still matches",
  );
  assert.equal(describeAdjustments({ highlights: 25 }), "highlights +25");
  assert.equal(describeAdjustments({ highlights: -25 }), "highlights -25");
  assert.equal(describeAdjustments({ highlights: 0 }), "");
  assert.equal(
    describeAdjustments({ exposure: 4, shadows: 10, highlights: -25, contrast: 6 }),
    "exposure +4, shadows +10, highlights -25, contrast +6",
  );
});

test("shadows lift or deepen dark tones and taper to nothing by mid grey", () => {
  const black = adjustPixels(single(0, 0, 0), {
    width: 1,
    height: 1,
    adjustments: { shadows: 100 },
  });
  assert.deepEqual([...black.pixels], [64, 64, 64, 255], "positive shadows opens pure black");

  const dark = adjustPixels(single(64, 64, 64), {
    width: 1,
    height: 1,
    adjustments: { shadows: 100 },
  });
  assert.deepEqual([...dark.pixels], [96, 96, 96, 255], "the lift is strongest in deep shadow");

  const mid = adjustPixels(single(128, 128, 128), {
    width: 1,
    height: 1,
    adjustments: { shadows: 100 },
  });
  assert.deepEqual([...mid.pixels], [128, 128, 128, 255], "mid grey is untouched");
  assert.equal(mid.changed, 0);

  const bright = adjustPixels(single(220, 200, 180), {
    width: 1,
    height: 1,
    adjustments: { shadows: -100 },
  });
  assert.deepEqual([...bright.pixels], [220, 200, 180, 255], "selected bright pixels stay unchanged");
  assert.equal(bright.changed, 0);

  const deepened = adjustPixels(single(64, 64, 64), {
    width: 1,
    height: 1,
    adjustments: { shadows: -100 },
  });
  assert.deepEqual([...deepened.pixels], [32, 32, 32, 255], "negative shadows deepens dark tones");

  const alreadyBlack = adjustPixels(single(0, 0, 0), {
    width: 1,
    height: 1,
    adjustments: { shadows: -100 },
  });
  assert.deepEqual([...alreadyBlack.pixels], [0, 0, 0, 255]);
  assert.equal(alreadyBlack.changed, 0);

  const colouredDark = adjustPixels(single(64, 0, 0), {
    width: 1,
    height: 1,
    adjustments: { shadows: 100 },
  });
  assert.ok(colouredDark.pixels[0] > 96, "a dark, low-luma colour gets a larger weighted lift");
});

test("shadows keeps alpha and transparent pixels and preserves prior pixel compatibility", () => {
  const source = pixels(
    10, 20, 30, 0,
    64, 64, 64, 128,
  );
  const result = adjustPixels(source, {
    width: 2,
    height: 1,
    adjustments: { shadows: 100 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual([...source.slice(0, 4)], [10, 20, 30, 0], "transparent padding is untouched");
  assert.deepEqual([...source.slice(4)], [96, 96, 96, 128], "dark tones lift, alpha and transparency do not");
  assert.equal(result.changed, 1);

  const defaults = single(120, 40, 200);
  const neutral = adjustPixels(defaults, { width: 1, height: 1, adjustments: { shadows: 0 } });
  assert.equal(neutral.neutral, true);
  assert.equal(neutral.changed, 0);
  assert.equal(neutral.pixels, defaults);
  assert.deepEqual([...defaults], [120, 40, 200, 255], "zero writes nothing");

  const render = (adjustments) => [...adjustPixels(single(120, 40, 200), {
    width: 1,
    height: 1,
    adjustments,
  }).pixels];
  assert.deepEqual(
    render({ exposure: 8, contrast: 4 }),
    render({ exposure: 8, contrast: 4, shadows: 0 }),
    "saved partial settings without shadows render identically",
  );
  for (const preset of ADJUSTMENT_PRESETS)
    assert.equal(preset.adjustments.shadows, 0, `${preset.id} keeps its prior pixels`);
});

test("shadows is clamped, neutralised, reset and described like the other adjustments", () => {
  assert.equal(normaliseAdjustments({ shadows: 150 }).shadows, 100);
  assert.equal(normaliseAdjustments({ shadows: -150 }).shadows, -100);
  assert.equal(normaliseAdjustments({}).shadows, 0);
  assert.equal(DEFAULT_ADJUSTMENTS.shadows, 0);
  assert.deepEqual(presetAdjustments("none"), { ...DEFAULT_ADJUSTMENTS });
  assert.equal(adjustmentsAreNeutral({ shadows: 0 }), true);
  assert.equal(adjustmentsAreNeutral({ shadows: 1 }), false);
  assert.equal(
    presetIdFor({ exposure: 4, shadows: 0, contrast: 6, saturation: 10, temperature: 32 }),
    "warm",
    "a saved partial preset still matches",
  );
  assert.equal(describeAdjustments({ shadows: 25 }), "shadows +25");
  assert.equal(describeAdjustments({ shadows: -25 }), "shadows -25");
  assert.equal(describeAdjustments({ shadows: 0 }), "");
});

test("tint is clamped, neutralised and described like the other adjustments", () => {
  assert.equal(normaliseAdjustments({ tint: 150 }).tint, 100);
  assert.equal(normaliseAdjustments({ tint: -150 }).tint, -100);
  assert.equal(adjustmentsAreNeutral({ tint: 0 }), true);
  assert.equal(adjustmentsAreNeutral({ tint: 1 }), false);
  assert.equal(
    presetIdFor({ exposure: 4, contrast: 6, saturation: 10, temperature: 32 }),
    "warm",
    "a saved partial preset still matches",
  );
  assert.equal(describeAdjustments({ tint: 25 }), "tint +25");
  assert.equal(describeAdjustments({ tint: -25 }), "tint -25");
  assert.equal(describeAdjustments({ tint: 0 }), "");
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
