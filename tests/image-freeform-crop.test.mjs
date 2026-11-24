import { test } from "node:test";
import assert from "node:assert/strict";

import {
  freeformCropCompatibilityProblem,
  freeformCropSourceProblem,
  freeformCropStateForSource,
  parseFreeformCrop,
  updateFreeformCropField,
} from "../src/frontend/image-freeform-crop.ts";
import { describeTransform, keptAreaPolygon, planImageTransform } from "../src/frontend/image-ops.ts";
import { buildImageReceipt } from "../src/frontend/image-receipt.ts";

const SOURCE = { sourceHash: "a".repeat(64), width: 100, height: 80 };
const NEUTRAL = {
  cropAspect: "original",
  rotate: 0,
  flipH: false,
  flipV: false,
  straighten: 0,
};
const RECT = { x: 10, y: 5, width: 50, height: 40 };

function resultFor(plan, crop = null) {
  return {
    plan,
    settings: {
      resizeMode: "exact",
      longEdge: 2048,
      exactWidth: 50,
      exactHeight: 40,
      cropAspect: "original",
      cropAnchor: "centre",
      rotate: 0,
      flipH: false,
      flipV: false,
      straighten: 0,
      resample: "smooth",
      adjust: { exposure: 0, contrast: 0 },
      format: "png",
      quality: 0.9,
      targetKiB: null,
      matte: "#ffffff",
    },
    width: 50,
    height: 40,
    mime: "image/png",
    bytes: 1234,
    sha256: "b".repeat(64),
    crop,
  };
}

test("freeform draft and applied state stay bound to one upright source", () => {
  let state = updateFreeformCropField(null, SOURCE, "left", "10");
  assert.deepEqual(state.fields, { left: "10", top: "0", width: "100", height: "80" });
  assert.equal(state.applied, null);

  state = { ...state, applied: RECT };
  const edited = updateFreeformCropField(state, SOURCE, "width", "51");
  assert.deepEqual(edited.applied, RECT, "editing a draft does not replace the applied rectangle");
  assert.equal(edited.fields.width, "51");

  const replacement = { ...SOURCE, sourceHash: "c".repeat(64) };
  assert.equal(freeformCropStateForSource(edited, replacement), null);
  assert.match(freeformCropSourceProblem(edited, replacement), /different source pixels.*Clear exact crop/);
  assert.equal(freeformCropSourceProblem(edited, SOURCE), null);
});

test("freeform values are exact whole pixels and invalid ranges are never clamped", () => {
  assert.deepEqual(
    parseFreeformCrop({ left: "10", top: "5", width: "50", height: "40" }, SOURCE),
    { ok: true, rect: RECT },
  );
  const fractional = parseFreeformCrop({ left: "1.5", top: "0", width: "10", height: "10" }, SOURCE);
  assert.equal(fractional.ok, false);
  assert.equal(fractional.invalid.left, true);
  assert.match(fractional.error, /whole pixels/);

  const zero = parseFreeformCrop({ left: "0", top: "0", width: "0", height: "10" }, SOURCE);
  assert.equal(zero.ok, false);
  assert.equal(zero.invalid.width, true);

  const overflow = parseFreeformCrop({ left: "90", top: "70", width: "20", height: "20" }, SOURCE);
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /not clamped/);
  assert.equal(overflow.invalid.left, true);
  assert.equal(overflow.invalid.width, true);
  assert.equal(overflow.invalid.top, true);
  assert.equal(overflow.invalid.height, true);
});

test("freeform crop refuses transforms, aspect crops and alpha trim with a recovery path", () => {
  assert.equal(freeformCropCompatibilityProblem(SOURCE, NEUTRAL, false), null);
  for (const settings of [
    { ...NEUTRAL, rotate: 1 },
    { ...NEUTRAL, flipH: true },
    { ...NEUTRAL, flipV: true },
    { ...NEUTRAL, straighten: 2.5 },
    { ...NEUTRAL, cropAspect: "square" },
  ]) {
    const problem = freeformCropCompatibilityProblem(SOURCE, settings, false);
    assert.match(problem, /Original aspect.*neutral/);
    assert.match(problem, /Restore those controls, or clear exact crop/);
  }
  assert.match(
    freeformCropCompatibilityProblem(SOURCE, NEUTRAL, true),
    /Clear transparent trim.*cannot be combined/,
  );
});

test("the deterministic planner, kept overlay and receipt identify the actual manual rectangle", () => {
  const plan = planImageTransform({
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    cropAspect: null,
    cropRect: RECT,
    resize: { mode: "exact", width: 50, height: 40 },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.crop, RECT);
  assert.deepEqual([plan.outputWidth, plan.outputHeight], [50, 40]);
  assert.deepEqual(keptAreaPolygon(plan)?.points, [
    { x: 10, y: 5 },
    { x: 60, y: 5 },
    { x: 60, y: 45 },
    { x: 10, y: 45 },
  ]);

  const receipt = buildImageReceipt({
    sourceHash: SOURCE.sourceHash,
    result: resultFor(plan, {
      kind: "manual",
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      rect: RECT,
    }),
  });
  assert.deepEqual(receipt.transform.crop, {
    mode: "manual",
    coordinateSpace: "upright-source-pixels",
    sourceWidth: 100,
    sourceHeight: 80,
    rect: RECT,
  });
  assert.deepEqual(receipt.output, {
    width: 50,
    height: 40,
    mime: "image/png",
    bytes: 1234,
    sha256: "b".repeat(64),
  });
  const caption = describeTransform({ manualCrop: RECT, format: "png" });
  assert.match(caption, /manual crop left 10px, top 5px, width 50px, height 40px in upright source pixels/);
  assert.doesNotMatch(caption, /trim transparent edges/);
});

test("neutral and automatic alpha-trim receipts keep their compatible v1 shape", () => {
  const plan = planImageTransform({
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    cropRect: RECT,
    resize: { mode: "exact", width: 50, height: 40 },
  });
  const neutral = buildImageReceipt({ sourceHash: SOURCE.sourceHash, result: resultFor(plan) });
  const alphaTrim = buildImageReceipt({
    sourceHash: SOURCE.sourceHash,
    result: resultFor(plan, {
      kind: "alpha-trim",
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      rect: RECT,
    }),
  });
  assert.equal(Object.hasOwn(neutral.transform, "crop"), false);
  assert.deepEqual(alphaTrim, neutral);
  assert.equal(
    describeTransform({ trimmed: true, format: "png" }),
    "trim transparent edges, PNG, re-encoded",
  );
});
