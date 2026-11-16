import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_ASPECTS,
  centredCrop,
  defaultLongEdge,
  describeTransform,
  extensionForImageMime,
  mimeForExport,
  planImageTransform,
  rotatedDimensions,
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

test("a long-edge plan produces the exact rounded edge", () => {
  const landscape = planImageTransform({
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
