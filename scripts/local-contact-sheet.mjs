import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { CONTACT_SHEET_MIN_IMAGES } from "../src/frontend/image-contact-sheet.ts";
import { MAX_BATCH_IMAGES } from "../src/frontend/image-limits.ts";
import { inspectImage } from "../src/frontend/image-metadata.ts";
import { digest, downloadLink, readLocalPng, runLocalImages, saveNewPng } from "./local-image-workbench.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string", multiple: true },
      output: { type: "string" },
    },
  });
  const sourcePaths = values.source ?? [];
  assert(sourcePaths.length >= CONTACT_SHEET_MIN_IMAGES && sourcePaths.length <= MAX_BATCH_IMAGES,
    `Supply ${CONTACT_SHEET_MIN_IMAGES}–${MAX_BATCH_IMAGES} explicit --source <PNG> options in sheet order.`);
  assert(values.output, "Supply an explicit --output <new PNG path>.");

  const inputs = [];
  for (const path of sourcePaths) inputs.push(await readLocalPng(path));
  const { bytes, ...report } = await runLocalImages(inputs, async page => {
    const batch = page.getByRole("region", { name: "Batch", exact: true });
    await batch.getByRole("button", { name: `Process all ${inputs.length} with these settings`, exact: true }).click();
    const completion = batch.getByRole("status").filter({ hasText: /\d+ images? processed/ });
    await completion.waitFor();
    assert.equal(await completion.textContent(), `${inputs.length} images processed. Nothing was uploaded.`,
      "One or more selected images could not be processed.");
    await batch.getByRole("button", { name: "Make contact sheet", exact: true }).click();
    const sheet = await downloadLink(page, batch.getByRole("link", { name: "Download contact sheet PNG", exact: true }));
    return { bytes: sheet.bytes };
  });
  const { mime, width, height } = inspectImage(bytes);
  assert.equal(mime, "image/png");
  await saveNewPng(values.output, bytes);
  console.log(JSON.stringify({
    ...report,
    sources: inputs.map(input => ({ sha256: digest(input), bytes: input.length })),
    output: { mime, width, height, sha256: digest(bytes), bytes: bytes.length },
  }));
}

main().catch(error => {
  console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
  process.exitCode = 1;
});
