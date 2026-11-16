// MIT. One bounded WebP rendition from stored media: the transform both the
// public poster preview and the private library preview rely on.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_PREVIEW_EDGE, previewDimensions, renderPreview } from "../src/lib/preview-rendition.mjs";
import { PNG_1x1 } from "./harness.mjs";

/** A 30-byte VP8X WebP header for the given size; enough to read it back. */
function webp(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x20, 0x00, 0x00, 0x00], 4); // size
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16); // chunk size
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

/** A PNG whose IHDR reports the given size. */
function png(width, height) {
  const bytes = PNG_1x1.slice();
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(16, width);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(20, height);
  return bytes;
}

function fakeImages({ output, failure, onTransform } = {}) {
  return {
    calls: [],
    input(bytes) {
      this.calls.push(bytes);
      return {
        transform(options) {
          onTransform?.(options);
          return {
            output: () => {
              if (failure) throw failure;
              return { response: () => new Response(output ?? webp(320, 200)) };
            },
          };
        },
      };
    },
  };
}

test("previewDimensions scales down and never up", () => {
  assert.deepEqual(previewDimensions(3000, 2000), { width: MAX_PREVIEW_EDGE, height: 683 });
  assert.deepEqual(previewDimensions(800, 1200), { width: 683, height: MAX_PREVIEW_EDGE });
  assert.deepEqual(previewDimensions(640, 480), { width: 640, height: 480 });
  assert.equal(previewDimensions(0, 0), null);
  assert.equal(previewDimensions("640", 480), null);
});

test("renderPreview hands a portrait still to Images by height and returns WebP metadata", async () => {
  let seen;
  const env = { IMAGES: fakeImages({ output: webp(683, 1024), onTransform: (options) => (seen = options) }) };
  const result = await renderPreview(env, png(1200, 1800));
  assert.deepEqual(seen, { height: 1024 });
  assert.equal(result.mime, "image/webp");
  assert.equal(result.width, 683);
  assert.equal(result.height, 1024);
  assert.equal(result.sha256.length, 64);
  assert.ok(result.bytes.byteLength > 0);
});

test("renderPreview measures a landscape source from its own bytes and keeps the long edge", async () => {
  let seen;
  const env = { IMAGES: fakeImages({ output: webp(1024, 512), onTransform: (options) => (seen = options) }) };
  const result = await renderPreview(env, png(4096, 2048));
  assert.deepEqual(seen, { width: 1024 });
  assert.equal(result.width, 1024);
  assert.equal(result.height, 512);
});

test("renderPreview refuses media that is not a still", async () => {
  await assert.rejects(
    renderPreview({ IMAGES: fakeImages() }, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0x81])),
    (error) => error.status === 415,
  );
  await assert.rejects(renderPreview({ IMAGES: fakeImages() }, new Uint8Array()), (error) => error.status === 400);
});

test("renderPreview says what to do when the Images binding is absent or on legacy billing", async () => {
  await assert.rejects(
    renderPreview({}, png(1200, 900)),
    (error) => error.status === 503 && /Images binding is unavailable/.test(error.message),
  );
  await assert.rejects(
    renderPreview({ IMAGES: fakeImages({ failure: { code: 9432 } }) }, png(1200, 900)),
    (error) => error.status === 503 && /legacy billing/.test(error.message),
  );
  await assert.rejects(
    renderPreview({ IMAGES: fakeImages({ failure: new Error("boom") }) }, png(1200, 900)),
    (error) => error.status === 503 && !/boom/.test(error.message),
  );
});

test("renderPreview refuses an empty rendition", async () => {
  await assert.rejects(
    renderPreview({ IMAGES: fakeImages({ output: new Uint8Array() }) }, png(1200, 900)),
    (error) => error.status === 502,
  );
});
