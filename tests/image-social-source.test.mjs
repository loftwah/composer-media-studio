import { test } from "node:test";
import assert from "node:assert/strict";

import {
  publicStillFromHash,
  publishedStillToolUrl,
  socialSourceManifestEntry,
  sourceFilmPath,
  sourceStillPath,
  stillSourceManifestEntry,
} from "../src/frontend/image-social-source.ts";

const sourceHash = "a".repeat(64);
const studioOrigin = "https://studio.example";

test("the source manifest carries the exact film, poster and verified input hash", () => {
  for (const route of ["poster", "thumb"]) {
    const poster = `/p/Film_1/${route}`;
    assert.equal(sourceFilmPath(poster), "/p/Film_1");
    const entry = socialSourceManifestEntry({ poster, sourceHash, studioOrigin });
    assert.equal(entry.name, "source-manifest.json");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(entry.data)), {
      schema: "media-studio/social-source-manifest",
      version: 1,
      source: {
        film: studioOrigin + "/p/Film_1",
        poster: studioOrigin + poster,
        sha256: sourceHash,
      },
    });
  }
});

test("a published still records its public page, media and verified hash", () => {
  const media = "/p/Still_1/media";
  assert.equal(sourceStillPath(media), "/p/Still_1");
  const entry = stillSourceManifestEntry({ media, sourceHash, studioOrigin });
  assert.equal(entry.name, "source-manifest.json");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(entry.data)), {
    schema: "media-studio/still-source-manifest",
    version: 1,
    source: {
      publication: studioOrigin + "/p/Still_1",
      media: studioOrigin + media,
      sha256: sourceHash,
    },
  });
});

test("the native handoff round-trips only one exact publication ID", () => {
  const tool = publishedStillToolUrl("Still_1");
  assert.equal(tool, "/tools/images#public-still=Still_1");
  assert.equal(publicStillFromHash(new URL(tool, studioOrigin).hash), "/p/Still_1/media");
  assert.equal(publishedStillToolUrl("Still_1/media"), null);
  for (const hash of [
    "",
    "#public-still=",
    "#public-still=/p/Still_1/poster",
    "#public-still=/p/Still_1/download",
    "#public-still=/p/Still_1/media?private=1",
    "#public-still=/p/Still_1/media#private",
    "#public-still=https://elsewhere.example/p/Still_1/media",
    "#public-still=//elsewhere.example/p/Still_1/media",
    "#public-still=/p/Still_1/media&public-poster=/p/Film_1/poster",
    "#public-poster=/p/Film_1/poster",
    "#composer-artwork=asset-public-art&revision=" + "a".repeat(64),
    "#public-still=Still_1\n",
    "#public-still=Still_1&public-poster=/p/Film_1/poster",
  ]) assert.equal(publicStillFromHash(hash), null);
});

test("external URLs, parameters, credentials and nonfixed paths cannot enter either manifest", () => {
  for (const poster of [
    "https://elsewhere.example/p/Film_1/poster",
    "//elsewhere.example/p/Film_1/thumb",
    "/p/Film_1/thumb?private=1",
    "/p/Film_1/poster#private",
    "/p/Film_1/media",
  ]) {
    assert.equal(socialSourceManifestEntry({ poster, sourceHash, studioOrigin }), null);
  }
  for (const media of [
    "https://elsewhere.example/p/Still_1/media",
    "//elsewhere.example/p/Still_1/media",
    "/p/Still_1/media?private=1",
    "/p/Still_1/media#private",
    "/p/Still_1/poster",
    "/p/Still_1/download",
  ]) {
    assert.equal(stillSourceManifestEntry({ media, sourceHash, studioOrigin }), null);
  }
  assert.equal(socialSourceManifestEntry({ poster: "/p/Film_1/thumb", sourceHash: "bad", studioOrigin }), null);
  assert.equal(socialSourceManifestEntry({ poster: "/p/Film_1/thumb", sourceHash, studioOrigin: "https://user:secret@studio.example" }), null);
  assert.equal(stillSourceManifestEntry({ media: "/p/Still_1/media", sourceHash: "bad", studioOrigin }), null);
  assert.equal(stillSourceManifestEntry({ media: "/p/Still_1/media", sourceHash, studioOrigin: "https://user:secret@studio.example" }), null);
});
