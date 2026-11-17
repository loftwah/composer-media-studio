// Browser evidence for Studio #183: the signed-out image workbench.
// Serves the built frontend from a plain local static server, drives the real
// React page in Chromium and measures real decoded pixels and encoded bytes.
// No wrangler, no session, no provider and no network request off this origin.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = process.env.STUDIO_IMAGE_OUT ?? "output/browser-evidence/183";
const BROWSER = process.env.STUDIO_BROWSER ?? "chromium";
const pw = await loadPlaywright();

async function loadPlaywright() {
  const modulePath = process.env.PLAYWRIGHT_MODULE ?? "playwright";
  return import(modulePath);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image tools — local evidence</title>
<link rel="stylesheet" href="/creative/home.css">
</head><body><div id="images"><main id="main"><h1>Image tools</h1>
<p>JavaScript is required.</p></main></div>
<script type="module" src="/images.js"></script></body></html>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/check.html") {
    response.writeHead(200, { "content-type": TYPES[".html"] });
    response.end(PAGE);
    return;
  }
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  const path = normalize(join(ROOT, "public", decodeURIComponent(url.pathname)));
  if (!path.startsWith(join(ROOT, "public"))) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address();
const ORIGIN = `http://127.0.0.1:${port}`;
await mkdir(OUT, { recursive: true });

