import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canExportImageAsPng,
  settingsForImage,
} from "../src/frontend/image-export-override.ts";
import {
  IMAGE_RECEIPT_SCHEMA,
  IMAGE_RECEIPT_VERSION,
  buildImageReceipt,
} from "../src/frontend/image-receipt.ts";

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
