import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_RECEIPT_SCHEMA,
  IMAGE_RECEIPT_VERSION,
  buildImageReceipt,
} from "../src/frontend/image-receipt.ts";

const SOURCE_HASH = "b".repeat(64);

function makeResult(overrides = {}) {
  return {
    plan: {
      ok: true,
      sourceWidth: 1600,
      sourceHeight: 1200,
      rotate: 1,
      flipH: false,
      flipV: false,
      rotatedWidth: 1200,
      rotatedHeight: 1600,
      straighten: null,
      crop: { x: 0, y: 0, width: 1200, height: 1600 },
      outputWidth: 1200,
      outputHeight: 1600,
      scaleX: 1,
      scaleY: 1,
      aspectDistorted: false,
      upscaled: false,
    },
    settings: {
      resizeMode: "long-edge",
      longEdge: 1600,
      exactWidth: 1600,
      exactHeight: 1200,
      cropAspect: "original",
      cropAnchor: "centre",
      rotate: 1,
      flipH: false,
      flipV: false,
      straighten: 0,
      resample: "smooth",
      adjust: { exposure: 0, contrast: 0 },
      format: "webp",
      quality: 0.82,
      targetKiB: null,
      matte: "#ffffff",
    },
    width: 1200,
    height: 1600,
    mime: "image/webp",
    bytes: 98765,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

test("receipt has the exact compact, versioned shape from the completed render", () => {
  const result = makeResult();
  const receipt = buildImageReceipt({ sourceHash: SOURCE_HASH, result });

  assert.deepEqual(Object.keys(receipt), [
    "schema",
    "version",
    "note",
    "source",
    "transform",
    "output",
  ]);
  assert.equal(receipt.schema, IMAGE_RECEIPT_SCHEMA);
  assert.equal(receipt.version, IMAGE_RECEIPT_VERSION);
  assert.equal(typeof receipt.note, "string");
  assert.deepEqual(receipt.source, { sha256: SOURCE_HASH });
  assert.deepEqual(receipt.transform, { plan: result.plan, settings: result.settings });
  assert.deepEqual(receipt.output, {
    width: 1200,
    height: 1600,
    mime: "image/webp",
    bytes: 98765,
    sha256: "a".repeat(64),
  });
});

test("receipt carries no raw bytes, filename, EXIF, private data or status guesses", () => {
  const result = makeResult();
  result.blob = new Uint8Array([1]);
  result.settings.filename = "private-file.webp";
  const receipt = buildImageReceipt({ sourceHash: SOURCE_HASH, result });
  const keys = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      if (
        child instanceof Uint8Array ||
        child instanceof ArrayBuffer ||
        (typeof Blob !== "undefined" && child instanceof Blob)
      )
        assert.fail(`receipt must not carry raw bytes under ${key}`);
      collect(child);
    }
  };
  collect(receipt);

  for (const banned of ["blob", "url", "file", "filename", "path", "exif", "orientation", "status", "buffer"])
    assert.equal(keys.includes(banned), false, `receipt must not contain ${banned}`);

  assert.match(receipt.note, /completed local render/i);
  assert.doesNotMatch(JSON.stringify(receipt), /private-file/);
});

test("receipt is bound to the completed render snapshot, not later editor edits", () => {
  const first = makeResult();
  const afterEdits = makeResult({
    sha256: "c".repeat(64),
    mime: "image/png",
    width: 800,
    height: 600,
    bytes: 1234,
    settings: { ...first.settings, format: "png", quality: 0.4 },
  });

  const firstReceipt = buildImageReceipt({ sourceHash: SOURCE_HASH, result: first });
  const secondReceipt = buildImageReceipt({ sourceHash: SOURCE_HASH, result: afterEdits });

  assert.equal(firstReceipt.output.sha256, "a".repeat(64));
  assert.equal(firstReceipt.output.mime, "image/webp");
  assert.equal(firstReceipt.transform.settings.quality, 0.82);
  assert.equal(secondReceipt.output.sha256, "c".repeat(64));
  assert.equal(secondReceipt.output.mime, "image/png");
  assert.equal(secondReceipt.transform.settings.quality, 0.4);
  assert.notDeepEqual(firstReceipt, secondReceipt);
});
