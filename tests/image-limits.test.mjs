import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BATCH_IMAGES,
  MAX_IMAGE_INPUT_BYTES,
  batchCountProblem,
  imageInputProblem,
  imagePixelProblem,
} from "../src/frontend/image-limits.mjs";

test("local image inputs are capped at 32 MiB and the accepted formats", () => {
  assert.equal(MAX_IMAGE_INPUT_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_BATCH_IMAGES, 20);
  assert.equal(imageInputProblem({ name: "photo.jpg", type: "image/jpeg", size: 1000 }), null);
  assert.equal(imageInputProblem({ name: "photo.png", type: "image/png", size: 1000 }), null);
  assert.equal(imageInputProblem({ name: "photo.webp", type: "image/webp", size: 1000 }), null);
  assert.equal(imageInputProblem({ name: "photo.jpg", type: "", size: 1000 }), null);
  assert.match(imageInputProblem({ name: "huge.jpg", type: "image/jpeg", size: MAX_IMAGE_INPUT_BYTES + 1 }), /32 MiB/);
  assert.match(imageInputProblem({ name: "empty.png", type: "image/png", size: 0 }), /empty/i);
});

test("active content and unsupported image containers are refused honestly", () => {
  assert.match(imageInputProblem({ name: "logo.svg", type: "image/svg+xml", size: 100 }), /active content/i);
  assert.match(imageInputProblem({ name: "page.html", type: "text/html", size: 100 }), /active content/i);
  assert.match(imageInputProblem({ name: "photo.heic", type: "image/heic", size: 100 }), /HEIC and HEIF/);
  assert.match(imageInputProblem({ name: "photo.heif", type: "image/heif", size: 100 }), /HEIC and HEIF/);
  assert.match(imageInputProblem({ name: "photo.avif", type: "image/avif", size: 100 }), /AVIF/);
  assert.match(imageInputProblem({ name: "anim.gif", type: "image/gif", size: 100 }), /not GIF/);
  assert.match(imageInputProblem({ name: "scan.tiff", type: "image/tiff", size: 100 }), /not TIFF/);
  assert.match(imageInputProblem({ name: "clip.mp4", type: "video/mp4", size: 100 }), /not video\/mp4/);
});

test("decoded pixels are bounded independently of input bytes", () => {
  assert.equal(imagePixelProblem(8000, 5000), null);
  assert.match(imagePixelProblem(16385, 100), /16384/);
  assert.match(imagePixelProblem(8000, 6000), /40 megapixels/);
  assert.match(imagePixelProblem(0, 10), /dimensions/);
  assert.match(imagePixelProblem(10.5, 10), /dimensions/);
});

test("a batch is bounded to twenty files", () => {
  assert.equal(batchCountProblem(1), null);
  assert.equal(batchCountProblem(20), null);
  assert.match(batchCountProblem(21), /20 images/);
  assert.match(batchCountProblem(0), /at least one/);
});
