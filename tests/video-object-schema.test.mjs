// MIT. A single, precise VideoObject slice for listed public watch pages only.
// Required facts come from the publication's own first-publish instant; anything
// unknown or private is omitted rather than guessed. The watch UI is untouched.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.mjs";
import { videoObjectJsonLd } from "../src/lib/ui.mjs";
import { sha256Hex } from "../src/lib/util.mjs";
import { PNG_1x1, addAsset, setup } from "./harness.mjs";

const base = "https://studio.test";
const PUBLISHED_AT = Date.parse("2025-11-17T00:00:00.000Z");

function scripts(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

function oneSchema(html) {
  const found = scripts(html);
  assert.equal(found.length, 1, "exactly one JSON-LD block on a listed watch page");
  return JSON.parse(found[0]);
}

function ldInput(overrides = {}) {
  return {
    kind: "video",
    listed: true,
    title: "A public film",
    description: "Public description",
    poster: "/p/page-video/poster",
    media: "/p/page-video/media",
    mime: "video/mp4",
    publishedAt: PUBLISHED_AT,
    pageUrl: `${base}/p/page-video`,
    ...overrides,
  };
}

async function publishedVideo(env, project, {
  id, slug, listed = 1, hidden = 0, withPoster = true, mime = "video/mp4",
} = {}) {
  // The asset's own date is deliberately different from the publication date.
  const asset = await addAsset(env, project, { id, kind: "video", durationMs: 5000 });
  await env.MEDIA.put(asset.r2_key, Uint8Array.from([0, 1, 2, 3, 4]));
  await env.DB.prepare("UPDATE assets SET mime=?2, bytes=?3, created_at=?4, sha256=?5 WHERE id=?1")
    .bind(asset.id, mime, 5, PUBLISHED_AT - 99_999_999, `sha-${id}`)
    .run();

  let posterAssetId = null;
  if (withPoster) {
    const poster = await addAsset(env, project, { id: `${id}-poster`, kind: "image", source: "upload" });
    const posterSha = await sha256Hex(PNG_1x1);
    await env.MEDIA.put(poster.r2_key, PNG_1x1);
    await env.DB.prepare("UPDATE assets SET mime='image/png', bytes=?2, sha256=?3 WHERE id=?1")
      .bind(poster.id, PNG_1x1.byteLength, posterSha)
      .run();
    posterAssetId = poster.id;
  }

  await env.DB.prepare(
    `INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at)
     VALUES(?1,?2,?3,?4,?5,'A public film','Public description',1,?6,?7,?8,NULL)`,
  ).bind(`pub_${id}`, project.id, asset.id, posterAssetId, slug, PUBLISHED_AT, listed, hidden).run();

  if (withPoster) {
    const posterSha = await sha256Hex(PNG_1x1);
    await env.DB.prepare(
      "INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,source_sha256,created_at) VALUES(?1,'poster',?2,'image/png',?3,1,1,?4,?4,1)",
    ).bind(`pub_${id}`, `${id}-preview`, PNG_1x1.byteLength, posterSha).run();
    await env.MEDIA.put(`${id}-preview`, PNG_1x1);
  }
}

function get(env, path) {
  return worker.fetch(new Request(base + path), env);
}

test("VideoObject requires a listed video, a poster and the authoritative publish instant", () => {
  const schema = JSON.parse(videoObjectJsonLd(ldInput()).replace(/^<script[^>]*>|<\/script>$/g, ""));
  assert.equal(schema["@context"], "https://schema.org");
  assert.equal(schema["@type"], "VideoObject");
  assert.equal(schema.name, "A public film");
  assert.equal(schema.description, "Public description");
  assert.equal(schema.thumbnailUrl, `${base}/p/page-video/poster`);
  assert.equal(schema.uploadDate, new Date(PUBLISHED_AT).toISOString());
  assert.equal(schema.contentUrl, `${base}/p/page-video/media`);
});

test("no markup on unlisted, non-video, posterless or unknown-date pages", () => {
  assert.equal(videoObjectJsonLd(ldInput({ listed: false })), "");
  assert.equal(videoObjectJsonLd(ldInput({ kind: "image" })), "");
  assert.equal(videoObjectJsonLd(ldInput({ kind: "audio" })), "");
  assert.equal(videoObjectJsonLd(ldInput({ poster: null })), "");
  assert.equal(videoObjectJsonLd(ldInput({ title: "  " })), "");
  assert.equal(videoObjectJsonLd(ldInput({ publishedAt: null })), "");
  assert.equal(videoObjectJsonLd(ldInput({ publishedAt: 0 })), "");
  assert.equal(videoObjectJsonLd(ldInput({ publishedAt: "yesterday" })), "");
});

test("only a supported same-origin media route qualifies, with optional description", () => {
  assert.equal(videoObjectJsonLd(ldInput({ mime: "video/quicktime" })), "");
  assert.equal(videoObjectJsonLd(ldInput({ poster: "//outside.example/poster.jpg" })), "");
  const schema = oneSchema(videoObjectJsonLd(ldInput({ description: "" })));
  assert.equal(schema.description, undefined);
  assert.equal(schema.contentUrl, `${base}/p/page-video/media`);
});

test("public strings cannot break out of the JSON-LD script element", () => {
  const hostile = '</script><script>alert("x")</script> & >';
  const tag = videoObjectJsonLd(ldInput({ title: hostile }));
  assert.equal((tag.match(/<\/script>/g) || []).length, 1, "only the real closing tag");
  assert.doesNotMatch(tag, /<\/script><script>/);
  const schema = JSON.parse(tag.replace(/^<script[^>]*>|<\/script>$/g, ""));
  assert.equal(schema.name, hostile);
});

test("a listed public video watch page emits one VideoObject and keeps the watch UI", async () => {
  const { env, project } = await setup();
  await publishedVideo(env, project, { id: "public", slug: "page-video" });

  const response = await get(env, "/p/page-video");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  const html = await response.text();
  const schema = oneSchema(html);

  assert.equal(schema.name, "A public film");
  assert.equal(schema.thumbnailUrl, `${base}/p/page-video/poster`);
  assert.equal(schema.uploadDate, new Date(PUBLISHED_AT).toISOString());
  assert.notEqual(schema.uploadDate, new Date(PUBLISHED_AT - 99_999_999).toISOString(), "never the asset date");
  assert.equal(schema.contentUrl, `${base}/p/page-video/media`);
  assert.equal(schema.contentUrl, (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1]?.replace(/\/?$/, "/media"));

  // The exact public bytes the contentUrl points at are still served unchanged.
  const media = await get(env, "/p/page-video/media");
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "video/mp4");

  // Visible watch UI is unchanged by the additive head markup.
  assert.match(html, /<video controls playsinline preload="metadata"/);
  assert.match(html, /<source src="\/p\/page-video\/media" type="video\/mp4">/);
  assert.match(html, /poster="\/p\/page-video\/poster-preview"/);
});

