// MIT. Focused checks for the checked gallery card renderer shared by the
// catalogue, home gallery, curated films and related-work strip.
import assert from "node:assert/strict";
import { test } from "node:test";

import { galleryCards, galleryDimensions } from "../src/lib/gallery-cards.ts";
import { publicGallery } from "../src/lib/ui.mjs";

test("card previews keep the stored-preview precedence and honest no-preview fallback", () => {
  const items = [
    { slug: "thumb", kind: "image", title: "Thumb", thumb_id: "t", thumb_width: 320, thumb_height: 240, width: 1600, height: 900 },
    { slug: "page_preview", kind: "video", title: "Preview", poster_preview_id: "p", poster_preview_width: 640, poster_preview_height: 360, poster_asset_id: "poster" },
    { slug: "poster", kind: "video", title: "Poster", poster_asset_id: "poster", poster_width: 1280, poster_height: 720 },
    { slug: "original", kind: "image", title: "Original", width: 1024, height: 768 },
    { slug: "sound", kind: "audio", title: "Sound" },
    { slug: "film", kind: "video", title: "Film" },
  ];
  const html = galleryCards(items);
  assert.match(html, /src="\/p\/thumb\/thumb" alt="" width="320" height="240" loading="lazy" decoding="async"/);
  assert.match(html, /src="\/p\/page_preview\/poster-preview" alt="" width="640" height="360"/);
  assert.match(html, /src="\/p\/poster\/poster" alt="" width="1280" height="720"/);
  assert.match(html, /src="\/p\/original\/media" alt="" width="1024" height="768"/);
  assert.match(html, /class="gallery-placeholder"><span>Listen<\/span><strong>Sound<\/strong><span aria-hidden="true">↗<\/span>/);
  assert.match(html, /class="gallery-placeholder"><span>Watch<\/span><strong>Film<\/strong>/);
  assert.match(html, />View image →</);
  assert.match(html, />Watch film →</);
  assert.match(html, />Listen →</);
});

test("card links encode the slug and carry the filtered browsing context back", () => {
  const items = [{ slug: "a film/ü", kind: "video", title: "Film & film" }];
  const plain = galleryCards(items);
  assert.ok(plain.includes('href="/p/a%20film%2F%C3%BC"'), plain);
  assert.doesNotMatch(plain, /back=/);
  const options = { query: "night signal", kind: "video", project: "alpha", capability: "assembled", order: "oldest", page: 2 };
  const filtered = galleryCards(items, options);
  assert.match(filtered, /href="\/p\/a%20film%2F%C3%BC\?back=%2Fgallery%3Fq%3Dnight%2Bsignal%26project%3Dalpha%26kind%3Dvideo%26capability%3Dassembled%26order%3Doldest%26page%3D2"/);
  assert.ok(publicGallery({ items, ...options, total: 1 }).includes(filtered), "the renderer stays shared with publicGallery");
});

test("card copy escapes authored text while shortening only the card's source URLs", () => {
  const description = 'A study. Source: https://woodhouse.example/api/assets/a.png! Keep <this> & "that".';
  const html = galleryCards([{ slug: "still", kind: "image", title: 'A <still> & "quote"', description }]);
  assert.match(html, /<strong>A &lt;still&gt; &amp; &quot;quote&quot;<\/strong>/);
  assert.match(html, /Source: see the work page! Keep &lt;this&gt; &amp; &quot;that&quot;\./);
  assert.doesNotMatch(html, /https:\/\/woodhouse\.example/);
});

test("dimensions use only positive safe integers, matching the former renderer", () => {
  assert.equal(galleryDimensions(320, 240), ' width="320" height="240"');
  assert.equal(galleryDimensions(0, 240), "");
  assert.equal(galleryDimensions(320, -1), "");
  assert.equal(galleryDimensions(12.5, 7.5), "");
  assert.equal(galleryDimensions("320", "240"), "");
  assert.equal(galleryDimensions(Number.MAX_SAFE_INTEGER + 1, 100), "");
  assert.equal(galleryDimensions(null, undefined), "");
  const html = galleryCards([{ slug: "edge", kind: "image", title: "Edge", thumb_id: "t", thumb_width: 0, thumb_height: -1 }]);
  assert.match(html, /src="\/p\/edge\/thumb" alt="" loading="lazy"/);
  assert.doesNotMatch(html, /width="0"/);
});
