# Image tools: adjustments, crop position, embed code and list order — 17 November 2026

Issue: [#183](https://github.com/loftwah/composer-media-studio/issues/183).
This covers the next browser-local slice of `/tools/images`. Nothing was
pushed, deployed, published or uploaded. All work stayed in
`/Users/deanlofts/gits/wt-studio183` on branch `feat/studio-183-remaining`,
based on `origin/main` `0c3a69e`.

## What changed

- **Light and colour** — exposure (±2 stops), contrast, saturation and
  temperature with Mono, Warm, Cool, Punch and Fade presets. Presets are named
  adjustment values, so the caption states the real numbers. Adjustments run on
  the exported canvas after crop and resize; alpha is never written and fully
  transparent pixels keep their RGB.
- **Crop position** — the aspect crop can be taken from the centre, four edges
  or four corners instead of always the centre.
- **Embed code** — Base64, data URI, CSS, HTML and Markdown from the exact
  exported bytes, with real character counts, a 2 MiB cap and a 128 KiB warning.
- **List order** — rows can be dragged or moved with Move up/Move down; the ZIP
  follows that order.
- **Caption fix** — a numeric crop aspect previously printed the word "aspect"
  in the result caption. It now names the real preset (for example
  "bottom crop 1:1 square").

## Method

| Item | Value |
| --- | --- |
| Base | `0c3a69e` |
| Build | `pnpm build:frontend` (Vite, `public/creative/home.js` + `images-*.js`) |
| Server | local static server over `public/`, no wrangler, no D1, no session |
| Harness | `tests/browser/images.mjs` (needs `PLAYWRIGHT_MODULE`) |
| Browsers | Chromium `158.0.8127.18`, Firefox `159.0`, WebKit `27.2`, headless |
| Receipts | [chromium](browser-receipt-chromium.json), [firefox](browser-receipt-firefox.json), [webkit](browser-receipt-webkit.json) |

The harness drives the real React page and measures pixels by decoding the
actual download bytes with `createImageBitmap`, not by reading the UI text.
Each engine's own canvas encoder is used, so byte counts differ between them by
design.

## Measured results (Chromium / Firefox / WebKit)

| Check | Measured |
| --- | --- |
| Generated sample | 1400 × 900 PNG; the UI reports 1.10 MiB / 385 KiB / 1.18 MiB |
| Resize to a 320 px long edge | 320 × 206 PNG at 82,896 / 54,050 / 83,589 bytes |
| Original unchanged | before 1400 × 900, after 320 × 206 in the same page |
| Mono preset | grey samples such as `[50,50,50]` / `[48,48,48]` / `[55,55,55]`, all alpha 255 |
| Adjustments reported | 65,920 pixels changed; caption `exposure +4, contrast +14, saturation -100` |
| Mono export | 52,497 / 34,558 / 49,807 bytes |
| Embed round-trip | data URI decodes to 320 × 206 and to exactly the download's bytes |
| Snippet size | 70,018 / 46,102 / 66,434 data-URI characters |
| Crop position top | 100 × 100 export, pixel `[255,0,0,255]` from the opaque red half |
| Crop position bottom | 100 × 100 export, all 10,000 pixels alpha 0 from the transparent half |
| JPEG with a green matte | 100 × 200 `.jpg`; the transparent half decodes as `[0,255,1,255]` while the Warm preset is active, so the matte is not tinted |
| WebP alpha | 100 × 200 `.webp`, 10,000 transparent pixels, 712 / 248 bytes in Chromium / Firefox |
| WebKit WebP | its canvas returns PNG, so the page refuses and names the real MIME instead of mislabelling the file |
| 390 px | `scrollWidth === innerWidth === 390`, no control outside the viewport |
| Network | every request stayed on `127.0.0.1`; no POST/PUT/PATCH/DELETE; no page errors |

All 22 checks passed in all three engines.

## Not verified here

- A physical phone, real touch dragging and Safari on iOS.
- A WebP export in WebKit: its canvas encoder returns PNG, so only the honest
  refusal path was verified there.
- The signed-in Studio import path (it needs a session and a project).
- A deployed production revision; this slice is local source only.
- GIF, PDF, background removal, redaction, sprite sheets and HTML-to-image stay
  deferred in [the coverage matrix](../../image-tools-coverage.md).
