import assert from "node:assert/strict";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { IMAGE_RECEIPT_SCHEMA, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";
import { SOCIAL_SIZES } from "../src/frontend/image-social-kit.ts";
import { digest, downloadLink, readLocalJson, readLocalPng, runLocalImages } from "./local-image-workbench.mjs";

async function download(page, name) {
  return downloadLink(page, page.getByRole("link", {name, exact: true}));
}

function assertSocialReproducible(expected, actual, size) {
  const settings = actual.transform.settings;
  const differences = Object.keys(settings)
    .filter(key => !isDeepStrictEqual(expected.transform?.settings?.[key], settings[key]))
    .map(key => `settings.${key}`);
  if (!isDeepStrictEqual(expected.transform?.plan, actual.transform.plan))
    differences.push("transform plan");
  if (expected.output?.width !== size.width || expected.output?.height !== size.height ||
      expected.output?.mime !== "image/webp")
    differences.push("output dimensions or format");
  assert(
    differences.length === 0,
    `The default social kit could not reproduce this receipt. Check: ${differences.join(", ")}.`,
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
  const report = await runLocalImages(source, async page => {
    let actual;
    let exported;
    if (size) {
      // Leave the controls at their page defaults: the shipped social kit is
      // the only transform this replay is allowed to exercise.
      await page.getByRole("button", {name: "Make 4 social sizes", exact: true}).click();
      const row = page.locator(".image-social-list li").filter({hasText: size.label});
      await row.waitFor();
      actual = JSON.parse((await downloadLink(page, row.locator('a[download$="-receipt.json"]'))).toString("utf8"));
      exported = await downloadLink(page, row.locator('a[download$=".webp"]'));
      assertSocialReproducible(expected, actual, size);
      assert(isDeepStrictEqual(actual, expected), "The default social kit did not reproduce the selected receipt.");
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
      ...(size ? { mode: `social:${size.key}` } : {}),
      output: actual.output,
      source: actual.source,
    };
  });
  console.log(JSON.stringify(report));
}

try {
  await main();
} catch (error) {
  console.error(`Image receipt replay failed: ${error.message}`);
  process.exitCode = 1;
}
