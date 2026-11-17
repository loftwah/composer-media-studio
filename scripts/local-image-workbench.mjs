import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { MAX_IMAGE_INPUT_BYTES } from "../src/frontend/image-limits.ts";
import { sniffLocalImage } from "../src/frontend/image-metadata.ts";

const origin = "http://127.0.0.1";
const workbench = '<!doctype html><title>Image Tools replay</title><div id="images"></div><script type="module" src="/images.js"></script>';

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readSelection(path, limit) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    assert(info.isFile() && info.size > 0 && info.size <= limit, "Select a non-empty local file within the size limit.");
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await file.read({ buffer: bytes });
    assert.equal(bytesRead, bytes.length, "The selected file changed while being read.");
    return bytes;
  } finally {
    await file.close();
  }
}

export async function readLocalPng(path) {
  const bytes = await readSelection(path, MAX_IMAGE_INPUT_BYTES);
  assert.equal(sniffLocalImage(bytes).mime, "image/png", "This replay supports PNG inputs.");
  return bytes;
}

export async function readLocalJson(path) {
  return JSON.parse((await readSelection(path, 16 * 1024)).toString("utf8"));
}

export async function downloadLink(page, link) {
  await link.waitFor();
  const [result] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return { name: result.suggestedFilename(), bytes: await buffer(await result.createReadStream()) };
}

export async function runLocalImages(source, run) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    let blocked = 0;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.origin === origin) {
        if (url.pathname === "/") return route.fulfill({ body: workbench, contentType: "text/html" });
        if (url.pathname === "/images.js" || /^\/creative\/[\w.-]+\.(js|css)$/.test(url.pathname)) {
          return route.fulfill({ path: fileURLToPath(new URL(`../public${url.pathname}`, import.meta.url)) });
        }
        if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
      }
      blocked++;
      return route.abort();
    });
    await page.goto(origin);
    await page.locator(".image-drop input[type=file]").setInputFiles({ name: "source.png", mimeType: "image/png", buffer: source });
    const result = await run(page);
    assert.equal(blocked, 0, "The workbench tried to access an unexpected resource.");
    return { browser: browser.version(), ...result, networkRequestsPassedThrough: 0 };
  } finally {
    await browser.close();
  }
}
