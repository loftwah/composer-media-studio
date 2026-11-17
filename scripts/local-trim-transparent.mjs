import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { IMAGE_RECEIPT_SCHEMA, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";
import { digest, downloadLink, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

const TRIM_NOTE = /^Trim to (\d+) × (\d+) px\./;

async function readTrim(page) {
  const controls = page.getByRole("group", { name: "Resize and crop", exact: true });
  const trim = controls.getByRole("button", { name: "Trim transparent edges", exact: true });
  await trim.click();
  await trim.waitFor();
  const note = await controls.getByRole("status").textContent();
  const applied = TRIM_NOTE.exec(note ?? "");
  assert(applied, note || "The workbench did not calculate transparent bounds.");
  return { width: Number(applied[1]), height: Number(applied[2]) };
}

async function main() {
  const { values } = parseArgs({
    options: { source: { type: "string" }, output: { type: "string" } },
  });
  assert(values.source, "Supply an explicit --source <PNG>.");
  assert(values.output, "Supply an explicit new --output <PNG path>.");

  const source = await readLocalPng(values.source);
  const input = inspectImage(source);
  assert.equal(input.mime, "image/png");

  const { bytes, receipt, ...report } = await runLocalImages(source, async (page) => {
    const trim = await readTrim(page);
    await page.getByLabel(/^Resize by/).selectOption("exact");
    await page.getByLabel("Width (px)", { exact: true }).fill(String(trim.width));
    await page.getByLabel("Height (px)", { exact: true }).fill(String(trim.height));
    await page.getByLabel(/^Format/).selectOption("png");
    await page.getByRole("button", { name: "Make this image", exact: true }).click();
    const result = page.locator("#image-downloads");
    await result.waitFor();
    const image = await downloadLink(page, result.getByRole("link", { name: "Download PNG", exact: true }));
    const json = await downloadLink(page, result.getByRole("link", { name: "Download image receipt (.json)", exact: true }));
    return { bytes: image.bytes, receipt: JSON.parse(json.bytes.toString("utf8")), trim };
  });

  assert.equal(receipt.schema, IMAGE_RECEIPT_SCHEMA);
  assert.equal(receipt.version, IMAGE_RECEIPT_VERSION);
  assert.equal(receipt.source.sha256, digest(source), "The receipt source hash does not match the selected PNG.");
  const plan = receipt.transform.plan;
  assert.equal(plan.crop.width, report.trim.width, "The receipt crop width does not match the trim control.");
  assert.equal(plan.crop.height, report.trim.height, "The receipt crop height does not match the trim control.");
  assert(plan.crop.width < input.orientedWidth || plan.crop.height < input.orientedHeight,
    "The receipt crop did not remove any transparent edge.");
  assert.equal(plan.rotate, 0);
  assert.equal(plan.flipH, false);
  assert.equal(plan.flipV, false);
  assert.equal(plan.straighten, null);
  assert.equal(plan.outputWidth, report.trim.width, "The receipt planned a different output width.");
  assert.equal(plan.outputHeight, report.trim.height, "The receipt planned a different output height.");
  assert.equal(plan.scaleX, 1);
  assert.equal(plan.scaleY, 1);
  assert.equal(plan.upscaled, false);
  assert.equal(plan.aspectDistorted, false);
  assert.equal(receipt.transform.settings.resizeMode, "exact");
  assert.equal(receipt.transform.settings.exactWidth, report.trim.width);
  assert.equal(receipt.transform.settings.exactHeight, report.trim.height);
  assert.equal(receipt.transform.settings.format, "png");
  assert.equal(receipt.transform.settings.cropAspect, "original");
  assert.equal(receipt.transform.settings.targetKiB, null);

  const output = inspectImage(bytes);
  assert.equal(output.mime, "image/png");
  assert.equal(output.alpha, true, "The trimmed PNG lost its alpha channel.");
  assert.equal(output.width, report.trim.width, "The trimmed PNG changed the crop width.");
  assert.equal(output.height, report.trim.height, "The trimmed PNG changed the crop height.");
  assert.equal(receipt.output.sha256, digest(bytes), "The receipt output hash does not match the downloaded PNG.");
  assert.equal(receipt.output.bytes, bytes.length, "The receipt output byte count does not match the downloaded PNG.");
  assert.equal(receipt.output.mime, "image/png");
  assert.equal(receipt.output.width, output.width);
  assert.equal(receipt.output.height, output.height);

  await saveNewPng(values.output, bytes);
  console.log(JSON.stringify({
    ...report,
    source: { sha256: digest(source), bytes: source.length, width: input.orientedWidth, height: input.orientedHeight },
    output: { sha256: digest(bytes), bytes: bytes.length, width: output.width, height: output.height },
    receiptSha256: digest(Buffer.from(JSON.stringify(receipt))),
    receiptVerified: true,
  }));
}

main().catch((error) => {
  console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
  process.exitCode = 1;
});
