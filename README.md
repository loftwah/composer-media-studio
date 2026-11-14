# Media Studio

An independent, original image, video and sound studio: upload and organise media, make stills, vary a reference, animate a still, generate music and narration, order a storyboard, render a bounded assembly, compare results, and publish one piece deliberately. MIT.

Built for [App Composer](https://github.com/loftwah/app-composer) issue [#457](https://github.com/loftwah/app-composer/issues/457). This repository owns its source, D1 metadata, R2 media, provider keys and release.

## What works without a model account

Projects, uploads, thumbnails, the viewer, search and filters, renaming, downloads, deletion, creative references, project export and public pages. Uploads accept JPEG, PNG and WebP up to 32 MB and MP4/WebM up to 64 MB. Reference images for generation are capped at 8 MB.

## Generation

- **Images** — Cloudflare Workers AI on this studio's own account. Studio Draft (SDXL Lightning) supports square, portrait, landscape and wide frames. Studio Detail (FLUX.2 klein) takes one selected still and makes a reference-guided variation.
- **Edits** — fal.ai on this studio's own key. Studio Fill (`fal-ai/flux-pro/v1/fill`) takes a still and an exactly matching mask for a real inpaint; the same tool builds a 25% extended frame for outpaint. Studio Cutout (`fal-ai/birefnet/v2`) removes the background and returns a transparent PNG; Studio Upscale (`fal-ai/clarity-upscaler`) doubles the still. Every edit keeps the original and saves the result as a separate variant with its own hash.
- **Video** — fal.ai through this studio's own key. Hailuo 2.3 Standard, Kling 2.5 Turbo Pro, or MiniMax H3 Max Turbo, image-to-video, 5–15 seconds depending on model. H3's live provider availability remains unverified. The job is asynchronous: submit, poll, copy the finished MP4 into this studio's R2.
- **Sound** — fal.ai through the same key. Studio Score (`fal-ai/stable-audio`) makes a 10–30 second instrumental bed; Studio Voice (`fal-ai/elevenlabs/tts/eleven-v3`) narrates text supplied by the owner; Studio Effect (`fal-ai/elevenlabs/sound-effects/v2`) makes one short cue. Each is saved as its own audio asset with a real duration, sample rate and channel count read from the bytes, and can be published or used in a composition.
- **Recipes** — five original starting points: editorial still, product plate, cinematic still, reference variation and animate a still. Controls state whether they map to a provider field or a prompt instruction.

## Storyboard and bounded assembly

A composition is an ordered list of two to six saved clips (each at most 16 seconds, all of them at most 60 seconds) plus a soundtrack of up to four saved music, narration or effect tracks. Trim, gain and fades are applied deterministically in the browser and saved as a new WAV; the separate tracks and their settings stay in the composition manifest. Rendering creates one durable job that calls one bounded ffmpeg composition on fal.ai (`fal-ai/ffmpeg-api/compose`) and copies the assembled MP4 into this studio's R2. Editing a storyboard updates it in place and keeps every earlier render attached to it, so the interface can show that a cut has changed since its last render. Rendering again is a separate estimated request.

For music-video planning, the Assemble workspace, project API and scoped MCP connection can save a rights-confirmed song plan against an existing audio asset's fingerprint. It proposes evenly divided scenes for a 2–60 second segment (two to six scenes); those boundaries are editable and are not lyric- or beat-aware. Each scene can retain a direction, same-project reference image and selected video take. Plan revisions use compare-and-swap so a stale edit returns a conflict. Planning does not generate or render media; the complete music-video workflow remains unfinished. Apply additive migration `0006_song_plans.sql` before deploying this capability.

Owners and authorised editors can save up to 100 manually timed, rights-confirmed caption cues on a song plan through the Assemble workspace, project API or MCP. Times are measured against the source song; SRT and WebVTT exports shift them to the chosen segment's start. Caption edits share the plan revision, and scene edits preserve them. Captions are not automatically transcribed or burned into rendered video.

The Assemble workspace, footage-planning API and MCP tools can save an editable, rights-confirmed cut map against an existing project video and its fingerprint. Suggested cuts are evenly divided, not detected from the footage; owners can adjust up to six ordered source ranges totalling at most 60 seconds, add directions and select existing same-project references and takes. Revisions reject stale edits and the original video is untouched. This is planning only: it does not analyse cuts, process footage, preserve audio in an export, restyle or render a finished edit. Apply additive migration `0008_footage_plans.sql` before deploying this capability.

A 9:16 cut keeps the selected shot order. Its first stage composes a deliberate one-second 1080 × 1920 slate; the second composes the selected takes in their chosen order after it, with the saved sound. It is not a renamed 4:5 file, a stretch, or a portrait-first re-sort of the edit.

Studio Score takes a length of 10 to 30 seconds, so a generated bed can be chosen to fit the cut instead of being padded afterwards.

A render needs the provider to read the participating bytes. The studio mints a signed link per asset, valid for 30 minutes, bound to one asset and one project. It exposes no listing, session or provider key, and expires on its own. That read is disclosed in the interface before the render starts.

Every request shows an estimate before submission. The monthly allowance is enforced by one atomic SQL admission across the project. Half-finished saves keep the exact provider bytes and can be retried without another inference call. Ambiguous provider outcomes keep their reservation and are never resubmitted automatically.

## Migrations

`0003_audio_and_assembly.sql` widens the saved media kinds to include audio and adds compositions. SQLite cannot widen a `CHECK` constraint in place, so the two tables that enumerate kinds are rebuilt with every existing row copied; no data is dropped. Apply it with `pnpm migrate:remote` before deploying the worker that needs it.

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

Optional video on a local or deployed studio: `npx wrangler secret put FAL_KEY`.

Optional public destinations: `PUBLIC_BUILD_URL` ("Build your own Media Studio"), `PUBLIC_STORY_URL` ("See how this was made") and `LAUNCH_KIT_URL` ("Open Launch Kit"). Each is a plain HTTPS installation variable; omit an independent studio's absent destination and the link is not rendered. Invalid, non-HTTPS or credential-bearing values are ignored.

`pnpm check` checks the strict TypeScript frontend and runs the unit and persistence tests. The project entrance, library, asset viewer, creation workbench, assembly, history, publication and settings screens use React, TypeScript, Vite and Tailwind. All surfaces share the existing server APIs and data. `pnpm dev` builds the frontend before starting the local Worker. `pnpm deploy` refuses a dirty tree or unpushed main, runs the checks and frontend build once, deploys, and verifies the live revision. The build output in `public/creative/` is generated, not a second data store or service.

The Apps launcher is the locally committed Composer distribution and source at App Composer revision `202c3dd16c5585210ac8186d36d21ebe4ac27aaa`; it needs no runtime asset fetch from Composer. `node scripts/launcher-assets.mjs --check` verifies its authored TypeScript against the shipped controller. A configured HTTPS `COMPOSER_ORIGIN` selects the Composer task destination; independently maintained app destinations remain those in the reviewed launcher source and can be changed by an installation owner before re-emitting it with `--write`.

## Ownership boundaries

- A standalone studio uses one owner passphrase and an HttpOnly signed session. There is no multi-tenant registration.
- An installation opened from App Composer accepts a short-lived signed handoff naming the current actor, workspace, selected project and read/edit/generate/publish/admin actions. Privileged actions re-check the current Composer grant on the server; a revoked member stops the next dispatch. The Composer cookies and provider keys never reach this origin.
- Media bytes live in the studio's R2 bucket; metadata in its D1 database.
- Composer receives a source pin, not credentials. The studio runs after detaching Composer and has no licence callback.
- Deleting media withdraws pages using it. A tombstone prevents a late provider result from restoring deleted media.
- The project export includes project, references, prompts, lineage, costs and publications but never secrets or media bytes. Media downloads are separate; an export is not an R2 backup.

See [the reuse note](docs/darkroom-assessment.md) for the bounded Darkroom decision and [the deployment notes](docs/deployment.md).

The [agent connection guide](docs/mcp-integration.md) describes the scoped MCP connection and its current limits.

First-party gallery reconciliation is disabled by default. An installation may explicitly allow specific project IDs with `FIRST_PARTY_PUBLICATION_PROJECTS` (comma-separated); that setting alone publishes nothing. A publish-authorised project member can then enable its policy after confirming rights and public suitability for outputs and reference material, and review a paged dry-run inventory before reconciling existing work. Saved reference-free outputs from supported models may be published or have their existing active pages listed. A supported single-reference result may also be reconciled when its public Woodhouse Share original matches the saved reference hash and its credit is in the reviewed set. The resulting page retains the public source credit and, where required, the complete Tabler Icons MIT notice. Verification failures, unknown credits, multi-source assemblies, reference chains and incomplete legacy records remain held for attribution review. Uploads and reference assets are not candidates; hidden or ever-withdrawn items are skipped, and existing public URLs are preserved. Eligible work started after opt-in can publish automatically; source verification is bounded and a failure leaves the saved output private. Public descriptions for new automatic pages are empty; prompts and private captions are not copied. Disable the project policy to stop future automatic publications; previously public pages remain public until explicitly withdrawn. The attestation is an operator assertion, not independent verification of rights or content.

A read-only production snapshot on 14 November 2026 found four stored outputs with explicit null reference, parent and mask fields. That is a point-in-time metadata result, not a conclusion about the rights or suitability of any other output. The snapshot predates the verified single-reference path; multi-source provenance remains future work. The guard does not delete or change existing pages.
