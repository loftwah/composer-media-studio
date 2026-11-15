// MIT. A paid request that is refused before dispatch says why. The generic
// preflight message hid an Images billing failure and an unusable reference.
import { test } from "node:test";
import assert from "node:assert/strict";

import { preflightFailure } from "../src/lib/darkroom.mjs";

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
