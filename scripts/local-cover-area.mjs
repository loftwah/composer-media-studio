import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { coverRegion, MAX_COVER_AREAS } from "../src/frontend/image-cover-region.ts";
import { BLUR_PIXEL_BUDGET, blurFitsPixelBudget } from "../src/frontend/image-blur.ts";
import { MAX_IMAGE_OUTPUT_DIMENSION } from "../src/frontend/image-limits.ts";
import { mosaicFitsPixelBudget } from "../src/frontend/image-mosaic.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

function wholePixels(value, name) {
  assert(typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    `Supply a whole-pixel integer --${name} (0 or greater).`);
  return Number(value);
}

/** The native treatments this command can drive; solid stays the privacy default. */
export const TREATMENTS = Object.freeze(["solid", "mosaic", "blur"]);

/** Native export controls for each treatment; decorative modes are never called redaction. */
export const TREATMENT_EXPORTS = Object.freeze({
  solid: Object.freeze({ name: "redacted", make: "Make redacted PNG", download: "Download redacted PNG" }),
  mosaic: Object.freeze({ name: "mosaic", make: "Make mosaic PNG", download: "Download mosaic PNG" }),
  blur: Object.freeze({ name: "soft blur", make: "Make soft blur PNG", download: "Download soft blur PNG" }),
});

export function parseTreatment(value) {
  const treatment = value ?? "solid";
  assert(TREATMENTS.includes(treatment), "Choose --treatment solid, mosaic or blur.");
  return treatment;
}

/** The same aggregate pixel budgets the native panel uses, checked before any rendering. */
export function assertTreatmentBudget(treatment, regions) {
  if (treatment === "mosaic") {
    assert(mosaicFitsPixelBudget(regions), "Mosaic areas exceed the 8 million pixel budget for one export.");
  } else if (treatment === "blur") {
    assert(blurFitsPixelBudget(regions),
      `Soft blur areas exceed the ${BLUR_PIXEL_BUDGET / 1_000_000} million pixel budget for one export.`);
  }
}

/** Solid keeps its exact receipt; decorative modes name what actually happened to the pixels. */
export function treatmentReceiptFields(treatment) {
  return treatment === "solid" ? {} : { treatment, decorative: true };
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
      treatment: { type: "string" },
    },
  });
  assert(values.source, "Supply an explicit --source <PNG>.");
  assert(values.output, "Supply an explicit new --output <PNG path>.");
  const treatment = parseTreatment(values.treatment);
  const labels = TREATMENT_EXPORTS[treatment];

  const source = await readLocalPng(values.source);
  const { mime, orientedWidth, orientedHeight } = inspectImage(source);
  assert.equal(mime, "image/png");
  const selection = coverSelection(values, orientedWidth, orientedHeight);
  assertTreatmentBudget(treatment, selection.regions);
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
    if (treatment !== "solid") {
      await cover.locator(`input[name="image-cover-mode"][value="${treatment}"]`).check();
    }
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
    await cover.getByRole("button", { name: labels.make, exact: true }).click();
    const exported = await downloadLink(page, cover.getByRole("link", { name: labels.download, exact: true }));
    return { bytes: exported.bytes };
  });

  const output = inspectImage(bytes);
  assert.equal(output.mime, "image/png");
  assert.equal(output.width, orientedWidth, `The ${labels.name} PNG changed the source pixel width.`);
  assert.equal(output.height, orientedHeight, `The ${labels.name} PNG changed the source pixel height.`);
  await saveNewPng(values.output, bytes);
  console.log(JSON.stringify({
    ...report,
    source: { sha256: digest(source), bytes: source.length, width: orientedWidth, height: orientedHeight },
    ...(selection.legacy ? { region: selection.region } : { areas: selection.regions }),
    output: { sha256: digest(bytes), bytes: bytes.length, width: output.width, height: output.height },
    ...treatmentReceiptFields(treatment),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
    process.exitCode = 1;
  });
}
