# Browser-local image workbench verification — 16 November 2026

Issue: [#183](https://github.com/loftwah/composer-media-studio/issues/183).
This evidence covers the first `/tools/images` slice only. Nothing was pushed,
deployed, published or uploaded. All work was local in
`/Users/deanlofts/gits/studio-wt-183` on branch `train/image-tools`, based on
`origin/main` `a2bce55`.

## Identity

| Item | Value |
| --- | --- |
| Repository | `/Users/deanlofts/gits/studio-wt-183` |
| Branch | `train/image-tools` |
| Base | `a2bce55` (`Record the OpenCode, signed upload and revision proof (#11, #15)`) |
| Local worker | `npx wrangler dev --local --persist-to .wrangler/state --port 8791` |
| Browser | Google Chrome `157.0.8103.52`, headless (`--headless=new`) |
| Node / pnpm | Node `v26.13.1`, pnpm `12.19.0` |
| Host | macOS `darwin` |
| Public source image | `https://media.loftwah.com/p/hSV7NN15-vlPvqXK/thumb` |

The local Worker route was requested with no session cookie. It returned
`HTTP 200`, `content-type: text/html; charset=utf-8`,
`cache-control: public, max-age=60`, and the page rendered without the login
form. The loaded page was:

```text
title: Image tools — Media Studio
h1: Image workbench
login form: false
signed-out local copy present: true
scripts: /theme.js, /images.js?v=dev
```

The page loads the dynamic `/creative/home.js` chunk and only then requests
`images-vOVCiynb.js`. The built image chunk is `78.55 kB` (`20.63 kB` gzip); it
is not part of `home.js`.

## Method

- **Public source:** downloaded the approved public Studio preview with
  `curl`. It was `image/webp`, `48,780` bytes, `411 × 720`, SHA-256
  `0d7993aed6bbb586b3d494123cb7a629db421a1112c6dc60f7de8cb7b0f5bd2a`.
- **EXIF fixture:** made a synthetic 800 × 600 JPEG with ImageMagick, then
  inserted a real EXIF APP1 block built by the repository's test TIFF builder.
  It declares orientation `6`, camera `Evidence Camera Co / Browser 1`, and a
  GPS IFD. The size is `16,090` bytes and SHA-256
  `ecc4bb97670c370132b50cbd1844641ad3a5629fa712499ee0ad46a5b21549fd`.
- **Quadrant fixture:** a 400 × 200 PNG with red/green/blue/yellow quadrants,
  used to verify rotation and flip at the pixel level. SHA-256
  `2e38539d67de00ec5930044a067e105db43f3bc60fcf858b5dfb57963f260188`.
- **Browser harness:** a one-off CDP script launched Chrome headless, navigated
  to `http://127.0.0.1:8791/tools/images`, clicked the real controls, added the
  public and synthetic files through the real file input, clicked the actual
  download links and read the downloaded bytes from disk. It recorded every
  network request and page error. Its JSON output is
  [browser-results.json](browser-results.json); the harness itself was temporary
  and is not part of the application.
- **Output inspection:** `sips`, `ffprobe`, ImageMagick `identify`/pixel
  sampling and `unzip -t`, plus the repository's own metadata parser. No
  numbers below are inferred from source or from a filename.
- The metadata-only Node checks used the same
  `src/frontend/image-metadata.mjs` path as the browser; results are in
  [node-metadata-results.json](node-metadata-results.json).

## 1. Single-image transform and export

The public preview was selected in the real UI, cropped to a square, given a
300 px long edge and exported as WebP. The UI reported `411 × 720` before and
`300 × 300` after. The browser's result image decoded at `300 × 300`.

| Output | Bytes | SHA-256 | `sips` | `ffprobe` |
| --- | ---: | --- | --- | --- |
| Generated sample PNG, 300 × 300 | 92,908 | `a473eb8525bb4ae26a200ae31eba500ed9e2b5dd8577903021daa59ef1e4578e` | 300 × 300, png | png, 300 × 300, rgba |
| Public preview → WebP, 300 × 300 | 30,200 | `f5ce23c9d425d8a4fe4a92409af84f71e0720a5710e2b0e0bcf5cdb79a3f82a6` | 300 × 300, webp | webp, 300 × 300, yuv420p |

Exact checks:

```sh
sips -g pixelWidth -g pixelHeight -g format browser-public-300x300.webp
# pixelWidth: 300
# pixelHeight: 300
# format: webp

ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt \
  -of default=noprint_wrappers=1 browser-public-300x300.webp
# codec_name=webp
# width=300
# height=300
# pix_fmt=yuv420p
```

The source facts in the UI were read from the bytes: `411 × 720`, `image/webp`,
`48 KiB`, no alpha, SHA-256 starting `0d7993aed6bb`.

## 2. EXIF orientation

The 800 × 600 fixture declares orientation 6. The UI showed the displayed frame
as `600 × 800` and planned `150 × 200`. The exported JPEG decoded at
`150 × 200`; an implementation that ignored the tag would have produced
`200 × 150`.

| Output | Bytes | SHA-256 | `sips` | `ffprobe` |
| --- | ---: | --- | --- | --- |
| EXIF-oriented JPEG, 150 × 200 | 3,746 | `6b70cc03a97f473bd6791a8cccddf7ee4293eaf8f59c1bbddcf6284123016549` | 150 × 200, jpeg | mjpeg, 150 × 200, yuvj420p |

The exported result has orientation `1` because the pixels were baked upright.
Its metadata report contains no GPS or camera tags.

## 3. Rotate and flip pixel proof

The quadrant fixture was rotated right and flipped horizontally, then exported
at a 200 px long edge. The plan and the decoded image were both `100 × 200`.
Sampling the output corners produced exactly the expected transform:

```sh
magick browser-rotated-flipped-100x200.png \
  -format 'TL=%[pixel:p{10,10}] TR=%[pixel:p{90,10}] BL=%[pixel:p{10,190}] BR=%[pixel:p{90,190}]\n' info:
# TL=srgba(255,0,0,1) TR=srgba(0,0,255,1) BL=srgba(0,255,0,1) BR=srgba(255,255,0,1)
```

Source quadrants were red/green/blue/yellow from top-left clockwise. Rotate
right then flip horizontal gives red/blue/green/yellow, which is what the actual
output bytes contain. The PNG is `1,085` bytes, SHA-256
`3b5a9af4670d45b913c71301cd0b2db8f975c426eb8de696d7b77c008e06c173`.

## 4. Metadata inspection and lossless strip

The EXIF fixture's UI report read: camera `Evidence Camera Co Browser 1`,
orientation `rotate 90° clockwise`, GPS `present`, `4` EXIF tags, XMP `87 B`,
one comment, and no ICC profile. The metadata-only operation produced a
`15,887`-byte JPEG from `16,090` bytes and verified:

```text
Pixels unchanged: verified
Dimensions and orientation match: verified
Declared metadata removed: verified
Removed: EXIF (privacy tags), XMP, Comment.
```

The output retains a one-tag EXIF orientation block so the picture does not
rotate, but its metadata report has GPS `false`, camera `null`, EXIF entries
`1`, XMP absent and text absent. Its SHA-256 is
`91bfcfe6037e7feaf83cf016468afe60e20e53e62dd1b3dbc486dd3be4c722fb`. Decoded RGBA pixels are identical:

```sh
magick fixture-exif.jpg -depth 8 rgba:- | shasum -a 256
# 94accb079dfa1c5799bfd020821e40a4c3cc45e807130bc2b9525774b65e37f4
magick browser-metadata-stripped.jpg -depth 8 rgba:- | shasum -a 256
# 94accb079dfa1c5799bfd020821e40a4c3cc45e807130bc2b9525774b65e37f4
```

Additional Node checks on the same modules:

| Input | Before | After | Removed | Pixel hash |
| --- | ---: | ---: | --- | --- |
| Public WebP | 48,780 | 48,780 | none | `f444…d881` both |
| PNG with 7 text chunks | 507,366 | 506,767 | 7 text chunks (`zTXt`/`tEXt`) | `f444…d881` both |
| EXIF JPEG | 16,090 | 15,887 | EXIF privacy tags, XMP, comment | `94accb…37f4` both |

The public WebP has an ICC profile; the default strip keeps it and reports that
it did. Removing ICC is an explicit option with a colour-change warning. The
PNG retains display/colour chunks such as `cHRM` and `bKGD`, and the result says
so. This is metadata removal, not an anonymity claim; the page states that
pixel-level clues remain.

## 5. Batch and ZIP

Three images were processed sequentially in one run. The UI reported real
completion and final dimensions:

| Image | Source | Output | Output bytes |
| --- | --- | --- | ---: |
| Generated sample | 1400 × 900 | 200 × 129 | 6,358 |
| Public Studio preview | 411 × 720 | 114 × 200 | 13,074 |
| EXIF JPEG | 600 × 800 displayed | 150 × 200 | 1,828 |

The ZIP is `21,676` bytes, SHA-256
`4832294e8c6949d7f096438ff895e5f45fce7f1155d2030cb74ea029b209187e`.
`unzip -t` and `unzip -l` read it as a valid store-only archive:

```text
testing: studio-image-sample-200x129.webp   OK
testing: studio-public-114x200.webp        OK
testing: fixture-exif-150x200.webp          OK
No errors detected in compressed data of browser-batch.zip

Length      Name
6358        studio-image-sample-200x129.webp
13074       studio-public-114x200.webp
1828        fixture-exif-150x200.webp
```

The batch wrote three output Blobs through the same sequential loop. The page
did not start 20 decodes at once; it decodes one input and encodes one output at
a time. The cancel control aborts between items and keeps completed downloads.

## 6. Network and privacy on the local path

The harness recorded `21` requests and no page errors. Every request was either
same-origin (`http://127.0.0.1:8791`) or a `blob:` URL created in the page.
There were **0 external requests** and **0 non-GET/HEAD/OPTIONS API writes**.
No source image was uploaded, and no image was fetched from another origin.
The network list is in [browser-results.json](browser-results.json).

## 7. Layout

| Viewport | `innerWidth` | `scrollWidth` | Horizontal overflow | Drop zone visible |
| --- | ---: | ---: | --- | --- |
| Phone 390 CSS px | 390 | 390 | no | yes |
| Desktop 1440 CSS px | 1440 | 1440 | no | yes |

Screenshots: [phone-390.png](phone-390.png),
[desktop-1440.png](desktop-1440.png). They show the generated sample, the
public preview and the synthetic fixtures only. No private asset, session,
account or credential is visible.

## 8. Checks run

```sh
PATH="/Users/deanlofts/.local/share/mise/installs/node/26.13.1/bin:$PATH" pnpm check
# tsc --noEmit, launcher check, all tests
# tests 505
# pass 505
# fail 0

PATH="/Users/deanlofts/.local/share/mise/installs/node/26.13.1/bin:$PATH" pnpm build:frontend
# tsc --noEmit && vite build
# images-vOVCiynb.js  78.55 kB │ gzip: 20.63 kB
# home.js            378.83 kB │ gzip: 83.53 kB
# built in 204ms
```

Focused tests added for this slice:

```sh
node --import ./tests/support/workers-runtime.mjs --test \
  tests/image-limits.test.mjs tests/image-ops.test.mjs \
  tests/image-metadata.test.mjs tests/image-zip.test.mjs \
  tests/image-page.test.mjs tests/media-sniff.test.mjs
```

They cover limits, crop/scale/rotation math, ZIP bytes/structure, CRC-32, PNG
chunk CRCs, JPEG/PNG/WebP metadata parsing and lossless stripping, orientation
retention, truncated/corrupt inputs, HEIC/HEIF sniffing and the existing MP4
classifications.

## 9. Honest limits of this evidence

- Chrome was the only browser exercised in this slice. Firefox, WebKit and a
  physical phone were not. The code uses standard Canvas/ImageBitmap APIs, but
  this record does not claim cross-browser parity.
- The Studio import path was not exercised because this was a signed-out local
  run. The control requires a real signed-in session and an existing project;
  no project or asset was created, changed or published.
- The local Worker was used, not production. The live deployment revision is not
  claimed.
- HEIC/HEIF, AVIF, GIF, SVG and HTML were refused rather than decoded. The
  server-side HEIC/HEIF sniffing fix is covered by `tests/media-sniff.test.mjs`,
  not by decoding a HEIC file.
- Metadata stripping cannot prove anonymity, and the UI says so. It preserves a
  display-critical orientation tag and optional ICC by design. Unknown chunks
  are reported rather than silently declared safe.
- The ZIP writer is store-only. It is valid but does not compress, and it is
  bounded to 20 entries / 128 MiB in the product path.
