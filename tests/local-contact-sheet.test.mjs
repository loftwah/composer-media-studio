// MIT. Focused checks for explicit local contact-sheet selections: mixed
// JPEG, PNG and WebP sources keep their order, sniffed MIME and synthetic
// names, while the other PNG-only local command keeps refusing them. No
// browser or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSelections, readLocalImage, readLocalPng } from "../scripts/local-image-workbench.mjs";
import { jpegFixture, pngFixture, webpFixture } from "./support/image-fixtures.mjs";

test("mixed explicit sources keep order, detected MIME and synthetic names", () => {
  const sources = [jpegFixture(), pngFixture(), webpFixture()];
  const selections = localSelections(sources);

  assert.deepEqual(
    selections.map(({ name, mimeType }) => [name, mimeType]),
    [
      ["source-1.jpg", "image/jpeg"],
      ["source-2.png", "image/png"],
      ["source-3.webp", "image/webp"],
    ],
  );
  assert.deepEqual(selections.map(({ buffer }) => buffer), sources);
  for (const { name } of selections) assert.doesNotMatch(name, /[\\/]/);
});

test("a single explicit source uses its detected format too", () => {
  for (const [source, name, mimeType] of [
    [jpegFixture(), "source.jpg", "image/jpeg"],
    [pngFixture(), "source.png", "image/png"],
    [webpFixture(), "source.webp", "image/webp"],
  ]) {
    assert.deepEqual(
      localSelections(source).map(({ name: value, mimeType: type }) => [value, type]),
      [[name, mimeType]],
    );
  }
});

test("the script reader accepts all three formats while the PNG-only reader does not", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-contact-sheet-"));
  try {
    const sources = [["jpeg", jpegFixture()], ["png", pngFixture()], ["webp", webpFixture()]];
    for (const [format, bytes] of sources) {
      const path = join(root, `source.${format}`);
      await writeFile(path, bytes);
      assert.deepEqual(new Uint8Array(await readLocalImage(path)), bytes);
      if (format !== "png") await assert.rejects(readLocalPng(path), /supports PNG inputs/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
