import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { stripImageMetadata } from "../src/frontend/image-metadata.ts";
import { digest, readLocalPng, saveNewPng } from "./local-image-workbench.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      output: { type: "string" },
    },
  });
  assert(values.source, "Supply an explicit --source <PNG>.");
  assert(values.output, "Supply an explicit new --output <PNG path>.");

  const source = await readLocalPng(values.source);
  const result = stripImageMetadata(source);
  assert.equal(result.format, "png");
  assert(result.verified.all, "The metadata-only copy did not pass verification; the original is unchanged.");

  await saveNewPng(values.output, result.bytes);
  console.log(JSON.stringify({
    format: result.format,
    source: { sha256: digest(source), bytes: source.length, width: result.before.width, height: result.before.height },
    output: {
      sha256: digest(result.bytes),
      bytes: result.bytes.length,
      width: result.after.width,
      height: result.after.height,
      mime: result.mime,
    },
    removed: result.removed,
    retained: { icc: result.after.icc.present, orientation: result.keptOrientation },
    verified: result.verified,
    warning: result.warning,
  }));
}

main().catch(error => {
  console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
  process.exitCode = 1;
});
