import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {
  COMPOSER_ARTWORK_DOWNLOAD_API,
  composerArtworkManifestEntry,
  fetchComposerArtwork,
  parseComposerArtworkHash,
} from "../src/frontend/composer-artwork.ts";
import { MAX_IMAGE_INPUT_BYTES } from "../src/frontend/image-limits.ts";

const assetId = "asset-public-art";
const revision = "a".repeat(64);
const ref = { assetId, revision };
const hash = `#composer-artwork=${assetId}&revision=${revision}`;
const download = `${COMPOSER_ARTWORK_DOWNLOAD_API}?id=${assetId}&file=0&revision=${revision}`;
const signal = new AbortController().signal;

test("accepts only a single exact artwork reference", () => {
  assert.deepEqual(parseComposerArtworkHash(hash), ref);
  for (const invalid of [
    "",
    hash.replace(assetId, "asset_public"),
    hash.replace(assetId, "%61sset-public-art"),
    hash.replace(assetId, "https://elsewhere.example/image"),
    hash.replace(revision, "A".repeat(64)),
    hash.replace(revision, "b".repeat(65)),
    hash + "&other=1",
    hash + "\n",
  ]) assert.equal(parseComposerArtworkHash(invalid), null);
});

test("fetches only the public rendition without cookies and records the source hash", async (t) => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(bytes, {
    headers: { "content-type": "image/jpeg" },
  }));
  const file = await fetchComposerArtwork(ref, signal);
  assert.deepEqual(fetch.mock.calls[0].arguments, [download, {
    mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal,
  }]);
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, `${assetId}.jpg`);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  const entry = composerArtworkManifestEntry(ref, "b".repeat(64));
  assert.equal(entry.name, "source-manifest.json");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(entry.data)), {
    schema: "media-studio/composer-artwork",
    version: 1,
    source: `https://composer.loftwah.com/share/artwork/${assetId}`,
    download,
    asset: assetId,
    revision,
    sha256: "b".repeat(64),
  });
});

test("stale, unpublished and unusable responses provide actionable feedback", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  for (const [response, recovery] of [
    [new Response(null, { status: 409 }), /Reopen it in Composer/],
    [new Response(null, { status: 404 }), /no longer available/],
    [new Response("<html>"), /JPEG, PNG or WebP/],
  ]) {
    fetch.mock.mockImplementationOnce(async () => response);
    await assert.rejects(fetchComposerArtwork(ref, signal), recovery);
  }
});

test("declared and streamed image limits both cancel the body", async (t) => {
  let cancellations = 0;
  const fetch = t.mock.method(globalThis, "fetch");
  for (const declared of [true, false]) {
    fetch.mock.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(declared ? 1 : MAX_IMAGE_INPUT_BYTES + 1));
      },
      cancel() { cancellations += 1; },
    }), {
      headers: {
        "content-type": "image/png",
        ...(declared ? { "content-length": String(MAX_IMAGE_INPUT_BYTES + 1) } : {}),
      },
    }));
    await assert.rejects(fetchComposerArtwork(ref, signal), /exceeds the image size limit/);
  }
  assert.equal(cancellations, 2);
});

test("only the image tools may connect to the exact Composer download path", async () => {
  for (const [path, expected] of [
    ["/tools/images", `connect-src 'self' ${COMPOSER_ARTWORK_DOWNLOAD_API}`],
    ["/watch", "connect-src 'self'"],
  ]) {
    const response = await worker.fetch(new Request(`https://media.loftwah.com${path}`), {}, {});
    const connect = response.headers.get("content-security-policy")?.split("; ").find((part) => part.startsWith("connect-src"));
    assert.equal(connect, expected);
  }
});
