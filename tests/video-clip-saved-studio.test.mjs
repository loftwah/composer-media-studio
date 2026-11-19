// MIT. Focused boundary checks for the private Studio save -> local Video Clip
// handoff. The viewer only advertises one saved asset and its stored digest;
// the tool re-reads that one private file itself, after an explicit click.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SAVED_VIDEO_BYTES,
  fetchPublicVideo,
  fetchSavedStudioVideo,
  savedStudioVideoFromHash,
  savedVideoClipUrl,
} from "../src/frontend/video-clip-source.ts";
import { sha256Hex } from "../src/lib/util.mjs";

const id = "asset_9c507145eaac4ebd9907001db1796085";
const sha = "37374dd4646888c081d19db831599cae345eeb2393724b1e70db25c8bab8a86d";
const fragment = `#studio-video=${id}&sha256=${sha}`;
const tool = `/tools/video-clip${fragment}`;
const saved = { id, sha256: sha, kind: "video", mime: "video/mp4", bytes: 33_000_000, durationMs: 33_000 };

function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = original; });
}

test("the viewer hands one exact saved asset and digest to Video Clip", () => {
  assert.equal(savedVideoClipUrl(saved), tool);
  assert.deepEqual(savedStudioVideoFromHash(new URL(tool, "https://studio.example").hash), {
    id, sha256: sha, media: `/api/assets/${id}/file`,
  });
  // A legacy save with no stored duration still offers Clip: the editor decodes
  // the exact bytes and enforces the 180s limit after the visitor acts.
  for (const durationMs of [null, undefined, 0]) {
    assert.ok(savedVideoClipUrl({ ...saved, durationMs }), String(durationMs));
  }
});

test("a malformed whole fragment never resolves to a fetchable path", () => {
  for (const hash of [
    "", "#studio-video=", fragment.slice(1),
    `#studio-video=${id}`, `#studio-video=${id}&sha256=`,
    `#studio-video=${id}&sha256=${sha}&extra=1`, `${fragment}#x`, `${fragment}\n`, `x${fragment}`,
    `#studio-video=${sha}&sha256=${sha}`, "#studio-video=asset_nothex&sha256=" + sha,
    `#studio-video=${id.toUpperCase()}&sha256=${sha}`, `#studio-video=${id}&sha256=${sha.toUpperCase()}`,
    `#studio-video=${id}&sha256=${sha.slice(0, 63)}`, `#studio-video=${id}&sha256=${sha}a`,
    "#public-video=Film_1", `#studio-video=/api/assets/${id}/file&sha256=${sha}`,
    `#studio-video=https://elsewhere.example/api/assets/${id}/file&sha256=${sha}`,
    `#studio-video=${id}&sha256x=${sha}`, `#studio-video=${id}&SHA256=${sha}`,
  ]) assert.equal(savedStudioVideoFromHash(hash), null, hash);
});

test("a known long or huge save is never advertised", () => {
  assert.ok(savedVideoClipUrl({ ...saved, bytes: MAX_SAVED_VIDEO_BYTES, durationMs: 180_000 }));
  for (const change of [
    { bytes: MAX_SAVED_VIDEO_BYTES + 1 }, { bytes: 0 }, { bytes: null },
    { durationMs: 180_001 }, { durationMs: -1 }, { durationMs: "33000" },
    { kind: "image" }, { mime: "video/webm" },
    { id: id + "a" }, { id: id.slice(0, -1) }, { id: "https://elsewhere.example" },
    { sha256: sha.slice(0, 63) }, { sha256: sha + "a" },
  ]) assert.equal(savedVideoClipUrl({ ...saved, ...change }), null, JSON.stringify(change));
});

test("a signed-out or failed status asks the visitor to reopen the save in Studio", async () => {
  for (const status of [401, 500]) {
    let request;
    const result = await withFetch((url, options) => {
      request = { url, options };
      return new Response(null, { status });
    }, () => fetchSavedStudioVideo(savedStudioVideoFromHash(fragment), new AbortController().signal));
    assert.match(result.reason ?? "", /Studio/i);
    assert.match(result.reason ?? "", /reopen/i);
    assert.equal(request.url, `/api/assets/${id}/file`);
    assert.equal(request.options.mode, "same-origin");
    assert.equal(request.options.credentials, "same-origin");
    assert.equal(request.options.redirect, "error");
    assert.equal(request.options.cache, "no-store");
  }
});

test("wrong content and a lying size never enter the local picker", async () => {
  const wrong = await withFetch(() => new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { "content-type": "text/html" },
  }), () => fetchSavedStudioVideo(savedStudioVideoFromHash(fragment), new AbortController().signal));
  assert.match(wrong.reason ?? "", /MP4/);
  assert.match(wrong.reason ?? "", /Studio/i);
  const huge = await withFetch(() => new Response(null, {
    status: 200, headers: { "content-type": "video/mp4", "content-length": String(MAX_SAVED_VIDEO_BYTES + 1) },
  }), () => fetchSavedStudioVideo(savedStudioVideoFromHash(fragment), new AbortController().signal));
  assert.match(huge.reason ?? "", /64 MB/);
  assert.match(huge.reason ?? "", /Studio/i);
});

test("a malformed source fetches no URL at all", async () => {
  let calls = 0;
  for (const bad of [
    { ...saved, id: "https://elsewhere.example" }, { ...saved, sha256: "nope" },
  ]) {
    const result = await withFetch(() => { calls++; return new Response(null, { status: 200 }); },
      () => fetchSavedStudioVideo(bad, new AbortController().signal));
    assert.match(result.reason ?? "", /Studio/i);
  }
  assert.equal(calls, 0);
});

test("only the exact stored digest becomes a local File", async () => {
  const bytes = new TextEncoder().encode("saved studio video bytes");
  const digest = await sha256Hex(bytes);
  const source = { ...savedStudioVideoFromHash(fragment), sha256: digest };
  const ok = await withFetch(() => new Response(bytes, {
    status: 200, headers: { "content-type": "video/mp4" },
  }), () => fetchSavedStudioVideo(source, new AbortController().signal));
  assert.ok(ok.file);
  assert.equal(ok.file.name, "saved-studio-video.mp4");
  assert.equal(ok.file.type, "video/mp4");
  assert.deepEqual(new Uint8Array(await ok.file.arrayBuffer()), bytes);

  const mismatch = await withFetch(() => new Response(bytes, {
    status: 200, headers: { "content-type": "video/mp4" },
  }), () => fetchSavedStudioVideo({ ...source, sha256: sha }, new AbortController().signal));
  assert.match(mismatch.reason ?? "", /reselect/i);
  assert.match(mismatch.reason ?? "", /digest/i);
  assert.match(mismatch.reason ?? "", /Studio/i);
});

test("the public signed-out read still uses the one bounded helper", async () => {
  const bytes = new TextEncoder().encode("public film bytes");
  let options;
  const ok = await withFetch((url, init) => {
    assert.equal(url, "/p/Film_1/media");
    options = init;
    return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } });
  }, () => fetchPublicVideo({ page: "/p/Film_1", media: "/p/Film_1/media" }, new AbortController().signal));
  assert.ok(ok.file);
  assert.equal(ok.file.name, "Film_1.mp4");
  assert.equal(options.credentials, "omit");
  const huge = await withFetch(() => new Response(null, {
    status: 200, headers: { "content-type": "video/mp4", "content-length": "999999999" },
  }), () => fetchPublicVideo({ page: "/p/Film_1", media: "/p/Film_1/media" }, new AbortController().signal));
  assert.match(huge.reason ?? "", /128 MB/);
});
