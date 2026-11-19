// MIT. Focused boundary checks for the public Watch page -> local clip tool
// handoff. The page only advertises an eligible publication; the tool fetches
// that publication's own media itself, after an explicit visitor action.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PUBLIC_VIDEO_BYTES,
  publicVideoClipUrl,
  publicVideoFromHash,
  publicVideoRefusal,
  publishedVideoToolUrl,
} from "../src/frontend/video-clip-source.ts";
import { publicPage } from "../src/lib/ui.mjs";

const origin = "https://media.example";
const film = {
  origin,
  slug: "Film_1",
  title: "A public film",
  kind: "video",
  mime: "video/mp4",
  media: "/p/Film_1/media",
  download: "/p/Film_1/download",
  bytes: 40 * 1024 * 1024,
  durationMs: 120_000,
  listed: true,
  publishedAt: 1_760_000_000_000,
};

test("the Watch page hands one exact publication ID to the clip tool", () => {
  const tool = publishedVideoToolUrl("Film_1");
  assert.equal(tool, "/tools/video-clip#public-video=Film_1");
  assert.deepEqual(publicVideoFromHash(new URL(tool, origin).hash), {
    page: "/p/Film_1",
    media: "/p/Film_1/media",
  });
  assert.ok(publicPage(film).includes(`href="${tool}">Clip this video</a>`));
});

test("only public MP4s inside known input limits advertise the handoff", () => {
  assert.ok(publicPage(film).includes("Clip this video"));
  assert.ok(publicVideoClipUrl({ ...film, bytes: MAX_PUBLIC_VIDEO_BYTES, durationMs: 180_000 }));
  for (const change of [
    { kind: "image" },
    { kind: "audio", mime: "audio/mpeg" },
    { mime: "video/webm" },
    { mime: "video/quicktime" },
    { media: "/p/Other/media" },
    { media: "/p/Film_1/download" },
    { slug: "Film_1/media" },
    { bytes: MAX_PUBLIC_VIDEO_BYTES + 1 },
    { bytes: 0 },
    { bytes: null },
    { durationMs: 180_001 },
    { durationMs: -1 },
    { durationMs: "120000" },
  ]) {
    assert.equal(publicVideoClipUrl({ ...film, ...change }), null, JSON.stringify(change));
    assert.doesNotMatch(publicPage({ ...film, ...change }), /Clip this video/, JSON.stringify(change));
  }
});

test("a legacy MP4 can use local duration validation when the stored duration is missing", () => {
  assert.match(publicPage({ ...film, durationMs: null }), /Clip this video/);
  assert.match(publicPage({ ...film, durationMs: undefined }), /Clip this video/);
  assert.match(publicPage({ ...film, durationMs: 0 }), /Clip this video/);
});

test("only the whole single-ID fragment resolves, to the fixed media path", () => {
  for (const hash of [
    "",
    "#public-video=",
    "#public-video=/p/Film_1/media",
    "#public-video=Film_1/media",
    "#public-video=Film_1&public-still=Still_1",
    "#public-video=Film_1#private",
    "#public-video=https://elsewhere.example/p/Film_1/media",
    "#public-video=//elsewhere.example/p/Film_1/media",
    "#public-video=Film_1\n",
    "#public-still=Film_1",
  ]) assert.equal(publicVideoFromHash(hash), null, hash);
  assert.equal(publishedVideoToolUrl("Film_1/media"), null);
  assert.equal(publishedVideoToolUrl("https://elsewhere.example"), null);
  assert.equal(publishedVideoToolUrl(""), null);
});

test("a public response that cannot reuse the picker intake returns a reason", () => {
  assert.equal(publicVideoRefusal({ ok: true, type: "video/mp4", bytes: 1 }), null);
  assert.equal(publicVideoRefusal({ ok: true, type: "video/mp4", bytes: null }), null);
  assert.match(publicVideoRefusal({ ok: false, type: "video/mp4", bytes: 1 }) ?? "", /unavailable/);
  assert.match(publicVideoRefusal({ ok: true, type: "image/png", bytes: 1 }) ?? "", /MP4/);
  assert.match(publicVideoRefusal({ ok: true, type: "video/mp4", bytes: Number.NaN }) ?? "", /128 MB/);
  assert.match(publicVideoRefusal({ ok: true, type: "video/mp4", bytes: MAX_PUBLIC_VIDEO_BYTES + 1 }) ?? "", /128 MB/);
});
