import test from "node:test";
import assert from "node:assert/strict";
import { captionFileFromText } from "../src/frontend/caption-paste.ts";
import { MAX_CAPTION_BYTES } from "../src/frontend/clip-captions.ts";
import { parseCaptionFile } from "../src/frontend/caption-import.ts";

async function bytesOf(result) {
  return new Uint8Array(await result.file.arrayBuffer());
}

test("pasted plain SRT and WebVTT become the same bounded File from the exact entered bytes", async () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello & bye\r\n";
  const srtResult = captionFileFromText(srt);
  assert.ok("file" in srtResult);
  assert.equal(srtResult.file.name, "pasted-captions.srt");
  assert.equal(srtResult.file.type, "application/x-subrip");
  const srtBytes = await bytesOf(srtResult);
  assert.deepEqual(srtBytes, new TextEncoder().encode(srt));
  assert.deepEqual(parseCaptionFile(new TextDecoder().decode(srtBytes), 0, 180_000).map(cue => cue.text), ["Hello & bye"]);

  // Leading BOM or whitespace still follows the importer's WEBVTT sniff.
  const vtt = "\ufeff  WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello &amp; bye\n";
  const vttResult = captionFileFromText(vtt);
  assert.ok("file" in vttResult);
  assert.equal(vttResult.file.name, "pasted-captions.vtt");
  assert.equal(vttResult.file.type, "text/vtt");
  const vttBytes = await bytesOf(vttResult);
  assert.deepEqual(vttBytes, new TextEncoder().encode(vtt));
  assert.deepEqual(parseCaptionFile(new TextDecoder().decode(vttBytes), 0, 180_000).map(cue => cue.text), ["Hello & bye"]);
});

test("empty, whitespace and oversized pasted text are refused before a File exists", () => {
  for (const text of ["", " \n\t "]) {
    const result = captionFileFromText(text);
    assert.ok("problem" in result);
    assert.match(result.problem, /Paste plain SRT or WebVTT text/);
  }
  const over = captionFileFromText("x".repeat(MAX_CAPTION_BYTES + 1));
  assert.ok("problem" in over);
  assert.match(over.problem, /64 KB/);
  // Byte length, not only UTF-16 length, enforces the cap for multibyte text.
  const multibyte = "\u20ac".repeat(Math.ceil(MAX_CAPTION_BYTES / 3) + 1);
  assert.ok(multibyte.length < MAX_CAPTION_BYTES);
  const overBytes = captionFileFromText(multibyte);
  assert.ok("problem" in overBytes);
  assert.match(overBytes.problem, /64 KB/);
  // The exact cap is still accepted; the parser decides whether it is valid.
  assert.ok("file" in captionFileFromText("x".repeat(MAX_CAPTION_BYTES)));
});
