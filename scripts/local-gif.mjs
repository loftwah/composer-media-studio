import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  GIF_FRAME_SIZES,
  GIF_MAX_FRAMES,
  GIF_MIN_FRAMES,
  GIF_MIN_FRAME_SIZE,
  gifDelaySummary,
  gifFrameDelaysProblem,
  gifSettingsProblem,
} from "../src/frontend/image-gif.ts";
import {
  digest,
  downloadLink,
  readLocalImage,
  runLocalImages,
  saveNewImage,
} from "./local-image-workbench.mjs";

/** Accessible names of the shipped GIF controls, kept in one place for the smoke path. */
const GIF_LABELS = Object.freeze({
  fieldset: "Make an animated GIF",
  frameSize: "GIF frame size",
  delay: "GIF delay (ms per frame)",
  matte: "GIF matte",
  loop: "Repeat after the last frame",
  compact: "Compact file",
});

const GIF_DOWNLOAD_LABEL = /^Download GIF/;

function gifMakeLabel(frameCount) {
  return `Make GIF (${frameCount} frames)`;
}

function gifDownloadName({ frameCount, frameSize, delayToken }) {
  return `media-studio-gif-${frameCount}-frames-${frameSize}px-${delayToken}.gif`;
}

/** The select offers fixed square sizes; a bare number that is not an option cannot be driven. */
function parseGifFrameSize(raw) {
  const instruction = `Supply --frame-size with one of ${GIF_FRAME_SIZES.join(", ")} px.`;
  assert(typeof raw === "string" && /^(?:0|[1-9]\d*)$/.test(raw), instruction);
  const frameSize = Number(raw);
  assert(GIF_FRAME_SIZES.includes(frameSize), instruction);
  return frameSize;
}

/** Whole 10 ms units inside the native 100–2000 ms window, using the browser's own rule. */
function parseGifDelay(raw) {
  assert(typeof raw === "string" && /^(?:0|[1-9]\d*)$/.test(raw), "Supply --delay as a whole number of milliseconds.");
  const delayMs = Number(raw);
  assert(Number.isSafeInteger(delayMs), "Supply --delay as a whole number of milliseconds.");
  const problem = gifSettingsProblem({ frameCount: GIF_MIN_FRAMES, frameSize: GIF_MIN_FRAME_SIZE, delayMs });
  assert.equal(problem, null, problem ?? undefined);
  return delayMs;
}

/** The colour input needs a six-digit hex string; lowercase matches what the input reports. */
function parseGifMatte(raw) {
  if (raw === undefined) return "#ffffff";
  assert(typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw),
    "Supply --matte as a six-digit hex colour such as #ffffff.");
  return raw.toLowerCase();
}

/** Optional full ordered vector; every frame must be named once in frame order. */
function parseGifFrameDelays(raw, frameCount) {
  if (raw === undefined) return undefined;
  const countInstruction =
    `Supply --frame-delays-ms as exactly ${frameCount} comma-separated whole milliseconds in frame order.`;
  assert(typeof raw === "string" && raw.length > 0, countInstruction);
  const parts = raw.split(",");
  assert.equal(parts.length, frameCount, countInstruction);
  const valuesInstruction = "Supply --frame-delays-ms as whole milliseconds separated by commas.";
  const frameDelaysMs = parts.map((part) => {
    assert(/^(?:0|[1-9]\d*)$/.test(part), valuesInstruction);
    const delayMs = Number(part);
    assert(Number.isSafeInteger(delayMs), valuesInstruction);
    return delayMs;
  });
  const problem = gifFrameDelaysProblem({ frameCount, frameDelaysMs });
  assert.equal(problem, null, problem ?? undefined);
  return frameDelaysMs;
}

/** The workbench loops by default; --once opts out. The two flags cannot be combined. */
function resolveGifPlayback(values) {
  assert(!(values.loop === true && values.once === true), "Do not combine --loop and --once.");
  return values.once !== true;
}

function assertGifOutputPath(output) {
  assert(typeof output === "string" && /\.gif$/i.test(output),
    "Supply an explicit new --output path ending in .gif.");
}

/** Refuse an occupied destination before reading sources or launching Chrome. */
async function assertNewOutput(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const error = new Error("The output path already exists. Choose a new path.");
  error.code = "EEXIST";
  throw error;
}

/** The workbench blocks every non-local request; a non-zero count would make the report a lie. */
function assertNetworkIsolation(report) {
  assert.equal(report.networkRequestsPassedThrough, 0, "The workbench passed through a network request.");
  return report.networkRequestsPassedThrough;
}

