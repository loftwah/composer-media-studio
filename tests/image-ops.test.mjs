import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_ANCHOR_LABELS,
  CROP_ASPECTS,
  MAX_STRAIGHTEN_DEGREES,
  anchoredCrop,
  centredCrop,
  defaultLongEdge,
  describeTransform,
  extensionForImageMime,
  imageSmoothingFor,
  isCropAnchor,
  keptAreaPolygon,
  mimeForExport,
  normaliseStraighten,
  planImageTransform,
  rotatedDimensions,
  searchTargetQuality,
  straightenGeometry,
  targetSizeProblem,
} from "../src/frontend/image-ops.ts";

test("rotation swaps dimensions only for odd quarter turns", () => {
  assert.deepEqual(rotatedDimensions(4000, 3000, 0), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedDimensions(4000, 3000, 1), { width: 3000, height: 4000 });
  assert.deepEqual(rotatedDimensions(4000, 3000, 2), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedDimensions(4000, 3000, 3), { width: 3000, height: 4000 });
  for (const rotate of [-1, 4, 1.5]) assert.equal(rotatedDimensions(4000, 3000, rotate), null);
});

test("centred crop keeps the largest safe rectangle for an aspect", () => {
  assert.deepEqual(centredCrop(1600, 900, 1), { x: 350, y: 0, width: 900, height: 900 });
  assert.deepEqual(centredCrop(900, 1600, 1), { x: 0, y: 350, width: 900, height: 900 });
  assert.deepEqual(centredCrop(1600, 900, null), { x: 0, y: 0, width: 1600, height: 900 });
  assert.deepEqual(centredCrop(1600, 900, CROP_ASPECTS.wide), { x: 0, y: 0, width: 1600, height: 900 });
  assert.deepEqual(centredCrop(1000, 1000, CROP_ASPECTS.tall), { x: 218, y: 0, width: 563, height: 1000 });
});

test("crop anchors choose the kept edge or corner instead of the centre", () => {
  // 900 × 1600, square crop: the free space is vertical only.
  assert.deepEqual(anchoredCrop(900, 1600, 1, "centre"), { x: 0, y: 350, width: 900, height: 900 });
  assert.deepEqual(anchoredCrop(900, 1600, 1, "top"), { x: 0, y: 0, width: 900, height: 900 });
  assert.deepEqual(anchoredCrop(900, 1600, 1, "bottom"), { x: 0, y: 700, width: 900, height: 900 });
  assert.deepEqual(anchoredCrop(900, 1600, 1, "topRight"), { x: 0, y: 0, width: 900, height: 900 });

  // 1600 × 900, square crop: the free space is horizontal only.
  assert.deepEqual(anchoredCrop(1600, 900, 1, "left"), { x: 0, y: 0, width: 900, height: 900 });
  assert.deepEqual(anchoredCrop(1600, 900, 1, "right"), { x: 700, y: 0, width: 900, height: 900 });

  assert.equal(anchoredCrop(1600, 900, null, "topLeft").x, 0);
  assert.equal(isCropAnchor("topLeft"), true);
  assert.equal(isCropAnchor("middle"), false);
  assert.equal(anchoredCrop(1600, 900, 1, "middle"), null);
  assert.equal(Object.keys(CROP_ANCHOR_LABELS).length, 9);
});

