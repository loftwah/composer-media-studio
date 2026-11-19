// MIT. Focused boundary checks for the local Add Music -> Video Clip handoff.
// The caller pins the browser window and origin. This covers the message and file bounds.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_MIX_CHANNEL, MAX_LOCAL_MIX_BYTES, VIDEO_MP4,
  isLocalMixReady, localMixBlobFits, localMixDeliver, localMixReady,
  localMixTokenFromHash, localMixToolUrl, newLocalMixToken, parseLocalMixDeliver,
} from "../src/frontend/local-mix-handoff.ts";

const token = newLocalMixToken();
const mp4 = () => new File([new Uint8Array([0, 1, 2, 3])], "mix-with-music.mp4", { type: VIDEO_MP4 });

test("a one-time token produces exactly one strict same-origin URL and fragment", () => {
  assert.match(token, /^[A-Za-z0-9_-]{16,128}$/);
  const url = localMixToolUrl(token);
  assert.equal(url, `/tools/video-clip#local-mix=${token}`);
  assert.equal(localMixTokenFromHash(new URL(url, "https://media.example").hash), token);
  assert.notEqual(newLocalMixToken(), token);
  for (const bad of ["", "short", "a".repeat(129), "has space", `${token}/p/1`, `${token}&x=1`])
    assert.equal(localMixToolUrl(bad), null, bad);
});

test("only the whole single-token fragment is a handoff", () => {
  for (const hash of [
    "", "#local-mix=", `#local-mix=${token}/media`, `#local-mix=${token}&public-video=Film_1`,
    "#public-video=Film_1", `#local-mix=${token}#x`, `x#local-mix=${token}`,
    `#local-mix=${"a".repeat(129)}`,
  ]) assert.equal(localMixTokenFromHash(hash), null, hash);
});

test("only a bounded MP4 blob can be offered", () => {
  assert.equal(localMixBlobFits(mp4()), true);
  assert.equal(localMixBlobFits({ type: VIDEO_MP4, size: MAX_LOCAL_MIX_BYTES }), true);
  assert.equal(localMixBlobFits({ type: VIDEO_MP4, size: MAX_LOCAL_MIX_BYTES + 1 }), false);
  assert.equal(localMixBlobFits(new File([new Uint8Array([1])], "x.webm", { type: "video/webm" })), false);
  assert.equal(localMixBlobFits(new File([], "x.mp4", { type: VIDEO_MP4 })), false);
});

test("only a ready on the channel with the matching token is accepted", () => {
  assert.equal(isLocalMixReady(localMixReady(token), token), true);
  assert.equal(isLocalMixReady(localMixReady(token), "another-token"), false);
  assert.equal(isLocalMixReady({ channel: LOCAL_MIX_CHANNEL, type: "deliver", token }, token), false);
  assert.equal(isLocalMixReady({ channel: "other", type: "ready", token }, token), false);
  for (const data of [null, "ready", [], { channel: LOCAL_MIX_CHANNEL, type: "ready" }])
    assert.equal(isLocalMixReady(data, token), false);
});

test("a delivery must be one bounded MP4 File for this token", () => {
  const file = mp4();
  const good = localMixDeliver(file, token);
  assert.equal(parseLocalMixDeliver(good, token), file);
  assert.equal(parseLocalMixDeliver(good, "another-token"), null);
  for (const change of [
    { type: "ready" },
    { channel: "other" },
    { file: new Blob([file], { type: VIDEO_MP4 }) },
    { file: new File([file], "x.webm", { type: "video/webm" }) },
    { file: new File([], "x.mp4", { type: VIDEO_MP4 }) },
    { file: { type: VIDEO_MP4, size: MAX_LOCAL_MIX_BYTES + 1 } },
  ]) assert.equal(parseLocalMixDeliver({ ...good, ...change }, token), null, JSON.stringify(change));
  for (const data of [null, "deliver", [], undefined])
    assert.equal(parseLocalMixDeliver(data, token), null);
});
