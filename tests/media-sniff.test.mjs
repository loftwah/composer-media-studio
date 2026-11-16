import { test } from "node:test";
import assert from "node:assert/strict";

import { extensionFor, sniffMedia } from "../src/lib/util.mjs";
import { heifFtyp } from "./support/image-fixtures.mjs";

test("HEIC and HEIF brands are images, not video/mp4", () => {
  assert.deepEqual(sniffMedia(heifFtyp("heic")), { mime: "image/heic", kind: "image" });
  assert.deepEqual(sniffMedia(heifFtyp("heix", [])), { mime: "image/heic", kind: "image" });
  assert.deepEqual(sniffMedia(heifFtyp("mif1", [])), { mime: "image/heif", kind: "image" });
  assert.deepEqual(sniffMedia(heifFtyp("msf1", [])), { mime: "image/heif", kind: "image" });
  assert.deepEqual(sniffMedia(heifFtyp("avif", [])), { mime: "image/avif", kind: "image" });
  assert.equal(extensionFor("image/heic"), "heic");
  assert.equal(extensionFor("image/heif"), "heif");
});

test("audio and video MP4 brands keep their existing classification", () => {
  assert.deepEqual(sniffMedia(heifFtyp("M4A ", [])), { mime: "audio/mp4", kind: "audio" });
  assert.deepEqual(sniffMedia(heifFtyp("isom", ["isom", "mp41"])), { mime: "video/mp4", kind: "video" });
  assert.deepEqual(sniffMedia(heifFtyp("qt  ", ["qt  "])), { mime: "video/mp4", kind: "video" });
});
