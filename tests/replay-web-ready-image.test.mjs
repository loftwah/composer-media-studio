// Focused checks for the local social receipt replay: an explicit PNG claim
// selects PNG, WebP stays the default, and invalid MIME or sizing is rejected.
// No browser, encoder, network or Studio account needed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SOCIAL_SIZES } from "../src/frontend/image-social-kit.ts";
import {
  assertSocialReproducible,
  socialFormatForReceipt,
} from "../scripts/replay-web-ready-image.mjs";

const STORY = SOCIAL_SIZES.find((size) => size.key === "story");

const SETTINGS = Object.freeze({
  resizeMode: "exact",
  longEdge: 1600,
  exactWidth: STORY.width,
  exactHeight: STORY.height,
  cropAspect: "tall",
  cropAnchor: "bottomRight",
  rotate: 0,
  flipH: false,
  flipV: false,
  straighten: 0,
  resample: "bilinear",
  adjust: {exposure: 0, contrast: 0},
  format: "webp",
  quality: 0.82,
  targetKiB: null,
  matte: null,
});

function receipt({format = "webp", mime, width = STORY.width, height = STORY.height} = {}) {
  return {
    schema: "media-studio/image-receipt",
    version: 1,
    source: {sha256: "b".repeat(64)},
    transform: {plan: {ok: true}, settings: {...SETTINGS, format}},
    output: {
      width,
      height,
      mime: mime ?? (format === "png" ? "image/png" : "image/webp"),
      bytes: 123456,
      sha256: "a".repeat(64),
    },
  };
}

test("an explicit PNG receipt selects PNG and passes an identical replay", () => {
  const expected = receipt({format: "png"});
  assert.equal(socialFormatForReceipt(expected, STORY), "png");
  assert.doesNotThrow(() => assertSocialReproducible(expected, structuredClone(expected), STORY, "png"));
});

test("the default WebP receipt stays WebP and passes an identical replay", () => {
  const expected = receipt();
  assert.equal(socialFormatForReceipt(expected, STORY), "webp");
  assert.doesNotThrow(() => assertSocialReproducible(expected, structuredClone(expected), STORY, "webp"));
});

test("an unsupported or missing claimed MIME is rejected", () => {
  for (const mime of ["image/jpeg", "image/avif", "text/html", "toString", "__proto__"]) {
    const expected = receipt();
    expected.output.mime = mime;
    assert.throws(
      () => socialFormatForReceipt(expected, STORY),
      /Unsupported social kit output MIME/,
    );
  }
  const missing = receipt();
  delete missing.output.mime;
  assert.throws(
    () => socialFormatForReceipt(missing, STORY),
    /Unsupported social kit output MIME/,
  );
});

test("a format setting that contradicts the claimed MIME is rejected", () => {
  assert.throws(
    () => socialFormatForReceipt(receipt({format: "webp", mime: "image/png"}), STORY),
    /format setting does not match output MIME/,
  );
  assert.throws(
    () => socialFormatForReceipt(receipt({format: "png", mime: "image/webp"}), STORY),
    /format setting does not match output MIME/,
  );
});

test("claimed sizing that does not match the selected size is rejected", () => {
  assert.throws(
    () => socialFormatForReceipt(receipt({width: 1920}), STORY),
    /Receipt width does not match story/,
  );
  assert.throws(
    () => socialFormatForReceipt(receipt({height: 1350}), STORY),
    /Receipt height does not match story/,
  );
  const bad = receipt({width: 1920});
  assert.throws(
    () => assertSocialReproducible(bad, structuredClone(bad), STORY, "webp"),
    /output dimensions or format/,
  );
});

test("a differing setting is reported by field and format-specific MIME is checked", () => {
  const expected = receipt({format: "png"});
  const actual = structuredClone(expected);
  actual.transform.settings.cropAnchor = "topLeft";
  assert.throws(
    () => assertSocialReproducible(expected, actual, STORY, "png"),
    /settings\.cropAnchor/,
  );
  const wrongClaim = receipt({format: "png"});
  wrongClaim.output.mime = "image/webp";
  assert.throws(
    () => assertSocialReproducible(wrongClaim, structuredClone(wrongClaim), STORY, "png"),
    /output dimensions or format/,
  );
});
