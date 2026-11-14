// MIT. Focused checks for the public next-step contract and media-aware reuse:
// optional HTTPS destinations, stored still relationships and share metadata.

import { test } from "node:test";
import assert from "node:assert/strict";

import { publicPage } from "../src/lib/ui.mjs";
import {
  extensionForMime,
  publicDestination,
  reuseStillFor,
  sharingDestinations,
} from "../src/lib/sharing.mjs";

const origin = "https://media.loftwah.com";
const slug = "JYCl_dWcb2yqya6h";

function still(overrides = {}) {
  return {
    id: "asset_still",
    kind: "image",
    mime: "image/jpeg",
    title: "The wheel, late light",
    deleted_at: null,
    ...overrides,
  };
}

function video(overrides = {}) {
  return {
    id: "asset_video",
    kind: "video",
    mime: "video/mp4",
    title: "The wheel, in motion",
    parentAssetId: null,
    generationId: null,
    ...overrides,
  };
}

function published(overrides = {}) {
  return publicPage({
    title: "The wheel, <late> light",
    description: "A paper-cut editorial still.",
    kind: "image",
    mime: "image/jpeg",
    width: 1024,
    height: 1280,
    durationMs: null,
    bytes: 700_000,
    media: `/p/${slug}/media`,
    download: `/p/${slug}/download`,
    poster: null,
    origin,
    slug,
    ...overrides,
  });
}

test("public destinations accept plain HTTPS links and fail closed", () => {
  assert.equal(
    publicDestination("https://composer.loftwah.com/init?start=media-studio"),
    "https://composer.loftwah.com/init?start=media-studio",
  );
  assert.equal(publicDestination(" https://example.com/example "), "https://example.com/example");
  assert.equal(publicDestination("http://example.com/"), null);
  assert.equal(publicDestination("javascript:alert(1)"), null);
  assert.equal(publicDestination("data:text/html,<h1>x</h1>"), null);
  assert.equal(publicDestination("https://owner:secret@example.com/"), null);
  assert.equal(publicDestination("https://example.com/has space"), null);
  assert.equal(publicDestination(""), null);
  assert.equal(publicDestination(undefined), null);
  assert.equal(publicDestination(`https://example.com/${"a".repeat(2048)}`), null);
});

test("installation destinations are optional and invalid values are ignored", () => {
  assert.deepEqual(sharingDestinations({}), {
    buildUrl: null,
    storyUrl: null,
    launchKitUrl: null,
  });
  assert.deepEqual(
    sharingDestinations({
      PUBLIC_BUILD_URL: "https://composer.loftwah.com/init?start=media-studio",
      PUBLIC_STORY_URL: "http://composer.loftwah.com/media-studio",
      LAUNCH_KIT_URL: "https://composer-launch-kit.loftwah.workers.dev/",
    }),
    {
      buildUrl: "https://composer.loftwah.com/init?start=media-studio",
      storyUrl: null,
      launchKitUrl: "https://composer-launch-kit.loftwah.workers.dev/",
    },
  );
});

test("a still reuses itself only when it is an importable, live still", () => {
  const asset = still();
  assert.equal(
    reuseStillFor({ asset, assets: [asset] })?.id,
    asset.id,
  );
  assert.equal(reuseStillFor({ asset, assets: [] }), null);
  assert.equal(
    reuseStillFor({ asset: still({ deleted_at: 123 }), assets: [still({ deleted_at: 123 })] }),
    null,
  );
  assert.equal(
    reuseStillFor({ asset: still({ mime: "image/gif" }), assets: [still({ mime: "image/gif" })] }),
    null,
  );
  assert.equal(reuseStillFor({ asset: still({ kind: "video" }), assets: [still({ kind: "video" })] }), null);
});

test("video reuse resolves stored parent, generation reference and published poster in order", () => {
  const parent = still({ id: "asset_parent", title: "Source still" });
  const later = still({ id: "asset_later", title: "Other still" });
  const clip = video({ parentAssetId: parent.id });

  assert.equal(
    reuseStillFor({
      asset: clip,
      assets: [clip, parent, later],
      publications: [{ assetId: clip.id, posterAssetId: later.id }],
    })?.id,
    parent.id,
  );

  const generated = video({
    id: "asset_generated",
    generationId: "gen_1",
  });
  assert.equal(
    reuseStillFor({
      asset: generated,
      assets: [generated, later],
      generations: [{ id: "gen_1", referenceAssetId: later.id }],
    })?.id,
    later.id,
  );

  const publishedClip = video({ id: "asset_published" });
  assert.equal(
    reuseStillFor({
      asset: publishedClip,
      assets: [publishedClip, parent],
      publications: [{ assetId: publishedClip.id, posterAssetId: parent.id }],
    })?.id,
    parent.id,
  );
});