test("the planner applies the anchor before the resize", () => {
  const plan = planImageTransform({
    sourceWidth: 1600,
    sourceHeight: 900,
    cropAspect: 1,
    cropAnchor: "right",
    resize: { mode: "long-edge", longEdge: 450 },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.crop, { x: 700, y: 0, width: 900, height: 900 });
  assert.deepEqual([plan.outputWidth, plan.outputHeight], [450, 450]);
  assert.equal(
    describeTransform({ cropAspect: "square", cropAnchor: "topLeft", format: "png" }),
    "top-left crop 1:1 square, PNG, re-encoded",
  );
  assert.equal(
    describeTransform({ cropAspect: CROP_ASPECTS.wide, format: "png" }),
    "centre crop 16:9 wide, PNG, re-encoded",
    "a numeric aspect still names the real preset instead of the word aspect",
  );
  assert.match(
    planImageTransform({
      sourceWidth: 1600,
      sourceHeight: 900,
      cropAspect: 1,
      cropAnchor: "middle",
      resize: { mode: "long-edge", longEdge: 450 },
    }).error,
    /crop anchor/,
  );
});

test("a long-edge plan produces the exact rounded edge", () => {  const landscape = planImageTransform({
    sourceWidth: 4000,
    sourceHeight: 3000,
    resize: { mode: "long-edge", longEdge: 2048 },
  });
  assert.equal(landscape.ok, true);
  assert.deepEqual([landscape.outputWidth, landscape.outputHeight], [2048, 1536]);
  assert.equal(landscape.upscaled, false);

  const portrait = planImageTransform({
    sourceWidth: 3000,
    sourceHeight: 4000,
    resize: { mode: "long-edge", longEdge: 2048 },
  });
  assert.deepEqual([portrait.outputWidth, portrait.outputHeight], [1536, 2048]);

  // One-pixel rounding on a long edge is not a distorted aspect.
  const rounded = planImageTransform({
    sourceWidth: 200,
    sourceHeight: 300,
    resize: { mode: "long-edge", longEdge: 260 },
  });
  assert.deepEqual([rounded.outputWidth, rounded.outputHeight], [173, 260]);
  assert.equal(rounded.aspectDistorted, false);

  const rotated = planImageTransform({
    sourceWidth: 4000,
    sourceHeight: 3000,
    rotate: 1,
    resize: { mode: "long-edge", longEdge: 2048 },
  });
  assert.deepEqual([rotated.rotatedWidth, rotated.rotatedHeight], [3000, 4000]);
  assert.deepEqual([rotated.outputWidth, rotated.outputHeight], [1536, 2048]);
});

test("crop is planned in rotated space before resize", () => {
  const plan = planImageTransform({
    sourceWidth: 4000,
    sourceHeight: 3000,
    rotate: 1,
    cropAspect: 1,
    resize: { mode: "long-edge", longEdge: 1200 },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.crop, { x: 0, y: 500, width: 3000, height: 3000 });
  assert.deepEqual([plan.outputWidth, plan.outputHeight], [1200, 1200]);
});

test("exact dimensions can distort and say so", () => {
  const plan = planImageTransform({
    sourceWidth: 4000,
    sourceHeight: 3000,
    resize: { mode: "exact", width: 1000, height: 1000 },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.aspectDistorted, true);
  assert.equal(plan.scaleX, 0.25);
  assert.equal(plan.scaleY, 1 / 3);
});

test("plans refuse unsafe dimensions and bad settings", () => {
  const base = {
    sourceWidth: 4000,
    sourceHeight: 3000,
    resize: { mode: "long-edge", longEdge: 2048 },
  };
  assert.match(planImageTransform({ ...base, sourceWidth: 0 }).error, /source dimensions/);
  assert.match(planImageTransform({ ...base, rotate: 4 }).error, /quarter turn/);
  assert.match(planImageTransform({ ...base, resize: { mode: "long-edge", longEdge: 9000 } }).error, /8192/);
  assert.match(planImageTransform({ ...base, resize: { mode: "exact", width: 9000, height: 10 } }).error, /8192/);
  assert.match(planImageTransform({ ...base, resize: { mode: "exact", width: 8000, height: 6000 } }).error, /40 megapixels/);
  assert.match(planImageTransform({ ...base, cropAspect: -1 }).error, /crop aspect/);
});

test("defaults and caption text are deterministic", () => {
  assert.equal(defaultLongEdge(4000, 3000), 2048);
  assert.equal(defaultLongEdge(900, 600), 900);
  assert.equal(
    describeTransform({
      rotate: 1,
      flipH: true,
      cropAspect: "square",
      resize: { mode: "long-edge", longEdge: 1200 },
      format: "webp",
      quality: 0.82,
      metadata: "canvas re-encode",
    }),
    "rotate 90°, flip horizontal, centre crop 1:1 square, long edge 1200px, WEBP q82, canvas re-encode",
  );
  assert.equal(extensionForImageMime("image/jpeg"), "jpg");
  assert.equal(extensionForImageMime("image/webp"), "webp");
  assert.equal(extensionForImageMime("image/png"), "png");
  assert.equal(mimeForExport("jpeg"), "image/jpeg");
  assert.equal(mimeForExport("webp"), "image/webp");
  assert.equal(mimeForExport("png"), "image/png");
});

test("trim can supply an exact crop before the centre crop and resize", () => {
  const trimmed = planImageTransform({
    sourceWidth: 100,
    sourceHeight: 80,
    cropRect: { x: 10, y: 5, width: 50, height: 40 },
    resize: { mode: "long-edge", longEdge: 50 },
  });
  assert.equal(trimmed.ok, true);
  assert.deepEqual(trimmed.crop, { x: 10, y: 5, width: 50, height: 40 });
  assert.deepEqual([trimmed.outputWidth, trimmed.outputHeight], [50, 40]);

  const squared = planImageTransform({
    sourceWidth: 100,
    sourceHeight: 80,
    cropRect: { x: 10, y: 5, width: 50, height: 40 },
    cropAspect: 1,
    resize: { mode: "long-edge", longEdge: 50 },
  });
  assert.deepEqual(squared.crop, { x: 15, y: 5, width: 40, height: 40 });
  assert.deepEqual([squared.outputWidth, squared.outputHeight], [50, 50]);

  assert.match(
    planImageTransform({
      sourceWidth: 100,
      sourceHeight: 80,
      cropRect: { x: 90, y: 70, width: 20, height: 20 },
      resize: { mode: "long-edge", longEdge: 50 },
    }).error,
    /trim rectangle/,
  );
  assert.match(
    planImageTransform({
      sourceWidth: 100,
      sourceHeight: 80,
      cropRect: { x: 0, y: 0, width: 0, height: 20 },
      resize: { mode: "long-edge", longEdge: 50 },
    }).error,
    /trim rectangle/,
  );
});

test("nearest-neighbour resampling is an explicit, captioned choice", () => {
  assert.deepEqual(imageSmoothingFor("smooth"), { enabled: true, quality: "high" });
  assert.deepEqual(imageSmoothingFor("nearest"), { enabled: false, quality: "low" });
  assert.deepEqual(imageSmoothingFor(), { enabled: true, quality: "high" });
  assert.equal(
    describeTransform({
      cropAspect: "square",
      trimmed: true,
      resize: { mode: "exact", width: 320, height: 320 },
      resample: "nearest",
      format: "png",
    }),
    "centre crop 1:1 square, trim transparent edges, nearest-neighbour, exact 320×320px, PNG, re-encoded",
  );
  assert.doesNotMatch(
    describeTransform({ resize: { mode: "long-edge", longEdge: 100 }, format: "webp" }),
    /nearest/,
  );
});

test("sharpen is opt-in in the transform caption and names its real strength", () => {
  assert.equal(
    describeTransform({
      resample: "nearest",
      sharpen: { radius: 1, amount: 0.5 },
      format: "png",
    }),
    "nearest-neighbour, sharpen edges 50% (1px), PNG, re-encoded",
  );
  assert.doesNotMatch(describeTransform({ sharpen: { radius: 1, amount: 0 }, format: "png" }), /sharpen/);
  assert.doesNotMatch(describeTransform({ sharpen: { radius: 2, amount: 0.5 }, format: "png" }), /sharpen/);
});

test("a byte target is refused honestly for PNG and invalid sizes", async () => {
  assert.match(targetSizeProblem("png", 50_000), /PNG is lossless/);
  assert.equal(targetSizeProblem("png", null), null);
  assert.equal(targetSizeProblem("jpeg", 50_000), null);
  assert.match(targetSizeProblem("webp", 512), /at least 1 KiB/);
  assert.match(targetSizeProblem("webp", 0), /at least 1 KiB/);
  assert.match(targetSizeProblem("webp", 65 * 1024 * 1024), /64 MiB/);
});

test("target-size search returns only real bytes and never false success", async () => {
  const encode = async (quality) => ({
    size: Math.round(100_000 * quality * quality),
    type: "image/jpeg",
  });
  const met = await searchTargetQuality({ targetBytes: 40_000, encode });
  assert.equal(met.ok, true);
  assert.equal(met.met, true);
  assert.ok(met.bytes <= 40_000, "the reported bytes meet the target");
  assert.ok(met.quality > 0.6 && met.quality <= 0.98, `quality ${met.quality} is a real search result`);
  assert.ok(met.attempts >= 2 && met.attempts <= 7);

  const missed = await searchTargetQuality({ targetBytes: 1_024, encode });
  assert.equal(missed.ok, true);
  assert.equal(missed.met, false, "an impossible target is not claimed as met");
  assert.ok(missed.bytes > 1_024);
  assert.equal(missed.quality, 0.35);
  assert.equal(missed.overBy, missed.bytes - 1_024);

  const highest = await searchTargetQuality({ targetBytes: 200_000, encode });
  assert.equal(highest.met, true);
  assert.equal(highest.quality, 0.98);
  assert.equal(highest.attempts, 1);

  const broken = await searchTargetQuality({
    targetBytes: 40_000,
    encode: async () => {
      throw new Error("encoder unavailable");
    },
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /encoder unavailable/);

  const invalid = await searchTargetQuality({ targetBytes: 10, encode });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /1 KiB/);
});

test("straightening keeps the largest fully-covered area of the turned image", () => {
  assert.equal(normaliseStraighten(0), 0);
  assert.equal(normaliseStraighten(0.04), 0);
  assert.equal(normaliseStraighten(0.1), 0.1);
  assert.equal(normaliseStraighten(3.14), 3.1);
  assert.equal(normaliseStraighten(-12.24), -12.2);
  assert.equal(normaliseStraighten(MAX_STRAIGHTEN_DEGREES), 45);
  assert.equal(normaliseStraighten(45.1), null);
  assert.equal(normaliseStraighten(Number.NaN), null);
  assert.equal(normaliseStraighten("3"), null);
  assert.equal(straightenGeometry(1000, 1000, 0), null, "zero degrees is not a stage");

  const square = straightenGeometry(1000, 1000, 10, 1);
  assert.equal(square.angle, 10);
  assert.equal(square.width, square.height);
  // 1000 / (cos 10° + sin 10°) ≈ 863 px, less a one-pixel inset on each side.
  assert.ok(Math.abs(square.width - 861) <= 2, `square side ${square.width}`);
  assert.equal(square.crop.x, Math.floor((square.boundingWidth - square.width) / 2));
  assert.equal(square.crop.y, Math.floor((square.boundingHeight - square.height) / 2));
  assert.ok(square.crop.x >= 0 && square.crop.x + square.crop.width <= square.boundingWidth);
  assert.ok(square.crop.y >= 0 && square.crop.y + square.crop.height <= square.boundingHeight);

  const wide = straightenGeometry(1600, 900, 8, 16 / 9);
  assert.ok(Math.abs(wide.width / wide.height - 16 / 9) < 0.01);
  assert.ok(wide.width < 1600 && wide.height < 900);
  assert.ok(wide.boundingWidth > 1600 && wide.boundingHeight > 900);

  const gentle = straightenGeometry(1600, 900, 0.5);
  const steep = straightenGeometry(1600, 900, 30);
  assert.ok(gentle.width > steep.width, "a steeper angle keeps less width");
  assert.ok(gentle.height > steep.height, "a steeper angle keeps less height");
  assert.equal(straightenGeometry(2, 2, 45), null, "a tiny image cannot keep a usable area");
  assert.equal(straightenGeometry(3, 3, 10), null, "a sub-pixel kept area is refused instead of rounded up");
  assert.equal(straightenGeometry(0, 900, 5), null);
});

test("the planner applies straighten before the crop and records the real stage", () => {
  const base = {
    sourceWidth: 1600,
    sourceHeight: 900,
    resize: { mode: "long-edge", longEdge: 800 },
  };
  assert.deepEqual(planImageTransform({ ...base, straighten: 0 }), planImageTransform(base));
  assert.deepEqual(planImageTransform(base).straighten, null);

  const turned = planImageTransform({ ...base, straighten: 6 });
  assert.equal(turned.ok, true);
  assert.equal(turned.straighten.angle, 6);
  assert.ok(turned.straighten.width < 1600);
  assert.ok(turned.straighten.boundingHeight > 900);
  assert.deepEqual([turned.outputWidth, turned.outputHeight], [800, Math.round((800 * turned.crop.height) / turned.crop.width)]);
  assert.equal(turned.crop.x + turned.crop.width <= turned.straighten.width, true);

  const rotated = planImageTransform({ ...base, rotate: 1, straighten: 5 });
  assert.equal(rotated.rotatedWidth, 900);
  assert.equal(rotated.rotatedHeight, 1600);
  assert.ok(rotated.straighten.width < rotated.rotatedWidth);
  assert.equal(rotated.crop.x + rotated.crop.width <= rotated.straighten.width, true);

  assert.match(
    planImageTransform({ ...base, straighten: 46 }).error,
    /Straighten must be a number between -45 and 45 degrees/,
  );
  assert.match(
    planImageTransform({ ...base, straighten: Number.NaN }).error,
    /Straighten must be a number/,
  );
  assert.match(
    planImageTransform({
      ...base,
      straighten: 2,
      cropRect: { x: 0, y: 0, width: 100, height: 100 },
    }).error,
    /Set straighten to 0° before trimming/,
  );
  assert.equal(
    planImageTransform({
      ...base,
      straighten: 0.04,
      cropRect: { x: 0, y: 0, width: 100, height: 100 },
    }).ok,
    true,
    "a value that rounds to zero is still the identity",
  );
});

test("the transform caption states the real straighten direction and angle", () => {
  assert.match(
    describeTransform({ straighten: -2.5, format: "png" }),
    /straighten 2\.5° anticlockwise/,
  );
  assert.match(
    describeTransform({ straighten: 3.5, format: "png" }),
    /straighten 3\.5° clockwise/,
  );
  assert.doesNotMatch(describeTransform({ format: "png" }), /straighten/);
  assert.doesNotMatch(describeTransform({ straighten: 0.04, format: "png" }), /straighten/);
  assert.equal(
    describeTransform({ rotate: 1, straighten: 4.5, format: "jpeg", quality: 0.8 }),
    "rotate 90°, straighten 4.5° clockwise, JPEG q80, re-encoded",
  );
});

test("the keep overlay maps the crop back through rotate, flip and straighten", () => {
  const bounds = (points) => ({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });

  const whole = keptAreaPolygon(
    planImageTransform({ sourceWidth: 400, sourceHeight: 300, resize: { mode: "long-edge", longEdge: 400 } }),
  );
  assert.ok(whole);
  assert.ok(Math.abs(whole.area - 120_000) < 1);
  assert.deepEqual(bounds(whole.points), { minX: 0, maxX: 400, minY: 0, maxY: 300 });

  const right = planImageTransform({
    sourceWidth: 1600,
    sourceHeight: 900,
    cropAspect: 1,
    cropAnchor: "right",
    resize: { mode: "long-edge", longEdge: 450 },
  });
  const rightKept = keptAreaPolygon(right);
  assert.ok(Math.abs(rightKept.area - 810_000) < 1);
  assert.equal(bounds(rightKept.points).minX, 700);

  const flipped = keptAreaPolygon(
    planImageTransform({
      sourceWidth: 1600,
      sourceHeight: 900,
      flipH: true,
      cropAspect: 1,
      cropAnchor: "left",
      resize: { mode: "long-edge", longEdge: 450 },
    }),
  );
  assert.ok(Math.abs(flipped.area - 810_000) < 1);
  const flippedBox = bounds(flipped.points);
  assert.equal(flippedBox.minX, 700, "a horizontal flip moves the left stage crop to the right of the source");
  assert.equal(flippedBox.maxX, 1600);

  const turned = planImageTransform({
    sourceWidth: 1600,
    sourceHeight: 900,
    rotate: 1,
    cropAspect: 1,
    cropAnchor: "bottom",
    resize: { mode: "long-edge", longEdge: 800 },
  });
  const turnedKept = keptAreaPolygon(turned);
  assert.ok(Math.abs(turnedKept.area - 900 * 900) < 1);
  assert.deepEqual(bounds(turnedKept.points), {
    minX: 700,
    maxX: 1600,
    minY: 0,
    maxY: 900,
  });

  for (const straighten of [4, -12.5]) {
    const plan = planImageTransform({
      sourceWidth: 1600,
      sourceHeight: 900,
      rotate: 3,
      flipV: true,
      straighten,
      cropAspect: 4 / 5,
      resize: { mode: "long-edge", longEdge: 640 },
    });
    assert.equal(plan.ok, true);
    const kept = keptAreaPolygon(plan);
    assert.ok(kept, `overlay exists for ${straighten}°`);
    const cropArea = plan.crop.width * plan.crop.height;
    assert.ok(
      Math.abs(kept.area - cropArea) / cropArea < 0.005,
      `overlay area ${kept.area} matches the crop area ${cropArea}`,
    );
    const box = bounds(kept.points);
    assert.ok(box.minX >= -0.01 && box.maxX <= 1600.01, `x inside the source: ${box.minX}..${box.maxX}`);
    assert.ok(box.minY >= -0.01 && box.maxY <= 900.01, `y inside the source: ${box.minY}..${box.maxY}`);
  }

  assert.equal(keptAreaPolygon({ ok: false, error: "no" }), null);
  assert.equal(keptAreaPolygon(null), null);
});
