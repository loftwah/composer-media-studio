// MIT. Focused checks for the explicit-file metadata strip command: the
// existing rewrite keeps the ICC profile and image bytes, and an occupied
// output path is refused without overwriting it. No browser or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inspectImage, stripImageMetadata } from "../src/frontend/image-metadata.ts";
import { pngFixture } from "./support/image-fixtures.mjs";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const command = ["scripts/local-metadata-strip.mjs"];

test("a valid PNG keeps its ICC profile and image bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-metadata-strip-"));
  try {
    const source = pngFixture();
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "stripped.png");
    await writeFile(sourcePath, source);

    const { stdout } = await run(process.execPath, [...command, "--source", sourcePath, "--output", outputPath], { cwd });
    const report = JSON.parse(stdout);
    const output = new Uint8Array(await readFile(outputPath));
    const expected = stripImageMetadata(source);

    assert.equal(report.format, "png");
    assert.equal(report.verified.all, true);
    assert.equal(report.verified.pixelsUnchanged, true);
    assert.equal(report.verified.metadataRemoved, true);
    assert.equal(report.retained.icc, true);
    assert.ok(report.removed.includes("eXIf"));
    assert.ok(report.removed.includes("tEXt"));
    assert.deepEqual(output, expected.bytes);

    const parsed = inspectImage(output);
    assert.deepEqual([parsed.width, parsed.height], [3, 2]);
    assert.equal(parsed.icc.present, true);
    assert.equal(parsed.exif.present, false);
    assert.equal(parsed.text.present, false);
    assert.equal(parsed.xmp.present, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an occupied output path is refused and left unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-metadata-strip-"));
  try {
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "stripped.png");
    const existing = Buffer.from("keep this file");
    await writeFile(sourcePath, pngFixture());
    await writeFile(outputPath, existing);

    await assert.rejects(
      run(process.execPath, [...command, "--source", sourcePath, "--output", outputPath], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /output path already exists/i);
        return true;
      },
    );
    assert.deepEqual(await readFile(outputPath), existing);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
