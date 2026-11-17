import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { coverRegion } from "../src/frontend/image-cover-region.ts";
import { MAX_IMAGE_OUTPUT_DIMENSION } from "../src/frontend/image-limits.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

function wholePixels(value, name) {
  assert(typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    `Supply a whole-pixel integer --${name} (0 or greater).`);
  return Number(value);
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      output: { type: "string" },
      left: { type: "string" },
      top: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
    },
  });
  assert(values.source, "Supply an explicit --source <PNG>.");
  assert(values.output, "Supply an explicit new --output <PNG path>.");

  const fields = {
    left: wholePixels(values.left, "left"),
    top: wholePixels(values.top, "top"),
    width: wholePixels(values.width, "width"),
    height: wholePixels(values.height, "height"),
  };
  const source = await readLocalPng(values.source);
  const { mime, orientedWidth, orientedHeight } = inspectImage(source);
  assert.equal(mime, "image/png");
  const region = coverRegion(
    { left: String(fields.left), top: String(fields.top), width: String(fields.width), height: String(fields.height) },
    orientedWidth,
    orientedHeight,
  );
  assert(region, `Choose a rectangle that fits inside the ${orientedWidth} × ${orientedHeight} source image.`);
  const longEdge = Math.max(orientedWidth, orientedHeight);
  assert(longEdge <= MAX_IMAGE_OUTPUT_DIMENSION,
    `The source long edge ${longEdge} exceeds the ${MAX_IMAGE_OUTPUT_DIMENSION} px output limit; pixel coordinates cannot be preserved.`);

  const { bytes, ...report } = await runLocalImages(source, async page => {
    await page.getByLabel("Long edge (px)").fill(String(longEdge));
    await page.getByRole("button", { name: "Make this image", exact: true }).click();
    const result = page.locator("#image-downloads");
    await result.waitFor();
    const cover = result.locator(".image-cover");
    await cover.locator("summary").click();
    await cover.getByLabel("Left (px)").fill(String(region.left));
    await cover.getByLabel("Top (px)").fill(String(region.top));
    await cover.getByLabel("Width (px)").fill(String(region.width));
    await cover.getByLabel("Height (px)").fill(String(region.height));
    await cover.getByRole("button", { name: "Make redacted PNG", exact: true }).click();
    const redacted = await downloadLink(page, cover.getByRole("link", { name: "Download redacted PNG", exact: true }));
    return { bytes: redacted.bytes };
  });

  const output = inspectImage(bytes);
  assert.equal(output.mime, "image/png");
  assert.equal(output.width, orientedWidth, "The redacted PNG changed the source pixel width.");
  assert.equal(output.height, orientedHeight, "The redacted PNG changed the source pixel height.");
  await saveNewPng(values.output, bytes);
  console.log(JSON.stringify({
    ...report,
    source: { sha256: digest(source), bytes: source.length, width: orientedWidth, height: orientedHeight },
    region,
    output: { sha256: digest(bytes), bytes: bytes.length, width: output.width, height: output.height },
  }));
}

main().catch(error => {
  console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
  process.exitCode = 1;
});
