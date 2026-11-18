import { test } from "node:test";
import assert from "node:assert/strict";

import { socialSourceManifestEntry, sourceFilmPath } from "../src/frontend/image-social-source.ts";

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

test("external URLs, parameters, credentials and nonposter paths cannot enter the manifest", () => {
  for (const poster of [
    "https://elsewhere.example/p/Film_1/poster",
    "//elsewhere.example/p/Film_1/thumb",
    "/p/Film_1/thumb?private=1",
    "/p/Film_1/poster#private",
    "/p/Film_1/media",
  ]) {
    assert.equal(socialSourceManifestEntry({ poster, sourceHash, studioOrigin }), null);
  }
  const poster = "/p/Film_1/thumb";
  assert.equal(socialSourceManifestEntry({ poster, sourceHash: "bad", studioOrigin }), null);
  assert.equal(socialSourceManifestEntry({ poster, sourceHash, studioOrigin: "https://user:secret@studio.example" }), null);
});
