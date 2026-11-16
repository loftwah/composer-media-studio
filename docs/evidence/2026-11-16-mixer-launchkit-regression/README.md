# Live mixer, Launch Kit and local-tools regression — 16 November 2026

Issue: [#20 LOCAL CREATOR TOOLS](https://github.com/loftwah/composer-media-studio/issues/20).
This is a read-only production regression pass. No deploy, publication, upload,
paid generation, project or asset was created or changed. Owner-only surfaces
were exercised against the same source revision in a local `wrangler dev`
fixture, not against production data; the distinction is recorded below.

## Identity

| Item | Value |
| --- | --- |
| Studio live revision | `5241e411ed48c33215e1efbb040f7ee963b13ff2`, `/build.json` `builtAt` 2026-11-16T04:24:54.407Z |
| Launch Kit live build | `c470eef73a0413ce28e9416d7a3bff5bbcaf16b2` (`https://composer-launch-kit.loftwah.workers.dev/build.json`) |
| Branch | `codex/batch-20-tools-regression` from `main` `5241e41` |
| Chrome | Google Chrome `157.0.8103.52`, headless, 1440×900 and 390×844 |
| Driver | `playwright` `1.65.0` (`chrome` channel) |
| Media inspection | `ffmpeg`/`ffprobe` `9.0.2` plus a local WAV RMS/Goertzel reader |
| Node | `v26.13.1` |
| Local fixture | `tests/browser/fixture.mjs` + `tests/browser/harness.mjs`, `wrangler dev --local`, isolated `--persist-to` under the run's temp root |

## Fixtures

Synthetic, regenerated locally with the command recorded in
[`../2026-11-16-performance-and-tools/README.md`](../2026-11-16-performance-and-tools/README.md):

| Fixture | Contents |
| --- | --- |
| `song-4s-mono.wav` | 4.000 s, 48 kHz mono 16-bit, 384,044 bytes; 880 Hz / 440 Hz / silence / 220 Hz one-second bands |
| `music-5s-stereo.wav` | 5.000 s, 44.1 kHz stereo 16-bit, 882,044 bytes, 880 Hz, left 0.5 / right 0.25 |
| `clip-3s.mp4` | H.264 High 480×270 30 fps 3.000 s, red/green/blue bands, AAC 48 kHz mono 440 Hz, 43,717 bytes |

## 1. Local creator tools on the live build

Every export below was downloaded from the live site and decoded. Duration and
content come from `ffprobe` and the samples, not the filename.

| Check | Expected | Actual (1440 and 390) | Result |
| --- | --- | --- | --- |
| Trim a song, 0.5–3.5 s, 0.3/0.4 s fades | 3.000 s WAV, 48 kHz mono | **3.000000 s**, 288,044 bytes, `pcm_s16le`, 48 kHz, 1 ch, identical at both widths | Pass |
| Trim content | 880 Hz first, 440 Hz 0.5–1.5 s, silence 1.5–2.5 s, 220 Hz 2.5–3 s | Goertzel power 0.0478 / 0.0625 / 0.0000 / 0.0285; RMS fade-in 0.095 → 0.475 → 0.3535 steady, fade-out 0.424 → 0.031 | Pass |
| Trim refusal | Specific message and no result | "Choose an end after the start and within the track.", 0 Save links | Pass |
| Clip, 1–2 s, 9:16, Standard, cover, muted | H.264 360×640, 1.000 s, no audio | **360×640, 1.000000 s, 2,177 bytes**, no audio stream; pixels at 0.5 s top/centre/bottom `#00d600` | Pass |
| Clip, contain | Real letterbox, not renamed bytes | **360×640, 1.000000 s, 2,593 bytes**; top/bottom `#000000`, centre `#00d600` | Pass |
| Clip, 16:9 HD, cover, muted | H.264 1280×720 | **1280×720, 3.000000 s** | Pass |
| Clip, unmuted | H.264 + AAC | **360×640 + AAC 48 kHz mono**, container 1.022667 s | Pass |
| Clip poster | PNG from the paused result | 360×640 PNG, captured at 0.50 s, download `clip-3s-clip-poster.png` | Pass |
| Add music, 60 % music, 0 % original, 0.3/0.3 fades | 640×360 H.264/AAC, 880 Hz audible, 440 Hz absent | **640×360 + AAC 44.1 kHz stereo**, container **3.040340 s**, 25,064 bytes; 880 Hz power 0.0126, 440 Hz 0.0000; RMS 0.0771 → 0.1588 → 0.0765 | Pass |
| Add music, original 50 % | Both tracks mixed | 880 Hz 0.0126, **440 Hz 0.0010 present**, RMS 0.165 steady | Pass |
| Audio-only preview | 3.0 s WAV, no video link | Preview `<audio>` 3.0 s, 0 Save MP4 links before export | Pass |
| Signed-out Studio handoff | No upload, explicit sign-in link | "Check sign-in and studios" → state `signed-out`, **0** upload buttons, **0** `/api/` POSTs | Pass |
| Tabs / layout | No overflow; controls reachable | No horizontal overflow at 1440 or 390; mute checkbox **13 × 13 px**; all expected controls in tab order | Pass |
| File bytes during local use | 0 | 0 uploaded bytes; only the zone RUM POST (840–849 bytes) | Pass |

The tool pages log one console error each: the zone-injected Cloudflare
challenge bootstrap is blocked by the site CSP (`script-src 'self'
https://static.cloudflareinsights.com`). This is the previously recorded
Cloudflare/zone behaviour, not tool code. No tool page error, no 4xx/5xx.

## 2. Studio audio mixer (local fixture, same source revision)

Production `/studio` is owner-only; signed out it serves the login page. No
production session was used. The fixture wrote only to an isolated local
`--persist-to` directory, never to production D1/R2.

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| Preview with one track | Visible blob player, cut duration | `#mix-preview-player` visible, `blob:` URL, **11.200 s** for an 11.2 s cut | Pass |
| Preview upload | None | 0 POSTs, asset count unchanged | Pass |
| Preview fades | Fade in 0.5 s, fade out 1.0 s | RMS 0.0009 → 0.0075 over the first 0.5 s, steady 0.0075, 0.0075 → 0.0011 over the last 1.0 s | Pass |
| Edited fades | UI value used on the next preview | Changed fade-in to 2000 ms and fade-out to 0 → 2.0 s ramp, no tail ramp | Pass |
| Start offset and gain | 1.0 s silent lead-in, −6 dB | 0.00000 RMS for the first second, then 0.5 × the reference level | Pass |
| Mix soundtrack | One new WAV matching the cut | New `audio/wav`, **11,200 ms**, 1,975,724 bytes; bytes identical to the preview | Pass |
| Mismatched mixed bed | Blocks save until mixed again | Warning and disabled Save when the cut duration changes | Pass by source/UI inspection; not changed |
| Phone layout | No overflow, player visible | 390/390 scroll width; preview player 300 px inside a 327 px row; fade control 149 × 37 px | Pass |

The mixer's fade/offset/gain scheduling is now pinned by
`tests/mix-preview.test.mjs` (added in this branch).

## 3. Launch Kit (live)

Path: the public Studio poster `/p/5ycQgw8F4AhOj_oB/poster` (`200`,
`image/png`, **1,413,143 bytes**, 1024×1280, SHA-256 `154b939c…`) was imported
into the live Launch Kit, signed out.

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| Source import | Studio poster accepted | "Generated · actual PNG files decoded and ready to inspect."; source **PNG · 1024 × 1280px** | Pass |
| Generated assets | Card and icons | 13 decoded `blob:` images: 1200×630, 16/32/48/180/192/512 px and maskable variants | Pass |
| Shared card | 1200×630, Studio artwork | **1200×630**, 340,249 bytes, SHA-256 `8164b261…` (matches the earlier live record) | Pass |
| Icon | 512×512 | **512×512**, 214,396 bytes | Pass |
| ZIP package | Complete and valid | **765,432 bytes**, 13 files, `unzip -t` OK; `launch-kit.json` source SHA matches the poster | Pass |
| Layout | No overflow at 390/1440 | 1440/1440 and 390/390 | Pass |
| Network / console | No app errors | 39 GETs, 0 non-GET, 0 4xx/5xx, 0 console/page errors | Pass |

## 4. Generation and job surfaces

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| Live signed-out generation POST | Honest 401 JSON, no 5xx | `401 application/json` `{"error":{"code":"unauthorized",...},"signedIn":false}` | Pass |
| Live signed-out composition POST | Same | `401` JSON, same shape | Pass |
| Live `/api/state`, `/api/session` | 401 JSON / signed-out session | 401 JSON; `signedIn:false` with no actions | Pass |
| Local job with no provider credentials | Specific state, not stuck | `201` created, then `unknown` with "The image request may have run. Check this job to recover the original without generating again."; History shows **OUTCOME UNKNOWN**, Reconcile and Remove from history | Pass (local fixture) |

No paid generation, provider call or production write was made.

## 5. Public surface crawl

`/`, `/gallery`, `/portfolio`, `/help`, `/login`, `/studio`, `/compare`,
two `/p/:slug` pages, an unknown slug, `/sitemap.xml`, `/robots.txt` and
`/build.json` at 1440 and 390: expected 200/401/404 only, no 5xx, no page
errors, no horizontal overflow. The only non-UI overflow is the raw XML
sitemap rendered by the browser at 390, which has no stylesheet by design.
Aborted `blob:`/media requests on navigation are expected; no failed app
request.

## 6. Defect found and fixed

**Unreadable media showed the library's raw parser text instead of the tool's
refusal.** Reproduced on the live build (`5241e41`):

1. `/tools/audio-trim` → choose a text file renamed `not-media.wav` → status
   read `Input has an unsupported or unrecognizable format.` (the tool's own
   "This browser cannot decode that audio file." was bypassed).
2. `/tools/add-music` → choose the same file as the video plus a valid WAV →
   `Make MP4` → the same raw text after several seconds, with no immediate
   feedback when the bad video was chosen.
3. `/tools/video-clip` already converted the same file into its own friendly
   message via its metadata preflight.

Fix: `src/frontend/media-probe.ts` translates a thrown parser refusal from the
first primary-track probe into the tool-specific message; `audio-trim`,
`video-clip` and `add-music` use it. `tests/media-probe.test.mjs` fails if the
raw library text is allowed through. The built local tool now reports:

- audio trim: `This browser cannot decode that audio file.`
- add music / video clip: `This browser cannot read that video. Try another MP4 or WebM.`

This fix is on the branch and verified in the local build. **It is not live
yet**; production remains on `5241e41` until integration/deploy.

Remaining minor finding, not fixed: add-music still has no status message
between choosing an unreadable video and pressing `Make MP4`; it refuses
correctly at export. Immediate validation would be a UX change outside this
regression pass.

## 7. Checks run

```
mise exec node@26.13.1 -- npx tsc --noEmit
→ pass

mise exec node@26.13.1 -- node --import ./tests/support/workers-runtime.mjs --test \
  tests/media-probe.test.mjs tests/mix-preview.test.mjs tests/audio-trim.test.mjs \
  tests/local-render.test.mjs tests/music-fades.test.mjs
→ 10/10 pass

mise exec node@26.13.1 -- node --import ./tests/support/workers-runtime.mjs --test \
  tests/audio-assembly.test.mjs tests/local-render.test.mjs tests/mix-preview.test.mjs \
  tests/music-fades.test.mjs tests/audio-trim.test.mjs tests/studio-controls.test.mjs \
  tests/publication-derivatives.test.mjs tests/media-probe.test.mjs
→ 34/34 pass (final, after the helper change)
```

The new mixer scheduling test was proven to fail when the gain schedule is
broken (temporarily changed `Math.pow(10, gainDb/20)` to `1`, test failed, file
restored). The new probe test includes the exact raw message from the live
defect.

## 8. Remaining limits

1. **Physical iPhone/iOS Safari** playback, codec fallback and long-file memory
   were not tested; no device is attached. WebKit was not used as a substitute
   in this pass.
2. The live mixer, the live Launch Kit "Open Launch Kit" button and the live
   signed-in import require an owner session. They were tested against the same
   source revision in the local fixture; production D1/R2 was not written.
3. The live signed-in generation path was not exercised; only the signed-out
   401 boundary and the local no-provider job state were checked.
4. The new friendly-error fix is not deployed; live still shows the old raw
   text for unreadable files.
