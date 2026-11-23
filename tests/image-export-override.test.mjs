import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canExportImageAsPng,
  imageQualityIsValid,
  settingsForImage,
} from "../src/frontend/image-export-override.ts";
import {
  IMAGE_RECEIPT_SCHEMA,
  IMAGE_RECEIPT_VERSION,
  buildImageReceipt,
} from "../src/frontend/image-receipt.ts";
import { extensionForImageMime } from "../src/frontend/image-ops.ts";

const SOURCE_HASH = "d".repeat(64);

function batchSettings(overrides = {}) {
  return {
    resizeMode: "long-edge",
    longEdge: 1600,
    exactWidth: 1600,
    exactHeight: 1200,
    cropAspect: "original",
    cropAnchor: "centre",
    rotate: 0,
    flipH: false,
    flipV: false,
    straighten: 0,
    resample: "smooth",
    adjust: { exposure: 0, contrast: 0 },
    format: "jpeg",
    quality: 0.8,
    targetKiB: 120,
    matte: "#ffffff",
    ...overrides,
  };
}

function receiptInput(settings, overrides = {}) {
  return {
    sourceHash: SOURCE_HASH,
    result: {
      plan: { ok: true, outputWidth: 800, outputHeight: 600 },
      settings,
      width: 800,
      height: 600,
      mime: settings.format === "png" ? "image/png" : `image/${settings.format}`,
      bytes: 12345,
      sha256: "e".repeat(64),
      ...overrides,
    },
  };
}

test("only a PNG source in a JPEG or WebP batch offers the PNG choice", () => {
  assert.equal(canExportImageAsPng("image/png", "jpeg"), true);
  assert.equal(canExportImageAsPng("image/png", "webp"), true);
  assert.equal(canExportImageAsPng("image/png", "png"), false);
  assert.equal(canExportImageAsPng("image/jpeg", "jpeg"), false);
  assert.equal(canExportImageAsPng("image/jpeg", "webp"), false);
  assert.equal(canExportImageAsPng("image/webp", "jpeg"), false);
});

test("the old default stays untouched when the choice is unchecked", () => {
  for (const format of ["jpeg", "webp"]) {
    const settings = batchSettings({ format });
    const effective = settingsForImage(settings, "image/png", false);
    assert.equal(effective, settings, "an unchecked image reuses the batch settings");
    assert.deepEqual(effective, settings);
    assert.equal(effective.format, format);
    assert.equal(effective.targetKiB, 120);
  }
});

test("a checked PNG becomes lossless PNG with no byte target in either format", () => {
  for (const format of ["jpeg", "webp"]) {
    const settings = batchSettings({ format });
    const effective = settingsForImage(settings, "image/png", true);

    assert.notEqual(effective, settings);
    assert.equal(effective.format, "png");
    assert.equal(effective.targetKiB, null);
    assert.equal(effective.quality, settings.quality, "unused quality is left as the batch value");
    assert.deepEqual(
      { ...effective, format: settings.format, targetKiB: settings.targetKiB },
      settings,
      "only the format and target differ",
    );
    assert.equal(settings.format, format, "the batch setting itself is unchanged");
    assert.equal(settings.targetKiB, 120);
  }
});

test("a PNG batch and non-PNG sources keep their existing settings", () => {
  const pngBatch = batchSettings({ format: "png", targetKiB: null });
  assert.equal(settingsForImage(pngBatch, "image/png", true), pngBatch);

  const jpegBatch = batchSettings({ format: "jpeg" });
  assert.equal(settingsForImage(jpegBatch, "image/jpeg", true), jpegBatch);
  assert.equal(settingsForImage(jpegBatch, "image/webp", true), jpegBatch);
});

test("one toggle is reversible and applies per image in a mixed batch", () => {
  const settings = batchSettings({ format: "webp" });
  const original = JSON.stringify(settings);

  const on = settingsForImage(settings, "image/png", true);
  const off = settingsForImage(settings, "image/png", false);
  assert.equal(on.format, "png");
  assert.equal(off, settings, "turning the choice off restores the batch format");
  assert.equal(JSON.stringify(settings), original, "the batch settings are never mutated");

  const mixed = [
    { mime: "image/png", override: true },
    { mime: "image/png", override: false },
    { mime: "image/jpeg", override: true },
    { mime: "image/webp", override: false },
  ].map(({ mime, override }) => settingsForImage(settings, mime, override));

  assert.deepEqual(
    mixed.map((item) => item.format),
    ["png", "webp", "webp", "webp"],
  );
  assert.deepEqual(
    mixed.map((item) => item.targetKiB),
    [null, 120, 120, 120],
  );
});

