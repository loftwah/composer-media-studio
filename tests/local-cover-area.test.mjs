// MIT. Focused checks for the local cover command's argument-to-rectangle
// contract: original whole-pixel flags stay compatible, repeated --area values
// stay ordered and bound, and invalid rectangles fail before any rendering.
// The --treatment modes reuse the native aggregate pixel budgets and report
// decorative work honestly; browser rendering stays shared with runLocalImages.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertTreatmentBudget, coverSelection, parseTreatment, TREATMENT_EXPORTS, treatmentReceiptFields,
} from "../scripts/local-cover-area.mjs";
import { BLUR_PIXEL_BUDGET } from "../src/frontend/image-blur.ts";
import { pngFixture } from "./support/image-fixtures.mjs";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const command = "scripts/local-cover-area.mjs";
const values = extra => ({ source: "source.png", output: "out.png", ...extra });
const region = (left, top, width, height) => ({ left, top, width, height });

test("original whole-pixel flags still describe the same single region", () => {
  const selection = coverSelection(values({ left: "64", top: "64", width: "100", height: "80" }), 400, 300);
  assert.equal(selection.legacy, true);
  assert.deepEqual(selection.regions, [region(64, 64, 100, 80)]);
  assert.deepEqual(selection.region, region(64, 64, 100, 80));
});

test("repeated --area values are parsed in the order supplied, up to eight", () => {
  const areas = [
    "5,5,20,10", "40,30,10,25", "0,0,1,1", "399,299,1,1",
    "10,10,2,2", "20,20,2,2", "30,30,2,2", "100,100,2,2",
  ];
  const selection = coverSelection(values({ area: areas }), 400, 300);
  assert.equal(selection.legacy, false);
  assert.deepEqual(selection.regions, [
    region(5, 5, 20, 10), region(40, 30, 10, 25), region(0, 0, 1, 1), region(399, 299, 1, 1),
    region(10, 10, 2, 2), region(20, 20, 2, 2), region(30, 30, 2, 2), region(100, 100, 2, 2),
  ]);
});

test("two parsed areas cover exact disjoint pixels", () => {
  const width = 12;
  const height = 8;
  const selection = coverSelection(values({ area: ["1,1,4,3", "7,4,3,2"] }), width, height);
  assert.equal(selection.regions.length, 2);
  const covered = selection.regions.map(r => {
    const pixels = new Set();
    for (let y = r.top; y < r.top + r.height; y++) {
      for (let x = r.left; x < r.left + r.width; x++) {
        assert(x < width && y < height, "each pixel stays inside the image");
        pixels.add(`${x},${y}`);
      }
    }
    assert.equal(pixels.size, r.width * r.height, "the rectangle covers exactly its own pixel count");
    return pixels;
  });
  const [first, second] = covered;
  for (const key of first) assert.equal(second.has(key), false, `${key} is not painted twice`);
  const union = new Set([...first, ...second]);
  assert.equal(union.size, first.size + second.size);
  assert.equal(union.size, 4 * 3 + 3 * 2);
  assert.equal(union.has("1,1"), true);
  assert.equal(union.has("4,3"), true);
  assert.equal(union.has("7,4"), true);
  assert.equal(union.has("9,5"), true);
  assert.equal(union.has("0,0"), false, "a pixel outside both areas is untouched");
});

test("old and new coordinate flags cannot be mixed", () => {
  assert.throws(
    () => coverSelection(values({ left: "1", top: "1", width: "2", height: "2", area: ["3,3,4,4"] }), 100, 100),
    /Do not mix --area/,
  );
});

test("every --area must be whole, four-valued and inside the source", () => {
  const invalid = [
    "-1,0,2,2", "0,0,0,2", "0,0,2,0", "0.5,0,2,2", "0,0,2,1.5",
    "Infinity,0,2,2", "0,0,2", "0,0,2,2,2", "", "99,99,2,2",
  ];
  for (const bad of invalid) {
    assert.throws(
      () => coverSelection(values({ area: ["1,1,2,2", bad] }), 100, 100),
      /--area #2/,
      JSON.stringify(bad),
    );
  }
  assert.throws(
    () => coverSelection(values({ area: Array.from({ length: 9 }, () => "0,0,1,1") }), 100, 100),
    /at most 8 --area values/,
  );
});

