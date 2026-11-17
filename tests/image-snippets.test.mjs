import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SNIPPET_BYTES,
  SNIPPET_KINDS,
  SNIPPET_WARN_BYTES,
  base64ToBytes,
  buildImageSnippets,
  bytesToBase64,
  escapeSnippetText,
} from "../src/frontend/image-snippets.ts";

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

test("base64 matches the standard encoder and round-trips exactly", () => {
  assert.equal(bytesToBase64(PNG_BYTES), Buffer.from(PNG_BYTES).toString("base64"));
  const awkward = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  assert.equal(bytesToBase64(awkward), Buffer.from(awkward).toString("base64"));
  assert.equal(bytesToBase64(awkward), "AAEC/f7/");
  assert.deepEqual([...base64ToBytes(bytesToBase64(awkward))], [...awkward]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(Uint8Array.from([7])))], [7]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(Uint8Array.from([])))], []);
  assert.equal(base64ToBytes("not base64!"), null);
  assert.equal(base64ToBytes("abc"), null);

  const large = new Uint8Array(70_001);
  for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
  const encoded = bytesToBase64(large);
  assert.equal(encoded, Buffer.from(large).toString("base64"));
  assert.deepEqual([...base64ToBytes(encoded)], [...large]);
});

test("snippets use the exact measured bytes and the requested mime", () => {
  const result = buildImageSnippets({
    bytes: PNG_BYTES,
    mime: "image/png",
    filename: "studio-sample.png",
    width: 300,
    height: 200,
  });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, PNG_BYTES.length);
  assert.equal(result.base64Length, Buffer.from(PNG_BYTES).toString("base64").length);
  assert.ok(result.snippets.dataUri.startsWith("data:image/png;base64,"));
  assert.equal(
    result.snippets.dataUri,
    `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`,
  );
  for (const kind of SNIPPET_KINDS) assert.equal(typeof result.snippets[kind], "string");
  assert.match(result.snippets.css, /aspect-ratio: 300 \/ 200;/);
  assert.match(result.snippets.css, /\.image-studio-sample \{/);
  assert.match(result.snippets.css, /data:image\/png;base64,/);
  assert.match(result.snippets.html, /<img src="data:image\/png;base64,/);
  assert.match(result.snippets.html, /width="300" height="200"/);
  assert.match(result.snippets.markdown, /^!\[studio-sample\.png\]\(data:image\/png;base64,/);
  assert.equal(result.warning, null);
  assert.equal(
    base64ToBytes(result.snippets.base64).length,
    PNG_BYTES.length,
    "the snippet decodes back to the same number of bytes",
  );
});

test("filenames cannot inject markup into the snippet", () => {
  const result = buildImageSnippets({
    bytes: PNG_BYTES,
    mime: "image/png",
    filename: '"><script>alert(1)</script>.png',
    width: 10,
    height: 10,
  });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.snippets.html, /<script>/);
  assert.match(result.snippets.html, /&lt;script&gt;/);
  assert.match(result.snippets.html, /&quot;&gt;/);
  assert.equal(escapeSnippetText("a&b<c>\"d'"), "a&amp;b&lt;c&gt;&quot;d&#39;");

  const brackets = buildImageSnippets({
    bytes: PNG_BYTES,
    mime: "image/png",
    filename: "shot]one[two.png",
    width: 10,
    height: 10,
  });
  assert.match(brackets.snippets.markdown, /^!\[shot\\\]one\\\[two\.png\]\(data:/);
  const backslash = buildImageSnippets({
    bytes: PNG_BYTES,
    mime: "image/png",
    filename: String.raw`proof\image.png`,
  });
  assert.ok(backslash.snippets.markdown.startsWith(String.raw`![proof\\image.png](data:`));
});

test("large results warn and oversized ones are refused with a reason", () => {
  const big = new Uint8Array(SNIPPET_WARN_BYTES + 1);
  const warned = buildImageSnippets({ bytes: big, mime: "image/webp", filename: "big.webp" });
  assert.equal(warned.ok, true);
  assert.match(warned.warning, /base64 text is/);
  assert.match(warned.warning, /truncate or reject/);

  const oversized = buildImageSnippets({
    bytes: new Uint8Array(MAX_SNIPPET_BYTES + 1),
    mime: "image/jpeg",
    filename: "huge.jpg",
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /Embed code is limited to 2\.00 MiB/);
});

test("unsupported results are refused instead of mislabelled", () => {
  const gif = buildImageSnippets({ bytes: PNG_BYTES, mime: "image/gif", filename: "x.gif" });
  assert.equal(gif.ok, false);
  assert.match(gif.error, /PNG, JPEG and WebP/);
  const empty = buildImageSnippets({ bytes: new Uint8Array(0), mime: "image/png" });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no encoded bytes/);
});
