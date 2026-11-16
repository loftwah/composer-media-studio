# Live local-tools and Launch Kit regression — 16 November 2026

Issue: [#20 LOCAL CREATOR TOOLS](https://github.com/loftwah/composer-media-studio/issues/20).
This is a read-only production regression: no deploy, no publication, no upload,
no project or asset created or changed. All fixtures are synthetic; the only
owner material used is an already-published Studio poster fetched through its
public route.

## Identity

| Item | Value |
| --- | --- |
| Studio live revision | `f2f29696d8be2424cee5f64b89bdcb0bb43de037`, `/build.json` `builtAt` 2026-11-15T23:18:21.480Z |
| Read at | 2026-11-16T02:19Z and again 02:38Z — unchanged |
| Launch Kit live build | `c470eef73a0413ce28e9416d7a3bff5bbcaf16b2` (`https://composer-launch-kit.loftwah.workers.dev/build.json`) |
| Chrome | Google Chrome `157.0.8103.52`, headless, real Chrome binary |
| Firefox | `159.0` (Playwright `firefox-1572` build) |
| WebKit | `27.2` (`webkit-2388`) — engine proxy only, not a device |
| Driver | `playwright-core` `1.65.0` |
| Media tools | `ffmpeg`/`ffprobe` `9.0.2` |
| Node | `v26.13.1` via `mise` |
| Target branch | `codex/20-tools-regression` from `main` `b91615d` |

The live revision is **the same build** that
[`docs/evidence/2026-11-16-performance-and-tools/README.md`](../2026-11-16-performance-and-tools/README.md)
section 5 measured (`f2f2969`). That evidence therefore still applies; this run
independently reproduced its headline results against the live site at both
widths and added the Firefox and Launch Kit checks it did not cover.

## Fixtures

Regenerated locally with the same contents and command recorded in the earlier
run, so the numbers are comparable:

| Fixture | Contents |
| --- | --- |
| `song-4s-mono.wav` | 4.000 s, 48 kHz mono 16-bit, 384,044 bytes; 0–1 s 880 Hz at 0.7, 1–2 s 440 Hz at 0.5, 2–3 s silence, 3–4 s 220 Hz at 0.6 |
| `music-5s-stereo.wav` | 5.000 s, 44.1 kHz stereo 16-bit, 882,044 bytes, 880 Hz, left 0.5 / right 0.25 |
| `clip-3s.mp4` | H.264 High 480×270 30 fps 3.000 s, red/green/blue one-second bands, AAC 48 kHz mono 440 Hz, 43,717 bytes |

## 1. Trim a song — `/tools/audio-trim`

Start 0.5 s, end 3.5 s, fade in 0.3 s, fade out 0.4 s. Export started with
**Enter** on the focused button in the keyboard run; a mouse click in the 390 and
1440 runs. "Save WAV" downloaded `song-4s-mono-trimmed.wav`.

| Check | Chrome 390 | Chrome 1440 | Firefox 159 |
| --- | --- | --- | --- |
| Format | WAV, `pcm_s16le` | same | same |
| Rate / channels | 48 kHz mono | same | same |
| Duration | **3.000000 s** | same | same |
| Bytes | **288,044** | same | same |
| SHA-256 | `176838eb…` | identical file | `5f78a2ad…` (same length/format) |

Decoded content of the 390 export:

- In point exact: 880 Hz occupies the first 0.5 s (source 0.5–1.0 s), 440 Hz
  runs 0.5–1.5 s (source 1.0–2.0 s), 1.5–2.5 s is silent (source 2–3 s), 220 Hz
  enters at 2.5 s (source 3–4 s).
- Fade in: window peaks 0.232 → 0.466 → 0.699 → 0.700 over 0.3 s.
- Fade out: last 0.25 s RMS **0.1531** vs **0.3535** steady.
- Source untouched: the original player still reports 4.00 s.
- Refusal path: end 9 s → "Choose an end after the start and within the track."
  in the `aria-live` status, **0** result links.

## 2. Clip and frame a video — `/tools/video-clip`

Start 1.0 s, end 2.0 s, 9:16 portrait, Standard (360×640). In the keyboard run
the mute checkbox was focused and toggled with **Space** (checked = true,
13 × 13 px box) and "Make MP4" started with **Enter**.

| Check | Cover, 1440 | Contain, 390 |
| --- | --- | --- |
| Codec / size | H.264 **360×640** | H.264 **360×640** |
| Duration | **1.000000 s** | **1.000000 s** |
| Audio | none (muted) | none (muted) |
| Bytes | **2,177** | **2,593** |
| Top / centre / bottom pixel at 0.5 s | `#00d600` / `#00d600` / `#00d600` — real centre crop | `#000000` / `#00d600` / `#000000` — real letterbox bars |
| Result `<video>` in page | 360×640, 1.0 s | 360×640, 1.0 s |

Both files probe cleanly and are not renamed container bytes: the frame geometry
and the pixel evidence match the selected fit. Progress was announced through
`role="status"` from "Making MP4 on this device: 0%" to 100% then "Your MP4 is
ready to play and save." (Chrome, both runs).

## 3. Add music — `/tools/add-music`

Video `clip-3s.mp4` + music `music-5s-stereo.wav`, music start 1.0 s, music 60 %,
original sound 0 %, music fade in/out 0.3 s. "Music start" skips the first second
of the track (`source.start(0, offset)`), it does not delay the music.

| Check | 390 | 1440 |
| --- | --- | --- |
| Preview | audio-only WAV blob, 3.0 s, no video link yet | same |
| Export | H.264 **640×360** 3.000 s + AAC 44.1 kHz stereo | same |
| Container | **3.040340 s**, video/audio stream `start_time` both `0.000000` | same |
| Bytes | **25,064** | **25,064** (not byte-identical, same decoded values) |
| Music audible | 880 Hz power **0.0126** at 0.5 s and 1.5 s | same |
| Original muted | 440 Hz power **0.0000** at both points | same |
| Fades | RMS 0.0771 (0–0.25 s) → 0.1588 steady → 0.0587 (last 0.25 s) | same |

0.0126 power in a 0.5 s window is amplitude ≈ 0.225, exactly 60 % of the 0.375
mono downmix of the 0.5/0.25 stereo source. The 440 Hz track is absent, as
requested by 0 % original sound. Progress was announced at 33 %, 67 %,
"Finishing the MP4…", then "Your film is ready to play and save.".

## 4. Zero file transmission

Every run recorded every request with method, URL, resource type, posted body
length and received body size.

| Run | Requests | Non-GET | Posted bytes | Uploaded file bytes |
| --- | --- | --- | --- | --- |
| audio 390 | 17 | 1 | 849 | **0** |
| audio 1440 | 17 | 1 | 846 | **0** |
| video cover 1440 | 19 | 1 | 845 | **0** |
| video contain 390 | 19 | 1 | 845 | **0** |
| music 390 | 22 | 1 | 848 | **0** |
| music 1440 | 22 | 1 | 840 | **0** |

The single non-GET in every run is the zone-injected Cloudflare Web Analytics
beacon `POST /cdn-cgi/rum` (204, 840–849 bytes). All media elements load
`blob:` URLs, which are local; no request carries file content.

Object URLs: audio 2 created → **0 live** after clearing the chosen file; video
2 → **0**; music 6 created, 4 live → **1 live** after clearing the video (the
still-chosen music source remains, as intended).

## 5. Firefox AAC fallback — honest refusal, still true on 159

The earlier record was Firefox 142; the current cached engine is **159.0**, and
it still refuses rather than writing a broken file.

| Probe | Result |
| --- | --- |
| `VideoEncoder.isConfigSupported({codec:"avc1.42001f"})` | `true` |
| `AudioEncoder.isConfigSupported({codec:"mp4a.40.2", 2 ch, 44100, 128 kbps})` | **`false`** |
| Message in `role="status"` | "This browser cannot encode H.264/AAC MP4. Try a current supported browser." |
| Result / Save link | **0** |
| Original files | still present, unchanged |
| Non-GET requests | only `POST /cdn-cgi/rum`, 753 bytes |
| Audio trim in the same Firefox | **passes** — 3.000 s, 288,044-byte WAV |

So the fallback is a specific, visible refusal of the unsupported codec, not a
silent broken export, and Firefox is not blocked from the tool it can run.

## 6. Studio handoff — signed-out branch

In the trimmed-WAV result, "Import to Studio" was opened and "Check sign-in and
studios" activated.

- Copy shown before any action: "Optional: sign in and choose a studio, then
  explicitly upload this finished WAV. Your source files stay on this device.
  Opening this section does not upload anything."
- Result: state `signed-out`, one "Studio sign-in in a new tab" link, **zero**
  upload buttons, no `/api/projects/…/assets` request. Only the RUM POST.
- The local result and player remained usable.

The signed-in branch (project selection → explicit upload → `201`, new private
asset `asset_39e897…`, source untouched) was proven against production in the
earlier leg and is **not repeated here** because it writes to production R2.

## 7. Launch Kit consumption — real card from a live Studio output

Path under test: the owner library's "Download poster for Launch Kit" link
resolves to a retained Studio still (`/p/:slug/poster`); that still is imported
into Launch Kit, which renders the card and icons.

- Studio film: `/p/5ycQgw8F4AhOj_oB` — "Launch Kit · The edge takes a bite".
- Poster: `https://media.loftwah.com/p/5ycQgw8F4AhOj_oB/poster`, `200`,
  `image/png`, **1,413,143 bytes**, **1024 × 1280**.
- Imported into Launch Kit `c470eef` in Chrome 1440: source label
  "PNG · 1024 × 1280px", status "Generated · actual PNG files decoded and ready
  to inspect.", 13 generated `blob:` previews including the 1200×630 shared-link
  card and 16/32/48/180/192/512 px icons.
- Downloaded from the live package:
  - `social-1200x630.png` — **1200 × 630**, 340,249 bytes; the card visibly uses
    the Studio rocket artwork.
  - `icon-512.png` — **512 × 512**, 214,396 bytes.
  - The rendered card captured from its own blob is byte-identical to
    `social-1200x630.png` (same SHA-256, `8164b261…`).
- Requests during import and generation: **8**, all GET, **0 posted bytes**.
  No console errors or page errors.
- No horizontal overflow at 1440 (scrollWidth 1440) or 390 (390).

Launch Kit keeps its own sample title and subtitle ("Night Signal", "Good
company after dark."); that is the editor's unrelated default text, not a Studio
value. The artwork, icons and card are the Studio poster.

## 8. Accessibility and interaction

| Check | Observed |
| --- | --- |
| Full tab cycle — trim | ← Media Studio → Choose audio → Original audio → Start → End → Fade in → Fade out → Make WAV → Trimmed audio → Save WAV → Import to Studio → Check sign-in and studios (12 stops) |
| Full tab cycle — clip | ← Media Studio → Choose video → Original video → Start → End → Frame → Quality → Fit → Mute original audio → Make MP4 → Finished video → Make a poster from this clip → Save MP4 → Import to Studio → Check sign-in and studios (15 stops) |
| Full tab cycle — add music | ← Media Studio → Video file → Original video → Music file → Original music → Music start → Music volume → Original video sound → Fade in → Fade out → Export quality → Preview mix → Make MP4 → Finished video with music → Save MP4 → Import to Studio → Check sign-in and studios (17 stops) |
| Controls by keyboard | number inputs typed (`0.75`, `45`), checkbox toggled with Space, Make WAV/MP4 and Preview mix started with Enter/Space, file inputs and links native |
| Focus visibility | focused button outline `solid 3px rgb(252, 91, 5)`, focused input `solid 2px` |
| Progress and errors | one `role="status" aria-live="polite"` per tool; progress percentages and the specific refusal message both appear there |
| Reduced motion | with `prefers-reduced-motion: reduce`, button transition drops from `0.12s` to `1e-05s`, 0 running animations, layout and exports unchanged |
| Autoplay with sound | every media element has `autoplay=false` and is `paused` after file choice, after preview and after export |
| 390 px overflow | 0 on all three tools before and after results; 1440 px likewise 0 |
| Mute checkbox | 13 × 13 px (the `730aeb5` fix holds) |
| Console | no tool error; the only console message is the previously recorded zone-injected Cloudflare challenge-bootstrap CSP refusal |

Native `<select>` elements are focusable, enabled and expose all three options,
but their OS-level option list cannot be opened in a headless browser, so an
arrow-key selection changing the value was not observed in Chrome, Firefox or
WebKit. They are not custom widgets.

## 9. Checks run

```
mise exec node@26.13.1 -- node --import ./tests/support/workers-runtime.mjs --test \
  tests/audio-assembly.test.mjs tests/local-render.test.mjs tests/mix-preview.test.mjs \
  tests/music-fades.test.mjs tests/audio-trim.test.mjs \
  tests/publication-derivatives.test.mjs tests/public-gallery-cards.test.mjs tests/studio-controls.test.mjs
  → 36/36 pass
```

No source file changed in this leg, so `tsc --noEmit` and the frontend build were
not rerun. The pass above is the retained suite on `main` `b91615d`.

Screenshots retained in the ignored run output (full-page, actual pixels):
`chrome-audio-390` 390×1602, `chrome-audio-1440` 1440×1369,
`chrome-video-contain-390` 390×2224, `chrome-video-cover-1440` 1440×2189,
`chrome-music-390` 390×2664, `chrome-music-1440` 1440×2624,
`firefox-audio-1440` 1440×1564, `firefox-music-1440` 1440×1949,
`chrome-390-handoff-signed-out` 390×1820, `launchkit-1440` 1440×3796,
`launchkit-390` 390×5335, `launchkit-social-1200x630` 1200×630,
`launchkit-icon-512` 512×512.

## 10. Remaining acceptance gaps

1. **Physical iPhone / iOS Safari** playback, codec fallback and long-file memory
   were not tested: no device is attached to this machine. WebKit 27.2 is an
   engine proxy, not a device, and is not counted as that pass.
2. **Signed-in owner control**: the exact in-app "Download poster for Launch Kit"
   button and the live import were not re-exercised here (the former needs an
   owner session, the latter writes to production R2). The same poster payload
   route was used, and the live import was proven in the earlier leg.
3. **Live audio mixer and media generation** regression belongs to the other
   #20 work items, not this lane; no paid generation was made here.

No defect was found in this leg, so there is no code change: the tools, the
honest Firefox refusal, the signed-out handoff and the Launch Kit card all
behave as the issue requires on the live release.
