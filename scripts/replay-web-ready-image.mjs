import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { MAX_IMAGE_INPUT_BYTES } from "../src/frontend/image-limits.mjs";
import { sniffLocalImage } from "../src/frontend/image-metadata.mjs";
import { IMAGE_RECEIPT_SCHEMA, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";

const origin = "http://127.0.0.1";
const workbench = '<!doctype html><title>Image Tools replay</title><div id="images"></div><script type="module" src="/images.js"></script>';

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readSelection(path, limit) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    assert(info.isFile() && info.size > 0 && info.size <= limit, "Select a non-empty local file within the size limit.");
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await file.read({buffer: bytes});
    assert.equal(bytesRead, bytes.length, "The selected file changed while being read.");
    return bytes;
  } finally {
    await file.close();
  }
}

async function download(page, name) {
  const link = page.getByRole("link", {name, exact: true});
  await link.waitFor();
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return buffer(await result.createReadStream());
}

async function main() {
  const { values } = parseArgs({ options: { source: {type: "string"}, receipt: {type: "string"} } });
  assert(values.source && values.receipt, "Supply an explicit --source <PNG> and --receipt <JSON>.");
  const [source, receiptBytes] = await Promise.all([
    readSelection(values.source, MAX_IMAGE_INPUT_BYTES),
    readSelection(values.receipt, 16 * 1024),
  ]);
  const expected = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(expected?.schema, IMAGE_RECEIPT_SCHEMA, "Select an Image Tools receipt.");
  assert.equal(expected?.version, IMAGE_RECEIPT_VERSION, "Select a supported Image Tools receipt version.");
  assert.equal(digest(source), expected.source?.sha256, "The source bytes do not match the receipt.");
  assert.equal(sniffLocalImage(source).mime, "image/png", "This replay supports PNG inputs.");
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    let blocked = 0;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.origin === origin) {
        if (url.pathname === "/") return route.fulfill({body: workbench, contentType: "text/html"});
        if (url.pathname === "/images.js" || /^\/creative\/[\w.-]+\.(js|css)$/.test(url.pathname)) {
          return route.fulfill({path: fileURLToPath(new URL(`../public${url.pathname}`, import.meta.url))});
        }
        if (url.pathname === "/favicon.ico") return route.fulfill({status: 204});
      }
      blocked++;
      return route.abort();
    });
    await page.goto(origin);
    await page.locator(".image-drop input[type=file]").setInputFiles({name: "source.png", mimeType: "image/png", buffer: source});
    await page.getByRole("button", {name: "Apply Web-ready image", exact: true}).click();
    await page.getByRole("button", {name: "Make this image", exact: true}).click();
    const actual = JSON.parse((await download(page, "Download image receipt (.json)")).toString("utf8"));
    const exported = await download(page, "Download WEBP");
    assert(isDeepStrictEqual(actual, expected), "The Web-ready preset did not reproduce the selected receipt.");
    assert.equal(exported.length, expected.output.bytes);
    assert.equal(digest(exported), expected.output.sha256);
    assert.equal(blocked, 0, "The workbench tried to access an unexpected resource.");
    console.log(JSON.stringify({browser: browser.version(), output: actual.output, source: actual.source, networkRequestsPassedThrough: 0}));
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Image receipt replay failed: ${error.message}`);
  process.exitCode = 1;
}
