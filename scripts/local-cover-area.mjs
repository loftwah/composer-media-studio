import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { coverRegion, MAX_COVER_AREAS } from "../src/frontend/image-cover-region.ts";
import { MAX_IMAGE_OUTPUT_DIMENSION } from "../src/frontend/image-limits.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

function wholePixels(value, name) {
  assert(typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    `Supply a whole-pixel integer --${name} (0 or greater).`);
  return Number(value);
}

/** Resolve either CLI form to an ordered list of whole-pixel rectangles, before any rendering. */
export function coverSelection(values, imageWidth, imageHeight) {
  const rawAreas = values.area ?? [];
  const oldFlags = ["left", "top", "width", "height"].filter(key => values[key] !== undefined);
  assert(!(rawAreas.length > 0 && oldFlags.length > 0),
    "Do not mix --area with --left, --top, --width or --height. Choose one form.");

  if (rawAreas.length === 0) {
    // Original single-rectangle form: identical validation, region and error text.
    const fields = {
      left: wholePixels(values.left, "left"),
      top: wholePixels(values.top, "top"),
      width: wholePixels(values.width, "width"),
      height: wholePixels(values.height, "height"),
    };
    const region = coverRegion(
      { left: String(fields.left), top: String(fields.top), width: String(fields.width), height: String(fields.height) },
      imageWidth,
      imageHeight,
    );
    assert(region, `Choose a rectangle that fits inside the ${imageWidth} × ${imageHeight} source image.`);
    return { legacy: true, regions: [region], region };
  }

  assert(rawAreas.length <= MAX_COVER_AREAS,
    `Supply at most ${MAX_COVER_AREAS} --area values (left,top,width,height each).`);
  const regions = rawAreas.map((raw, index) => {
    const parts = String(raw).split(",");
    assert(parts.length === 4,
      `--area #${index + 1} must be exactly left,top,width,height (four whole-pixel values).`);
    const region = coverRegion(
      { left: parts[0], top: parts[1], width: parts[2], height: parts[3] },
      imageWidth,
      imageHeight,
    );
    assert(region,
      `--area #${index + 1} (${raw}) is not a whole-pixel rectangle inside the ${imageWidth} × ${imageHeight} source image.`);
    return region;
  });
  return { legacy: false, regions, region: regions[0] };
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
      area: { type: "string", multiple: true },
    },
  });
  assert(values.source, "Supply an explicit --source <PNG>.");
  assert(values.output, "Supply an explicit new --output <PNG path>.");

  const source = await readLocalPng(values.source);
  const { mime, orientedWidth, orientedHeight } = inspectImage(source);
  assert.equal(mime, "image/png");
  const selection = coverSelection(values, orientedWidth, orientedHeight);
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
    for (let index = 0; index < selection.regions.length; index++) {
      const region = selection.regions[index];
      await cover.getByLabel("Left (px)").fill(String(region.left));
      await cover.getByLabel("Top (px)").fill(String(region.top));
      await cover.getByLabel("Width (px)").fill(String(region.width));
      await cover.getByLabel("Height (px)").fill(String(region.height));
      // All but the final rectangle are retained; the last is exported as the
      // current area, so the native preview paints them in the supplied order.
      if (index < selection.regions.length - 1) {
        await cover.getByRole("button", { name: "Add another area", exact: true }).click();
      }
    }
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
    ...(selection.legacy ? { region: selection.region } : { areas: selection.regions }),
    output: { sha256: digest(bytes), bytes: bytes.length, width: output.width, height: output.height },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
    process.exitCode = 1;
  });
}
