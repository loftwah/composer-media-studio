import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { imageFileFromBase64 } from "../src/frontend/image-base64-input.ts";
import {
  MAX_BASE64_INPUT_CHARACTERS,
  MAX_BASE64_LENGTH,
  MAX_SNIPPET_BYTES,
  base64ToBytes,
  buildImageSnippets,
  bytesToBase64,
} from "../src/frontend/image-snippets.ts";
import {
  ascii,
  jpegFixture,
  pngFixture,
  webpFixture,
} from "./support/image-fixtures.mjs";

function problem(text) {
  const result = imageFileFromBase64(text);
  assert.ok("problem" in result);
  return result.problem;
}

async function fileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

test("generated Base64 and data URI snippets round-trip through neutral Files", async () => {
  const cases = [
    { bytes: pngFixture(), mime: "image/png", extension: "png" },
    { bytes: jpegFixture(), mime: "image/jpeg", extension: "jpg" },
    { bytes: webpFixture(), mime: "image/webp", extension: "webp" },
  ];
  for (const entry of cases) {
    const snippets = buildImageSnippets({ bytes: entry.bytes, mime: entry.mime });
    assert.equal(snippets.ok, true);
    const formatted = snippets.snippets.base64.match(/.{1,32}/g).join("\r\n\t");
    const raw = imageFileFromBase64(` \n${formatted}\t `);
    assert.ok("file" in raw, entry.mime);
    assert.equal(raw.file.name, `pasted-image.${entry.extension}`);
    assert.equal(raw.file.type, entry.mime);
    assert.equal(raw.file.size, entry.bytes.length);
    assert.equal(raw.mime, entry.mime);
    assert.equal(raw.bytes, entry.bytes.length);
    assert.deepEqual(await fileBytes(raw.file), entry.bytes);

    const uri = imageFileFromBase64(
      `\n${snippets.snippets.dataUri.replace(";base64,", ";base64,\r\n\t")}\n`,
    );
    assert.ok("file" in uri, entry.mime);
    assert.equal(uri.file.name, `pasted-image.${entry.extension}`);
    assert.equal(uri.file.type, entry.mime);
    assert.deepEqual(await fileBytes(uri.file), entry.bytes);
  }
});

test("declared MIME must match the bytes and raw input needs a supported signature", () => {
  const png = bytesToBase64(pngFixture());
  assert.match(
    problem(`data:image/jpeg;base64,${png}`),
    /declares image\/jpeg, but the decoded bytes are image\/png/,
  );

  const badPng = pngFixture();
  badPng[0] = 0;
  assert.match(problem(bytesToBase64(badPng)), /not a JPEG, PNG or WebP image/);
  assert.match(problem(bytesToBase64(ascii("not an image"))), /not a JPEG, PNG or WebP image/);
});

test("only canonical standard Base64 with required padding is decoded", () => {
  assert.deepEqual([...base64ToBytes(" T W\nE=\r\n")], [77, 97]);
  assert.deepEqual([...base64ToBytes("TWFu")], [77, 97, 110]);
  for (const value of [
    "TQ",
    "TQ=",
    "T===",
    "=TQ=",
    "TQ=A",
    "TQ==AAAA",
    "TR==",
    "TWF=",
    "TQ--",
    "TQ!!",
    "TQ\u00a0==",
  ]) {
    assert.equal(base64ToBytes(value), null, value);
    assert.match(problem(value), /valid standard Base64/, value);
  }
});

test("decoded bytes and the whole whitespace-inclusive paste are bounded", () => {
  const exact = new Uint8Array(MAX_SNIPPET_BYTES);
  const exactEncoded = bytesToBase64(exact);
  assert.equal(exactEncoded.length, MAX_BASE64_LENGTH);
  assert.equal(base64ToBytes(exactEncoded).length, MAX_SNIPPET_BYTES);

  const oversizedEncoded = bytesToBase64(new Uint8Array(MAX_SNIPPET_BYTES + 1));
  assert.equal(base64ToBytes(oversizedEncoded), null);
  assert.match(problem(oversizedEncoded), /decoded image is limited to 2 MiB/);

  assert.match(
    problem("A".repeat(MAX_BASE64_INPUT_CHARACTERS + 1)),
    /characters, including whitespace/,
  );
  assert.match(
    problem(`${bytesToBase64(pngFixture())}${" ".repeat(MAX_BASE64_INPUT_CHARACTERS)}`),
    /characters, including whitespace/,
  );
});

test("unsupported URIs, external URLs, markup and active content are refused", () => {
  const png = bytesToBase64(pngFixture());
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,PGh0bWw+",
    "data:image/png;charset=utf-8;base64,PHN2Zz4=",
    "data:image/png,PHN2Zz4=",
    "DATA:image/png;base64,PHN2Zz4=",
    `data:image/jpg;base64,${png}`,
  ]) {
    assert.match(problem(value), /exact data:image\/png;base64/, value);
  }
  for (const value of [
    "https://example.com/image.png",
    `![image](data:image/png;base64,${png})`,
    `<img src="data:image/png;base64,${png}">`,
  ]) {
    assert.match(problem(value), /valid standard Base64/, value);
  }
  assert.match(
    problem(bytesToBase64(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))),
    /SVG can contain active content/,
  );
  assert.match(
    problem(bytesToBase64(ascii("<!doctype html><html><script>alert(1)</script></html>"))),
    /HTML is not opened as an image/,
  );
});

test("the intake module has no network, storage or markup-rendering path", () => {
  const source = readFileSync(
    new URL("../src/frontend/image-base64-input.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator.sendBeacon",
    "dangerouslySetInnerHTML",
    "<form",
  ]) {
    assert.ok(!source.includes(forbidden), `the intake must not use ${forbidden}`);
  }
});
