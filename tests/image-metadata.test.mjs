import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ImageMetadataError,
  inspectImage,
  sniffLocalImage,
  stripImageMetadata,
} from "../src/frontend/image-metadata.ts";
import {
  heifFtyp,
  jpegFixture,
  pngFixture,
  concat,
  ascii,
  bytes,
  webpFixture,
} from "./support/image-fixtures.mjs";

const JPEG_SCAN_TAIL = bytes([0x01, 0x02, 0xff, 0x00, 0x03, 0xff, 0xd9]);

test("local sniffing distinguishes active content, HEIC/HEIF and supported images", () => {
  assert.equal(sniffLocalImage(jpegFixture()).mime, "image/jpeg");
  assert.equal(sniffLocalImage(pngFixture()).mime, "image/png");
  assert.equal(sniffLocalImage(webpFixture()).mime, "image/webp");
  assert.deepEqual(
    { mime: sniffLocalImage(heifFtyp("heic")).mime, supported: sniffLocalImage(heifFtyp("heic")).supported },
    { mime: "image/heic", supported: false },
  );
  assert.equal(sniffLocalImage(heifFtyp("mif1", [])).mime, "image/heif");
  assert.equal(sniffLocalImage(heifFtyp("avif", [])).mime, "image/avif");
  const svg = sniffLocalImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"));
  assert.equal(svg.mime, "image/svg+xml");
  assert.equal(svg.activeContent, true);
  assert.equal(svg.supported, false);
  const html = sniffLocalImage(ascii("<!doctype html><html><script>alert(1)</script></html>"));
  assert.equal(html.activeContent, true);
  assert.equal(html.supported, false);
});

test("JPEG EXIF orientation, camera, GPS, XMP and ICC are reported honestly", () => {
  const summary = inspectImage(jpegFixture());
  assert.equal(summary.format, "jpeg");
  assert.deepEqual([summary.width, summary.height], [200, 100]);
  assert.equal(summary.orientation, 6);
  assert.deepEqual([summary.orientedWidth, summary.orientedHeight], [100, 200]);
  assert.equal(summary.exif.present, true);
  assert.deepEqual(summary.camera, { make: "Fixture Camera Co", model: "Local 1" });
  assert.equal(summary.gps, true);
  assert.equal(summary.xmp.present, true);
  assert.equal(summary.icc.present, true);
  assert.equal(summary.alpha, false);
  assert.equal(summary.hasMetadata, true);
});

test("JPEG metadata stripping is lossless and verifies the scan bytes", () => {
  const source = jpegFixture();
  const result = stripImageMetadata(source, { keepColorProfile: false });
  assert.equal(result.format, "jpeg");
  assert.equal(result.verified.pixelsUnchanged, true);
  assert.equal(result.verified.dimensionsMatch, true);
  assert.equal(result.verified.metadataRemoved, true);
  assert.equal(result.verified.all, true);
  assert.ok(result.removed.some((label) => label.startsWith("EXIF")));
  assert.ok(result.removed.includes("XMP"));
  assert.ok(result.removed.includes("ICC profile"));
  assert.equal(result.after.exif.present, true);
  assert.equal(result.after.exif.entries, 1);
  assert.equal(result.after.orientation, 6);
  assert.equal(result.after.camera, null);
  assert.equal(result.after.gps, false);
  assert.equal(result.after.xmp.present, false);
  assert.equal(result.after.icc.present, false);
  assert.deepEqual(result.bytes.subarray(result.bytes.length - JPEG_SCAN_TAIL.length), JPEG_SCAN_TAIL);
  assert.match(result.warning, /colour profile/);
});

test("keeping a JPEG ICC profile is explicit and leaves metadataRemoved true", () => {
  const result = stripImageMetadata(jpegFixture(), { keepColorProfile: true });
  assert.equal(result.after.icc.present, true);
  assert.equal(result.verified.metadataRemoved, true);
  assert.equal(result.verified.all, true);
  assert.equal(result.warning, null);
});

