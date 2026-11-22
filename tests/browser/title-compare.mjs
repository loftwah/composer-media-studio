// Browser evidence for the title + thumbnail compare slice (Studio #488):
// drives the built workbench in headless Chromium from a plain local static
// server, with synthetic local fixtures only. No wrangler, no session, no
// provider and no request off this origin.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = process.env.STUDIO_COMPARE_OUT ?? join(ROOT, ".impeccable/review");
const BROWSER = process.env.STUDIO_BROWSER ?? "chromium";
const REVIEW = process.env.STUDIO_COMPARE_RECEIPT ?? join(ROOT, "output/browser-evidence/title-compare");
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const PAGE = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image tools — local evidence</title>
<link rel="preload" href="/brand/space-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/studio.css">
<link rel="stylesheet" href="/creative/home.css">
<script src="/theme.js" defer></script>
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
await mkdir(REVIEW, { recursive: true });

const receipt = {
  startedAt: new Date().toISOString(),
  origin: "local static server (built frontend, no worker)",
  firstEditAt: "2026-11-22T06:27:59Z",
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

const SECTION = ".image-title-compare";

/** Draw a synthetic PNG in the page and hand it back as Node bytes. */
async function pngFromPage(page, width, height, painter) {
  const base64 = await page.evaluate(
    ({ width, height, painter }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      // eslint-disable-next-line no-new-func
      new Function("context", `with (context) { ${painter} }`)(context);
      return new Promise((done) => canvas.toBlob(async (blob) => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result).split(",")[1]);
        reader.readAsDataURL(blob);
      }, "image/png"));
    },
    { width, height, painter },
  );
  return Buffer.from(base64, "base64");
}

