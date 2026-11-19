// Focused check for the signed-out Web-ready social kit: exact bounded sizes,
// preserved crop anchor and alpha-safe WebP, one typed v1 receipt per output,
// and a bounded store-only ZIP. No browser, account or network needed.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SOCIAL_KIT_FORMATS,
  SOCIAL_SIZES,
  defaultSocialKitFormat,
  socialKitCropAnchor,
  socialKitSettings,
  socialPostEntries,
  socialSourceEligible,
} from "../src/frontend/image-social-kit.ts";

test("optional social text preserves entered UTF-8, skips blank fields and is bounded", () => {
  assert.deepEqual(socialPostEntries(), []);
  assert.deepEqual(socialPostEntries({ caption: "  ", altText: "\n" }), []);
  const caption = "First line\nSecond line — café";
  const entries = socialPostEntries({ caption, altText: "a".repeat(502) });
  assert.deepEqual(entries.map(({ name, data }) => [name, new TextDecoder().decode(data)]), [
    ["post.txt", caption],
    ["alt.txt", "a".repeat(500)],
  ]);
});
import {
  assertSocialReproducible,
  socialFormatForReceipt,
} from "../scripts/replay-web-ready-image.mjs";
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

test("the workbench default follows WebP encode support without changing any size or edit", () => {
  assert.equal(defaultSocialKitFormat(true), "webp");
  assert.equal(defaultSocialKitFormat(false), "png");
  for (const size of SOCIAL_SIZES) {
    const settings = socialKitSettings(BASE, size, 0.82, defaultSocialKitFormat(false));
    assert.equal(settings.format, "png");
    assert.equal(settings.quality, 0.82);
    assert.equal(settings.targetKiB, null);
    assert.equal(settings.cropAnchor, "bottomRight");
    assert.equal(settings.rotate, 1);
    assert.deepEqual(settings.adjust, BASE.adjust);
    assert.equal(settings.resizeMode, "exact");
    assert.equal(settings.exactWidth, size.width);
    assert.equal(settings.exactHeight, size.height);
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

test("blank social size choices keep the editor anchor and explicit choices stay independent", () => {
  const choices = { square: "topLeft", story: "bottomRight" };
  assert.equal(socialKitCropAnchor(undefined, "square", "centre"), "centre");
  assert.equal(socialKitCropAnchor({}, "story", "centre"), "centre");
  assert.equal(socialKitCropAnchor(choices, "square", "centre"), "topLeft");
  assert.equal(socialKitCropAnchor(choices, "story", "centre"), "bottomRight");
  assert.equal(socialKitCropAnchor(choices, "portrait", "centre"), "centre");
  assert.equal(socialKitCropAnchor(choices, "landscape", "centre"), "centre");
  // Native "Use editor" removes one key without losing the other sizes.
  const reset = { ...choices, square: undefined };
  assert.equal(socialKitCropAnchor(reset, "square", "centre"), "centre");
  assert.equal(socialKitCropAnchor(reset, "story", "centre"), "bottomRight");
});

test("four sizes carry their own crop anchor into settings, receipts and local replay", () => {
  const chosen = {
    square: "topLeft",
    portrait: "top",
    story: "bottomRight",
    landscape: "right",
  };
  const receipts = SOCIAL_SIZES.map((size) => {
    const cropAnchor = socialKitCropAnchor(chosen, size.key, "centre");
    const settings = socialKitSettings({ ...BASE, cropAnchor }, size, 0.82, "webp");
    assert.equal(settings.cropAnchor, cropAnchor);
    assert.equal(settings.cropAspect, size.aspect);
    assert.equal(settings.exactWidth, size.width);
    assert.equal(settings.exactHeight, size.height);
    assert.equal(settings.rotate, BASE.rotate);
    assert.equal(settings.resample, BASE.resample);
    assert.deepEqual(settings.adjust, BASE.adjust);
    assert.equal(settings.format, "webp");
    assert.equal(settings.targetKiB, null);
    const receipt = buildImageReceipt({
      sourceHash: "b".repeat(64),
      result: {
        plan: { ok: true, outputWidth: size.width, outputHeight: size.height },
        settings,
        width: size.width,
        height: size.height,
        mime: "image/webp",
        bytes: 123456,
        sha256: "a".repeat(64),
      },
    });
    assert.equal(receipt.version, IMAGE_RECEIPT_VERSION);
    assert.equal(receipt.transform.settings.cropAnchor, cropAnchor);
    assert.equal(socialFormatForReceipt(receipt, size), "webp");
    assert.doesNotThrow(() =>
      assertSocialReproducible(receipt, structuredClone(receipt), size, "webp"));
    const wrong = structuredClone(receipt);
    wrong.transform.settings.cropAnchor = "centre";
    assert.throws(
      () => assertSocialReproducible(receipt, wrong, size, "webp"),
      /settings\.cropAnchor/,
    );
    return receipt;
  });
  assert.deepEqual(
    receipts.map((receipt) => receipt.transform.settings.cropAnchor),
    ["topLeft", "top", "bottomRight", "right"],
  );
});

test("the social kit accepts local still PNG, JPEG and WebP and preserves the public poster path", () => {
  for (const mime of ["image/png", "image/jpeg"]) {
    assert.equal(socialSourceEligible(mime, false), true, mime);
  }
  assert.equal(socialSourceEligible("image/webp", false, false), true);
  assert.equal(socialSourceEligible("image/webp", false, true), false);
  assert.equal(socialSourceEligible("image/webp", false), false);
  for (const mime of ["image/gif", "image/avif", "image/heic", undefined]) {
    assert.equal(socialSourceEligible(mime, false), false, mime);
  }
  assert.equal(socialSourceEligible("image/webp", true, true), true);
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