test("receipts keep the v1 shape and record the real PNG result", () => {
  const jpegSettings = batchSettings({ format: "jpeg" });
  const pngSettings = settingsForImage(jpegSettings, "image/png", true);

  const originalReceipt = buildImageReceipt(
    receiptInput(jpegSettings, { mime: "image/jpeg" }),
  );
  const overrideReceipt = buildImageReceipt(receiptInput(pngSettings));

  assert.equal(IMAGE_RECEIPT_SCHEMA, "media-studio/image-receipt");
  assert.equal(IMAGE_RECEIPT_VERSION, 1);
  assert.equal(originalReceipt.version, 1);
  assert.equal(overrideReceipt.version, 1);

  assert.deepEqual(Object.keys(overrideReceipt), Object.keys(originalReceipt));
  assert.deepEqual(
    Object.keys(overrideReceipt.transform.settings),
    Object.keys(originalReceipt.transform.settings),
    "the override adds no receipt setting",
  );
  assert.equal(overrideReceipt.transform.settings.format, "png");
  assert.equal(overrideReceipt.transform.settings.targetKiB, null);
  assert.equal(overrideReceipt.output.mime, "image/png");
  assert.equal(overrideReceipt.output.sha256, "e".repeat(64));

  assert.equal(originalReceipt.transform.settings.format, "jpeg");
  assert.equal(originalReceipt.transform.settings.targetKiB, 120);
  assert.equal(originalReceipt.output.mime, "image/jpeg");
  assert.deepEqual(originalReceipt.transform.settings, jpegSettings);
});

test("a blank per-image long edge inherits the batch exactly", () => {
  for (const resizeMode of ["long-edge", "max-long-edge", "exact"]) {
    const settings = batchSettings({ resizeMode });
    assert.equal(settingsForImage(settings, "image/png", false, undefined), settings);
    assert.equal(settingsForImage(settings, "image/png", true, undefined).longEdge, settings.longEdge);
  }
});

test("a nonblank per-image long edge resizes only that image", () => {
  for (const resizeMode of ["long-edge", "max-long-edge", "exact"]) {
    const settings = batchSettings({ format: "webp", resizeMode });
    const effective = settingsForImage(settings, "image/webp", false, 640);

    assert.equal(effective.longEdge, 640);
    assert.equal(effective.resizeMode, "long-edge");
    assert.equal(settings.longEdge, 1600, "the batch setting is unchanged");
    assert.equal(settings.resizeMode, resizeMode);
    assert.equal(effective.format, "webp");
    assert.equal(effective.targetKiB, 120);
  }
});

test("the per-image long edge composes with the PNG choice", () => {
  const settings = batchSettings({ format: "jpeg" });
  const effective = settingsForImage(settings, "image/png", true, 400);

  assert.equal(effective.format, "png");
  assert.equal(effective.targetKiB, null);
  assert.equal(effective.longEdge, 400);
  assert.equal(effective.resizeMode, "long-edge");
});

test("an invalid per-image long edge is passed to the existing whole-number check", () => {
  const settings = batchSettings();
  for (const value of [Number.NaN, 0, 9000, 1.5]) {
    const effective = settingsForImage(settings, "image/webp", false, value);
    assert.equal(effective.longEdge, value);
    assert.equal(effective.resizeMode, "long-edge");
  }
});

