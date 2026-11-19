import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {
  COMPOSER_ARTWORK_DOWNLOAD_API,
  COMPOSER_POST_BRIEF_MAX_BYTES,
  composerArtworkDownloadUrl,
  composerArtworkManifestEntry,
  composerArtworkSourceUrl,
  fetchComposerArtwork,
  parseComposerArtworkHash,
  parseComposerPostBrief,
} from "../src/frontend/composer-artwork.ts";
import { MAX_IMAGE_INPUT_BYTES } from "../src/frontend/image-limits.ts";
import { SOCIAL_POST_LIMITS } from "../src/frontend/image-social-kit.ts";

const assetId = "asset-public-art";
const revision = "a".repeat(64);
const ref = { assetId, revision };
const hash = `#composer-artwork=${assetId}&revision=${revision}`;
const download = `${COMPOSER_ARTWORK_DOWNLOAD_API}?id=${assetId}&file=0&revision=${revision}`;
const signal = new AbortController().signal;

// Mirrors the read-only native v1 producer (share-artwork-post.ts). The caption
// is plain text composed from artwork fields; it may include the canonical URL,
// which the Studio must treat as text and never follow.
const canonical = composerArtworkSourceUrl(ref);
function postBrief(top = {}, art = {}) {
  return {
    schema: "app-composer/public-artwork-post",
    version: 1,
    status: "draft",
    caption: "A plain caption\n\nwith a second line",
    ...top,
    artwork: {
      id: assetId,
      revision,
      title: "Public art",
      canonicalUrl: canonical,
      downloadUrl: download,
      alt: "Plain alt text",
      credit: "Studio",
      sourceUrl: null,
      reuse: "unconfirmed",
      ...art,
    },
  };
}

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
    reuse: "unconfirmed",
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

test("accepts the actual v1 contract for the loaded artwork and follows no URL from it", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("the post brief must not trigger network");
  });
  const caption = `See ${canonical}\n\nA café — original artwork 🎨`;
  const alt = "A plain text alternative";
  const result = parseComposerPostBrief(JSON.stringify(postBrief({ caption }, { alt })), ref);
  assert.deepEqual(result, { ok: true, caption, altText: alt });
  assert.equal(fetch.mock.calls.length, 0);
});

test("rejects a brief for the wrong asset or revision", () => {
  for (const art of [{ id: "asset-other" }, { revision: "b".repeat(64) }]) {
    const result = parseComposerPostBrief(JSON.stringify(postBrief({}, art)), ref);
    assert.equal(result.ok, false);
    assert.match(result.reason, /different artwork or revision/);
  }
});

test("rejects a wrong schema, version, status or reuse state", () => {
  for (const [brief, pattern] of [
    [postBrief({ schema: "other/post-brief" }), /not a Composer post brief/],
    [postBrief({ version: 2 }), /unsupported version/],
    [postBrief({ status: "published" }), /not a draft/],
    [postBrief({}, { reuse: "confirmed" }), /reuse as unconfirmed/],
  ]) {
    const result = parseComposerPostBrief(JSON.stringify(brief), ref);
    assert.equal(result.ok, false);
    assert.match(result.reason, pattern);
  }
});

test("rejects a brief whose canonical or download target differs from the exact builders", () => {
  assert.equal(composerArtworkDownloadUrl(ref), download);
  for (const art of [
    { canonicalUrl: "https://elsewhere.example/artwork" },
    { downloadUrl: `${COMPOSER_ARTWORK_DOWNLOAD_API}?id=${assetId}&file=1&revision=${revision}` },
  ]) {
    const result = parseComposerPostBrief(JSON.stringify(postBrief({}, art)), ref);
    assert.equal(result.ok, false);
    assert.match(result.reason, /different artwork links/);
  }
});

test("rejects malformed, non-object and oversized briefs before any text is used", () => {
  for (const raw of [
    "",
    "{not json",
    "[]",
    "null",
    '"a string"',
    JSON.stringify(postBrief()).padEnd(COMPOSER_POST_BRIEF_MAX_BYTES + 1, " "),
  ]) {
    const result = parseComposerPostBrief(raw, ref);
    assert.equal(result.ok, false);
    assert.ok(result.reason.length > 0);
  }
});

test("enforces the existing social string bounds without silently truncating", () => {
  const longCaption = parseComposerPostBrief(
    JSON.stringify(postBrief({ caption: "a".repeat(SOCIAL_POST_LIMITS.caption + 1) })), ref,
  );
  assert.equal(longCaption.ok, false);
  assert.match(longCaption.reason, /caption is over/);
  const longAlt = parseComposerPostBrief(
    JSON.stringify(postBrief({}, { alt: "b".repeat(SOCIAL_POST_LIMITS.altText + 1) })), ref,
  );
  assert.equal(longAlt.ok, false);
  assert.match(longAlt.reason, /alt text is over/);
  const exact = "First line\nSecond — café 🎨";
  assert.deepEqual(
    parseComposerPostBrief(JSON.stringify(postBrief({ caption: exact }, { alt: exact })), ref),
    { ok: true, caption: exact, altText: exact },
  );
});

test("only the fixed Composer diagnostics reach the artwork recovery message", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  const reference = "f9e7d97c-6b66-4d7c-9244-a3baddf6b9bb";
  const marker = "https://example.invalid/private-body-marker";
  for (const [status, category, request, message, safeReference] of [
    [400, "invalid-request", reference, /could not read this artwork link/, reference],
    [503, "catalogue-unavailable", reference, /catalogue is temporarily unavailable/, reference],
    [502, "file-unavailable", reference, /could not fetch the artwork file/, reference],
    [502, "file-rejected", reference, /refused the artwork file/, reference],
    [504, "file-timeout", reference, /timed out fetching the artwork file/, reference],
    [503, "file-rejected", marker, /could not download the artwork/, null],
    [502, marker, marker, /could not download the artwork/, null],
  ]) {
    fetch.mock.mockImplementationOnce(async () => new Response(marker, {
      status,
      headers: { "x-composer-artwork-failure": category, "x-composer-artwork-request": request },
    }));
    await assert.rejects(fetchComposerArtwork(ref, signal), (error) => {
      assert.match(error.message, message);
      assert.equal(error.reference, safeReference);
      assert.ok(!error.message.includes(marker));
      return true;
    });
  }
});

test("artwork recovery preserves cancellation and hides raw transport errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  const marker = "https://example.invalid/private-body-marker";
  fetch.mock.mockImplementationOnce(async () => { throw new TypeError(marker); });
  await assert.rejects(fetchComposerArtwork(ref, signal), (error) => {
    assert.match(error.message, /could not reach or finish reading/);
    assert.ok(!error.message.includes(marker));
    return true;
  });
  const controller = new AbortController();
  controller.abort(new DOMException("Stopped", "AbortError"));
  fetch.mock.mockImplementationOnce(async () => { throw new TypeError(marker); });
  await assert.rejects(fetchComposerArtwork(ref, controller.signal), { name: "AbortError" });
});