test("unlisted and hidden video pages carry no markup and keep noindex", async () => {
  const { env, project } = await setup();
  await publishedVideo(env, project, { id: "unlisted", slug: "page-unlisted", listed: 0 });
  await publishedVideo(env, project, { id: "hidden", slug: "page-hidden", listed: 1, hidden: 1 });

  for (const slug of ["page-unlisted", "page-hidden"]) {
    const html = await (await get(env, `/p/${slug}`)).text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.deepEqual(scripts(html), []);
  }
});

test("a listed video with no validated poster emits no markup", async () => {
  const { env, project } = await setup();
  await publishedVideo(env, project, { id: "noposter", slug: "page-noposter", withPoster: false });
  const html = await (await get(env, "/p/page-noposter")).text();
  assert.equal(html.includes('type="application/ld+json"'), false);
  assert.deepEqual(scripts(html), []);
});

test("images and audio never get a VideoObject", async () => {
  const { env, project } = await setup();
  const image = await addAsset(env, project, { id: "image", kind: "image", source: "upload" });
  await env.MEDIA.put(image.r2_key, PNG_1x1);
  await env.DB.prepare("UPDATE assets SET mime='image/png',bytes=?2,sha256=?3 WHERE id=?1")
    .bind(image.id, PNG_1x1.byteLength, await sha256Hex(PNG_1x1)).run();
  await env.DB.prepare(
    "INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,listed,hidden,revoked_at) VALUES('pub_image',?1,?2,'page-image','An image','',1,?3,1,0,NULL)",
  ).bind(project.id, image.id, PUBLISHED_AT).run();

  const html = await (await get(env, "/p/page-image")).text();
  assert.match(html, /<img src="\/p\/page-image\/media"/);
  assert.deepEqual(scripts(html), []);
});
