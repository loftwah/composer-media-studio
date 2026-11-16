# Image tools coverage matrix (issue #183)

This is the beginning of the 19-tool matrix required by
[issue #183](https://github.com/loftwah/composer-media-studio/issues/183). It
records what the first `/tools/images` slice actually ships, what is delegated
to an existing owned system, and what remains deferred. It is not a claim that
the whole issue is complete.

The first slice is publicly usable signed out and without provider spend. It
runs in the browser, accepts JPEG/PNG/WebP up to 32 MiB and 40 megapixels, and
processes at most 20 images in one sequential batch. Evidence for the slice is
in [the image workbench evidence](../evidence/2026-11-16-browser-local-image-workbench/README.md).

## Status key

- **Shipped** — implemented in `/tools/images` and covered by focused tests/evidence.
- **Partial** — a useful part is shipped, with the missing capability named.
- **Delegated** — the owned place for this job is another existing system; this
  page does not duplicate it.
- **Deferred** — not shipped in this slice, with a concrete reason.

## The matrix

| # | Tool job | Status | What this slice does | Remaining gap / owner |
| --- | --- | --- | --- | --- |
| 1 | Compress and optimise JPEG/PNG/WebP | **Partial** | JPEG/WebP quality control and real output bytes; PNG is lossless. The before/after byte count is measured from the encoded Blob. | No perceptual target-size search, no automatic quality ladder, no GIF/AVIF optimisation. Quantified compression presets remain for a later slice. |
| 2 | Resize | **Shipped** | Long-edge or exact width and height; output pixel bounds checked before drawing; source dimensions and output dimensions shown. | No separate DPI/print metadata rewrite. Exact dimensions may change aspect and say so. |
| 3 | Crop | **Shipped** | Centre crop to original, 1:1, 4:5, 5:4, 16:9, 9:16, 3:2 or 2:3 with safe integer bounds. Crop is planned in rotated space. | Focal-point and freeform crop handles are deferred. |
| 4 | Rotate and flip | **Shipped** | Quarter-turn rotation, horizontal/vertical flip and EXIF orientation applied before editing. | No arbitrary-angle straightening. |
| 5 | Convert format | **Shipped** | Canvas export to real PNG, JPEG or WebP; the chosen MIME is verified from the output bytes. JPEG flattens alpha onto a chosen matte. | No AVIF/BMP/GIF encode and no universal HEIC decoder. The page refuses those inputs honestly. |
| 6 | Batch selection, progress, cancel, retry, ZIP | **Shipped** | Maximum 20 images, sequential decode/encode, real completed count, cancel between items, per-file error and retry, per-file download and one store-only ZIP. ZIP names are flat and unique; the writer rejects traversal, duplicate names and bounded overruns. | No drag-reorder or per-file settings matrix. ZIP is store-only, not deflate. |
| 7 | EXIF/metadata inspect | **Shipped** | Reads JPEG segments, PNG chunks and WebP chunks; reports camera, orientation, GPS presence, ICC, XMP, text/comments and other chunk labels. Unreadable EXIF is reported as present and unreadable, never absent. | No map link from GPS coordinates; coordinates are not decoded or displayed, only presence. |
| 8 | Metadata strip and verify | **Shipped** | Metadata-only copy for JPEG/PNG/WebP, no canvas re-encode. Verifies pixel payload bytes, dimensions, orientation and declared metadata after the rewrite. Preserves non-default orientation with a one-tag EXIF block so the picture does not rotate. ICC removal is optional and warned. | No guaranteed anonymity; pixel clues remain. Unknown ancillary chunks are reported, not silently treated as identity metadata. |
| 9 | Palette / eyedropper | **Deferred** | — | Needs an accessible colour picker, copy formats and an alpha-aware palette UI. No implementation in this slice. |
| 10 | Basic photo adjustments and filters | **Deferred** | — | Exposure/contrast/saturation/temperature, filters and text/frames are a separate editor scope; adding a second canvas engine here would exceed this slice. |
| 11 | Background removal | **Delegated / optional provider** | — | Existing Studio Cutout (`fal-ai/birefnet/v2`) remains the provider-backed path with estimate, billing and consent. No on-device model is shipped. |
| 12 | Upscale | **Delegated / optional provider** | Local resize can enlarge by resampling and explicitly says it invents no detail. | Existing Studio Upscale (`fal-ai/clarity-upscaler`) is the detail-reconstruction path; it is not free or local. No local sharpening claim. |
| 13 | Blur, mosaic or redact regions | **Deferred** | — | Needs user-selected regions and hard redaction semantics. Face detection is fallible and is not shipped. |
| 14 | GIF creation | **Deferred** | — | Needs ordered frames, frame delays, loop control, colour/transparency handling and an actual animation preview. GIF input is refused in this slice. |
| 15 | Image → PDF | **Delegated** | — | Coordinate with the existing Paperwork system rather than adding a parallel PDF editor. |
| 16 | Image ↔ Base64/data URI/CSS/HTML/Markdown | **Deferred** | — | Needs hard size warnings and safe copy/download so confidential bytes are not pasted into shareable URLs. |
| 17 | HTML/CSS → PNG/JPEG | **Deferred** | — | Requires an isolated, permissioned renderer with controlled active content, fetch, fonts and resource limits. No arbitrary untrusted HTML is run in Studio's origin. |
| 18 | Meme / caption layouts | **Deferred** | — | Intended as a preset on the existing text editor, not a second image canvas engine. |
| 19 | Favicon / PWA / touch / OG kits | **Delegated** | — | Existing Launch Kit owns the favicon/PWA/icon/OG package creator and the deliberate Composer handoff. This page does not create a competing implementation. |

## Owned-app extensions (not part of the 19-tool count)

These are useful when actual Fighter/Bubbles/SHOALSHOT assets are approved for
the work:

| Extension | Status | Note |
| --- | --- | --- |
| Transparency / alpha-edge checker | Deferred | The source summary already reports a declared alpha channel and the export preserves alpha for PNG/WebP. Edge inspection and hard checks are separate. |
| Sprite-sheet / atlas assembly | Deferred | Needs ordering, cell geometry, padding and metadata output. |
| Trim transparent padding | Deferred | Needs alpha bounds measured from decoded pixels. |
| Consistent pixel-art nearest-neighbour mode | Deferred | The current resampler uses high-quality smoothing; a nearest-neighbour export mode and tests are required. |

## Safety and bounds shipped by this slice

- Input cap: 32 MiB per file, 40,000,000 decoded pixels, 16,384 px per source
  side, 8,192 px per output side, 64 MiB per encoded result, 20 images per batch,
  128 MiB per ZIP.
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
- `tests/image-metadata.test.mjs`
- `tests/image-zip.test.mjs`
- `tests/image-page.test.mjs`
- `tests/media-sniff.test.mjs`

`pnpm check` runs these with the rest of the repository suite, and
`pnpm build:frontend` confirms the route's dynamic chunk builds separately from
`home.js`.
