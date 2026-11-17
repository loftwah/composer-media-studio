# Image tools coverage matrix (issue #183)

This is the beginning of the 19-tool matrix required by
[issue #183](https://github.com/loftwah/composer-media-studio/issues/183). It
records what the first `/tools/images` slice actually ships, what is delegated
to an existing owned system, and what remains deferred. It is not a claim that
the whole issue is complete.

The first slice is publicly usable signed out and without provider spend. It
runs in the browser, accepts JPEG/PNG/WebP up to 32 MiB and 40 megapixels, and
processes at most 20 images in one sequential batch. Evidence for the slice is
in [the image workbench evidence](evidence/2026-11-16-browser-local-image-workbench/README.md)
and [the straighten and kept-area overlay slice](evidence/2026-11-17-image-tools-straighten/README.md).

## Status key

- **Shipped** — implemented in `/tools/images` and covered by focused tests/evidence.
- **Partial** — a useful part is shipped, with the missing capability named.
- **Delegated** — the owned place for this job is another existing system; this
  page does not duplicate it.
- **Deferred** — not shipped in this slice, with a concrete reason.

## The matrix

| # | Tool job | Status | What this slice does | Remaining gap / owner |
| --- | --- | --- | --- | --- |
| 1 | Compress and optimise JPEG/PNG/WebP | **Partial** | JPEG/WebP quality control plus an optional target byte size. The target runs a deterministic, bounded search (at most seven encodes) for the highest tested quality that meets the target and reports the real encoded bytes and whether it was met. An unmet target is reported as not met, never as success. PNG states that a lossless byte target is not achievable and points to resizing. The before/after byte count is measured from the encoded Blob. | No perceptual/SSIM target, no automatic quality ladder across formats, no GIF/AVIF optimisation. Target search re-encodes up to seven times per image and is not a perceptually optimal encoder. |
| 2 | Resize | **Shipped** | Long-edge or exact width and height; output pixel bounds checked before drawing; source dimensions and output dimensions shown. | No separate DPI/print metadata rewrite. Exact dimensions may change aspect and say so. |
| 3 | Crop | **Shipped** | Aspect crop to original, 1:1, 4:5, 5:4, 16:9, 9:16, 3:2 or 2:3 with safe integer bounds, planned in rotated space. The kept region is chosen from nine positions — centre, four edges or four corners — including inside a trimmed region. A kept-area overlay outlines that region on the source preview and dims what the export discards, so the crop is visible before **Make this image**. | Freeform crop handles and arbitrary focal points are deferred. |
| 4 | Rotate and flip | **Shipped** | Quarter-turn rotation, horizontal/vertical flip and EXIF orientation applied before editing. Arbitrary-angle straightening runs from −45° to +45° in 0.1° steps, always clockwise-positive relative to the current view, and keeps the largest centred area whose pixels all come from the source (with a one-pixel safety inset). The kept-area overlay and the export use the same plan, and the caption states the real angle and direction. | No drag-handle horizon tool, edge detection or lens correction. Straighten and alpha trim are mutually exclusive because trim is measured on upright pixels. |
| 5 | Convert format | **Shipped** | Canvas export to real PNG, JPEG or WebP; the chosen MIME is verified from the output bytes. JPEG flattens alpha onto a chosen matte after adjustments, so the matte keeps its exact colour. | No AVIF/BMP/GIF encode and no universal HEIC decoder. The page refuses those inputs honestly. Installed Playwright WebKit 26.5 and 27.2 returned PNG for a WebP canvas request. The page detects a mismatched output and reports an error. |
| 6 | Batch selection, progress, cancel, retries and exports | **Shipped** | Process up to 20 images sequentially, with counts beside the batch actions, cancellation between images, per-file errors, retry and download. Row order controls both the store-only ZIP and the contact sheet. Remove keeps keyboard focus on the next surviving row, or the previous one at the end of the list, and returns it to the native file button only when the batch is empty. The ZIP writer produces unique flat names and bounds archive size. **Make contact sheet** previews and downloads a browser-local PNG of 2–20 completed results in fixed 240px tiles, up to four columns, with each image centred at its aspect ratio. A changed batch discards its old sheet and in-progress work. [Verified exports and decoded pixels](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6946348923). | Per-image settings remain open. The local contact-sheet command accepts PNG sources. |
| 7 | EXIF/metadata inspect | **Shipped** | Reads JPEG segments, PNG chunks and WebP chunks; reports camera, orientation, GPS presence, ICC, XMP, text/comments and other chunk labels. Unreadable EXIF is reported as present and unreadable, never absent. | No map link from GPS coordinates; coordinates are not decoded or displayed, only presence. |
| 8 | Metadata strip and verify | **Shipped** | Metadata-only copy for JPEG/PNG/WebP, no canvas re-encode. Verifies pixel payload bytes, dimensions, orientation and declared metadata after the rewrite. Preserves non-default orientation with a one-tag EXIF block so the picture does not rotate. ICC removal is optional and warned. | No guaranteed anonymity; pixel clues remain. Unknown ancillary chunks are reported, not silently treated as identity metadata. |
| 9 | Palette / eyedropper | **Shipped** | Up to 8 dominant colours from the decoded source, merging near-duplicates in a 5-bit RGB histogram. Fully transparent pixels are ignored; semi-transparent pixels keep their average alpha. Each colour reports HEX, RGB, HSL and coverage of visible sampled pixels. Swatches are keyboard-reachable buttons and each format has its own copy button, so copying does not need a canvas click. A pointer eyedropper on the encoded result preview, with arrow-key/Enter keyboard sampling, reads the exact intrinsic pixel; CSS coordinates map through the displayed box, so DPR scaling is handled. Download the same swatches as GIMP Palette (`.gpl`), CSS custom properties (`.css`), Adobe Swatch Exchange (`.ase`) or v1 palette JSON. The **Use palette in Launch Kit** link opens the existing importer. Choose the downloaded JSON there and apply a swatch explicitly. [Verified palette-to-Composer review](https://github.com/loftwah/app-composer/issues/600#issuecomment-6945773550). The ASE colour entries use UTF-16BE HEX names and RGB floats. Each download uses a fixed name and contains palette data only. | Palette is sampled from a reduced working copy (1400 px long edge) on large images and coverage is over sampled visible pixels. No palette import (ASE/GPL), cross-image palette application or colour-blindness simulation. |
| 10 | Basic photo adjustments and filters | **Partial** | Exposure (two photographic stops each way), contrast, saturation and temperature sliders, plus Mono, Warm, Cool, Punch and Fade presets. Presets are only named values, so the caption states the real numbers. Adjustments are applied to the exported pixels after resize and crop; the alpha byte is never written and fully transparent pixels keep their RGB. The result reports how many pixels actually changed. Preview stays non-destructive until **Make this image**; the original File is untouched. | No text, frames, curves, selective colour, crop-and-mask layers or a live canvas preview of unsaved settings. Values are sRGB byte operations, not a colour-managed or linear-light pipeline. |
| 11 | Background removal | **Delegated / optional provider** | — | Existing Studio Cutout (`fal-ai/birefnet/v2`) remains the provider-backed path with estimate, billing and consent. No on-device model is shipped. |
| 12 | Upscale | **Delegated / optional provider** | Local resize can enlarge by resampling and explicitly says it invents no detail. | Existing Studio Upscale (`fal-ai/clarity-upscaler`) is the detail-reconstruction path; it is not free or local. No local sharpening claim. |
| 13 | Blur, mosaic or redact regions | **Partial** | **Cover an area** outlines one integer-pixel rectangle on a completed image and exports a separate PNG with an opaque black fill. The completed source image and its receipt remain available separately. The local command accepts one explicitly selected PNG and the same whole-pixel rectangle. | Blur, mosaic, face detection and multiple regions remain open. |
| 14 | GIF creation | **Deferred** | — | Needs ordered frames, frame delays, loop control, colour/transparency handling and an actual animation preview. GIF input is refused in this slice. |
| 15 | Image → PDF | **Delegated** | — | Coordinate with the existing Paperwork system rather than adding a parallel PDF editor. |
| 16 | Image ↔ Base64/data URI/CSS/HTML/Markdown | **Shipped** | Builds Base64, data URI, CSS rule, HTML `img` and Markdown from the exact exported bytes, with the real Base64 and data-URI character counts. The HTML attribute and Markdown alt text are escaped. It refuses non-PNG/JPEG/WebP results, empty bytes and anything over 2 MiB, and warns at 128 KiB that editors or chat tools may truncate a paste. The page states plainly that a data URI is the image itself, not encryption, redaction or a private link. | No size-optimised snippet server, no partial-byte or chunked embedding, no guarantee that a pasted snippet is private. |
| 17 | HTML/CSS → PNG/JPEG | **Deferred** | — | Requires an isolated, permissioned renderer with controlled active content, fetch, fonts and resource limits. No arbitrary untrusted HTML is run in Studio's origin. |
| 18 | Meme / caption layouts | **Deferred** | — | Intended as a preset on the existing text editor, not a second image canvas engine. |
| 19 | Favicon / PWA / touch / OG kits | **Delegated** | — | Existing Launch Kit owns the favicon/PWA/icon/OG package creator and the deliberate Composer handoff. This page does not create a competing implementation. |

## Owned-app extensions (not part of the 19-tool count)

These are useful when actual Fighter/Bubbles/SHOALSHOT assets are approved for
the work:

| Extension | Status | Note |
| --- | --- | --- |
| Transparency / alpha-edge checker | Partial | Exact alpha bounds are now read from decoded pixels for trim, and the source/export summary reports declared alpha. Transparent results can be inspected on checkerboard, white or black in the After and eyedropper previews. Display background does not change the encoded result. |
| Sprite-sheet / atlas assembly | Deferred | Needs ordering, cell geometry, padding and metadata output. |
| Trim transparent padding | Shipped | Alpha bounds are measured from every decoded pixel. The trim action updates the crop plan (centre crop composes inside the trimmed region), applies to the selected image only, and is cleared by rotation, flips, image change or clear. Opaque images report that there is nothing to trim instead of cropping silently. |
| Consistent pixel-art nearest-neighbour mode | Shipped | Resampling is an explicit smooth/nearest choice applied to resize and crop output. Nearest-neighbour is recorded in the exported caption and the visible transform description. |

## Verified image workflows

| Workflow | Verified scope | Evidence |
| --- | --- | --- |
| Web-ready preset | WebP at 82% quality with a 1600 px long-edge cap after the image's crop and rotation. The owned 1200 × 1200 Moss PNG retained transparency and exported as a 153,240-byte WebP on desktop and phone. | [Live #195 check](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6937217543) |
| Image receipt | A v1 JSON download carries the source and output SHA-256, dimensions, MIME, byte count and saved transform settings. Later control edits keep the completed receipt intact. | [Live #196 check](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6937400509), [receipt tests](../tests/image-receipt.test.mjs) |
| Local Web-ready replay | Isolated Chrome uses the existing Image Tools workbench with one explicitly selected PNG and its matching v1 receipt. The same Moss input reproduced the exact WebP bytes and receipt without network access from the page. The `--size` replay also honours an explicit `image/png` claim by selecting the Kit format → PNG control and verifying the downloaded PNG name, bytes and MIME; WebP stays the default and an unsupported MIME or wrong sizing is rejected. | [#199 verification](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6938232520), [local command](../scripts/replay-web-ready-image.mjs), [checks](../tests/replay-web-ready-image.test.mjs) |
| Social sizes | One PNG yields four exact sizes with individual v1 receipts. Choose default WebP or lossless PNG. Filenames, ZIP entries and receipt MIME follow the verified output bytes. The owned Moss WebP results decoded with transparency and matched by hash at desktop and phone widths. | [Live #204 check](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6938735525) |
| Social kit browser compatibility | Recorded Chrome runs reproduced the exact Foilbury Moss PNG and WebP bytes. Installed Firefox 159.0 at 390px downloaded one ZIP containing four PNGs and matching v1 receipts on Studio `c631b79fe326dccb1187ecd2ec62b855062c5d1c`. The repeated Firefox runs kept identical image data and added different ancillary `deBG` bytes, changing the PNG hashes. Installed WebKit 27.2 generated a valid linked ZIP Blob. Physical device and native Safari download checks remain open. | [Chrome and WebKit evidence](https://github.com/loftwah/composer-media-studio/issues/183#issuecomment-6939792310), [Firefox evidence](https://github.com/loftwah/composer-media-studio/issues/182#issuecomment-6940573665) |
| Local palette JSON replay | Isolated Chrome uses the existing workbench with one explicitly selected PNG and its matching palette JSON. **Extract palette** must reproduce the same format, version, units and swatches in order. The source SHA-256 is computed separately from the PNG because the palette document does not encode source identity. | [local command](../scripts/replay-palette-json.mjs) |
| Local contact sheet | Select two to twenty local JPEG, PNG or WebP images explicitly in order, including mixed formats. Each file is sniffed from its bytes and given a synthetic name and matching MIME before isolated Chrome uses the same Image Tools process and contact-sheet controls to save a native PNG to a new path. The selected Studio sample produced the same 480 × 240 PNG bytes as the public workbench. | [Local command](../scripts/local-contact-sheet.mjs) |
| Local area cover | Select a PNG, rectangle and new output path. Isolated Chrome uses the same Image Tools control. The selected Studio sample produced the same 1400 × 900 PNG bytes as the public workbench with a 100 × 80 opaque rectangle. | [Local command](../scripts/local-cover-area.mjs) |
| Local metadata strip | Select one JPEG, PNG or WebP image and a new output path. The script calls the same lossless metadata rewrite directly, keeps the ICC profile by default, retains a non-default orientation, and refuses an unverified copy. A harmless comment added to the Studio sample was removed with identical native browser and CLI PNG bytes; focused JPEG, PNG and WebP fixtures cover the remaining formats. | [Local command](../scripts/local-metadata-strip.mjs) |

## Safety and bounds shipped by this slice

- Input cap: 32 MiB per file, 40,000,000 decoded pixels, 16,384 px per source
  side, 8,192 px per output side, 64 MiB per encoded result, 20 images per batch,
  128 MiB per ZIP. Straighten is bounded to ±45° and reports the real reduced
  kept area before the export.
- JPEG, PNG and WebP magic bytes are checked; the declared browser MIME is not
  trusted. SVG/HTML active content, HEIC/HEIF, AVIF, GIF and unknown containers
  are refused with a visible reason.
- PNG chunk CRCs are checked; malformed/truncated JPEG, PNG and WebP bytes fail
  before processing.
- No external image fetch, no cross-origin canvas source and no server upload on
  the local path. Studio import is a separate, explicit, signed-in action.
- Object URLs, canvases and ImageBitmaps are released on remove, clear and
  unmount. Batch work is sequential, not 20 synchronous decodes.

## Tests in this slice

- `tests/image-limits.test.mjs`
- `tests/image-ops.test.mjs`
- `tests/image-colour.test.mjs`
- `tests/image-adjust.test.mjs`
- `tests/image-snippets.test.mjs`
- `tests/image-metadata.test.mjs`
- `tests/local-contact-sheet.test.mjs`
- `tests/local-metadata-strip.test.mjs`
- `tests/image-zip.test.mjs`
- `tests/image-page.test.mjs`
- `tests/media-sniff.test.mjs`

`pnpm check` runs these with the rest of the repository suite, and
`pnpm build:frontend` confirms the route's dynamic chunk builds separately from
`home.js`.

The browser evidence harness `tests/browser/images.mjs` drives the built page in
headless Chromium, Firefox and WebKit (`STUDIO_BROWSER`) from a local static
server and measures decoded pixels and encoded bytes for resize, Mono, embed
code, crop position, straighten and reset. The straighten check reads the
exported dark stripe's centroid at 10% and 90% of the result height and compares
its measured tilt with `tan(angle)`, and also requires every exported alpha to be
255 so no empty rotated corner reached the file. It is evidence tooling, not part
of `pnpm check`, and it needs `PLAYWRIGHT_MODULE` plus `pnpm build:frontend`.
