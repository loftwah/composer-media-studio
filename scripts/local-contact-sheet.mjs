import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  CONTACT_SHEET_LAYOUT_SCHEMA,
  CONTACT_SHEET_LAYOUT_VERSION,
  CONTACT_SHEET_MAX_COLUMNS,
  CONTACT_SHEET_MIN_IMAGES,
  contactSheetLayout,
  contactSheetPlacement,
} from "../src/frontend/image-contact-sheet.ts";
import {
  ATLAS_LAYOUT_SCHEMA,
  ATLAS_LAYOUT_VERSION,
  atlasBoundsProblem,
  atlasLayout,
  atlasPlacement,
} from "../src/frontend/image-atlas.ts";
import { MAX_BATCH_IMAGES, MAX_IMAGE_OUTPUT_DIMENSION } from "../src/frontend/image-limits.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalImage, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

/** Resolve the optional --columns into Auto or a bounded 1..4 count, before any browser launch or write. */
export function resolveSheetColumns(rawColumns) {
  if (rawColumns === undefined) return "auto";
  const parsed = Number(rawColumns);
  assert(/^\d+$/.test(rawColumns) && Number.isInteger(parsed) && parsed >= 1 && parsed <= CONTACT_SHEET_MAX_COLUMNS,
    `Supply --columns with a whole number from 1 to ${CONTACT_SHEET_MAX_COLUMNS}, or omit it for Auto.`);
  return parsed;
}

/**
 * Native-size geometry promised by the explicit PNG selection, computed before
 * Chrome starts. Sources are measured at their displayed size so the shrink-only
 * resize used in atlas mode preserves every completed PNG at 1:1.
 */
