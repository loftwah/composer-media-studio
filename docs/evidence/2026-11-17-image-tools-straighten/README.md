# Image tools: straighten and the kept-area overlay — 17 November 2026

Issue: [#183](https://github.com/loftwah/composer-media-studio/issues/183).
This is the next browser-local slice of `/tools/images`, based on `main` at
`8e4b9cc` and released as `fe9f4dc`. Nothing is uploaded, published or sent to a
provider.

## What changed

- **Straighten** — a new `−45°…+45°` control in 0.1° steps, positive clockwise
  relative to the current view. It runs after the quarter-turn/flip stage and
  before the aspect crop. The exported area is the largest centred rectangle of
  the chosen aspect that contains only real source pixels, inset by one pixel so
  an antialiased rotated edge cannot reach the file. No empty corner is ever
  exported.
- **Kept-area overlay** — a preview of the original with the exact kept crop
  outlined and everything discarded dimmed. The outline is the crop mapped back
  through straighten, quarter turns and flips, so it stays correct on the
  displayed (EXIF-oriented) source. The caption states the kept dimensions and
  the source dimensions.
- **Reset controls** — restores the original settings for the batch. Images,
  completed downloads and source Files are unchanged. Unlike **Clear all**, it
  keeps the work; a result made with other settings is still marked stale.
- **Trim interaction** — trim measures upright alpha bounds, so straighten is
  not combined with trim: changing straighten clears a trim with an explicit
  message, and the trim action refuses while the image is turned.
- **Notes layout** — explanatory notes inside the control fieldsets now span the
  fieldset and stop at 72ch instead of being squeezed into one 12rem column.
  This affects the existing trim, target-size and adjustment notes too.
- **Caption** — `describeTransform` now records `straighten 3.5° clockwise` (or
  `anticlockwise`) in the result caption and any explicit Studio import caption.

The original `File` is untouched throughout: the overlay reads the same object
URL, the render decodes a fresh bitmap, and reset never re-encodes the source.

## Method

| Item | Value |
| --- | --- |
| Base | `8e4b9cc` (`main`, clean and pushed); released `fe9f4dc` |
| Build | `pnpm build:frontend` (Vite) |
| Server | local static server over `public/`; no wrangler, D1 or session |
| Harness | `tests/browser/images.mjs` (`PLAYWRIGHT_MODULE`) |
| Browsers | Chromium 158, Firefox 159, WebKit 27.2, headless |
| Receipts | [chromium](browser-receipt-chromium.json), [firefox](browser-receipt-firefox.json), [webkit](browser-receipt-webkit.json) |
| Impeccable | v4.8.0 at `/Users/deanlofts/.agents/skills/impeccable` (opencode harness); `impeccable context --target src/frontend/images.tsx`; Operate mode + craft floor read |

The harness adds a synthetic 300 × 300 opaque PNG with a vertical dark stripe.
It sets straighten to 10°, makes the image, decodes the real downloaded bytes,
and measures the stripe centroid at 10% and 90% of the result height. It also
requires every exported alpha pixel to be 255, so a blank rotated corner would
fail the check rather than pass on dimensions alone.

## Measured results (Chromium / Firefox / WebKit)

| Check | Measured |
| --- | --- |
| Straighten control | `Straighten 10.0° clockwise`; keyboard ArrowRight moves `-4` → `-3.9` and the label to `3.9° anticlockwise` |
| Kept area | `257 × 257 px of 300 × 300` for 10°; SVG outline has 4 points and exactly overlays the preview box |
| Export | 300 × 300 PNG; 8,711 / 8,889 / 7,388 bytes |
| Measured tilt | stripe centroid delta 42.0 px vs `tan(10°) × 0.8 × height` = 42.32 px |
| Empty corners | 0 pixels below alpha 255 in the export |
| Caption | `straighten 10.0° clockwise, long edge 300px, PNG, canvas re-encode` |
| Reset controls | straighten `0`, long edge `2048`, PNG; stale-result notice shown; earlier download still present; source still 300 × 300 |
| 390 px | `scrollWidth === innerWidth === 390`, no control outside the viewport |
| Network | every request stayed on `127.0.0.1`; no POST/PUT/PATCH/DELETE; no page errors |

All 28 checks passed in all three engines.

## Rendered inspection

| Evidence | What it shows |
| --- | --- |
| [straighten-control-desktop.png](straighten-control-desktop.png) | The new control at 1440 px with the real angle and the note at full fieldset width |
| [straighten-control-phone.png](straighten-control-phone.png) | The same fieldset at 390 px, one column |
| [keep-overlay-desktop.png](keep-overlay-desktop.png) | The 10° rotated keep area on the 300 × 300 stripe |
| [keep-overlay-phone.png](keep-overlay-phone.png) | The same overlay at 390 px |
| [sample-keep-desktop.png](sample-keep-desktop.png) | The generated sample (1400 × 900) with a 4:5 top crop and −4°: `682 × 852 px of 1400 × 900` |
| [sample-keep-phone.png](sample-keep-phone.png) | The same state at 390 px |
| [sample-keep-dark.png](sample-keep-dark.png) | The overlay under the Studio dark theme (`data-theme="dark"`) |
| [live-keep-desktop.png](live-keep-desktop.png) | The released page at `media.loftwah.com`, 10° on the stripe |
| [live-straighten-control-phone.png](live-straighten-control-phone.png) | The released control at 390 px |

The straighten fieldset and the kept-area figure were also inspected in dark
theme and with a visible focus ring. The phone screenshots were captured
headlessly at 390 × 844; no horizontal overflow was measured.

## Live release

`pnpm deploy` passed its own `pnpm check` and frontend build, uploaded, and read
back the exact source identity: revision `fe9f4dc2b5bfbfb13b6d8728db3f513238344fd4`
at `2026-11-16T14:29:01.184Z` (28.2 s). `GET https://media.loftwah.com/build.json`
reports the same revision.

A headless Chromium pass then loaded the live `/tools/images` page, dropped the
same synthetic stripe, set 10°, downloaded `stripe-300x300.png` through the real
download link, and measured 8,711 bytes, 300 × 300, a 42.0 px centroid tilt
against `tan(10°) × 0.8 × height = 42.32`, and zero pixels below alpha 255.
**Reset controls** restored `0` and `2048` while the earlier download stayed
available and the stale-result notice appeared. At 390 px,
`scrollWidth === innerWidth === 390` with no control outside the viewport, and
there were no page errors.

Two live-only observations, both pre-existing and outside this slice:

- Cloudflare injects an inline bot-detection script that the site's own
  `script-src` policy blocks, so one CSP console error appears. The page itself
  raises no error and its module script runs.
- The live page loads Cloudflare's Insights beacon and uses `blob:` URLs for its
  previews. No user image, session or transform setting is sent anywhere; there
  were no API writes. The local harness records zero off-origin requests because
  the static evidence server has no Cloudflare layer.

## Not verified here

- A physical phone, real touch dragging or Safari on iOS.
- Dark-theme contrast with an automated ratio checker; the values were read
  visually in the Studio dark theme, not measured per element.
- Freeform crop handles, horizon detection, lens correction, GIF, PDF,
  background removal, redaction, sprite sheets and HTML-to-image remain
  deferred or delegated in [the coverage matrix](../../image-tools-coverage.md).
