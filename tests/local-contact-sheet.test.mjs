// MIT. Focused checks for explicit local contact-sheet selections: mixed
// JPEG, PNG and WebP sources keep their order, sniffed MIME and synthetic
// names, while the other PNG-only local command keeps refusing them. The
// --columns checks reject bad arguments before Chrome or any file is touched;
// no browser or network is used here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { atlasExpectation, resolveSheetColumns } from "../scripts/local-contact-sheet.mjs";
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

test("the CLI refuses an occupied output before reading sources or launching Chrome", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-output-occupied-"));
  try {
    const output = join(root, "atlas.png");
    const existing = Buffer.from("keep this file");
    await writeFile(output, existing);
    const dangling = join(root, "dangling-atlas.png");
    await symlink(join(root, "missing-target.png"), dangling);
    // Missing sources prove the destination is checked before any source read.
    for (const occupied of [output, dangling]) {
      await assert.rejects(
        run(process.execPath, [
          command, "--sprite-atlas",
          "--source", join(root, "missing-a.png"),
          "--source", join(root, "missing-b.png"),
          "--output", occupied,
        ], { cwd }),
        error => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /output path already exists/i);
          return true;
        },
      );
    }
    assert.deepEqual(await readFile(output), existing);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the atlas expectation uses displayed native dimensions in selection order", () => {
  const first = pngFixture({ width: 3, height: 2 });
  const second = pngFixture({ width: 2, height: 3 });
  const expected = atlasExpectation([first, second], "auto");
  assert.deepEqual(expected.sizes, [{ width: 3, height: 2 }, { width: 2, height: 3 }]);
  assert.deepEqual(expected.layout, { count: 2, columns: 2, cellWidth: 3, cellHeight: 3, width: 6, height: 3 });

  const oneColumn = atlasExpectation([first, second], 1);
  assert.deepEqual(oneColumn.layout, { count: 2, columns: 1, cellWidth: 3, cellHeight: 3, width: 3, height: 6 });
});

test("the atlas expectation measures the displayed size of an oriented PNG", () => {
  const rotated = pngFixture({ width: 3, height: 2, orientation: 6 });
  const expected = atlasExpectation([rotated, rotated], "auto");
  assert.deepEqual(expected.sizes, [{ width: 2, height: 3 }, { width: 2, height: 3 }]);
  assert.equal(expected.layout.cellWidth, 2);
  assert.equal(expected.layout.cellHeight, 3);
});

test("the atlas expectation refuses non-PNG and over-bound selections before Chrome", () => {
  assert.throws(() => atlasExpectation([jpegFixture(), pngFixture()], "auto"), /PNG/);
  const huge = pngFixture({ width: 9000, height: 2 });
  assert.throws(() => atlasExpectation([huge, huge], 2), /8192 px on each side/);
});

test("the CLI atlas mode refuses a non-PNG before Chrome or any output is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-atlas-invalid-"));
  try {
    const first = join(root, "first.png");
    const second = join(root, "second.png");
    const output = join(root, "atlas.png");
    await writeFile(first, pngFixture());
    await writeFile(second, jpegFixture());
    await assert.rejects(
      run(process.execPath, [
        command, "--sprite-atlas", "--source", first, "--source", second, "--output", output,
      ], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /supports PNG inputs/);
        return true;
      },
    );
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the atlas path drives the canonical workbench mode and validates the sibling layout", async () => {
  const source = await readFile(new URL("../scripts/local-contact-sheet.mjs", import.meta.url), "utf8");
  assert.match(source, /selectOption\("max-long-edge"\)/);
  assert.match(source, /getByLabel\("Maximum long edge \(px\)"/);
  assert.match(source, /name: "Sheet mode", exact: true \}\)\.selectOption\("sprite-atlas"\)/);
  assert.match(source, /spriteAtlas \? "Atlas columns" : "Contact sheet columns"/);
  assert.match(source, /name: label, exact: true \}\)\.selectOption/);
  assert.match(source, /name: "Make sprite atlas"/);
  assert.match(source, /name: "Download sprite atlas PNG"/);
  assert.match(source, /name: "Download atlas layout JSON"/);
  assert.match(source, /ATLAS_LAYOUT_SCHEMA/);
  assert.match(source, /ATLAS_LAYOUT_VERSION/);
  assert.match(source, /atlasPlacement\(expected, index, size\.width, size\.height\)/);
  assert.match(source, /layout\.sheet\?\.sha256, receipt\.output\.sha256/);
  assert.match(source, /spriteAtlas \? \{ mode: "sprite-atlas" \} : \{\}/);
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