test("a per-image crop position applies only while the effective aspect is cropped", () => {
  const uncropped = batchSettings({ cropAspect: "original" });
  assert.equal(
    settingsForImage(uncropped, "image/png", false, undefined, undefined, "top"),
    uncropped,
    "an uncropped row keeps the exact batch settings and its stored anchor is ignored",
  );

  const batchCropped = batchSettings({ cropAspect: "square" });
  assert.equal(
    settingsForImage(batchCropped, "image/png", false, undefined, undefined, "top").cropAnchor,
    "top",
  );
  assert.equal(batchCropped.cropAnchor, "centre", "the batch anchor is unchanged");

  const rowCropped = settingsForImage(
    uncropped,
    "image/png",
    false,
    undefined,
    "square",
    "bottom",
  );
  assert.equal(rowCropped.cropAspect, "square");
  assert.equal(rowCropped.cropAnchor, "bottom", "a row aspect makes its anchor relevant");

  assert.equal(
    settingsForImage(batchCropped, "image/png", false, undefined, undefined, undefined),
    batchCropped,
    "a blank anchor inherits the batch position",
  );
});

test("the receipt records the effective per-image long edge, not the batch value", () => {
  const settings = batchSettings({ format: "webp", resizeMode: "max-long-edge" });
  const effective = settingsForImage(settings, "image/webp", false, 320);
  const receipt = buildImageReceipt(receiptInput(effective, { mime: "image/webp" }));

  assert.equal(IMAGE_RECEIPT_VERSION, 1);
  assert.equal(Object.keys(receipt.transform.settings).length, Object.keys(settings).length);
  assert.equal(receipt.transform.settings.longEdge, 320);
  assert.equal(receipt.transform.settings.resizeMode, "long-edge");
  assert.equal(settings.longEdge, 1600, "the batch settings are never mutated");
});

test("JPEG and WebP quality overrides apply to one row while PNG and byte targets keep their settings", () => {
  for (const format of ["jpeg", "webp"]) {
    const batch = batchSettings({ format, targetKiB: null });
    const row = (quality, png = false, settings = batch) =>
      settingsForImage(settings, "image/png", png, undefined, undefined, undefined, quality);

    assert.equal(row(70).quality, 0.7);
    assert.equal(row(undefined), batch);
    assert.equal(row(70, true).format, "png");
    assert.equal(row(70, true).quality, batch.quality);
    const png = { ...batch, format: "png" };
    assert.equal(row(70, false, png), png);
    const target = { ...batch, targetKiB: 120 };
    assert.equal(row(70, false, target), target);
    for (const invalid of [49, 101, 70.5, NaN]) {
      assert.equal(imageQualityIsValid(invalid), false);
      assert.equal(row(invalid), batch);
    }
  }
});

test("a blank per-row format keeps the exact batch object", () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const settings = batchSettings({
      format,
      targetKiB: format === "png" ? null : 120,
    });
    assert.equal(
      settingsForImage(
        settings,
        "image/jpeg",
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
      settings,
    );
  }
});

test("each row can choose PNG, JPEG or WebP without changing the batch", () => {
  const settings = batchSettings({ format: "jpeg", targetKiB: null });
  for (const format of ["png", "jpeg", "webp"]) {
    const effective = settingsForImage(
      settings,
      "image/png",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      format,
    );
    assert.equal(effective.format, format);
    assert.equal(settings.format, "jpeg", "the batch format is unchanged");
    if (format === "png") assert.equal(effective.targetKiB, null);
    else assert.equal(effective.targetKiB, settings.targetKiB);
  }

  const original = JSON.stringify(settings);
  const row = settingsForImage(
    settings,
    "image/png",
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    "webp",
  );
  assert.equal(row.format, "webp");
  assert.equal(
    settingsForImage(settings, "image/png", false, undefined, undefined, undefined, undefined, undefined),
    settings,
    "Use batch restores the exact batch settings",
  );
  assert.equal(JSON.stringify(settings), original);
});

test("a PNG row has no byte target while a lossy row keeps a lossy batch target", () => {
  const lossy = batchSettings({ format: "jpeg", targetKiB: 120 });
  const pngRow = settingsForImage(
    lossy,
    "image/jpeg",
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    "png",
  );
  assert.equal(pngRow.format, "png");
  assert.equal(pngRow.targetKiB, null);

  for (const format of ["jpeg", "webp"]) {
    const lossyRow = settingsForImage(
      lossy,
      "image/jpeg",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      format,
    );
    assert.equal(lossyRow.format, format);
    assert.equal(lossyRow.targetKiB, 120, "a lossy batch target still applies");
  }
});

