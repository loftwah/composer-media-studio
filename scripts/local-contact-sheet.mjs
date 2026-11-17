import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import {
  CONTACT_SHEET_LAYOUT_SCHEMA,
  CONTACT_SHEET_LAYOUT_VERSION,
  CONTACT_SHEET_MIN_IMAGES,
  contactSheetLayout,
  contactSheetPlacement,
} from "../src/frontend/image-contact-sheet.ts";
import { MAX_BATCH_IMAGES } from "../src/frontend/image-limits.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalImage, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string", multiple: true },
      output: { type: "string" },
      "include-layout": { type: "boolean" },
    },
  });
  const sourcePaths = values.source ?? [];
  assert(sourcePaths.length >= CONTACT_SHEET_MIN_IMAGES && sourcePaths.length <= MAX_BATCH_IMAGES,
    `Supply ${CONTACT_SHEET_MIN_IMAGES}–${MAX_BATCH_IMAGES} explicit --source <JPEG, PNG or WebP> options in sheet order.`);
  assert(values.output, "Supply an explicit --output <new PNG path>.");
  const includeLayout = values["include-layout"] === true;

  const inputs = [];
  for (const path of sourcePaths) inputs.push(await readLocalImage(path));
  const { bytes, layout: layoutDownload, ...report } = await runLocalImages(inputs, async page => {
    const batch = page.getByRole("region", { name: "Batch", exact: true });
    await batch.getByRole("button", { name: `Process all ${inputs.length} with these settings`, exact: true }).click();
    const completion = batch.getByRole("status").filter({ hasText: /\d+ images? processed/ });
    await completion.waitFor();
    assert.equal(await completion.textContent(), `${inputs.length} images processed. Nothing was uploaded.`,
      "One or more selected images could not be processed.");
    await batch.getByRole("button", { name: "Make contact sheet", exact: true }).click();
    const sheet = await downloadLink(page, batch.getByRole("link", { name: "Download contact sheet PNG", exact: true }));
    const layout = includeLayout
      ? await downloadLink(page, batch.getByRole("link", { name: "Download layout JSON", exact: true }))
      : null;
    return { bytes: sheet.bytes, layout };
  });
  const { mime, width, height } = inspectImage(bytes);
  assert.equal(mime, "image/png");

  const receipt = {
    ...report,
    sources: inputs.map(input => ({ sha256: digest(input), bytes: input.length })),
    output: { mime, width, height, sha256: digest(bytes), bytes: bytes.length },
  };

  if (layoutDownload) {
    const layout = JSON.parse(layoutDownload.bytes.toString("utf8"));
    const fixed = contactSheetLayout(inputs.length);
    assert.equal(layout.schema, CONTACT_SHEET_LAYOUT_SCHEMA, "The browser did not return a Media Studio contact-sheet layout.");
    assert.equal(layout.version, CONTACT_SHEET_LAYOUT_VERSION, "The browser returned an unsupported layout version.");
    assert.equal(layout.layout?.kind, "fixed-contact-sheet", "The browser layout is not the fixed contact-sheet layout.");
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

main().catch(error => {
  console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
  process.exitCode = 1;
});