test("PNG chunks are parsed and stripped without touching IDAT bytes", () => {
  const source = pngFixture();
  const summary = inspectImage(source);
  assert.equal(summary.format, "png");
  assert.deepEqual([summary.width, summary.height], [3, 2]);
  assert.equal(summary.alpha, true);
  assert.equal(summary.exif.present, true);
  assert.equal(summary.gps, true);
  assert.equal(summary.text.present, true);
  assert.equal(summary.xmp.present, true);
  assert.equal(summary.icc.present, true);

  const kept = stripImageMetadata(source, { keepColorProfile: true });
  assert.equal(kept.verified.pixelsUnchanged, true);
  assert.equal(kept.verified.dimensionsMatch, true);
  assert.equal(kept.verified.metadataRemoved, true);
  assert.equal(kept.verified.all, true);
  assert.equal(kept.after.exif.present, false);
  assert.equal(kept.after.text.present, false);
  assert.equal(kept.after.xmp.present, false);
  assert.equal(kept.after.icc.present, true);

  const removed = stripImageMetadata(source, { keepColorProfile: false });
  assert.equal(removed.after.icc.present, false);
  assert.equal(removed.verified.all, true);
  assert.match(removed.warning, /colour/);
});

test("PNG corrupt chunks are rejected rather than stripped", () => {
  const source = pngFixture().slice();
  source[45] ^= 0xff;
  assert.throws(() => inspectImage(source), ImageMetadataError);
  assert.throws(() => stripImageMetadata(source), /corrupt/i);
});

test("WebP chunks, alpha and metadata stripping are handled honestly", () => {
  const source = webpFixture();
  const summary = inspectImage(source);
  assert.equal(summary.format, "webp");
  assert.deepEqual([summary.width, summary.height], [120, 80]);
  assert.equal(summary.alpha, true);
  assert.equal(summary.exif.present, true);
  assert.equal(summary.gps, true);
  assert.equal(summary.xmp.present, true);
  assert.equal(summary.icc.present, true);

  const result = stripImageMetadata(source, { keepColorProfile: false });
  assert.equal(result.verified.pixelsUnchanged, true);
  assert.equal(result.verified.dimensionsMatch, true);
  assert.equal(result.verified.metadataRemoved, true);
  assert.equal(result.verified.all, true);
  assert.equal(result.after.exif.present, false);
  assert.equal(result.after.xmp.present, false);
  assert.equal(result.after.icc.present, false);
  assert.equal(result.after.alpha, true);
  assert.match(result.warning, /colour/);
});

test("non-default orientation is retained for PNG and WebP metadata-only copies", () => {
  const png = stripImageMetadata(pngFixture({ orientation: 6 }), { keepColorProfile: true });
  assert.equal(png.after.orientation, 6);
  assert.equal(png.after.exif.entries, 1);
  assert.equal(png.after.gps, false);
  assert.equal(png.verified.all, true);

  const webp = stripImageMetadata(webpFixture({ orientation: 6 }), { keepColorProfile: false });
  assert.equal(webp.after.orientation, 6);
  assert.equal(webp.after.exif.entries, 1);
  assert.equal(webp.after.gps, false);
  assert.equal(webp.verified.all, true);
});

test("truncated or malformed files fail with a clear metadata error", () => {
  assert.throws(() => inspectImage(jpegFixture().subarray(0, 30)), /JPEG|truncated|segment|scan/i);
  assert.throws(() => inspectImage(pngFixture().subarray(0, 20)), /PNG|truncated|chunk/i);
  assert.throws(() => inspectImage(webpFixture().subarray(0, 15)), /WebP|truncated|chunk/i);
  assert.throws(() => inspectImage(ascii("not an image")), ImageMetadataError);
});

test("a file with no removable metadata is reported unchanged", () => {
  const clean = concat(
    bytes([0xff, 0xd8]),
    bytes([0xff, 0xc0, 0x00, 0x0b, 8, 0, 10, 0, 20, 1, 1, 0x11, 0]),
    bytes([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]),
    JPEG_SCAN_TAIL,
  );
  const result = stripImageMetadata(clean);
  assert.equal(result.changed, false);
  assert.deepEqual(result.removed, []);
  assert.equal(result.verified.all, true);
});
