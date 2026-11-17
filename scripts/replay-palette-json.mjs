import assert from "node:assert/strict";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { MAX_PALETTE_COLOURS, paletteToJson } from "../src/frontend/image-colour.ts";
import { digest, downloadLink, readLocalJson, readLocalPng, runLocalImages } from "./local-image-workbench.mjs";

async function main() {
  const { values } = parseArgs({ options: { source: { type: "string" }, palette: { type: "string" } } });
  assert(values.source && values.palette, "Supply an explicit --source <PNG> and --palette <JSON>.");
  const [source, expected] = await Promise.all([
    readLocalPng(values.source),
    readLocalJson(values.palette),
  ]);
  const contract = JSON.parse(paletteToJson([]));
  assert.equal(expected?.format, contract.format, "Select a Media Studio palette JSON document.");
  assert.equal(expected?.version, contract.version, "Select a supported palette JSON version.");
  assert(Array.isArray(expected.colors) &&
    expected.colors.length > 0 &&
    expected.colors.length <= MAX_PALETTE_COLOURS, "Select a palette JSON with a valid swatch count.");

  const report = await runLocalImages(source, async page => {
    await page.getByRole("button", { name: "Extract palette", exact: true }).click();
    const { bytes } = await downloadLink(page, page.getByRole("link", { name: "Download palette (.json)", exact: true }));
    const actual = JSON.parse(bytes.toString("utf8"));
    assert(isDeepStrictEqual(actual, expected), "The browser palette did not reproduce the selected JSON.");
    return {
      source: { bytes: source.length, sha256: digest(source) },
      palette: { bytes: bytes.length, sha256: digest(bytes), swatches: actual.colors.length },
    };
  });
  console.log(JSON.stringify(report));
}

try {
  await main();
} catch (error) {
  console.error(`Palette JSON replay failed: ${error.message}`);
  process.exitCode = 1;
}
