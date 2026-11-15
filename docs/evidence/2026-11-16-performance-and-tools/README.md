# Media performance and local-tool verification — 16 November 2026

Issues: [#12 MEDIA PERFORMANCE](https://github.com/loftwah/composer-media-studio/issues/12)
and [#20 LOCAL CREATOR TOOLS](https://github.com/loftwah/composer-media-studio/issues/20).

This is a read-only production audit plus real-browser functional checks of the
three signed-out local tools. Nothing was deployed, published, withdrawn or
uploaded. Every number below comes from a request or a decoded file that was
actually transferred; nothing is inferred from source alone. All fixtures are
synthetic, and no real publication, asset or project was created, changed or
withdrawn.

## Identity

| Item | Value |
| --- | --- |
| Repository | `/Users/deanlofts/gits/composer-media-studio` |
| Branch | `codex/studio-perf-tools-20261116` (from `main` `f2f2969`) |
| Live revision when the run started | `c7729e5fab7afe75ef8daba7aad877611b8b698a`, `/build.json` `builtAt` 2026-11-15T22:03:30.489Z |
| Live revision for every final measurement | `f2f29696d8be2424cee5f64b89bdcb0bb43de037`, `builtAt` 2026-11-15T23:18:21.480Z |
| Chrome | Google Chrome `157.0.8103.52`, headless (`/Applications/Google Chrome.app`) |
| Firefox | `142.0` (Playwright `firefox-1495` build) |
| WebKit | `26.0` (Playwright `webkit-2215` build) — Safari engine proxy only |
| Browser driver | `playwright-core` `1.56.1` |
| Node / pnpm | Node `v26.13.1`, pnpm `12.19.0` (Node 22.23.4 in the login shell is below the repo's engine floor, so the `mise` 26.13.1 install was used) |
| Host | macOS, `darwin` |

Production moved while this run was in progress: another worker shipped
`33fe578` (“Share published films with their stored preview”, #13) and
`730aeb5` (“Keep tool checkboxes at their native size”, #20). Both are deployed
as `f2f2969`. Section 7 records independent verification of those two changes
instead of duplicating them.

## Method

- HTTP byte counts: a Node script fetched the exact preview URLs the deployed
  HTML points a browser at, and recorded `content-length` and body size. Response
  headers (status, `content-type`, `cache-control`, `ETag`) were recorded at the
  same time.
- Browser measurements: Playwright drove Chrome, Firefox and WebKit. Transferred
  body sizes come from `request.sizes()` (encoded response body actually
  received), not from `content-length`, so an aborted range request is not
  counted as a full download.
- Vitals: `PerformanceObserver` for `largest-contentful-paint` and `layout-shift`.
  Throttled runs used CDP `Network.emulateNetworkConditions` at 1.6 Mbit/s down,
  150 ms RTT and 4× CPU throttling with cache disabled, cold context per page.
- owner `/studio`: the owner session was established through the existing
  Composer handoff in the owner's own Chrome (`media.loftwah.com` reports
  “Opened from App Composer · dean”). Navigation was read-only; no project,
  asset, publication or model setting was changed.
- Local tools: three synthetic fixtures, real file inputs, real downloads, then
  `ffprobe`/`ffmpeg` and a Goertzel analysis of the exported audio. Object-URL
  lifetime was recorded by wrapping `URL.createObjectURL`/`revokeObjectURL` in an
  init script.

## 1. `/gallery` — 16 published works

| Measurement | Result |
| --- | --- |
| Preview responses (HTTP) | 16, all `image/webp` |
| Total preview bytes | **792,638** |
| Largest preview | 94,718 (`/p/QXaKw_fL9cZenKCg/thumb`) |
| Smallest preview | 13,480 (`/p/fT2vGObWUuAfCQAx/thumb`) |
| Headers | `content-type: image/webp`, `cache-control: public, max-age=60`, `ETag`; repeat request with `If-None-Match` returns **304** |
| Chrome 1440×900, first view | 12 preview responses, **536,843** transferred, LCP **392–1,064 ms** across three cold runs, CLS **0** |
| Chrome 390×844, first view | 3 preview responses, **79,391** transferred, LCP **368 ms**, CLS **0** |
| Firefox 1440, first view | 6 preview responses, **203,290**, LCP **403 ms**, CLS **0** |
| WebKit 1440, first view | 3 preview responses, **77,102**, CLS **0** (WebKit exposes no LCP entry: reported as 0) |
| Full scroll, all 16 previews | **792,638** declared; every one of the 16 images decoded (`naturalWidth > 0`) in Chrome, Firefox and WebKit at 1440 and 390 |
| Layout | 16 cards, page height 3760 px (1440) / 8516 px (390), **no horizontal overflow** in any engine at either width |
| Throttled (1.6 Mbit/s, 4× CPU) | LCP **1,784 ms**, CLS 0.0001, overflow 0 |

The gallery acceptance for #12 holds: the cards request the stored preview, not
the original, and the page is byte-light and stable.

## 2. Public `/p/:slug` pages

| Page | Requested preview | Preview bytes (browser) | LCP (warm) | LCP (1.6 Mbit/s, 4× CPU) | CLS | Video |
| --- | --- | --- | --- | --- | --- | --- |
| `/p/Gs_0aKIkiriOHyLt` (film, owner-chosen poster) | `/p/Gs_0aKIkiriOHyLt/poster` | **2,288,009** (header 2,286,798) | VIDEO 612 ms | **14,948 ms** (1440 and 390) | 0 at 1440; 0.0141 in the throttled 390 run | 768×960, 5.18 s, plays, 206 range |
| `/p/hSV7NN15-vlPvqXK` (film, no chosen poster) | `/p/hSV7NN15-vlPvqXK/thumb` | **49,553** (total page 52,852) | VIDEO 312 ms | **1,236 ms** (1440), **1,256 ms** (390) | 0 | 1088×1904, 5.04 s, plays, `206` `content-range: bytes 0-1023/11715772` |
| `/p/fT2vGObWUuAfCQAx` (image) | `/p/fT2vGObWUuAfCQAx/media` | 527,706 | IMG 340 ms | — | 0 | — |
| `/p/notARealSlug42` | — | — | — | — | — | **404** |

- Images decode and films play with native controls; media responses answer
  `Range` with `206` and `accept-ranges: bytes`.
- Layout is stable: CLS 0 on the film pages, no horizontal overflow at 1440 or
  390 in Chrome, Firefox or WebKit.
- **Open defect (measured, not fixed here):** a film whose page uses the owner's
  chosen poster pays the full poster (0.5–3.2 MB) before first paint. Under
  throttling that is **14.9 s to LCP**. Every such page already has a stored
  preview (37,426 bytes for `/p/hvhyL90Wm1EXbrAE`), but it is a video frame, not
  the chosen still, so swapping it would change published artwork. Shrinking
  these posters needs a preview derived from the poster asset at publish or
  backfill time; that is new pipeline work and outside this session's scope.

## 3. `/portfolio` — Woodhouse Share catalogue + published films

| Measurement | Result |
| --- | --- |
| Structure | 21 film cards, 24 print images, 0 “No preview still provided” placeholders |
| Studio film-preview bytes (HTTP) | **30,169,968** across 22 responses |
| Browser transfer, Chrome 1440 | **30,194,694** |
| Browser transfer, WebKit 390 | **30,177,098** |
| Largest | `/p/KKxqXp1_5Po84FMU/poster` **3,178,430** |
| Prints | small `…-thumb.webp` files from `woodhouse.loftwah.com` |
| Playback | `preload="none"`; a 17.02 s film plays in place (position 2.24 s after 2.5 s), no autoplay with sound |
| Layout | no horizontal overflow at 1440 or 390 (Chrome and WebKit) |

**Open defect (measured, not fixed here).** The 21 film cards are the only heavy
part of this page: they serve the full poster even though a 37–91 KB stored
preview exists for every one of them. At **30.2 MB** the page is larger than the
whole rest of the site combined. Replacing the poster with the video-frame
preview would change the artwork the owner chose, so the correct fix is the same
poster-derived preview as in section 2. Recorded, not attempted.

## 4. Owner `/studio` library

Read-only, signed in as `dean` through the existing Composer handoff.

| Measurement | Result |
| --- | --- |
| Largest library | “Woodhouse Share · Portfolio Artwork”, **39 cards** (22 images, 17 videos) |
| Requests after 6 s at 1440×900, cache disabled | **32** `/api/assets/<id>/file` requests |
| Bytes transferred | **19,809,267** |
| Largest single original | **3,062,920** |
| Media state | 22 `<img>`, 17 `<video>` with metadata loaded; card width 220 px |
| CLS | **0.0002** (one 0.0002 navigation shift) |
| Overflow at 390 | 0 |

The owner library is the one place the derivative pipeline does not reach: every
card renders `asset.file`, the full original. Derivatives are
publication-scoped by design (`publication_derivatives`), so this needs
asset-level previews with their own lifecycle, not a reuse of the public route.
_Acceptance for #12 is therefore **not** met on this surface; the number is
recorded rather than worked around._

### Interaction: open → play → back

Chrome 1440, WebKit 1440 and Firefox 1440, plus Chrome 390 and WebKit 390:

1. scrolled `/gallery` to y=900;
2. activated a visible film card with a DOM click (the harness does not scroll it
   into view, so the offset is the browser's own);
3. the film page loaded, the poster painted, and `play()` advanced
   `currentTime` to 1.6–2.5 s (`paused: false`) with a `206` media response;
4. browser Back restored the gallery at **y=900 in every engine**, with the same
   card in view (top 127–212 px). No scroll jump, no CLS.

Filtered navigation (Chrome 1440): `/gallery?kind=video` showed 14 cards; the
card link carried `?back=%2Fgallery%3Fkind%3Dvideo%26page%3D1`; the page's own
“← Back to gallery” link resolved to
`https://media.loftwah.com/gallery?kind=video&page=1` and returned a filtered
page with 14 cards and `kind=video` selected. Browser Back is not required.

Keyboard search: focused the search field, typed `LDraw`, pressed Enter →
`/gallery?q=LDraw&kind=&order=newest` with 1 card (“Move the mountain · LDraw
motion”).

### Published-item withdrawal

**Not exercised on real content.** Withdrawal, re-publish and deletion were left
alone. Only read-only observations were made: a live slug serves 200, an unknown
slug serves 404, `If-None-Match` on a preview serves 304, and the preview route
is only reachable while the publication is live. The repo's own
`tests/publication-derivatives.test.mjs` covers withdrawal stopping the preview
and removing its bytes; that suite passes (section 6).

## 5. Local creator tools — functional results

URLs: `/tools/audio-trim`, `/tools/video-clip`, `/tools/add-music` (all 200).

### Fixtures (synthetic, generated locally)

| Fixture | Contents |
| --- | --- |
| `song-4s-mono.wav` | 4.000 s, 48 kHz mono 16-bit, 384,044 bytes. 0–1 s 880 Hz at 0.7, 1–2 s 440 Hz at 0.5, 2–3 s silence, 3–4 s 220 Hz at 0.6 |
| `music-5s-stereo.wav` | 5.000 s, 44.1 kHz stereo 16-bit, 882,044 bytes, 880 Hz, left 0.5 / right 0.25 |
| `clip-3s.mp4` | H.264 High 480×270 30 fps 3.000 s, red 0–1 s / green 1–2 s / blue 2–3 s, AAC 48 kHz mono 440 Hz (peak −16.3 dBFS) |

The video was made with:
`ffmpeg -f lavfi -i color=c=red:s=480x270:r=30:d=1 -f lavfi -i color=c=lime:… -f lavfi -i color=c=blue:… -f lavfi -i sine=frequency=440:sample_rate=48000:duration=3 -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]" -map "[v]" -map 3:a -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -b:a 96k -shortest -movflags +faststart`.
The WAVs were written directly as PCM by a small Node script (no dependency).

### Trim a song

In 0.5 s, out 3.5 s, fade in 0.3 s, fade out 0.4 s. “Make WAV” → result player
(blob, 3.0 s) → “Save WAV” downloaded `song-4s-mono-trimmed.wav`.

| Check | Observed |
| --- | --- |
| Format | WAV, PCM s16le, **48 kHz mono**, 288,044 bytes |
| Duration | **3.000 s exactly** (0.5→3.5 s of the source) |
| In point | 880 Hz band (source 0.5–1.0 s) present, 440 Hz starts 0.5 s in (source 1.0 s) — accurate |
| Fade in | window peaks 0.232 → 0.466 → 0.699 over 0.3 s, then steady 0.7 |
| Body | 440 Hz at 0.5 for 1 s, then the source's 2–3 s silence preserved |
| Fade out | 220 Hz band enters at 2.5 s and falls to 0 by 3.0 s (last-window peak 0.148) |
| Source untouched | the 4 s source player still reports 4.00 s; the file was never re-written |
| Refusals | end past the source, start after end, and fades longer than the clip each produce a specific message and no result |

Identical 3.000 s / 288,044-byte output in WebKit at 1440 and 390.

### Clip and frame a video

Start 1.0 s, end 2.0 s, 9:16 portrait, Standard (360×640), “Mute original audio”
toggled with **Space**, “Make MP4” activated with **Enter**.

| Check | Chrome | WebKit |
| --- | --- | --- |
| Codec / size | H.264 **360×640**, 1.000 s, 2,177 bytes | H.264 **360×640**, 1.000 s, 5,432 bytes |
| Audio | none (muted, as requested) | none |
| Fit = cover | centre, top and bottom pixels all `00d600` — the green 1–2 s segment fills the frame | same |
| Fit = contain | 360×640, 1.000 s, 2,593 bytes; centre `00d600`, top/bottom dark — real letterbox bars, not renamed bytes | 6,337 bytes, same geometry |
| Playback | result `<video>` reports 360×640 over 1.0 s; file probes clean with `ffprobe` | same |

Firefox produced the same 360×640 / 1.000 s H.264 file.

### Add music

Video `clip-3s.mp4` + `music-5s-stereo.wav`, music start 1.0 s, music 60 %,
original sound 0 %, fade in 0.3 s, fade out 0.3 s. “Preview mix (audio only)”
first, then “Make MP4” by keyboard.

| Check | Chrome | WebKit |
| --- | --- | --- |
| Preview | audio-only WAV blob, 3.0 s, nothing exported | same |
| Export | H.264 **640×360** + AAC 44.1 kHz stereo, 3.040 s container / 3.000 s video, 25,064 bytes | 3.021 s, 32,494 bytes |
| Music audible | 880 Hz power 0.1122 steady ≈ amplitude 0.225, i.e. 60 % of the 0.375 mono downmix of the 0.5/0.25 stereo source | 0.1101–0.1123 |
| Original muted | 440 Hz power ≤ 0.0007 | ≤ 0.0007 |
| Fades | RMS 0.0796 at 0–0.25 s and 0.0767 at 2.75–3.0 s vs 0.1587 steady | same shape |
| Mixing | second export with original 50 %: 880 Hz unchanged at 0.112, **440 Hz 0.0312 present** (expected ≈0.038 for the 0.153-peak source at 50 %, less AAC loss) — both tracks mixed at the set levels | — |

Firefox refuses this specific tool with
“This browser cannot encode H.264/AAC MP4. Try a current supported browser.”
because `AudioEncoder.isConfigSupported({codec:"mp4a.40.2", numberOfChannels:2,
sampleRate:44100, bitrate:128000})` is `false` in Firefox 142, while
`VideoEncoder` reports `avc1.42001f` supported. The refusal is honest: no upload,
no renamed container, original files unchanged. Chrome and WebKit report both
codecs supported and complete the export.

### Privacy, object URLs and keyboard

| Check | Result |
| --- | --- |
| Requests during a full local use | Chrome 17–22, WebKit 50–408 (page assets and fonts only) |
| Non-GET requests | exactly one per run: `POST /cdn-cgi/rum`, **841–845 bytes**, Cloudflare Web Analytics injected by the zone. No tool request, no file bytes |
| File bytes transmitted | **0** — nothing is posted until an explicit “Upload … to selected studio” click, which was not made |
| Audio object URLs | 2 created, 2 live in use; clearing the chosen file revoked both (**live 0**) |
| Video object URLs | 3 created, 2 live (source + result); clearing revoked to **0** |
| Add-music object URLs | 6 created, 4 live (video, music, preview, result); clearing the video revoked 3 → **1** (music source) |
| Keyboard | file input, every number field, Frame/Quality/Fit selects, the mute checkbox, Make WAV/MP4, the Save link and the “Import to Studio” disclosure are all tabbable on all three tools; checkbox toggled with Space and exports started with Enter |
| Small screen | 390×844: **no horizontal overflow** on any tool (Chrome and WebKit); 1440×900: none |
| Console | Only a zone-injected CSP refusal for Cloudflare's inline challenge bootstrap, already recorded in #20. The tools themselves log no errors |

## 6. Checks run

```
node --import ./tests/support/workers-runtime.mjs --test \
  tests/publication-derivatives.test.mjs tests/public-gallery-cards.test.mjs tests/studio-controls.test.mjs
  → 12/12 pass

node --import ./tests/support/workers-runtime.mjs --test \
  tests/audio-assembly.test.mjs tests/local-render.test.mjs tests/mix-preview.test.mjs \
  tests/music-fades.test.mjs tests/audio-trim.test.mjs
  → 24/24 pass
```

No source file was changed by this session, so `pnpm check`/`tsc` were not rerun
on a candidate; the two commits under verification were already released as
`f2f2969` and are covered by the suites above.

## 7. Defects found and their current state

| # | Defect | Evidence | State |
| --- | --- | --- | --- |
| 1 | Video tool's “Mute original audio” checkbox inherited the global full-width `input` rule inside a flex label | On `c7729e5` the checkbox measured **782.8 × 13 px** at 1440, label text detached | **Fixed and deployed** by `730aeb5` (#20) while this run was in progress; verified on `f2f2969`: **13 × 13 px** at 1440 and 390, 12 × 12 in WebKit |
| 2 | A film page without a chosen poster served no poster at all, so the browser requested video bytes before first paint | `c7729e5`: `/p/hSV7NN15-vlPvqXK` had no `poster` attribute; the page issued a `206` range request covering the remaining **11,715,772** bytes of the film | **Fixed and deployed** by `33fe578` (#13); verified on `f2f2969`: poster is the stored **48,780**-byte preview, page total 52,852 bytes, LCP 1,236 ms throttled |
| 3 | `/portfolio` film cards serve full posters: **30.2 MB** for 21 cards | Section 3 | **Open.** Needs a poster-derived preview; the stored preview is a video frame and swapping it would change published artwork |
| 4 | `/p/:slug` films with a chosen poster pay the full poster before first paint: **14.9 s** LCP at 1.6 Mbit/s | Section 2 | **Open**, same root cause and same fix as 3 |
| 5 | Owner `/studio` library serves full originals: **19.8 MB** for 39 cards | Section 4 | **Open.** Needs asset-level preview derivatives with their own lifecycle |

No code change was made in this session: the two defects that were fixable
inside the stated scope had already been fixed and released by a concurrent
worker, and the remaining three need a new preview pipeline that the task
explicitly excludes (“compatibility and interaction proof, not new
architecture”). They are recorded with exact numbers rather than worked around.

## 8. Per-issue recommendation

**#12 — do not close yet.** Met: derivative previews on `/gallery` (792,638
bytes for 16 works, all decode, ETag/304, CLS 0, no overflow at 390/1440),
public film playback with range requests, poster/LCP for films without a chosen
poster, open → play → back with exact scroll restore in Chromium, Firefox and
WebKit, and filtered “Back to gallery” without browser Back. Not met: owner
library previews (19.8 MB), film-page posters (14.9 s LCP throttled), and
`/portfolio` film cards (30.2 MB). The compatibility tick now has Firefox and
WebKit engine evidence, but physical Safari/iOS is still an owner step.

**#20 — close after the owner-only iOS check.** All three tools work signed out
at 390 and 1440 in Chrome and WebKit with real exports that decode, play and
carry the selected trim, crop, fade and mix. No file bytes leave the device, and
object URLs are revoked. Remaining honest limits: physical iPhone/iOS Safari
playback and codec fallback, Firefox's explicit no-AAC refusal for Add music,
and the existing signed-in import evidence from the earlier session (not
repeated here because it would write to production R2).

## 9. Owner-only remaining checks (physical Safari / iOS)

macOS Safari cannot be automated without enabling remote automation, and no
physical iPhone was attached. WebKit 26.0 is an engine proxy, not device proof.

1. On an iPhone (iOS 18 or later), open `https://media.loftwah.com/gallery`, scroll
   the full page and confirm every preview paints and the page never scrolls
   sideways.
2. Open one film, press play, let it buffer on cellular, then use the browser's
   Back and confirm the gallery returns to the same card and offset.
3. Open `/tools/audio-trim`, choose a song from Files, trim 30 s, and confirm the
   result plays and “Save WAV” writes to Files.
4. Open `/tools/video-clip`, clip 5 s to 9:16 and confirm the downloaded MP4 plays
   in Photos with the expected duration and no audio when muted.
5. Open `/tools/add-music`, export a short film and confirm the music is audible
   and the original soundtrack follows the volume control.
6. Note any iOS memory warning with a long file (>2 minutes) as the known limit.
