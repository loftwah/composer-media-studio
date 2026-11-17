import assert from "node:assert/strict";
import { resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { IMAGE_RECEIPT_SCHEMA, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";
import { sniffLocalImage } from "../src/frontend/image-metadata.ts";
import { mimeForExport } from "../src/frontend/image-ops.ts";
import { SOCIAL_KIT_FORMATS, SOCIAL_SIZES } from "../src/frontend/image-social-kit.ts";
import { digest, downloadLink, readLocalJson, readLocalPng, runLocalImages } from "./local-image-workbench.mjs";

async function download(page, name) {
  const { bytes } = await downloadLink(page, page.getByRole("link", { name, exact: true }));
  return bytes;
}

/** Validate an explicit v1 social receipt's claimed MIME, format and sizing before driving the UI. */
export function socialFormatForReceipt(expected, size) {
  const mime = expected?.output?.mime;
  const format = SOCIAL_KIT_FORMATS.find(candidate => mimeForExport(candidate) === mime);
  assert(format, `Unsupported social kit output MIME "${mime}"; expected image/webp or image/png.`);
  assert.equal(expected.output.width, size.width, `Receipt width does not match ${size.key} (${size.width}).`);
  assert.equal(expected.output.height, size.height, `Receipt height does not match ${size.key} (${size.height}).`);
  assert.equal(expected.transform?.settings?.format, format, `Receipt format setting does not match output MIME ${mime}.`);
  return format;
}

export function assertSocialReproducible(expected, actual, size, format) {
  const settings = actual.transform.settings;
  const differences = Object.keys(settings)
    .filter(key => !isDeepStrictEqual(expected.transform?.settings?.[key], settings[key]))
    .map(key => `settings.${key}`);
  if (!isDeepStrictEqual(expected.transform?.plan, actual.transform.plan))
    differences.push("transform plan");
  if (expected.output?.width !== size.width || expected.output?.height !== size.height ||
      expected.output?.mime !== mimeForExport(format))
    differences.push("output dimensions or format");
  assert(
    differences.length === 0,
    `The ${format} social kit could not reproduce this receipt. Check: ${differences.join(", ")}.`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: {type: "string"},
      receipt: {type: "string"},
      size: {type: "string"},
    },
  });
  assert(values.source && values.receipt, "Supply an explicit --source <PNG> and --receipt <JSON>.");
  const size = values.size ? SOCIAL_SIZES.find((candidate) => candidate.key === values.size) : null;
  assert(!values.size || size, `Select one social size: ${SOCIAL_SIZES.map((candidate) => candidate.key).join(", ")}.`);
  const [source, expected] = await Promise.all([
    readLocalPng(values.source),
    readLocalJson(values.receipt),
  ]);
  assert.equal(expected?.schema, IMAGE_RECEIPT_SCHEMA, "Select an Image Tools receipt.");
  assert.equal(expected?.version, IMAGE_RECEIPT_VERSION, "Select a supported Image Tools receipt version.");
  assert.equal(digest(source), expected.source?.sha256, "The source bytes do not match the receipt.");
  const format = size ? socialFormatForReceipt(expected, size) : null;
  const report = await runLocalImages(source, async page => {
    let actual;
    let exported;
    let outputName = null;
    if (size) {
      if (format === "png") {
        // The receipt explicitly claims PNG: select the shipped Kit format
        // control before making the kit. WebP stays at the page default.
        await page.getByLabel("Kit format").selectOption("png");
      }
      await page.getByRole("button", {name: "Make 4 social sizes", exact: true}).click();
      const row = page.locator(".image-social-list li").filter({hasText: size.label});
      await row.waitFor();
      const receipt = await downloadLink(page, row.locator('a[download$="-receipt.json"]'));
      actual = JSON.parse(receipt.bytes.toString("utf8"));
      const image = await downloadLink(page, row.locator(`a[download$=".${format}"]`));
      outputName = image.name;
      exported = image.bytes;
      assert.equal(
        outputName, `source-${size.key}-${size.width}x${size.height}.${format}`,
        "Unexpected social download name.",
      );
      assert.equal(
        sniffLocalImage(exported).mime, expected.output.mime,
        "Downloaded bytes do not match the receipt's claimed MIME.",
      );
      assertSocialReproducible(expected, actual, size, format);
      assert(isDeepStrictEqual(actual, expected), "The social kit did not reproduce the selected receipt.");
    } else {
      await page.getByRole("button", {name: "Apply Web-ready image", exact: true}).click();
      await page.getByRole("button", {name: "Make this image", exact: true}).click();
      actual = JSON.parse((await download(page, "Download image receipt (.json)")).toString("utf8"));
      exported = await download(page, "Download WEBP");
      assert(isDeepStrictEqual(actual, expected), "The Web-ready preset did not reproduce the selected receipt.");
    }
    assert.equal(exported.length, expected.output.bytes);
    assert.equal(digest(exported), expected.output.sha256);
    return {
      ...(size ? {mode: `social:${size.key}`, format, outputName, outputBytes: exported.length} : {}),
      output: actual.output,
      source: actual.source,
    };
  });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Image receipt replay failed: ${error.message}`);
    process.exitCode = 1;
  }
}