export function atlasExpectation(inputs, columns) {
  const sizes = inputs.map(input => {
    const image = inspectImage(input);
    assert.equal(image.mime, "image/png", "Atlas sources must be PNGs.");
    return { width: image.orientedWidth, height: image.orientedHeight };
  });
  const layout = atlasLayout(sizes, columns);
  assert(layout, "The selected PNGs cannot form an atlas.");
  const problem = atlasBoundsProblem(layout);
  assert.equal(problem, null, problem ?? undefined);
  return { layout, sizes };
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string", multiple: true },
      output: { type: "string" },
      "include-layout": { type: "boolean" },
      "sprite-atlas": { type: "boolean" },
      columns: { type: "string" },
    },
  });
  const sourcePaths = values.source ?? [];
  const spriteAtlas = values["sprite-atlas"] === true;
  assert(sourcePaths.length >= CONTACT_SHEET_MIN_IMAGES && sourcePaths.length <= MAX_BATCH_IMAGES,
    spriteAtlas
      ? `Supply ${CONTACT_SHEET_MIN_IMAGES}–${MAX_BATCH_IMAGES} explicit --source <PNG> options in atlas order.`
      : `Supply ${CONTACT_SHEET_MIN_IMAGES}–${MAX_BATCH_IMAGES} explicit --source <JPEG, PNG or WebP> options in sheet order.`);
  assert(values.output, "Supply an explicit --output <new PNG path>.");
  const includeLayout = values["include-layout"] === true;
  const columns = resolveSheetColumns(values.columns);

  const inputs = [];
  for (const path of sourcePaths) inputs.push(await (spriteAtlas ? readLocalPng(path) : readLocalImage(path)));
  const expectation = spriteAtlas ? atlasExpectation(inputs, columns) : null;
  const { bytes, layout: layoutDownload, ...report } = await runLocalImages(inputs, async page => {
    const batch = page.getByRole("region", { name: "Batch", exact: true });
    if (spriteAtlas) {
      // Canonical workbench mode: shrink-only with the largest allowed edge
      // preserves the selected PNGs at their native size before assembly.
      await page.getByLabel(/^Resize by/).selectOption("max-long-edge");
      await page.getByLabel("Maximum long edge (px)", { exact: true }).fill(String(MAX_IMAGE_OUTPUT_DIMENSION));
      await batch.getByRole("combobox", { name: "Sheet mode", exact: true }).selectOption("sprite-atlas");
    }
    if (columns !== "auto") {
      const label = spriteAtlas ? "Atlas columns" : "Contact sheet columns";
      await batch.getByRole("combobox", { name: label, exact: true }).selectOption(String(columns));
    }
    await batch.getByRole("button", { name: `Process all ${inputs.length} with these settings`, exact: true }).click();
    const completion = batch.getByRole("status").filter({ hasText: /\d+ images? processed/ });
    await completion.waitFor();
    assert.equal(await completion.textContent(), `${inputs.length} images processed. Nothing was uploaded.`,
      "One or more selected images could not be processed.");
    if (spriteAtlas) {
      await batch.getByRole("button", { name: "Make sprite atlas", exact: true }).click();
      const sheet = await downloadLink(page, batch.getByRole("link", { name: "Download sprite atlas PNG", exact: true }));
      const layout = await downloadLink(page, batch.getByRole("link", { name: "Download atlas layout JSON", exact: true }));
      return { bytes: sheet.bytes, layout };
    }
    await batch.getByRole("button", { name: "Make contact sheet", exact: true }).click();
    const sheet = await downloadLink(page, batch.getByRole("link", { name: "Download contact sheet PNG", exact: true }));
    const layout = includeLayout
      ? await downloadLink(page, batch.getByRole("link", { name: "Download layout JSON", exact: true }))
      : null;
    return { bytes: sheet.bytes, layout };
  });
  const { mime, width, height } = inspectImage(bytes);
  assert.equal(mime, "image/png");
  if (spriteAtlas) {
    assert.equal(width, expectation.layout.width, "The atlas PNG width does not match the native cell geometry.");
    assert.equal(height, expectation.layout.height, "The atlas PNG height does not match the native cell geometry.");
  } else if (columns !== "auto") {
    const expected = contactSheetLayout(inputs.length, columns);
    assert.equal(width, expected.width, "The PNG width does not match the requested column count.");
    assert.equal(height, expected.height, "The PNG height does not match the requested column count.");
  }

  const receipt = {
    ...report,
    ...(spriteAtlas ? { mode: "sprite-atlas" } : {}),
    sources: inputs.map((input, index) => spriteAtlas
      ? {
          sha256: digest(input),
          bytes: input.length,
          width: expectation.sizes[index].width,
          height: expectation.sizes[index].height,
        }
      : { sha256: digest(input), bytes: input.length }),
    output: { mime, width, height, sha256: digest(bytes), bytes: bytes.length },
  };

  if (spriteAtlas) {
    const layout = JSON.parse(layoutDownload.bytes.toString("utf8"));
    const expected = expectation.layout;
    assert.equal(layout.schema, ATLAS_LAYOUT_SCHEMA, "The browser did not return a Media Studio sprite-atlas layout.");
    assert.equal(layout.version, ATLAS_LAYOUT_VERSION, "The browser returned an unsupported atlas layout version.");
    assert.equal(layout.layout?.kind, "sprite-atlas", "The browser layout is not the sprite-atlas layout.");
    assert.equal(layout.layout?.resample, "none", "The atlas was resampled instead of keeping native pixels.");
    assert.equal(layout.layout?.background, "transparent", "The atlas did not keep transparent cells.");
    assert.equal(layout.layout?.tileSize, undefined, "The atlas layout must not reuse the v1 tileSize field.");
    assert.equal(layout.layout?.columns, expected.columns, "The atlas column count does not match the requested columns.");
    assert.equal(layout.layout?.count, inputs.length, "The atlas count does not match the selected PNGs.");
    assert.equal(layout.layout?.cellWidth, expected.cellWidth, "The atlas cell width does not match the native geometry.");
    assert.equal(layout.layout?.cellHeight, expected.cellHeight, "The atlas cell height does not match the native geometry.");
    assert.equal(layout.sheet?.width, width);
    assert.equal(layout.sheet?.height, height);
    assert.equal(layout.sheet?.sha256, receipt.output.sha256, "The layout does not describe the downloaded atlas PNG bytes.");
    assert.equal(layout.sheet?.bytes, bytes.length);
    assert.equal(layout.tiles?.length, inputs.length, "The atlas tile count does not match the selected PNGs.");
    for (const [index, tile] of layout.tiles.entries()) {
      const size = expectation.sizes[index];
      assert.equal(tile.index, index, "Atlas tiles are not in selection order.");
      assert.equal(tile.output?.width, size.width, "A completed PNG changed its native width.");
      assert.equal(tile.output?.height, size.height, "A completed PNG changed its native height.");
      assert.deepEqual(tile.rect, atlasPlacement(expected, index, size.width, size.height),
        "A layout rectangle does not match the native atlas placement geometry.");
      assert.equal(tile.source.sha256, receipt.sources[index].sha256, "A layout source hash does not match its selected PNG.");
    }
    assert.doesNotMatch(JSON.stringify(layout), /\/(?:Users|private|home)\//,
      "The layout must not contain local file paths.");
    receipt.layout = layout;
  } else if (layoutDownload) {
    const layout = JSON.parse(layoutDownload.bytes.toString("utf8"));
    const fixed = contactSheetLayout(inputs.length, columns);
    assert.equal(layout.schema, CONTACT_SHEET_LAYOUT_SCHEMA, "The browser did not return a Media Studio contact-sheet layout.");
    assert.equal(layout.version, CONTACT_SHEET_LAYOUT_VERSION, "The browser returned an unsupported layout version.");
    assert.equal(layout.layout?.kind, "fixed-contact-sheet", "The browser layout is not the fixed contact-sheet layout.");
    assert.equal(layout.layout?.columns, fixed.columns, "The layout column count does not match the requested columns.");
    assert.equal(layout.sheet?.width, width);
    assert.equal(layout.sheet?.height, height);
    assert.equal(layout.sheet?.sha256, receipt.output.sha256, "The layout does not describe the downloaded PNG bytes.");
    assert.equal(layout.sheet?.bytes, bytes.length);
    assert.equal(layout.tiles?.length, inputs.length, "The layout tile count does not match the selected images.");
    for (const [index, tile] of layout.tiles.entries()) {
      assert.equal(tile.index, index, "Layout tiles are not in completed-result order.");
      assert.deepEqual(tile.rect, contactSheetPlacement(fixed, index, tile.output.width, tile.output.height),
        "A layout rectangle does not match the contact-sheet placement geometry.");
      assert.equal(tile.source.sha256, receipt.sources[index].sha256, "A layout source hash does not match its selected input.");
    }
    assert.doesNotMatch(JSON.stringify(layout), /\/(?:Users|private|home)\//,
      "The layout must not contain local file paths.");
    receipt.layout = layout;
  }

  await saveNewPng(values.output, bytes);
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
    process.exitCode = 1;
  });
}
