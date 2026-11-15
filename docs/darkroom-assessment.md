# Darkroom reuse assessment

Checked 2026-11-13 UTC against the published package, not a website summary.

## What was inspected

- `@fungi.computer/darkroom@0.5.12` (MIT), published to npm on 2026-11-13, source
  `https://github.com/fungi-computer/darkroom`.
- The published tarball's `dist/index.d.ts`, `model-catalog.d.ts`,
  `server.d.ts`, `cloudflare.d.ts`, `cloudflare/provider.d.ts`,
  `media-operation-owner.d.ts`, `media-operation-storage.d.ts` and the package
  README. Its own test suite is not included in the published package; no claim
  is made that its tests were run here.
- Documented bounds from the inspection note: four references, 8 MiB per
  reference, 32 MiB still-image output, 64 MiB video output. The studio adopts
  its own conservative limits (one reference, 8 MiB reference, 32 MiB image,
  64 MiB video) rather than claiming the package's constants were exercised.

## What Darkroom provides

`MediaOperationDO` is a SQLite-backed Durable Object per generation. It captures
identity and input before dispatch, retains provider bytes before the destination
save, retries a failed save with the same bytes, returns 409 for a changed input
under the same request id, and never re-dispatches an ambiguous provider
execution silently. The host supplies `actorId`, `namespace`, `owner`,
`destinationId`, a provider, destination authorisation and optional idempotent
metering. That is the right shape for a media job engine.

## Concrete incompatibility

The package cannot admit the required route without modification:

1. **Closed model catalogue.** `mediaVideoModelIdSchema` admits
   `bytedance/seedance-2.0`, `google/veo-3.1` and `minimax/h3-max` through the
   Fungi gateway. The ordinary Cloudflare studio must use fal.ai's documented
   image-to-video endpoints (`fal-ai/minimax/hailuo-2.3/standard/image-to-video`,
   `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`) without an Oyster/Fungi
   installation. A custom `MediaProvider` is injectable, but
   `validateMediaGenerationSettings` rejects a model outside that catalogue, so
   the provider cannot be reached with a valid request.
2. **Oyster-shaped references.** `MediaReference` requires
   `{ computerId, path }` and the request schema marks `computerId` as a string.
   This studio's references are app-owned R2 assets, which is exactly the
   independent Cloudflare path required when Oyster is absent.
3. **Two engines, one outcome.** Using Darkroom for still images and a separate
   engine for video would create two job authorities for one studio and duplicate
   cancellation, budget and tombstone semantics. That is worse than one reviewed
   app-owned engine.

## Decision

**Adapt the semantics, do not vendor the package in the first release.** The
studio implements the same invariants in `src/lib/jobs.mjs`:

- intent persisted before dispatch;
- one unique client request id per project;
- an atomic dispatch lease;
- retained bytes before the asset record;
- save retry without inference;
- one atomic monthly allowance admission;
- unknown outcomes keep their reservation and are never resubmitted;
- tombstones survive late completion after deletion.

This is a documented replacement of the machinery, not an unexamined one. The later edit and 9:16 additions keep the same authority: a fill, cutout or upscale is one generation row with its source and mask hashes; the 9:16 cut is one generation row whose first provider stage is a merge and whose second stage is the existing compose call, with the same reservation, retained bytes and tombstone rules.

## When to revisit

Adopt Darkroom when either:

- its catalogue becomes host-extensible (allowing a reviewed fal adapter), or
- [#422](https://github.com/loftwah/app-composer/issues/422)'s Oyster path is
  enabled and its gateway video route is the selected provider.

Update path: pin the exact published version, run its published checks in the
studio repository, add the catalogue entry and adapter, migrate the existing job
rows by stable request id, and keep the current tombstones and budget ledger as
the authority during the transition.

## Update 2026-11-15: still images only

Reason 1 above is resolved upstream: since Darkroom 0.7.0 a host can inject its own provider catalogue (`parseMediaCatalogue`; validation and the video cost estimate take it as an argument), so a reviewed fal.ai adapter is possible later. Reason 2 is resolved by the R2 destination below.

`@fungi.computer/darkroom@0.10.0` now ships `createR2MediaDestination`, so Darkroom
can read references from and write results to this studio's `MEDIA` bucket without
a Computer. Studio Print, Film, Quick and Detail use it (`src/lib/darkroom.mjs`).
The decision above stands for everything else: Studio Draft (SDXL Lightning) is not
in Darkroom's catalogue, video and edits are fal.ai, and the job ledger, budget
reservation and tombstones stay in `src/lib/jobs.mjs`. Darkroom is the provider and
storage step inside that engine, not a second one. Deleting a generated still, or
discarding a deleted job, also erases Darkroom's retained copy under
`media-output/` in `APP_ARTIFACTS` through Darkroom's own `erase`.

One visible change: Darkroom builds its own Workers AI input and has no
`guidance` setting, so Studio Print (Lucid Origin, was `guidance: 5`) and Studio
Film (Phoenix, was `guidance: 3`) now use the model defaults.