function inspectGif(bytes, frameSize, expectedDelaysMs) {
  assert(bytes.length >= 14 && bytes.toString("ascii", 0, 6) === "GIF89a" && bytes.at(-1) === 0x3b,
    "The workbench did not download a complete GIF89a file.");
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  assert(width === frameSize && height === frameSize, "The downloaded GIF dimensions differ from the requested size.");

  // Read every Graphic Control Extension back from the actual downloaded bytes
  // and compare the ordered hundredth-of-a-second units with the requested vector.
  const frameDelaysMs = [];
  let offset = 13 + 256 * 3;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) break;
    if (marker === 0x21 && bytes[offset + 1] === 0xff) {
      offset += 19;
      continue;
    }
    if (marker === 0x21 && bytes[offset + 1] === 0xf9) {
      frameDelaysMs.push(bytes.readUInt16LE(offset + 4) * 10);
      offset += 8;
      continue;
    }
    assert.equal(marker, 0x2c, "The downloaded GIF has an unexpected block.");
    offset += 10;
    assert.equal(bytes[offset], 8, "The downloaded GIF does not use the expected LZW code size.");
    offset += 1;
    while (offset < bytes.length && bytes[offset] !== 0) offset += 1 + bytes[offset];
    assert.equal(bytes[offset], 0, "The downloaded GIF has truncated image data.");
    offset += 1;
  }
  assert.deepEqual(frameDelaysMs, expectedDelaysMs,
    "The GIF control blocks differ from the requested frame delays.");
  return { width, height, frameDelaysMs };
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string", multiple: true },
      output: { type: "string" },
      "frame-size": { type: "string" },
      delay: { type: "string" },
      "frame-delays-ms": { type: "string" },
      matte: { type: "string" },
      loop: { type: "boolean" },
      once: { type: "boolean" },
      compact: { type: "boolean" },
    },
  });
  const sourcePaths = values.source ?? [];
  assert(sourcePaths.length >= GIF_MIN_FRAMES && sourcePaths.length <= GIF_MAX_FRAMES,
    `Supply ${GIF_MIN_FRAMES}–${GIF_MAX_FRAMES} explicit --source <JPEG, PNG or WebP> options in GIF frame order.`);
  assertGifOutputPath(values.output);
  const frameSize = parseGifFrameSize(values["frame-size"]);
  const delayMs = parseGifDelay(values.delay);
  const frameDelaysMs = parseGifFrameDelays(values["frame-delays-ms"], sourcePaths.length);
  const matte = parseGifMatte(values.matte);
  const loop = resolveGifPlayback(values);
  const compact = values.compact === true;
  const effectiveDelaysMs = frameDelaysMs ?? sourcePaths.map(() => delayMs);
  const delaySummary = gifDelaySummary(effectiveDelaysMs);
  const settings = {
    frameSize,
    delayMs,
    ...(frameDelaysMs ? { frameDelaysMs } : {}),
    matte,
    loop,
    playback: loop ? "loop" : "once",
    compact,
  };
  const problem =
    gifSettingsProblem({ frameCount: sourcePaths.length, frameSize, delayMs }) ??
    gifFrameDelaysProblem({ frameCount: sourcePaths.length, frameDelaysMs: effectiveDelaysMs });
  assert.equal(problem, null, problem ?? undefined);
  await assertNewOutput(values.output);

  const inputs = [];
  for (const path of sourcePaths) inputs.push(await readLocalImage(path));

  const { bytes, ...report } = await runLocalImages(inputs, async (page) => {
    page.setDefaultTimeout(8000);
    const gif = page.getByRole("group", { name: GIF_LABELS.fieldset, exact: true });
    await gif.getByRole("combobox", { name: GIF_LABELS.frameSize, exact: true }).selectOption(String(frameSize));
    await gif.getByLabel(GIF_LABELS.delay, { exact: true }).fill(String(delayMs));
    if (frameDelaysMs) {
      const disclosure = gif.locator("details.image-gif-delays");
      if (!(await disclosure.evaluate((details) => details.open)))
        await disclosure.locator("summary").click();
      for (const [index, frameDelayMs] of frameDelaysMs.entries())
        await gif.getByLabel(`Frame ${index + 1} delay (ms)`, { exact: true }).fill(String(frameDelayMs));
    }
    await gif.getByLabel(GIF_LABELS.matte, { exact: true }).fill(matte);
    const repeat = gif.getByLabel(GIF_LABELS.loop, { exact: true });
    if (loop) await repeat.check();
    else await repeat.uncheck();
    const compactControl = gif.getByLabel(GIF_LABELS.compact, { exact: true });
    if (compact) await compactControl.check();
    else await compactControl.uncheck();
    await gif.getByRole("button", { name: gifMakeLabel(inputs.length), exact: true }).click();
    const completion = gif.getByRole("status").filter({ hasText: /^GIF ready: / });
    await completion.waitFor();
    const status = await completion.textContent();
    assert(status?.startsWith(
      `GIF ready: ${inputs.length} frames · ${frameSize} × ${frameSize} px · ${delaySummary.phrase}`),
    "The workbench reported different GIF settings.");
    assert(status?.endsWith(loop ? "loops forever." : "plays once."),
      "The workbench reported different GIF playback.");
    const downloaded = await downloadLink(page, gif.getByRole("link", { name: GIF_DOWNLOAD_LABEL }));
    assert.equal(downloaded.name, gifDownloadName({
      frameCount: inputs.length,
      frameSize,
      delayToken: delaySummary.token,
    }), "The workbench named a different GIF download.");
    return { bytes: downloaded.bytes };
  });

  const dimensions = inspectGif(bytes, frameSize, effectiveDelaysMs);
  assertNetworkIsolation(report);
  const receipt = {
    schema: "media-studio/local-gif",
    version: 1,
    browser: report.browser,
    sources: inputs.map((input, index) => ({ index, sha256: digest(input), bytes: input.length })),
    settings: { frameCount: inputs.length, ...settings },
    output: {
      mime: "image/gif",
      width: dimensions.width,
      height: dimensions.height,
      ...(frameDelaysMs ? { frameDelaysMs: dimensions.frameDelaysMs } : {}),
      sha256: digest(bytes),
      bytes: bytes.length,
    },
    networkRequestsPassedThrough: report.networkRequestsPassedThrough,
  };
  await saveNewImage(values.output, bytes);
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.code === "EEXIST" ? "The output path already exists. Choose a new path." : error.message);
    process.exitCode = 1;
  });
}