test("video reuse falls through missing, deleted, wrong-kind and cross-project candidates", () => {
  const importable = still({ id: "asset_ok" });
  const deleted = still({ id: "asset_deleted", deleted_at: 123 });
  const wrongKind = video({ id: "asset_wrong" });
  const unsupported = still({ id: "asset_gif", mime: "image/gif" });
  const otherProject = still({ id: "asset_elsewhere" });
  const clip = video({ parentAssetId: "asset_missing" });

  assert.equal(
    reuseStillFor({
      asset: clip,
      assets: [clip, importable, deleted, wrongKind, unsupported],
      publications: [{ assetId: clip.id, posterAssetId: importable.id }],
    })?.id,
    importable.id,
  );
  assert.equal(
    reuseStillFor({
      asset: video({ parentAssetId: otherProject.id }),
      assets: [importable],
    }),
    null,
  );
  assert.equal(
    reuseStillFor({
      asset: video({ id: "asset_other_pub" }),
      assets: [importable],
      publications: [{ assetId: "asset_a_different_video", posterAssetId: otherProject.id }],
    }),
    null,
  );
  assert.equal(
    reuseStillFor({
      asset: video({ parentAssetId: wrongKind.id }),
      assets: [wrongKind, unsupported, deleted],
    }),
    null,
  );
});

test("a published still gives a signed-out visitor the build journey", () => {
  const html = published({
    buildUrl: "https://composer.loftwah.com/init?start=media-studio&ref=public",
    storyUrl: "https://composer.loftwah.com/media-studio",
  });
  assert.match(html, />Build your own Media Studio<\/a>/);
  assert.match(html, /href="https:\/\/composer\.loftwah\.com\/init\?start=media-studio&amp;ref=public"/);
  assert.match(html, />Read how this was made<\/a>/);
  assert.match(html, /href="https:\/\/composer\.loftwah\.com\/media-studio"/);
  assert.match(html, /href="https:\/\/media\.loftwah\.com\/studio">Owner sign-in<\/a>/);
  assert.match(html, /href="https:\/\/media\.loftwah\.com\/gallery">← Back to gallery<\/a>/);
  assert.doesNotMatch(html, /visit the studio/);
  assert.match(html, /<script src="\/theme\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script(?! src="\/theme\.js" defer><\/script>)/);
  assert.match(html, /class="quiet theme-toggle"[^>]* hidden>/);
  assert.match(html, /Download image/);
});

test("an installation without destinations still has a useful page and no dead end", () => {
  const html = published();
  assert.doesNotMatch(html, /Build your own Media Studio/);
  assert.doesNotMatch(html, /Read how this was made/);
  assert.match(html, /href="https:\/\/media\.loftwah\.com\/studio">Owner sign-in<\/a>/);
  assert.match(html, /Download image/);
});

test("share metadata names the poster and never uses video frame dimensions for it", () => {
  const html = published({
    kind: "video",
    mime: "video/mp4",
    width: 1080,
    height: 1920,
    durationMs: 5000,
    poster: `/p/${slug}/poster`,
    posterMime: "image/jpeg",
    posterWidth: 768,
    posterHeight: 960,
  });
  assert.match(html, /property="og:image" content="https:\/\/media\.loftwah\.com\/p\/JYCl_dWcb2yqya6h\/poster"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.match(html, /property="og:image:width" content="768"/);
  assert.match(html, /property="og:image:height" content="960"/);
  assert.match(html, /property="og:image:alt" content="The wheel, &lt;late&gt; light"/);
  assert.match(html, /name="twitter:title" content="The wheel, &lt;late&gt; light"/);
  assert.match(html, /name="twitter:image" content="https:\/\/media\.loftwah\.com\/p\/JYCl_dWcb2yqya6h\/poster"/);
  assert.match(html, /name="twitter:image:alt" content="The wheel, &lt;late&gt; light"/);
  assert.match(html, /property="og:video" content="https:\/\/media\.loftwah\.com\/p\/JYCl_dWcb2yqya6h\/media"/);
  assert.match(html, /property="video:duration" content="5"/);
});

test("a video without a poster has explicit text-only share metadata", () => {
  const html = published({
    kind: "video",
    mime: "video/mp4",
    width: 768,
    height: 960,
    poster: null,
  });
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /name="twitter:image"/);
  assert.match(html, /name="twitter:card" content="summary"/);
  assert.match(html, /name="twitter:title"/);
  assert.match(html, /name="twitter:description"/);
});

test("Launch Kit download filenames match the supported still MIME", () => {
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(extensionForMime("image/png"), "png");
  assert.equal(extensionForMime("image/webp"), "webp");
  assert.equal(extensionForMime("video/mp4"), "bin");
});