test("the CLI refuses a mixed invocation before rendering or writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-local-cover-"));
  try {
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "redacted.png");
    await writeFile(sourcePath, pngFixture());
    await assert.rejects(
      run(process.execPath, [
        command, "--source", sourcePath, "--output", outputPath,
        "--left", "0", "--top", "0", "--width", "1", "--height", "1",
        "--area", "1,1,1,1",
      ], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Do not mix --area/);
        return true;
      },
    );
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI refuses an out-of-bounds --area before rendering or writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-local-cover-"));
  try {
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "redacted.png");
    await writeFile(sourcePath, pngFixture());
    await assert.rejects(
      run(process.execPath, [command, "--source", sourcePath, "--output", outputPath, "--area", "99,99,2,2"], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /--area #1/);
        return true;
      },
    );
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("treatment defaults to solid and only accepts the three native modes", () => {
  assert.equal(parseTreatment(undefined), "solid");
  for (const mode of ["solid", "mosaic", "blur"]) assert.equal(parseTreatment(mode), mode);
  assert.throws(() => parseTreatment("redact"), /Choose --treatment solid, mosaic or blur/);
});

test("solid keeps its receipt while decorative modes name the real treatment", () => {
  assert.deepEqual(treatmentReceiptFields("solid"), {});
  for (const mode of ["mosaic", "blur"]) {
    const fields = treatmentReceiptFields(mode);
    assert.deepEqual(fields, { treatment: mode, decorative: true });
    assert.equal(JSON.stringify(fields).includes("redact"), false, "a decorative PNG is not described as redaction");
  }
  assert.deepEqual(Object.keys(TREATMENT_EXPORTS), ["solid", "mosaic", "blur"]);
  assert.deepEqual(TREATMENT_EXPORTS.solid, { name: "redacted", make: "Make redacted PNG", download: "Download redacted PNG" });
  assert.deepEqual(TREATMENT_EXPORTS.mosaic, { name: "mosaic", make: "Make mosaic PNG", download: "Download mosaic PNG" });
  assert.deepEqual(TREATMENT_EXPORTS.blur, { name: "soft blur", make: "Make soft blur PNG", download: "Download soft blur PNG" });
});

test("decorative pixel budgets are aggregate and use the native limits", () => {
  const image = 8192;
  const mosaicSelection = coverSelection(values({ area: ["0,0,4000,2000", "4000,0,4000,2000"] }), image, image);
  assert.equal(mosaicSelection.regions.reduce((sum, r) => sum + r.width * r.height, 0), 16_000_000);
  assert.doesNotThrow(() => assertTreatmentBudget("mosaic", mosaicSelection.regions.slice(0, 1)));
  assert.throws(() => assertTreatmentBudget("mosaic", mosaicSelection.regions), /8 million pixel budget/);
  assert.doesNotThrow(() => assertTreatmentBudget("solid", mosaicSelection.regions));

  const blurSelection = coverSelection(values({ area: ["0,0,1500,1000", "1500,0,1500,1000"] }), image, image);
  assert.equal(BLUR_PIXEL_BUDGET, 2_000_000);
  assert.doesNotThrow(() => assertTreatmentBudget("blur", blurSelection.regions.slice(0, 1)));
  assert.throws(() => assertTreatmentBudget("blur", blurSelection.regions), /2 million pixel budget/);
  assert.doesNotThrow(() => assertTreatmentBudget("solid", blurSelection.regions));
});

test("the CLI refuses an unknown --treatment before rendering or writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-local-cover-"));
  try {
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "out.png");
    await writeFile(sourcePath, pngFixture());
    await assert.rejects(
      run(process.execPath, [
        command, "--source", sourcePath, "--output", outputPath,
        "--left", "0", "--top", "0", "--width", "1", "--height", "1",
        "--treatment", "redact",
      ], { cwd }),
      error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Choose --treatment solid, mosaic or blur/);
        return true;
      },
    );
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI refuses over-budget decorative areas before the browser starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-local-cover-"));
  try {
    const sourcePath = join(root, "source.png");
    const outputPath = join(root, "out.png");
    await writeFile(sourcePath, pngFixture({ width: 8192, height: 8192 }));
    const cases = [
      ["mosaic", ["0,0,4000,2000", "4000,0,4000,2000"], /8 million pixel budget/],
      ["blur", ["0,0,1500,1000", "1500,0,1500,1000"], /2 million pixel budget/],
    ];
    for (const [treatment, areas, message] of cases) {
      await assert.rejects(
        run(process.execPath, [
          command, "--source", sourcePath, "--output", outputPath, "--treatment", treatment,
          ...areas.flatMap(area => ["--area", area]),
        ], { cwd }),
        error => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, message);
          return true;
        },
      );
      await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
