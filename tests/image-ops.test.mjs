import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_ANCHOR_LABELS,
  CROP_ASPECTS,
  anchoredCrop,
  centredCrop,
  defaultLongEdge,
  describeTransform,
  extensionForImageMime,
  imageSmoothingFor,
  isCropAnchor,
  mimeForExport,
  planImageTransform,
  rotatedDimensions,
  searchTargetQuality,
  targetSizeProblem,
} from "../src/frontend/image-ops.mjs";

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
