// Focused check for the signed-out Web-ready social kit: exact bounded sizes,
// preserved crop anchor and alpha-safe WebP, one typed v1 receipt per output,
// and a bounded store-only ZIP. No browser, account or network needed.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SOCIAL_KIT_FORMATS,
  SOCIAL_SIZES,
  socialKitSettings,
} from "../src/frontend/image-social-kit.ts";
import { CROP_ASPECTS, extensionForImageMime, mimeForExport } from "../src/frontend/image-ops.ts";
import {
  MAX_DECODED_PIXELS,
  MAX_IMAGE_OUTPUT_DIMENSION,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
} from "../src/frontend/image-limits.ts";
import { buildImageReceipt, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";
import { createZip } from "../src/frontend/image-zip.ts";

const BASE = {
  resizeMode: "max-long-edge",
  longEdge: 1600,
  exactWidth: 1600,
  exactHeight: 1200,
  cropAspect: "original",
  cropAnchor: "bottomRight",
  rotate: 1,
  flipH: true,
  flipV: false,
  straighten: 0,
  resample: "nearest",
  adjust: { exposure: 0.2, contrast: 0 },
  format: "png",
  quality: 0.9,
  targetKiB: 256,
  matte: "#123456",
};

test("four exact social sizes map to the existing crop aspects and stay inside the caps", () => {
  assert.deepEqual(
    SOCIAL_SIZES.map((size) => [size.key, size.aspect, size.width, size.height]),
    [
      ["square", "square", 1080, 1080],
      ["portrait", "portrait", 1080, 1350],
      ["story", "tall", 1080, 1920],
      ["landscape", "wide", 1920, 1080],
    ],
  );
  for (const size of SOCIAL_SIZES) {
    assert.equal(CROP_ASPECTS[size.aspect], size.width / size.height);
    assert.ok(size.width <= MAX_IMAGE_OUTPUT_DIMENSION && size.height <= MAX_IMAGE_OUTPUT_DIMENSION);
    assert.ok(size.width * size.height <= MAX_DECODED_PIXELS);
  }
});

test("each size keeps the user's crop anchor and edits, and defaults to alpha-safe WebP", () => {
  for (const size of SOCIAL_SIZES) {
    const settings = socialKitSettings(BASE, size, 0.82);
    assert.equal(settings.cropAnchor, "bottomRight");
    assert.equal(settings.rotate, 1);
    assert.equal(settings.flipH, true);
    assert.equal(settings.straighten, 0);
    assert.equal(settings.resample, "nearest");
    assert.deepEqual(settings.adjust, BASE.adjust);
    assert.equal(settings.resizeMode, "exact");
    assert.equal(settings.exactWidth, size.width);
    assert.equal(settings.exactHeight, size.height);
    assert.equal(settings.cropAspect, size.aspect);
    assert.equal(settings.format, "webp");
    assert.equal(settings.quality, 0.82);
    assert.equal(settings.targetKiB, null);
  }
});

test("the kit offers exactly one explicit choice, with WebP as the default", () => {
  assert.deepEqual([...SOCIAL_KIT_FORMATS], ["webp", "png"]);
  for (const size of SOCIAL_SIZES) {
    assert.equal(socialKitSettings(BASE, size, 0.82).format, "webp");
  }
});

test("an explicit PNG choice keeps every exact size and edit but changes only the format", () => {
  for (const size of SOCIAL_SIZES) {
    const settings = socialKitSettings(BASE, size, 0.82, "png");
    assert.equal(settings.cropAnchor, "bottomRight");
    assert.equal(settings.rotate, 1);
    assert.equal(settings.flipH, true);
    assert.equal(settings.straighten, 0);
    assert.equal(settings.resample, "nearest");
    assert.deepEqual(settings.adjust, BASE.adjust);
    assert.equal(settings.resizeMode, "exact");
    assert.equal(settings.exactWidth, size.width);
    assert.equal(settings.exactHeight, size.height);
    assert.equal(settings.cropAspect, size.aspect);
    assert.equal(settings.format, "png");
    assert.equal(settings.quality, 0.82);
    assert.equal(settings.targetKiB, null);
  }
});

test("download names, ZIP names and receipts follow verified bytes, never a false format label", () => {
  for (const format of SOCIAL_KIT_FORMATS) {
    const mime = mimeForExport(format);
    assert.equal(extensionForImageMime(mime), format);
    const size = SOCIAL_SIZES[0];
    const settings = socialKitSettings(BASE, size, 0.82, format);
    const receipt = buildImageReceipt({
      sourceHash: "b".repeat(64),
      result: {
        plan: { ok: true, outputWidth: size.width, outputHeight: size.height },
        settings,
        width: size.width,
        height: size.height,
        mime,
        bytes: 123456,
        sha256: "a".repeat(64),
      },
    });
    assert.equal(receipt.output.mime, mime);
    assert.equal(receipt.transform.settings.format, format);
    assert.equal(extensionForImageMime(receipt.output.mime), format);
  }
});

test("the typed v1 builder captures each output's exact receipt without new schema", () => {
  const size = SOCIAL_SIZES[2];
  const settings = socialKitSettings(BASE, size, 0.82);
  const result = {
    plan: { ok: true, outputWidth: size.width, outputHeight: size.height },
    settings,
    width: size.width,
    height: size.height,
    mime: "image/webp",
    bytes: 123456,
    sha256: "a".repeat(64),
  };
  const receipt = buildImageReceipt({ sourceHash: "b".repeat(64), result });
  assert.equal(receipt.version, IMAGE_RECEIPT_VERSION);
  assert.deepEqual(receipt.source, { sha256: "b".repeat(64) });
  assert.deepEqual(receipt.output, {
    width: size.width,
    height: size.height,
    mime: "image/webp",
    bytes: 123456,
    sha256: "a".repeat(64),
  });
  assert.equal(receipt.transform.settings.cropAnchor, "bottomRight");
  assert.equal(receipt.transform.settings.cropAspect, size.aspect);
  assert.equal(receipt.transform.settings.format, "webp");
});

test("four WebP outputs and four receipts fit one bounded flat ZIP", () => {
  const entries = [];
  for (const size of SOCIAL_SIZES) {
    entries.push({ name: `sticker-${size.key}-${size.width}x${size.height}.webp`, data: new Uint8Array([1, 2, 3, 4]) });
    entries.push({ name: `sticker-${size.key}-receipt.json`, data: new TextEncoder().encode(`{"size":"${size.key}"}`) });
  }
  assert.ok(entries.length <= MAX_ZIP_ENTRIES);
  const zip = createZip(entries, { date: new Date(0) });
  assert.equal(zip.ok, true);
  assert.equal(zip.entries.length, 8);
  assert.equal(new Set(zip.entries).size, 8);
  assert.ok(zip.bytes.length > 0 && zip.bytes.length < MAX_ZIP_BYTES);
  for (const name of zip.entries) assert.equal(name.includes("/"), false);
});