const LONG_TITLE =
  "After Hours — The Room Wall: the slower cut where the lamp holds one extra beat before the margin closes, and the paper grain keeps breathing while the title keeps running on and on past the second line on purpose";

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("request", (request) => receipt.requests.push(`${request.method()} ${request.url()}`));
  page.on("pageerror", (error) => receipt.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") receipt.pageErrors.push(message.text());
  });

  await page.goto(`${ORIGIN}/check.html`, { waitUntil: "networkidle" });
  const section = page.locator(SECTION);
  await section.waitFor({ timeout: 30_000 });
  await section.scrollIntoViewIfNeeded();

  const head = await section.locator(".image-section-head").innerText();
  record("the section renders inside the workbench shell", /Title \+ thumbnail compare/.test(head), head.replace(/\s+/g, " "));

  const pairs = await section.locator("[data-title-compare-pair]").count();
  record("three pair cards are present", pairs === 3, { pairs });

  // Pair A: a long title over a landscape quadrant fixture, so truncation and
  // a full-fit crop are both visible at once.
  await section.getByLabel("Title A").fill(LONG_TITLE);
  const widePng = await pngFromPage(
    page,
    1280,
    720,
    `fillStyle='#c0392b'; fillRect(0,0,640,360); fillStyle='#2e86c1'; fillRect(640,0,640,360); fillStyle='#1e8449'; fillRect(0,360,640,360); fillStyle='#d4ac0d'; fillRect(640,360,640,360);`,
  );
  await section.getByLabel("Thumbnail A").setInputFiles({
    name: "wide-quadrants.png",
    mimeType: "image/png",
    buffer: widePng,
  });
  await section.locator("[data-title-compare-pair='a']").getByText(/1280 × 720 px/).waitFor({ timeout: 30_000 });
  const aMeta = await section.locator("[data-title-compare-pair='a']").getByText(/1280 × 720 px/).innerText();
  record("pair A decodes with oriented facts from the local bytes", /1280 × 720 px/.test(aMeta), aMeta);

  const objectPosition = await section
    .locator("[data-title-compare-thumb='a-card'] img")
    .evaluate((element) => element.style.objectPosition);
  record("the live preview starts at the centre anchor", objectPosition === "50% 50%", { objectPosition });

  await section.getByLabel("Preview crop position").selectOption("left");
  const leftPosition = await section
    .locator("[data-title-compare-thumb='a-card'] img")
    .evaluate((element) => element.style.objectPosition);
  record("changing the anchor moves the real crop preview", leftPosition === "0% 50%", { leftPosition });
  await section.getByLabel("Preview crop position").selectOption("centre");

  // -webkit-line-clamp reports a clamped scrollHeight in Chrome, so prove the
  // truncation by unclamping the same element and comparing heights. At
  // desktop width the card truncates; the row truncates at phone width below.
  const truncation = await section
    .locator("[data-title-compare-preview='a']")
    .evaluate((figure) => {
      const measure = (element, fontPx) => {
        const clampedHeight = element.clientHeight;
        const before = element.getAttribute("style") ?? "";
        element.style.webkitLineClamp = "unset";
        element.style.overflow = "visible";
        const naturalHeight = element.scrollHeight;
        element.setAttribute("style", before);
        return {
          clampedHeight,
          naturalHeight,
          truncates: naturalHeight > clampedHeight + 2,
          naturalLines: Math.round(naturalHeight / (fontPx * 1.35)),
        };
      };
      return measure(figure.querySelector(".title-compare-title-card"), 18);
    });
  record("the long title actually truncates at card scale", truncation.truncates, truncation);

  // Pair B: a square fixture with three horizontal bands, for anchor parity
  // between the preview and the exported pixels.
  await section.getByLabel("Title B").fill("Quiet margin");
  const bandedPng = await pngFromPage(
    page,
    1080,
    1080,
    `fillStyle='#c0392b'; fillRect(0,0,1080,360); fillStyle='#1e8449'; fillRect(0,360,1080,360); fillStyle='#2e86c1'; fillRect(0,720,1080,360);`,
  );
  await section.getByLabel("Thumbnail B").setInputFiles({
    name: "banded-square.png",
    mimeType: "image/png",
    buffer: bandedPng,
  });
  await section.locator("[data-title-compare-pair='b']").getByText(/1080 × 1080 px/).waitFor({ timeout: 30_000 });

  await section.getByLabel("Preview crop position").selectOption("top");
  await section.getByRole("button", { name: "Export Pair A card thumbnail (640 × 360)" }).click();
  await section.getByRole("link", { name: "Download card PNG" }).waitFor({ timeout: 30_000 });
  const exported = await page.evaluate(async () => {
    const link = document.querySelector(".image-title-compare .title-compare-export a");
    const response = await fetch(link.href);
    const buffer = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      bytes: buffer.byteLength,
      name: link.getAttribute("download"),
      top: at(320, 10),
      middle: at(320, 180),
    };
    bitmap.close();
    return result;
  });
  record(
    "the card export is a real 640 × 360 PNG named for the pair's title",
    exported.width === 640 && exported.height === 360 && /-feed-640x360\.png$/.test(exported.name ?? ""),
    { width: exported.width, height: exported.height, name: exported.name, bytes: exported.bytes },
  );
  const quadrants = await page.evaluate(async () => {
    const link = document.querySelector(".image-title-compare .title-compare-export a");
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const result = {
      topLeft: at(10, 10),
      topRight: at(630, 10),
      bottomLeft: at(10, 350),
      bottomRight: at(630, 350),
    };
    bitmap.close();
    return result;
  });
  const isRed = ([r, g]) => r > 140 && g < 90;
  const isBlue = ([r, g, b]) => b > 140 && r < 90;
  const isGreen = ([r, g, b]) => g > 100 && r < 80 && b < 110;
  const isYellow = ([r, g, b]) => r > 160 && g > 120 && b < 90;
  record(
    "the exported pixels are the shown centre crop of the source",
    isRed(quadrants.topLeft) && isBlue(quadrants.topRight) && isGreen(quadrants.bottomLeft) && isYellow(quadrants.bottomRight),
    quadrants,
  );

  // The banded square on pair B: anchor top must keep the red band, anchor
  // bottom the blue band, in the same pixels the preview shows. Selecting
  // pair B is what aims both export buttons at it.
  await section.getByLabel("Preview crop position").selectOption("top");
  await section.locator("[data-title-compare-pair='b'] input[type='radio']").check();
  await section.getByRole("button", { name: "Export Pair B card thumbnail (640 × 360)" }).click();
  await page.waitForFunction(
    () => document.querySelector(".image-title-compare .title-compare-export a")?.getAttribute("download")?.startsWith("Quiet-margin"),
    null,
    { timeout: 30_000 },
  );
  const topBand = await page.evaluate(async () => {
    const link = document.querySelector(".image-title-compare .title-compare-export a");
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const result = { top: at(320, 10), bottom: at(320, 350) };
    bitmap.close();
    return result;
  });
  record(
    "the top-anchored export keeps the preview's top band",
    isRed(topBand.top) && isGreen(topBand.bottom),
    topBand,
  );

  await section.getByLabel("Preview crop position").selectOption("bottom");
  await section.getByRole("button", { name: "Export Pair B card thumbnail (640 × 360)" }).click();
  await page.waitForFunction(
    () => {
      const note = document.querySelector(".image-title-compare [role='status']")?.textContent ?? "";
      return note.includes("Card export ready");
    },
    null,
    { timeout: 30_000 },
  );
  const bottomBand = await page.evaluate(async () => {
    const link = document.querySelector(".image-title-compare .title-compare-export a");
    const buffer = await (await fetch(link.href)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const at = (x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const result = { top: at(320, 10), bottom: at(320, 350) };
    bitmap.close();
    return result;
  });
  record(
    "the bottom-anchored export keeps the preview's bottom band",
    isGreen(bottomBand.top) && isBlue(bottomBand.bottom),
    bottomBand,
  );

  // Keyboard: the radio group moves with the arrow keys alone.
  await section.getByLabel("Preview crop position").selectOption("centre");
  await section.locator("[data-title-compare-pair='a'] input[type='radio']").focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  const afterDown = await section.locator(".image-section-head span").innerText();
  record("ArrowDown moves the compared pair to B", /Pair B selected/.test(afterDown), afterDown);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(100);
  const afterUp = await section.locator(".image-section-head span").innerText();
  record("ArrowUp moves the compared pair back to A", /Pair A selected/.test(afterUp), afterUp);

  // A refused file keeps the pair and names the reason.
  await section.getByLabel("Thumbnail C").setInputFiles({
    name: "note.html",
    mimeType: "text/html",
    buffer: Buffer.from("<!doctype html><html><body>x</body></html>", "utf8"),
  });
  const refusal = section.locator("[data-title-compare-pair='c'] [role='alert']");
  await refusal.waitFor({ timeout: 30_000 });
  const refusalText = await refusal.innerText();
  record("an HTML file is refused with a visible reason", /HTML/.test(refusalText), refusalText);

  // Pair C gets a small exact-size fixture so all three previews are live.
  await section.getByLabel("Title C").fill("Margin closed");
  const smallPng = await pngFromPage(
    page,
    640,
    360,
    `fillStyle='#7d3c98'; fillRect(0,0,640,360); fillStyle='#f9e79f'; fillRect(0,180,640,180);`,
  );
  await section.getByLabel("Thumbnail C").setInputFiles({
    name: "small-exact.png",
    mimeType: "image/png",
    buffer: smallPng,
  });
  await section.locator("[data-title-compare-pair='c']").getByText(/640 × 360 px/).waitFor({ timeout: 30_000 });
  const cPreviewCount = await section.locator("[data-title-compare-thumb='c-card'] img").count();
  record("the third preview goes live from its own local bytes", cPreviewCount === 1, { cPreviewCount });

  // Screenshots for the design review: desktop, then dark theme.
  await page.evaluate(() => document.querySelector(".image-title-compare")?.scrollIntoView());
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, "desktop.png"), fullPage: true });
  await section.screenshot({ path: join(OUT, "title-compare-desktop.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(150);
  await section.screenshot({ path: join(OUT, "title-compare-dark.png") });
  await page.screenshot({ path: join(OUT, "dark.png"), fullPage: true });
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });

  // Phone: the section stacks without horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector(".image-title-compare")?.scrollIntoView());
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, "mobile.png"), fullPage: true });
  const phone = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    controlsOutside: [...document.querySelectorAll(".image-title-compare input, .image-title-compare select, .image-title-compare button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .map((element) => element.tagName),
  }));
  record(
    "390 px keeps the section inside the viewport with no horizontal overflow",
    phone.scrollWidth === phone.innerWidth && phone.controlsOutside.length === 0,
    phone,
  );

  // At phone width the row title column is narrow enough that the same long
  // title genuinely exceeds two lines and the clamp truncates it.
  const rowTruncation = await section
    .locator("[data-title-compare-preview='a']")
    .evaluate((figure) => {
      const element = figure.querySelector(".title-compare-title-row");
      const clampedHeight = element.clientHeight;
      const before = element.getAttribute("style") ?? "";
      element.style.webkitLineClamp = "unset";
      element.style.overflow = "visible";
      const naturalHeight = element.scrollHeight;
      element.setAttribute("style", before);
      return {
        clampedHeight,
        naturalHeight,
        truncates: naturalHeight > clampedHeight + 2,
        naturalLines: Math.round(naturalHeight / (14 * 1.35)),
      };
    });
  record(
    "the long title genuinely truncates at row scale on a phone",
    rowTruncation.truncates && rowTruncation.naturalLines > 2,
    rowTruncation,
  );

  // 200% zoom: a fresh context rendered at device scale 2 — the same CSS
  // pixels-per-point shift 200% browser zoom produces — checked for clipping.
  const zoomContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const zoomPage = await zoomContext.newPage();
  zoomPage.on("pageerror", (error) => receipt.pageErrors.push(error.message));
  zoomPage.on("console", (message) => {
    if (message.type() === "error") receipt.pageErrors.push(message.text());
  });
  await zoomPage.goto(`${ORIGIN}/check.html`, { waitUntil: "networkidle" });
  const zoomSection = zoomPage.locator(SECTION);
  await zoomSection.waitFor({ timeout: 30_000 });
  await zoomSection.getByLabel("Title A").fill(LONG_TITLE);
  await zoomSection.getByLabel("Thumbnail A").setInputFiles({
    name: "wide-quadrants.png",
    mimeType: "image/png",
    buffer: widePng,
  });
  await zoomSection.locator("[data-title-compare-pair='a']").getByText(/1280 × 720 px/).waitFor({ timeout: 30_000 });
  await zoomSection.getByLabel("Thumbnail B").setInputFiles({
    name: "banded-square.png",
    mimeType: "image/png",
    buffer: bandedPng,
  });
  await zoomSection.locator("[data-title-compare-pair='b']").getByText(/1080 × 1080 px/).waitFor({ timeout: 30_000 });
  await zoomSection.getByLabel("Thumbnail C").setInputFiles({
    name: "small-exact.png",
    mimeType: "image/png",
    buffer: smallPng,
  });
  await zoomSection.locator("[data-title-compare-pair='c']").getByText(/640 × 360 px/).waitFor({ timeout: 30_000 });
  await zoomSection.scrollIntoViewIfNeeded();
  await zoomPage.waitForTimeout(200);
  await zoomSection.screenshot({ path: join(OUT, "title-compare-zoom-200.png") });
  const zoom = await zoomPage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    clipped: [...document.querySelectorAll(".image-title-compare .title-compare-thumb img")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
      })
      .length,
  }));
  record(
    "200% zoom keeps the section and its thumbs inside the viewport",
    zoom.scrollWidth === zoom.innerWidth && zoom.clipped === 0 && zoom.devicePixelRatio === 2,
    zoom,
  );
  await zoomContext.close();

  // A slow encode that finishes after the user selects another pair must
  // still say which pair and anchor it exported, not the new selection.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, (blob) => setTimeout(() => callback(blob), 600), type, quality);
    };
    window.__restoreToBlob = () => {
      HTMLCanvasElement.prototype.toBlob = original;
    };
  });
  await section.getByLabel("Preview crop position").selectOption("left");
  await section.getByRole("button", { name: "Export Pair A card thumbnail (640 × 360)" }).click();
  await section.locator("[data-title-compare-pair='b'] input[type='radio']").check();
  await section.getByLabel("Preview crop position").selectOption("bottom");
  await page.waitForFunction(
    () => {
      const note = document.querySelector(".image-title-compare [role='status']")?.textContent ?? "";
      return note.includes("Card export ready for Pair A");
    },
    null,
    { timeout: 30_000 },
  );
  const switchedExport = await page.evaluate(() => ({
    note: document.querySelector(".image-title-compare .title-compare-export")?.textContent ?? "",
    status: document.querySelector(".image-title-compare [role='status']")?.textContent ?? "",
    selected: document.querySelector(".image-title-compare .image-section-head span")?.textContent ?? "",
    anchor: document.querySelector(".image-title-compare select")?.value ?? "",
  }));
  record(
    "an in-flight export stays labelled with its own pair and anchor",
    /Pair A · Left crop/.test(switchedExport.note) &&
      /Pair A · left crop/.test(switchedExport.status) &&
      /Pair B selected/.test(switchedExport.selected) &&
      switchedExport.anchor === "bottom",
    switchedExport,
  );
  await page.evaluate(() => window.__restoreToBlob?.());

  // A slower local decode that lands after a newer pick must not put its
  // image (or its object URL) back into the pair the user has already replaced.
  const slowPng = await pngFromPage(
    page,
    120,
    90,
    `fillStyle='#c0392b'; fillRect(0,0,120,90);`,
  );
  const fastPng = await pngFromPage(
    page,
    200,
    150,
    `fillStyle='#1e8449'; fillRect(0,0,200,150);`,
  );
  await page.evaluate(
    ({ slow, fast }) => {
      const fromBase64 = (base64, name) =>
        new File([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], name, {
          type: "image/png",
        });
      const drop = (file) => {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        document
          .querySelector("[data-title-compare-pair='b'] .title-compare-drop")
          ?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      };
      const original = window.createImageBitmap;
      window.createImageBitmap = function (source, ...rest) {
        const call = original.call(window, source, ...rest);
        if (!(source instanceof File) || source.name !== "slow-load.png") return call;
        return new Promise((resolve, reject) => setTimeout(() => call.then(resolve, reject), 700));
      };
      window.__restoreBitmap = () => {
        window.createImageBitmap = original;
      };
      drop(fromBase64(slow, "slow-load.png"));
      setTimeout(() => drop(fromBase64(fast, "fast-win.png")), 80);
    },
    { slow: slowPng.toString("base64"), fast: fastPng.toString("base64") },
  );
  await section.locator("[data-title-compare-pair='b']").getByText(/200 × 150 px/).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const delayedLoad = await section.locator("[data-title-compare-pair='b']").innerText();
  record(
    "a delayed load cannot replace the newer local image",
    /fast-win\.png/.test(delayedLoad) && /200 × 150 px/.test(delayedLoad) && !/slow-load\.png/.test(delayedLoad),
    delayedLoad.replace(/\s+/g, " "),
  );
  await page.evaluate(() => window.__restoreBitmap?.());

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
await writeFile(join(REVIEW, "title-compare-browser-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`\n${receipt.checks.filter((check) => check.ok).length}/${receipt.checks.length} checks passed · receipt ${join(REVIEW, "title-compare-browser-receipt.json")}`);
process.exit(receipt.passed ? 0 : 1);
