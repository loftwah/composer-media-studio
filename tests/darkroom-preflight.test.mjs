// MIT. A paid request that is refused before dispatch says why, and a reference
// that already satisfies the model's catalogue rule does not need Images.
import { test } from "node:test";
import assert from "node:assert/strict";

import { preflightFailure, referenceFitsModel } from "../src/lib/darkroom.mjs";

const detail = { id: "studio-detail", references: 1 };

function withName(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("a legacy Images billing failure names the real cause", () => {
  const error = withName("ImagesError", "not available using legacy billing (9432)");
  const mapped = preflightFailure(error);
  assert.equal(mapped.status, 503);
  assert.equal(mapped.code, "provider_billing");
  assert.match(mapped.message, /legacy billing/);
  assert.equal(mapped.definitive, true);
});

test("a refused reference keeps the package's fixed reason", () => {
  const mapped = preflightFailure(withName("MediaSettingsError", "reference image is not a supported image"));
  assert.equal(mapped.status, 400);
  assert.equal(mapped.code, "reference_invalid");
  assert.match(mapped.message, /reference image is not a supported image/);
});

test("an unknown preflight error stays generic and marks no dispatch", () => {
  const mapped = preflightFailure(withName("Error", "some internal detail"));
  assert.equal(mapped.status, 502);
  assert.equal(mapped.code, "provider_preflight");
  assert.match(mapped.message, /No image request was sent/);
  assert.equal(JSON.stringify(mapped.message).includes("internal detail"), false);
});

test("a reference inside the catalogue rule needs no Images transform", () => {
  // Studio Detail's Darkroom model fits references to 512 px PNG.
  assert.equal(referenceFitsModel(detail, { width: 410, height: 512, format: "png" }), true);
  assert.equal(referenceFitsModel(detail, { width: 256, height: 256, format: "png" }), true);
  // Anything larger, or in another encoding, still needs the fitter.
  assert.equal(referenceFitsModel(detail, { width: 1024, height: 1280, format: "png" }), false);
  assert.equal(referenceFitsModel(detail, { width: 512, height: 640, format: "png" }), false);
  assert.equal(referenceFitsModel(detail, { width: 410, height: 512, format: "jpeg" }), false);
  assert.equal(referenceFitsModel(detail, null), false);
  assert.equal(referenceFitsModel({ id: "studio-draft", references: 0 }, { width: 512, height: 512, format: "png" }), false);
});
