# Media Studio

An independent, original image, video and sound studio: upload and organise media, make stills, vary a reference, animate a still, generate music and narration, order a storyboard, render a bounded assembly, compare results, and publish one piece deliberately. MIT.

Built for [App Composer](https://github.com/loftwah/app-composer) issue [#457](https://github.com/loftwah/app-composer/issues/457). This repository owns its source, D1 metadata, R2 media, provider keys and release.

## What works without a model account

Projects, uploads, thumbnails, the viewer, search and filters, renaming, downloads, deletion, creative references, project export and public pages. Uploads accept JPEG, PNG and WebP up to 32 MB and MP4/WebM up to 64 MB. Reference images for generation are capped at 8 MB.

## Browser-local image workbench

[`/tools/images`](/tools/images) is a signed-out, browser-local image workbench. It needs no account, provider, payment or upload, and it never fetches a user image from another origin. The page narrows the work to JPEG, PNG and WebP inputs up to 32 MiB and 40 megapixels per image, with at most 20 images in one batch.

- **One workspace:** drag, drop, paste or choose files, or try the generated sample. JPEG EXIF orientation is applied before editing. It shows source dimensions, MIME, bytes, declared alpha and SHA-256, then resizes by long edge or exact width and height with smooth or nearest-neighbour resampling, crops to an aspect from a chosen position (centre, edge or corner), rotates, flips and straightens by up to 45° each way. Straightening keeps the largest fully-covered area, so no empty rotated corner is exported, and **Reset controls** restores the original settings without removing images. A **kept-area overlay** outlines the exact region the export will use on the source, dimming what will be discarded. Transparent padding can be trimmed from exact alpha bounds. Exports are real PNG, JPEG or WebP bytes with dimensions, byte count, SHA-256, a before/after preview and a download. The original File is unchanged.
- **Light and colour:** exposure (two stops each way), contrast, saturation and temperature sliders, plus Mono, Warm, Cool, Punch and Fade presets that are only named values for those controls. Adjustments are applied to the exported pixels after resize and crop, the alpha channel is never written, and the result states the real numbers and how many pixels changed.
- **Colour and target size:** extracts up to 8 dominant colours while ignoring fully transparent pixels and merging near-duplicates, with HEX, RGB, HSL and coverage. The palette can be downloaded as a GIMP Palette (`.gpl`) file with HEX swatch names; it contains no image bytes or metadata. Swatches and per-format copy buttons are keyboard reachable. The result preview has a pointer eyedropper plus arrow-key/Enter sampling that reads the exact intrinsic pixel. JPEG and WebP can target a byte size through a bounded quality search that reports real output bytes and says honestly when the target was not met; PNG explains that a lossless byte target is not achievable.
- **Embed code:** builds Base64, data URI, CSS, HTML and Markdown from the exported bytes, with the real Base64 and data-URI character counts. It stops at 2 MiB and says plainly that a data URI is the image itself, not encryption, redaction or a private link.
- **Batch:** the same settings run across up to 20 images one at a time, with real progress, cancellation between items, per-file error and retry, per-file download and one store-only ZIP. Rows can be dragged or moved with Move up and Move down; the ZIP follows that order. The ZIP writer is in this repository and has byte-structure tests.
- **Metadata:** it reads JPEG segments, PNG chunks and WebP chunks, and reports camera, EXIF orientation, GPS presence, ICC, XMP, text/comments and other chunks. **Strip metadata and verify** copies pixels without re-encoding, preserves a non-default EXIF orientation with a one-tag block so the picture does not rotate, and checks the output bytes, dimensions and declared metadata. ICC removal is optional and warns that colours can change. This is not an anonymity tool: pixel-level clues remain.
- **Limits and honest refusals:** SVG, HTML and other active content are refused, as are HEIC/HEIF, AVIF, GIF and unsupported containers in this slice. Corrupt or malformed files fail before processing. Object URLs and bitmaps are released on remove, clear and page unmount. There is no server upload on the local path.
- **Explicit Studio import only:** a result can be imported only after checking a signed-in Studio session, choosing an existing project and clicking upload. The caption records the source filename, source SHA-256 and transform settings, including crop position and adjustment values. The result becomes a new private library asset; nothing is published automatically.

The workbench is part of [issue #183](https://github.com/loftwah/composer-media-studio/issues/183). Perceptual compression presets, palette import, alpha-edge fringe inspection, sprite-sheet assembly, local background removal, provider upscale, redaction, GIF, PDF, HTML-to-image and captions remain open or delegated. The palette action opens the Launch Kit importer for the JSON you download. See [the coverage matrix](docs/image-tools-coverage.md) for the exact shipped, delegated and deferred state. Older local tools remain at `/tools/audio-trim`, `/tools/video-clip` and `/tools/add-music`.

## Generation

- **Images** — Cloudflare Workers AI on this studio's own account, run through [Darkroom](https://www.npmjs.com/package/@fungi.computer/darkroom) for Studio Print, Film, Draft, Quick and Detail. Darkroom reads an authorised reference and retains the exact provider image in this studio's R2 bucket; it needs no Computer. It fits a reference with the `IMAGES` binding and keeps each job in a `MEDIA_OPERATION` Durable Object. Studio Draft now uses FLUX.2 Klein 9B through Darkroom's multipart adapter and supports square, portrait, landscape and wide frames. The retired SDXL Lightning draft is still named on its saved jobs with its exact endpoint; new work cannot select it. Studio Detail (FLUX.2 klein 4B) takes one selected still and makes a reference-guided variation.
- **Edits** — fal.ai on this studio's own key. Studio Fill (`fal-ai/flux-pro/v1/fill`) takes a still and an exactly matching mask for a real inpaint; the same tool builds a 25% extended frame for outpaint. Studio Cutout (`fal-ai/birefnet/v2`) removes the background and returns a transparent PNG; Studio Upscale (`fal-ai/clarity-upscaler`) doubles the still. Every edit keeps the original and saves the result as a separate variant with its own hash.
- **Video** — fal.ai through this studio's own key. Hailuo 2.3 Standard, Kling 2.5 Turbo Pro, or MiniMax H3 Max Turbo, image-to-video, 5–15 seconds depending on model. H3 produced saved videos on the Media Studio installation shown here, including [Bubbles](https://media.loftwah.com/p/Z8Ve3dyfywAKyAc4) and [SHOALSHOT](https://media.loftwah.com/p/5xFh02VhvCRteXtb). Availability and funding depend on each studio's provider account. The job is asynchronous: submit, poll, copy the finished MP4 into this studio's R2.
- **Sound** — fal.ai through the same key. Studio Score (`fal-ai/stable-audio`) makes a 10–30 second instrumental bed; Studio Voice (`fal-ai/elevenlabs/tts/eleven-v3`) narrates text supplied by the owner; Studio Effect (`fal-ai/elevenlabs/sound-effects/v3`) makes one short cue. Each is saved as its own audio asset with a real duration, sample rate and channel count read from the bytes, and can be published or used in a composition.
- **Recipes** — five original starting points: editorial still, product plate, cinematic still, reference variation and animate a still. Controls state whether they map to a provider field or a prompt instruction.

## Storyboard and bounded assembly

A composition is an ordered list of two to six saved clips (each at most 16 seconds, all of them at most 60 seconds) plus a soundtrack of up to four saved music, narration or effect tracks. Trim, gain and fades are applied deterministically in the browser and saved as a new WAV; the separate tracks and their settings stay in the composition manifest. Rendering creates one durable job that calls one bounded ffmpeg composition on fal.ai (`fal-ai/ffmpeg-api/compose`) and copies the assembled MP4 into this studio's R2. Editing a storyboard updates it in place and keeps every earlier render attached to it, so the interface can show that a cut has changed since its last render. Rendering again is a separate estimated request.

For music-video planning, the Assemble workspace, project API and scoped MCP connection can save a rights-confirmed song plan against an existing audio asset's fingerprint. It proposes evenly divided scenes for a 2–60 second segment (two to six scenes); those boundaries are editable and are not lyric- or beat-aware. Each scene can retain a direction, same-project reference image and selected video take. Plan revisions use compare-and-swap so a stale edit returns a conflict. A saved plan can create revision-linked storyboards from takes up to 16 seconds long. The creator may choose an in-point for each take and explicitly approve the portions used; each out-point follows from the scene length. The original song segment is retained as a soundtrack track, and the source ranges are frozen with the storyboard for caption checks. Distinct in-points create distinct storyboards; retries reopen the matching unchanged cut. Open the storyboard and mix the soundtrack into a saved WAV before rendering. The local MP4 renderer can burn in saved captions when the plan revision and frozen ranges still match. Paid provider rendering does not support trimmed shots. The bridge itself does not mix or render, and the complete music-video workflow remains unfinished. The existing fal compose result-read limitation is not resolved by this bridge. Apply additive migration `0006_song_plans.sql` before deploying this capability.

**Studio Director.** In the Assemble workbench the Studio Director turns one short creator request into a typed scene-direction proposal for the ticked scenes of a saved song plan. It reads only that project's saved plan text, timing and asset titles, runs one bounded Workers AI text request with no media generation, and returns before/after directions with a review digest. Nothing is applied, saved, generated, published or charged until the creator reviews the proposal, applies it to the draft and saves the scene plan; the existing revision check refuses a stale plan. A studio without the Workers AI binding reports the Director as unconfigured, and any model failure leaves the plan unchanged. A direction is a creative suggestion, not approved art direction.

Owners and authorised editors can save up to 100 manually timed, rights-confirmed caption cues on a song plan through the Assemble workspace, project API or MCP. Times are measured against the source song; SRT and WebVTT exports shift them to the chosen segment's start. Caption edits share the plan revision, and scene edits preserve them. Captions are not automatically transcribed or burned into rendered video.

The Assemble workspace, footage-planning API and MCP tools can save an editable, rights-confirmed cut map against an existing project video and its fingerprint. Suggested cuts are evenly divided, not detected from the footage; owners can adjust up to six ordered source ranges totalling at most 60 seconds, add directions and select existing same-project references and takes. Revisions reject stale edits and the original video is untouched. A saved source range can be exported locally with its primary audio track in a compatible browser. The cut map does not detect cuts, restyle footage or render a complete edit. Apply additive migration `0008_footage_plans.sql` before deploying this capability.

Saved storyboards can also be rendered locally to H.264/AAC MP4 in a compatible browser. Each render resolves the clicked storyboard id against the server's current saved revision before encoding, including a replaced take or soundtrack, and the private receipt is bound to that same revision and output hash. Storyboard cards show the plan revision and whether it is the latest saved cut; the editor names the revision it is changing and shows saved or unsaved status, and a newly created song storyboard is loaded before its first edit. The bounded local renderer uses two to six saved clips (up to 16 seconds each, 60 seconds total, 128 MiB total inputs), a saved WAV mix (up to 16 MiB) or silence, source video frames up to 4K, and a small landscape, portrait or square output frame. Matching saved song plans can optionally burn in permission-confirmed captions; source-clip audio is muted. Rendering requires the page to remain open, uses no inference provider and offers explicit download or a separate save to the Studio library. AAC encoding can add a short audio tail. Codec support and resource use depend on the device; unsupported cases fail without submitting a provider job. The renderer uses [Mediabunny 1.66.0](https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.0.tgz), MPL-2.0; [licence and source notice](public/third-party/mediabunny.txt).

A 9:16 cut keeps the selected shot order. Its first stage composes a deliberate one-second 1080 × 1920 slate; the second composes the selected takes in their chosen order after it, with the saved sound. It is not a renamed 4:5 file, a stretch, or a portrait-first re-sort of the edit.

Studio Score takes a length of 10 to 30 seconds, so a generated bed can be chosen to fit the cut instead of being padded afterwards.

A render needs the provider to read the participating bytes. The studio mints a signed link per asset, valid for 30 minutes, bound to one asset and one project. It exposes no listing, session or provider key, and expires on its own. That read is disclosed in the interface before the render starts.

Every request shows an estimate before submission. The monthly allowance reservation and job admission are committed together in one D1 transaction across the project. Half-finished saves keep the exact provider bytes and can be retried without another inference call. Ambiguous provider outcomes keep their reservation and are never resubmitted automatically. Accepted cancellation requests require explicit reconciliation; normal polling and cron do not advance them. Older admitted jobs without a verifiable atomic admission are held for investigation rather than dispatched or released automatically.

## Private version review rooms

A creator can issue a private review link for one exact saved image or film. The room pins the asset ID and its SHA-256 (and, where a local render receipt records it, the exact storyboard revision the render came from), so feedback is always attached to one saved version. The link is a 256-bit bearer token stored only as a SHA-256 hash in D1, expires after a chosen 1–30 days and can be revoked or replaced immediately. Reviewer pages are `noindex`, `no-store` and `no-referrer`, expose no project name, prompt, caption, source lineage or other project asset, and serve the pinned bytes only through the token-checked media route.

A reviewer can watch or view that version, leave film feedback at a timecode or image feedback at a point, and record an explicit **approved** or **changes requested** decision. Approval is review feedback only: it does not publish, schedule, spend, delete, promote a revision or change project permissions. The creator reads feedback grouped by version, can mark a note resolved, compare two saved versions side by side, see each room's state and issue a new link without losing the recorded feedback. A new render is a new room and never inherits an earlier approval. Review rooms do not call a provider or mutate the saved media.

A reviewer who holds a second private link can paste it on the review page to see both pinned versions together. The comparison validates both tokens by hash and status, requires the same project, rate-limits attempts and returns only each version's label, media facts, status and decision; neither room's feedback is copied or shown against the other version. The page is server-rendered from a same-origin form, the JSON form is `POST /api/review/compare`, and no comparison is stored. On a wide screen the review page keeps a bounded, sticky media stage beside the feedback and decision panels; below 1000px it stacks.

Apply additive migration `0019_review_rooms.sql` before deploying this capability.

## Storage health

The Library has a compact **Storage health** panel for the studio owner or an admin grant. It reads the project's saved records and checks the exact R2 objects without deleting, moving, re-encoding or publishing anything. It shows bytes by media kind, originals versus derivatives, missing objects, published and protected assets, incomplete legacy rows and exact duplicate content.

The same read-only report is available at `GET /api/projects/:id/storage-report` (owner/admin only; add `?download=1` for a JSON download). Per-asset **Used in** detail is at `GET /api/projects/:id/assets/:assetId/uses`. Uses come only from saved lineage, generations, storyboards, audio tracks, slates, publications, subject versions, song and footage plans, render receipts and review rooms. An asset with incomplete provenance is reported as `unknown`, never as `unused`; a used or published asset is never labelled unused because a reference is missing.

Before an upload, the Library hashes the file in the browser and asks `POST /api/projects/:id/assets/preflight` with the SHA-256, byte size and MIME. A match must be exact, live and in the same project. **Reuse existing original** calls `POST /api/projects/:id/assets/reuse`, which returns the existing saved asset without copying bytes, creating a row or changing lineage, rights or relationships. A shared filename with different bytes is not a duplicate, and another project's asset is never disclosed. If hashing or the preflight fails, the existing upload path still runs.

This slice is deliberately read-only. Reclaiming storage remains a separate, explicitly approved follow-up with its own dependency and tombstone checks; there is no auto-purge in this report.

## Replay a Web-ready image receipt locally

Use this tool with an explicitly selected PNG and its downloaded Image Tools v1 receipt from **Apply Web-ready image**. Build the frontend with `pnpm build:frontend`. Use an installed Google Chrome and a local Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/replay-web-ready-image.mjs --source ./source.png --receipt ./studio-image-receipt.json
```

The script passes the selected PNG to the existing browser workbench and matches the downloaded receipt and WebP bytes. It serves the built workbench assets in the isolated Chrome session and blocks other requests. Exact output may depend on the Chrome encoder version. The script reports a mismatch and opens no Studio account or workspace.

To verify one output of the four-size **Social sizes** kit, add `--size square|portrait|story|landscape` with that size's receipt:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/replay-web-ready-image.mjs --source ./source.png --receipt ./moss-story-receipt.json --size story
```

This uses the existing workbench and your selected PNG. With `--size`, a WebP
receipt leaves the kit at its default. A PNG receipt selects **Kit format → PNG**.
The script compares the actual downloaded filename, MIME, byte count and SHA-256
with the chosen size and receipt. Without `--size`, the Web-ready preset is used.

## Replay a palette JSON export locally

Use this tool with an explicitly selected PNG and its downloaded Image Tools palette JSON from **Download palette (.json)**. It uses the same isolated workbench and explicit local file selection as the receipt replay:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/replay-palette-json.mjs --source ./source.png --palette ./studio-palette.json
```

The script uses **Extract palette** and compares the complete v1 JSON export, including the swatch order. The report includes a digest of the selected PNG and a separate digest of the downloaded palette. The palette format itself carries swatches and units. Use the same build and Chrome version for an exact replay.

## Make a contact sheet from explicit local files

Build the frontend with `pnpm build:frontend`. Repeat `--source` for two to
twenty PNGs in the order you want them on the sheet. Choose an unused
`--output` path for the result.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/local-contact-sheet.mjs --source ./first.png --source ./next.png --output ./contact-sheet.png
```

The isolated Chrome workbench processes the selected images and saves its
native contact sheet PNG. The report includes the source hashes, dimensions
and output SHA-256.

## Migrations

`0003_audio_and_assembly.sql` widens the saved media kinds to include audio and adds compositions. SQLite cannot widen a `CHECK` constraint in place, so the two tables that enumerate kinds are rebuilt with every existing row copied; no data is dropped. Apply it with `pnpm migrate:remote` before deploying the worker that needs it.

`0018_portable_project_imports.sql` adds restart-safe restore staging and bundle idempotency. Apply it before using portable project import on an existing installation.

## Run locally

```sh
pnpm install
npx wrangler d1 create media-studio   # first time only; update database_id
npx wrangler r2 bucket create media-studio
pnpm migrate:local
printf '%s' 'a-long-owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE --local
printf '%s' "$(openssl rand -hex 32)" | npx wrangler secret put SESSION_SECRET --local
pnpm dev
```

Stills from Studio Print, Film, Quick and Detail run through Darkroom, which needs the `IMAGES`, `MEDIA_OPERATION` and `APP_ARTIFACTS` bindings already in `wrangler.jsonc`. `pnpm dev` supplies them locally; no new bucket is needed. To try it, open a project, choose Studio Detail with one of its stills as the reference, and generate. The result lands in the project library as before.

Optional video on a local or deployed studio: `npx wrangler secret put FAL_KEY`.

Optional public destinations: `PUBLIC_BUILD_URL` ("Build your own Media Studio"), `PUBLIC_STORY_URL` ("See how this was made") and `LAUNCH_KIT_URL` ("Open Launch Kit"). Each is a plain HTTPS installation variable; omit an independent studio's absent destination and the link is not rendered. Invalid, non-HTTPS or credential-bearing values are ignored.

`pnpm check` checks the strict TypeScript frontend and runs the unit and persistence tests. The project entrance, library, asset viewer, creation workbench, assembly, history, publication and settings screens use React, TypeScript, Vite and Tailwind. All surfaces share the existing server APIs and data. `pnpm dev` builds the frontend before starting the local Worker. `pnpm run deploy` refuses a dirty tree or unpushed main, runs the checks and frontend build once, deploys, and verifies the live revision. The build output in `public/creative/` is generated, not a second data store or service.

The Apps launcher is the locally committed Composer distribution and source at App Composer revision `202c3dd16c5585210ac8186d36d21ebe4ac27aaa`; it needs no runtime asset fetch from Composer. `node scripts/launcher-assets.mjs --check` verifies its authored TypeScript against the shipped controller. A configured HTTPS `COMPOSER_ORIGIN` selects the Composer task destination; independently maintained app destinations remain those in the reviewed launcher source and can be changed by an installation owner before re-emitting it with `--write`.

## Ownership boundaries

See the [source map](docs/studio-architecture.md) for the Worker, Image Tools, agent and publication boundaries.

- A standalone studio uses one owner passphrase and an HttpOnly signed session. There is no multi-tenant registration.
- An installation opened from App Composer accepts a short-lived signed handoff naming the current actor, workspace, selected project and read/edit/generate/publish/admin actions. Privileged actions re-check the current Composer grant on the server; a revoked member stops the next dispatch. The Composer cookies and provider keys never reach this origin.
- Media bytes live in the studio's R2 bucket; metadata in its D1 database. Darkroom may only read a live image in the same project. The Studio indexes the exact original from the operation’s fixed private R2 key. The copy with embedded prompts is never stored; originals with unverified metadata or signatures stay private.
- Composer receives a source pin, not credentials. The studio runs after detaching Composer and has no licence callback.
- Deleting media withdraws pages using it. A tombstone prevents a late provider result from restoring deleted media.
- The private metadata export at `/api/projects/:id/export` includes project records, references, prompts, lineage, costs, publications, subject versions and song plans (which may contain lyrics and scene directions), but not Studio provider keys, session cookies or media bytes. User-authored text and links can still contain sensitive information; share it carefully. It remains available for backward compatibility and is not itself an importable restore.
- A portable project bundle at `/api/projects/:id/portable-export` plus the owner CLI includes the same records and every live media original with content hashes, and can be restored into a fresh owner-controlled installation. Provider keys, sessions and signed URLs are excluded; restored publications start withdrawn and hidden. See [portable project bundles](docs/portable-project.md) for exact commands, the deterministic archive format, limits and the current verification boundary.

See [the reuse note](docs/darkroom-assessment.md) for the bounded Darkroom decision and [the deployment notes](docs/deployment.md).

The [agent connection guide](docs/mcp-integration.md) describes the scoped MCP connection and its current limits.

First-party gallery reconciliation is disabled by default. An installation may explicitly allow specific project IDs with `FIRST_PARTY_PUBLICATION_PROJECTS` (comma-separated); that setting alone publishes nothing. A publish-authorised project member can then enable its policy after confirming rights and public suitability for outputs and reference material, and review a paged dry-run inventory before reconciling existing work. Saved reference-free outputs from supported models may be published or have their existing active pages listed. A supported single-reference result may also be reconciled when its public Woodhouse Share original matches the saved reference hash and its credit is in the reviewed set. The resulting page retains the public source credit and, where required, the complete Tabler Icons MIT notice. Bounded, no-mask generated-only chains may also be reconciled when every saved reference ID and hash leads to an explicitly reference-free generated root or to a verified Woodhouse Share original. In the latter case the public page retains the verified root credit and applicable licence; each intermediate asset and generation keeps its existing provenance and hashes. Verification failures, unknown credits, masked edits, multi-source assemblies and incomplete legacy records remain held for attribution review. Uploads and reference assets are not candidates; hidden or ever-withdrawn items are skipped, and existing public URLs are preserved. Eligible work started after opt-in can publish automatically; source verification is bounded and a failure leaves the saved output private. Public descriptions for new automatic pages are empty; prompts and private captions are not copied. Disable the project policy to stop future automatic publications; previously public pages remain public until explicitly withdrawn. The attestation is an operator assertion, not independent verification of rights or content.

A read-only production snapshot on 14 November 2026 found four stored outputs with explicit null reference, parent and mask fields. That is a point-in-time metadata result, not a conclusion about the rights or suitability of any other output. The snapshot predates the verified single-reference and generated-chain paths; multi-source provenance remains future work. The guard does not delete or change existing pages.
