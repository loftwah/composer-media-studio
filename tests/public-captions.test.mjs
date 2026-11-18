// MIT. Narrow accessibility proof: a native English caption track resolves only
// for the exact already-public film and media hash, and nowhere else. No writes,
// no provider calls, no network: the reviewed VTT is a typed public source.

import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { PUBLIC_CAPTION_ROUTE, reviewedCaptionFor } from "../src/lib/public-captions.ts";
import { addAsset, setup } from "./harness.mjs";

const base = "https://studio.test";
const SLUG = "PbvQYtyGG-YlF0Dh";
const SHA = "187134b76dc0687d95e263d7b3bb2b7cf6507affb4204e61c2badaeff567d046";
const OTHER_SHA = "0000000000000000000000000000000000000000000000000000000000000000";

// The approved public VTT, kept here as an independent witness so any copy edit
// of the reviewed captions fails this test.
const APPROVED_VTT = `WEBVTT

00:00.000 --> 00:00.600 line:12%
[A sharp click]

00:00.600 --> 00:02.050 line:12%
Bring your AI agent.

00:02.050 --> 00:03.650 line:12%
Build an app.

00:03.850 --> 00:07.700 line:12%
[Power-up chime]
Take it with you.
`;

const TRACK = `<track kind="captions" srclang="en" label="English" src="/p/${SLUG}${PUBLIC_CAPTION_ROUTE}">`;

function get(env, path) {
  return worker.fetch(new Request(base + path), env);
}

async function publish(env, project, { slug, sha, kind = "video", id = "film", revokedAt = null } = {}) {
  const asset = await addAsset(env, project, { id, kind, durationMs: kind === "video" ? 7_700 : null });
  await env.DB.prepare("UPDATE assets SET mime=?2, sha256=?3 WHERE id=?1").bind(
    asset.id,
    kind === "video" ? "video/mp4" : "image/png",
    sha,
  ).run();
  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at)
     VALUES(?1,?2,?3,?4,'Take it with you','',1,?5,1,0,?6)`,
  ).bind(`pub_${id}`, project.id, asset.id, slug, Date.parse("2025-11-17T00:00:00.000Z"), revokedAt).run();
}

test("reviewed captions resolve only for the exact slug and media hash", () => {
  const exact = reviewedCaptionFor(SLUG, SHA);
  assert.ok(exact, "exact public film and hash resolve a track");
  assert.equal(exact, APPROVED_VTT, "approved VTT is served unchanged");

  assert.equal(reviewedCaptionFor(SLUG, OTHER_SHA), null, "same slug, wrong hash: no track");
  assert.equal(reviewedCaptionFor("another-public-slug", SHA), null, "same hash, other slug: no track");
  assert.equal(reviewedCaptionFor(SLUG.toUpperCase(), SHA), null, "slug is case-sensitive");
  assert.equal(reviewedCaptionFor(SLUG, undefined), null, "missing hash: no track");
  assert.equal(reviewedCaptionFor(undefined, SHA), null, "missing slug: no track");
  assert.equal(reviewedCaptionFor(SLUG, SHA.toUpperCase()), null, "hash is case-sensitive");
});

test("the exact published film renders a native caption track, captions off by default", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: SLUG, sha: SHA });

  const html = await (await get(env, `/p/${SLUG}`)).text();
  assert.ok(html.includes(TRACK), "native captions track on the exact film only");
  assert.doesNotMatch(html, /<track[^>]*\bdefault\b/i, "captions are off until the viewer enables them");
  assert.ok(
    html.includes(`<source src="/p/${SLUG}/media" type="video/mp4">${TRACK}`),
    "the track sits inside the existing video, immediately after its source",
  );
  assert.match(html, /<video controls playsinline preload="metadata"/, "existing watch UI is preserved");
});

test("the reviewed VTT is served byte-for-byte on the related public route", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: SLUG, sha: SHA });

  const response = await get(env, `/p/${SLUG}${PUBLIC_CAPTION_ROUTE}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/vtt; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), APPROVED_VTT);
});

test("a wrong media hash yields no track and no caption route", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: SLUG, sha: OTHER_SHA });

  const html = await (await get(env, `/p/${SLUG}`)).text();
  assert.doesNotMatch(html, /<track\b/i, "no track on a hash mismatch");
  assert.equal((await get(env, `/p/${SLUG}${PUBLIC_CAPTION_ROUTE}`)).status, 404);
});

test("the same hash under a different slug is not captioned", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: "another-public-slug", sha: SHA });

  const html = await (await get(env, "/p/another-public-slug")).text();
  assert.doesNotMatch(html, /<track\b/i);
  assert.equal((await get(env, `/p/another-public-slug${PUBLIC_CAPTION_ROUTE}`)).status, 404);
});

test("the withdrawal gate stops the caption route as it stops the page", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: SLUG, sha: SHA, revokedAt: Date.now() });

  assert.equal((await get(env, `/p/${SLUG}`)).status, 404);
  assert.equal((await get(env, `/p/${SLUG}${PUBLIC_CAPTION_ROUTE}`)).status, 404);
});

test("no other asset kind gets an indiscriminate track", async () => {
  const { env, project } = await setup();
  await publish(env, project, { slug: "still-image", sha: SHA, kind: "image", id: "still" });

  const html = await (await get(env, "/p/still-image")).text();
  assert.doesNotMatch(html, /<track\b/i);
  assert.equal((await get(env, `/p/still-image${PUBLIC_CAPTION_ROUTE}`)).status, 404);
});