const receipt = {
  startedAt: new Date().toISOString(),
  origin: "local static server (built frontend, no worker)",
  checks: [],
  failures: [],
  requests: [],
  pageErrors: [],
};
const record = (check, ok, detail) => {
  receipt.checks.push({ check, ok, detail });
  if (!ok) receipt.failures.push({ check, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${check}`, detail === undefined ? "" : JSON.stringify(detail));
};

const browser = await pw[BROWSER].launch({ headless: true });
receipt.browser = { name: BROWSER, version: browser.version() };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("request", (request) => receipt.requests.push(`${request.method()} ${request.url()}`));
  page.on("pageerror", (error) => receipt.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") receipt.pageErrors.push(message.text());
  });

  await page.goto(`${ORIGIN}/check.html`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Try the sample" }).click();
  await page.locator(".image-facts").first().waitFor({ timeout: 30_000 });
  const sourceFacts = await page.locator(".image-facts").first().innerText();
  record("sample decodes at 1400 × 900", /1400 × 900/.test(sourceFacts), sourceFacts.replace(/\s+/g, " ").trim());

  await page.getByLabel("Long edge (px)").fill("320");
  await page.getByRole("button", { name: "Make this image" }).click();
  await page.locator(".image-result").waitFor({ timeout: 30_000 });

  const resized = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const response = await fetch(link.href);
    const buffer = await response.arrayBuffer();
    const type = response.headers.get("content-type");
    const bitmap = await createImageBitmap(new Blob([buffer], { type }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(await createImageBitmap(new Blob([buffer], { type })), 0, 0);
    const pixel = [...context.getImageData(40, 40, 1, 1).data];
    return {
      bytes: buffer.byteLength,
      type,
      ...size,
      pixel,
      caption: document.querySelector(".image-result .trim-note")?.textContent?.trim(),
      downloadName: link.getAttribute("download"),
      before: document.querySelectorAll(".image-compare figcaption")[0]?.textContent?.trim(),
      after: document.querySelectorAll(".image-compare figcaption")[1]?.textContent?.trim(),
    };
  });
  record(
    "resize produces a real 320-px PNG with measured bytes",
    resized.width === 320 && resized.height === 206 && resized.bytes > 0 && resized.type === "image/png",
    { width: resized.width, height: resized.height, bytes: resized.bytes, type: resized.type },
  );
  record("the original stays 1400 × 900 while the result is 320 × 206", /1400 × 900/.test(resized.before ?? "") && /320 × 206/.test(resized.after ?? ""), {
    before: resized.before,
    after: resized.after,
  });
  record("download name carries the real size and extension", resized.downloadName === "studio-image-sample-320x206.png", resized.downloadName);

  await page.getByLabel("Preset").selectOption("mono");
  const presetValue = await page.getByLabel("Preset").inputValue();
  await page.getByRole("button", { name: "Make this image" }).click();
  await page.waitForFunction(
    () => document.querySelector(".image-result .trim-note")?.textContent?.includes("saturation -100"),
    null,
    { timeout: 30_000 },
  );
  const mono = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const samples = [];
    for (const [x, y] of [
      [10, 10],
      [160, 100],
      [300, 190],
    ]) {
      const offset = (y * bitmap.width + x) * 4;
      samples.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
    }
    const alphas = new Set();
    for (let index = 3; index < data.length; index += 4) alphas.add(data[index]);
    return {
      samples,
      grey: samples.every(([r, g, b]) => r === g && g === b),
      alphaValues: [...alphas],
      changed: document.querySelector(".image-result .trim-note + .trim-note")?.textContent?.trim(),
      caption: document.querySelector(".image-result .trim-note")?.textContent?.trim(),
    };
  });
  record("the Mono preset is a real greyscale export", mono.grey, mono.samples);
  record("preset selection is reflected in the visible control", presetValue === "mono", presetValue);
  record("the caption states the real adjustment numbers", /saturation -100/.test(mono.caption ?? ""), mono.caption);
  record("the export keeps a single opaque alpha value", mono.alphaValues.length === 1 && mono.alphaValues[0] === 255, mono.alphaValues);
  record("the page reports how many pixels changed", /Adjustments changed [\d,]+ pixels?/.test(mono.changed ?? ""), mono.changed);

  await page.getByRole("button", { name: /Build embed code|Rebuild embed code/ }).click();
  await page.locator(".image-snippet textarea").waitFor({ timeout: 30_000 });
  const snippet = await page.evaluate(async () => {
    const text = document.querySelector(".image-snippet textarea").value;
    const tab = document.querySelector(".image-snippet-actions [aria-pressed='true']")?.textContent;
    const stats = document.querySelector(".image-snippet .trim-note")?.textContent?.trim();
    const response = await fetch(text);
    const buffer = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const downloadBytes = (await (await fetch(link.href)).arrayBuffer()).byteLength;
    return {
      prefix: text.slice(0, 30),
      characters: text.length,
      bytes: buffer.byteLength,
      downloadBytes,
      width: size.width,
      height: size.height,
      tab,
      stats,
    };
  });
  record("the data URI decodes back to the exported pixels", snippet.prefix.startsWith("data:image/png;base64,"), snippet.prefix);
  record(
    "the embedded bytes and dimensions match the download",
    snippet.width === 320 && snippet.height === 206 && snippet.bytes === snippet.downloadBytes,
    {
      bytes: snippet.bytes,
      downloadBytes: snippet.downloadBytes,
      width: snippet.width,
      height: snippet.height,
      characters: snippet.characters,
    },
  );
  record("the snippet states its real character count", /base64 characters/.test(snippet.stats ?? ""), snippet.stats);

  // A synthetic file with an opaque red top half and a transparent bottom half
  // proves the crop anchor and the preserved alpha in one real export.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 100, 100);
    context.clearRect(0, 100, 100, 100);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "halves.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document
      .querySelector(".image-drop")
      .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.locator(".image-list li", { hasText: "halves.png" }).waitFor({ timeout: 30_000 });
  await page.locator(".image-list-select", { hasText: "halves.png" }).click();
  await page.getByRole("button", { name: "Reset adjustments" }).click();
  await page.getByLabel("Crop aspect").selectOption("square");
  await page.getByLabel("Long edge (px)").fill("100");
  await page.getByLabel("Crop position").selectOption("top");
  await page.getByRole("button", { name: "Make this image" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".image-compare figcaption")[1]?.textContent?.includes("100 × 100"),
    null,
    { timeout: 30_000 },
  );
  const topCrop = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { size: [bitmap.width, bitmap.height], pixel: [...data.slice(0, 4)] };
  });
  record("top crop keeps the red half", topCrop.pixel[0] === 255 && topCrop.pixel[1] === 0 && topCrop.pixel[3] === 255, topCrop);

  await page.getByLabel("Crop position").selectOption("bottom");
  await page.getByRole("button", { name: "Make this image" }).click();
  await page.waitForFunction(
    () => document.querySelector(".image-result .trim-note")?.textContent?.includes("bottom crop"),
    null,
    { timeout: 30_000 },
  );
  const bottomCrop = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let transparent = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] === 0) transparent += 1;
    return {
      size: [bitmap.width, bitmap.height],
      transparent,
      total: bitmap.width * bitmap.height,
      caption: document.querySelector(".image-result .trim-note")?.textContent?.trim(),
    };
  });
  record(
    "bottom crop keeps the transparent half and its alpha",
    bottomCrop.transparent === bottomCrop.total && /bottom crop/.test(bottomCrop.caption ?? ""),
    bottomCrop,
  );

  // JPEG has no alpha, so the matte must be composited after the adjustments
  // and stay the exact chosen colour behind the transparent half.
  await page.getByLabel("Crop aspect").selectOption("original");
  await page.getByLabel("Long edge (px)").fill("200");
  await page.getByLabel("Preset").selectOption("warm");
  await page.getByRole("group", { name: "Output" }).getByLabel("Format").selectOption("jpeg");
  await page.getByLabel("Matte colour for transparency").fill("#00ff00");
  await page.getByRole("button", { name: "Make this image" }).click();
  await page.getByRole("link", { name: /^Download JPEG$/ }).waitFor({ timeout: 30_000 });
  const jpeg = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const response = await fetch(link.href);
    const buffer = await response.arrayBuffer();
    const type = response.headers.get("content-type");
    const bitmap = await createImageBitmap(new Blob([buffer], { type }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
    };
    return {
      type,
      size: [bitmap.width, bitmap.height],
      downloadName: link.getAttribute("download"),
      top: at(50, 20),
      matte: at(50, 150),
      caption: document.querySelector(".image-result .trim-note")?.textContent?.trim(),
    };
  });
  record(
    "JPEG export is a real .jpg at the planned size",
    jpeg.type === "image/jpeg" && jpeg.size[0] === 100 && jpeg.size[1] === 200 && /\.jpg$/.test(jpeg.downloadName ?? ""),
    { type: jpeg.type, size: jpeg.size, downloadName: jpeg.downloadName },
  );
  record(
    "the JPEG matte keeps its exact colour behind transparency and is not warmed by the filter",
    jpeg.matte[1] > 200 && jpeg.matte[0] < 40 && jpeg.matte[2] < 40,
    jpeg.matte,
  );
  record("the warm preset is stated in the JPEG caption", /temperature \+32/.test(jpeg.caption ?? ""), jpeg.caption);

  await page.getByRole("group", { name: "Output" }).getByLabel("Format").selectOption("webp");
  await page.getByRole("button", { name: "Make this image" }).click();
  const webpOutcome = await page
    .waitForFunction(
      () => {
        const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
          /^Download WEBP$/.test(anchor.textContent ?? ""),
        );
        if (link) return { ok: true };
        const error = document.querySelector('.notice.warn[role="alert"]')?.textContent?.trim();
        return error ? { ok: false, error } : null;
      },
      null,
      { timeout: 30_000 },
    )
    .then((handle) => handle.jsonValue());
  if (!webpOutcome.ok) {
    record(
      "a browser without a WebP encoder refuses honestly instead of mislabelling the file",
      /instead of image\/webp/.test(webpOutcome.error ?? ""),
      webpOutcome.error,
    );
  } else {
    const webp = await page.evaluate(async () => {
      const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
        /^Download/.test(anchor.textContent ?? ""),
      );
      const response = await fetch(link.href);
      const buffer = await response.arrayBuffer();
      const type = response.headers.get("content-type");
      const bitmap = await createImageBitmap(new Blob([buffer], { type }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let transparent = 0;
      for (let y = 100; y < bitmap.height; y += 1) {
        for (let x = 0; x < bitmap.width; x += 1) {
          if (data[(y * bitmap.width + x) * 4 + 3] === 0) transparent += 1;
        }
      }
      return {
        type,
        size: [bitmap.width, bitmap.height],
        bytes: buffer.byteLength,
        downloadName: link.getAttribute("download"),
        transparent,
        expected: bitmap.width * 100,
      };
    });
    record(
      "WebP export keeps the transparent half as alpha",
      webp.type === "image/webp" && webp.transparent === webp.expected && /\.webp$/.test(webp.downloadName ?? ""),
      { type: webp.type, size: webp.size, bytes: webp.bytes, transparent: webp.transparent, expected: webp.expected, downloadName: webp.downloadName },
    );
  }

  // Straighten: a synthetic vertical stripe on an opaque 300 × 300 PNG. The
  // export must tilt the stripe by the chosen angle, keep every pixel opaque
  // (no empty rotated corner) and match the visible kept-area overlay.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 300, 300);
    context.fillStyle = "#101010";
    context.fillRect(140, 0, 20, 300);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "stripe.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document
      .querySelector(".image-drop")
      .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.locator(".image-list-select", { hasText: "stripe.png" }).click();
  await page.getByRole("button", { name: "Reset controls" }).click();
  await page.getByLabel("Long edge (px)").fill("300");
  await page.getByLabel(/Straighten/).evaluate((element) => {
    // React's value tracker ignores a direct assignment; use the native setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, "10");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const straightenLabel = await page.getByLabel(/Straighten/).evaluate((element) =>
    element.closest("label")?.textContent?.replace(/\s+/g, " ").trim(),
  );
  record("the straighten control states its real angle and direction", /10\.0° clockwise/.test(straightenLabel ?? ""), straightenLabel);

  const keep = await page.evaluate(() => {
    const svg = document.querySelector(".image-keep-overlay");
    const polygon = svg?.querySelector(".image-keep-outline");
    const stage = document.querySelector(".image-keep-stage")?.getBoundingClientRect();
    const overlay = svg?.getBoundingClientRect();
    return {
      points: polygon?.getAttribute("points")?.trim().split(/\s+/).length ?? 0,
      shade: Boolean(svg?.querySelector(".image-keep-shade")),
      caption: document.querySelector(".image-keep figcaption")?.textContent?.replace(/\s+/g, " ").trim(),
      viewBox: svg?.getAttribute("viewBox"),
      aligned: Boolean(stage && overlay && Math.abs(stage.width - overlay.width) < 1 && Math.abs(stage.height - overlay.height) < 1),
    };
  });
  record(
    "the keep overlay outlines a four-corner area aligned with the source preview",
    keep.points === 4 && keep.shade && keep.viewBox === "0 0 300 300" && keep.aligned,
    keep,
  );

  await page.getByRole("button", { name: "Make this image" }).click();
  await page.waitForFunction(
    () => document.querySelector(".image-result .trim-note")?.textContent?.includes("straighten 10.0° clockwise"),
    null,
    { timeout: 30_000 },
  );
  const straightened = await page.evaluate(async () => {
    const link = [...document.querySelectorAll(".image-result a")].find((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    );
    const response = await fetch(link.href);
    const buffer = await response.arrayBuffer();
    const type = response.headers.get("content-type");
    const bitmap = await createImageBitmap(new Blob([buffer], { type }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => data[(y * bitmap.width + x) * 4];
    let transparent = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] < 255) transparent += 1;
    const centroid = (row) => {
      let sum = 0;
      let count = 0;
      for (let x = 0; x < bitmap.width; x += 1) {
        if (at(x, row) < 96) {
          sum += x;
          count += 1;
        }
      }
      return count ? sum / count : null;
    };
    const top = centroid(Math.floor(bitmap.height * 0.1));
    const bottom = centroid(Math.floor(bitmap.height * 0.9));
    return {
      type,
      width: bitmap.width,
      height: bitmap.height,
      bytes: buffer.byteLength,
      transparent,
      top,
      bottom,
      tilt: top !== null && bottom !== null ? top - bottom : null,
      expectedTilt: bitmap.height * 0.8 * Math.tan((10 * Math.PI) / 180),
      downloadName: link.getAttribute("download"),
      caption: document.querySelector(".image-result .trim-note")?.textContent?.replace(/\s+/g, " ").trim(),
      keepCaption: document.querySelector(".image-keep figcaption")?.textContent?.replace(/\s+/g, " ").trim(),
      sourceFacts: document.querySelector(".image-facts")?.textContent?.replace(/\s+/g, " ").trim(),
    };
  });
  record(
    "straighten exports a real PNG tilted by the chosen angle",
    straightened.type === "image/png" &&
      straightened.width === 300 &&
      straightened.height === 300 &&
      straightened.tilt !== null &&
      Math.abs(straightened.tilt - straightened.expectedTilt) <= 8,
    {
      size: [straightened.width, straightened.height],
      tilt: straightened.tilt,
      expectedTilt: straightened.expectedTilt,
      bytes: straightened.bytes,
      downloadName: straightened.downloadName,
    },
  );
  record(
    "every exported pixel is opaque, so no empty rotated corner reached the file",
    straightened.transparent === 0,
    { transparent: straightened.transparent },
  );
  record(
    "the caption and keep overlay state the real straighten and crop",
    /straighten 10\.0° clockwise/.test(straightened.caption ?? "") &&
      /Kept area · \d+ × \d+ px of 300 × 300/.test(straightened.keepCaption ?? "") &&
      /300 × 300 px/.test(straightened.sourceFacts ?? ""),
    { caption: straightened.caption, keep: straightened.keepCaption },
  );

  await page.locator(".image-keep").screenshot({ path: join(OUT, "keep-overlay-desktop.png") });
  await page
    .locator("fieldset.image-controls", { hasText: "Straighten" })
    .screenshot({ path: join(OUT, "straighten-control-desktop.png") });
  await page.screenshot({ path: join(OUT, "straighten-desktop.png") });

  await page.getByRole("button", { name: "Reset controls" }).click();
  const reset = await page.evaluate(() => ({
    straighten: document.querySelector('input[type="range"][aria-describedby="image-straighten-note"]')?.value,
    longEdge: document.querySelector('input[type="number"]')?.value,
    stale: document.body.textContent?.includes("The settings changed since this result"),
    download: [...document.querySelectorAll(".image-result a")].some((anchor) =>
      /^Download/.test(anchor.textContent ?? ""),
    ),
    sourceFacts: document.querySelector(".image-facts")?.textContent?.replace(/\s+/g, " ").trim(),
  }));
  record(
    "reset controls restores the original values without touching images or downloads",
    reset.straighten === "0" && reset.longEdge === "2048" && reset.stale && reset.download && /300 × 300 px/.test(reset.sourceFacts ?? ""),
    reset,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel(/Straighten/).evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, "-6");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.locator(".image-keep").screenshot({ path: join(OUT, "keep-overlay-phone.png") });
  await page
    .locator("fieldset.image-controls", { hasText: "Straighten" })
    .screenshot({ path: join(OUT, "straighten-control-phone.png") });
  await page.screenshot({ path: join(OUT, "straighten-phone.png"), fullPage: false });
  await page.waitForTimeout(150);
  const phone = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    controlsOutside: [...document.querySelectorAll(".image-page input, .image-page select, .image-page textarea, .image-page button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => element.tagName),
  }));
  record("390 px has no horizontal overflow or controls outside the viewport", phone.scrollWidth === phone.innerWidth && phone.controlsOutside.length === 0, phone);

  const external = receipt.requests.filter(
    (request) => !request.endsWith("/check.html") && !request.includes(ORIGIN),
  );
  const apiWrites = receipt.requests.filter((request) => /^(POST|PUT|PATCH|DELETE) /.test(request));
  record("no request leaves the local origin", external.length === 0, external.slice(0, 5));
  record("no local action writes to an API", apiWrites.length === 0, apiWrites.slice(0, 5));
  record("no page errors", receipt.pageErrors.length === 0, receipt.pageErrors.slice(0, 5));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

receipt.finishedAt = new Date().toISOString();
receipt.passed = receipt.failures.length === 0;
await writeFile(join(OUT, "images-browser-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`\n${receipt.checks.filter((check) => check.ok).length}/${receipt.checks.length} checks passed · receipt ${join(OUT, "images-browser-receipt.json")}`);
process.exit(receipt.passed ? 0 : 1);