test("a lossy row in a PNG batch does not revive a stale hidden target", () => {
  for (const format of ["jpeg", "webp"]) {
    const clean = batchSettings({ format: "png", targetKiB: null });
    const cleanRow = settingsForImage(
      clean,
      "image/png",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      format,
    );
    assert.equal(cleanRow.format, format);
    assert.equal(cleanRow.targetKiB, null);

    const stale = batchSettings({ format: "png", targetKiB: 120 });
    const staleRow = settingsForImage(
      stale,
      "image/png",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      format,
    );
    assert.equal(staleRow.format, format);
    assert.equal(staleRow.targetKiB, null, "the hidden target stays out of the row");
    assert.equal(stale.targetKiB, 120, "the batch object is untouched");
  }
});

test("per-row quality applies to a lossy format override and is ignored for PNG", () => {
  const pngBatch = batchSettings({ format: "png", targetKiB: null, quality: 0.9 });
  const jpegRow = settingsForImage(
    pngBatch,
    "image/png",
    false,
    undefined,
    undefined,
    undefined,
    70,
    "jpeg",
  );
  assert.equal(jpegRow.format, "jpeg");
  assert.equal(jpegRow.targetKiB, null);
  assert.equal(jpegRow.quality, 0.7);

  const pngRow = settingsForImage(
    pngBatch,
    "image/png",
    false,
    undefined,
    undefined,
    undefined,
    70,
    "png",
  );
  assert.equal(pngRow.quality, 0.9, "lossless PNG keeps the batch quality value unused");

  const target = batchSettings({ format: "jpeg", targetKiB: 120 });
  const targeted = settingsForImage(
    target,
    "image/jpeg",
    false,
    undefined,
    undefined,
    undefined,
    70,
    "webp",
  );
  assert.equal(targeted.quality, target.quality, "a byte target keeps its own search");
});

test("the older PNG flag still works and an explicit row format wins", () => {
  const batch = batchSettings({ format: "jpeg" });
  const png = settingsForImage(batch, "image/png", true);
  assert.equal(png.format, "png");
  assert.equal(png.targetKiB, null);

  const explicit = settingsForImage(
    batch,
    "image/png",
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    "webp",
  );
  assert.equal(explicit.format, "webp");
  assert.equal(explicit.targetKiB, 120);
});

test("the row format composes with its own long edge, crop and quality", () => {
  const settings = batchSettings({ format: "jpeg", targetKiB: null });
  const effective = settingsForImage(
    settings,
    "image/jpeg",
    false,
    640,
    "square",
    "top",
    70,
    "webp",
  );
  assert.equal(effective.format, "webp");
  assert.equal(effective.longEdge, 640);
  assert.equal(effective.resizeMode, "long-edge");
  assert.equal(effective.cropAspect, "square");
  assert.equal(effective.cropAnchor, "top");
  assert.equal(effective.quality, 0.7);
  assert.equal(settings.longEdge, 1600);
  assert.equal(settings.cropAspect, "original");
});

test("a per-row format result keeps the v1 receipt and its exact MIME extension", () => {
  const settings = batchSettings({ format: "jpeg" });
  for (const [format, mime, extension] of [
    ["png", "image/png", "png"],
    ["jpeg", "image/jpeg", "jpg"],
    ["webp", "image/webp", "webp"],
  ]) {
    const row = settingsForImage(
      settings,
      "image/png",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      format,
    );
    const receipt = buildImageReceipt(receiptInput(row, { mime }));

    assert.equal(IMAGE_RECEIPT_VERSION, 1);
    assert.equal(receipt.version, 1);
    assert.deepEqual(
      Object.keys(receipt.transform.settings),
      Object.keys(buildImageReceipt(receiptInput(settings, { mime: "image/jpeg" })).transform.settings),
      "the row format adds no receipt setting",
    );
    assert.equal(receipt.transform.settings.format, format);
    assert.equal(receipt.output.mime, mime);
    assert.equal(extensionForImageMime(receipt.output.mime), extension);
    assert.equal(receipt.transform.settings.targetKiB, format === "png" ? null : 120);
  }
});
