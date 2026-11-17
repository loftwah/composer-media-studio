import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { MAX_IMAGE_INPUT_BYTES } from "../src/frontend/image-limits.mjs";
import { sniffLocalImage } from "../src/frontend/image-metadata.mjs";
import { IMAGE_RECEIPT_SCHEMA, IMAGE_RECEIPT_VERSION } from "../src/frontend/image-receipt.ts";
import { SOCIAL_SIZES } from "../src/frontend/image-social-kit.ts";

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

async function downloadLink(page, link) {
  await link.waitFor();
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return buffer(await result.createReadStream());
}

async function download(page, name) {
  return downloadLink(page, page.getByRole("link", {name, exact: true}));
}

function assertSocialReproducible(expected, actual, size) {
  const settings = actual.transform.settings;
  const differences = Object.keys(settings)
    .filter(key => !isDeepStrictEqual(expected.transform?.settings?.[key], settings[key]))
    .map(key => `settings.${key}`);
  if (!isDeepStrictEqual(expected.transform?.plan, actual.transform.plan))
    differences.push("transform plan");
  if (expected.output?.width !== size.width || expected.output?.height !== size.height ||
      expected.output?.mime !== "image/webp")
    differences.push("output dimensions or format");
  assert(
    differences.length === 0,
    `The default social kit could not reproduce this receipt. Check: ${differences.join(", ")}.`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: {type: "string"},
      receipt: {type: "string"},
      size: {type: "string"},
    },
  });
  assert(values.source && values.receipt, "Supply an explicit --source <PNG> and --receipt <JSON>.");
  const size = values.size ? SOCIAL_SIZES.find((candidate) => candidate.key === values.size) : null;
  assert(!values.size || size, `Select one social size: ${SOCIAL_SIZES.map((candidate) => candidate.key).join(", ")}.`);
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
    let actual;
    let exported;
    if (size) {
      // Leave the controls at their page defaults: the shipped social kit is
      // the only transform this replay is allowed to exercise.
      await page.getByRole("button", {name: "Make 4 social sizes", exact: true}).click();
      const row = page.locator(".image-social-list li").filter({hasText: size.label});
      await row.waitFor();
      actual = JSON.parse((await downloadLink(page, row.locator('a[download$="-receipt.json"]'))).toString("utf8"));
      exported = await downloadLink(page, row.locator('a[download$=".webp"]'));
      assertSocialReproducible(expected, actual, size);
      assert(isDeepStrictEqual(actual, expected), "The default social kit did not reproduce the selected receipt.");
    } else {
      await page.getByRole("button", {name: "Apply Web-ready image", exact: true}).click();
      await page.getByRole("button", {name: "Make this image", exact: true}).click();
      actual = JSON.parse((await download(page, "Download image receipt (.json)")).toString("utf8"));
      exported = await download(page, "Download WEBP");
      assert(isDeepStrictEqual(actual, expected), "The Web-ready preset did not reproduce the selected receipt.");
    }
    assert.equal(exported.length, expected.output.bytes);
    assert.equal(digest(exported), expected.output.sha256);
    assert.equal(blocked, 0, "The workbench tried to access an unexpected resource.");
    console.log(JSON.stringify({
      browser: browser.version(),
      ...(size ? { mode: `social:${size.key}` } : {}),
      output: actual.output,
      source: actual.source,
      networkRequestsPassedThrough: 0,
    }));
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
