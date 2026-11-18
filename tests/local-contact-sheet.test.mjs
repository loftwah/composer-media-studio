// MIT. Focused checks for explicit local contact-sheet selections: mixed
// JPEG, PNG and WebP sources keep their order, sniffed MIME and synthetic
// names, while the other PNG-only local command keeps refusing them. The
// --columns checks reject bad arguments before Chrome or any file is touched;
// no browser or network is used here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveSheetColumns } from "../scripts/local-contact-sheet.mjs";
import { localSelections, readLocalImage, readLocalPng } from "../scripts/local-image-workbench.mjs";
import { jpegFixture, pngFixture, webpFixture } from "./support/image-fixtures.mjs";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const command = "scripts/local-contact-sheet.mjs";

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

test("omitting --columns stays Auto while explicit values are bounded 1..4", () => {
  assert.equal(resolveSheetColumns(undefined), "auto");
  for (const value of [1, 2, 3, 4]) assert.equal(resolveSheetColumns(String(value)), value);
  for (const bad of ["0", "5", "9", "auto", "", "1.5", "-1", "+2", " 2 ", "2px"]) {
    assert.throws(() => resolveSheetColumns(bad), /--columns.*1 to 4/, JSON.stringify(bad));
  }
});

test("the CLI refuses an invalid --columns before Chrome or any output is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-columns-invalid-"));
  try {
    const first = join(root, "first.png");
    const second = join(root, "second.png");
    const output = join(root, "sheet.png");
    await writeFile(first, pngFixture());
    await writeFile(second, pngFixture());
    await assert.rejects(
      run(process.execPath, [
        command, "--source", first, "--source", second, "--output", output, "--columns", "9",
      ], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /--columns.*1 to 4/);
        return true;
      },
    );
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI refuses a --columns with no value before Chrome or any output is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-columns-missing-"));
  try {
    const first = join(root, "first.png");
    const second = join(root, "second.png");
    const output = join(root, "sheet.png");
    await writeFile(first, pngFixture());
    await writeFile(second, pngFixture());
    await assert.rejects(
      run(process.execPath, [
        command, "--source", first, "--source", second, "--output", output, "--columns",
      ], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /columns/i);
        return true;
      },
    );
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
