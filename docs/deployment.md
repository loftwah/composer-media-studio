# Deployment and ownership

## Production identity

| Item | Value |
| --- | --- |
| Worker | `composer-media-studio` |
| Account | Loftwah `1003dc1d93af0ebea56b2f1252f89627` |
| Public origin | https://media.loftwah.com |
| D1 | `media-studio` (`c3451e4b-48b7-44cd-bf0e-7d953f763df2`) |
| R2 | `media-studio` bound as `MEDIA` |
| Workers AI | binding `AI` |
| Images | binding `IMAGES`, fits reference images for Darkroom |
| Darkroom | Durable Object `MEDIA_OPERATION` (class `MediaOperationDO`, migration `v1`) and R2 binding `APP_ARTIFACTS`, the same `media-studio` bucket |
| Cron | `* * * * *` for job reconciliation |
| Runtime secrets | `OWNER_PASSPHRASE`, `SESSION_SECRET`, `FAL_KEY` |
| Optional public destinations | `PUBLIC_BUILD_URL`, `PUBLIC_STORY_URL`, `LAUNCH_KIT_URL` |
| Source | https://github.com/loftwah/composer-media-studio |

Secrets live only on the Worker and in the owner's ignored local file. The
repository contains no credential, session cookie or provider key.

## First provision

```sh
npx wrangler d1 create media-studio
npx wrangler r2 bucket create media-studio   # also backs APP_ARTIFACTS; no second bucket
# put the returned database_id in wrangler.jsonc
npx wrangler d1 migrations apply media-studio --remote
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
printf '%s' "$SESSION_SECRET" | npx wrangler secret put SESSION_SECRET
printf '%s' "$FAL_KEY" | npx wrangler secret put FAL_KEY   # optional, video only
pnpm run deploy --migrate
```

`pnpm run deploy` refuses a dirty tree or unpushed `main`, runs the focused checks
once, deploys with the commit baked in, then reads `/healthz` and `/build.json`
and fails if the live revision is not the released commit.

After upload, both endpoints can briefly serve the previous revision. The
guard makes up to 12 read attempts five seconds apart, with a three-second
timeout per request. It returns on the first exact match from both endpoints
and exits nonzero if the window expires.

Each release carries one monotonic run ID from before `pnpm check` to exact live
revision identity. It writes a redacted `release-timing/v1` receipt under ignored
`.release/timing/` and prints total, target and limit. **Exactly 300,000 ms is a
breach**; only strictly under five minutes passes. A breach finishes the safe
upload and live check, then creates or updates one open GitHub issue labelled
`delivery-sla`, fingerprinted by repository, release path and slowest stage.
Matching breaches comment on the same issue; a different bottleneck opens a
separate one. A failed GitHub write leaves a redacted event in
`.release/timing/pending/` for the next run. Run the operational checks with:

```sh
pnpm release:watchdog --check-stuck
pnpm release:watchdog --retry-pending
```

A passing release adds recovery evidence but never closes the breach issue
automatically. Receipts contain no credentials, signed URLs or private media.

An alert that still cannot be filed keeps `pnpm release:watchdog --retry-pending`
failing with exit 2 and the number of queued events; it is never reported as a
clean retry. An alert that arrived through the queue keeps its breach identity, so
a later compliant release adds recovery evidence to the same issue.

### Optional first-edit timestamp

Record the UTC instant of the first relevant edit. The guard accepts whole
seconds or three fractional digits and stores JavaScript `toISOString()` format.

```sh
STUDIO_FIRST_EDIT_AT=2026-11-17T01:23:45.000Z pnpm deploy
```

Once the exact live source matches, the private receipt records that timestamp
and `firstEditToLiveIdentityMs`, the UTC gap before the guard plus the monotonic
guard interval; it never changes the guard total or status. The watchdog still
classifies the guard interval against the strict 300,000 ms limit. Invalid,
future or unverified values are ignored.

When that first-edit → exact-live span reaches **300,000 ms** with a fast guard,
the same deduplicated GitHub adapter and pending path file a separate
`delivery-sla` issue for the pre-guard lead time. A run that already breached the
guard alert is not reported twice, and only a later measured compliant span
counts as recovery for that issue. Only the derived duration reaches GitHub; the
raw timestamp stays in the private receipt.

## Darkroom

Studio Print, Film, Quick and Detail use the exact npm release
`@fungi.computer/darkroom@0.10.0`. Run `pnpm run deploy --migrate` for the first
deployment to apply the additive D1 erasure queue and the Worker’s `v1`
SQLite Durable Object migration. Do not reset either store. Keep `MEDIA` and
`APP_ARTIFACTS` bound to the **same private bucket**. Darkroom writes one
immutable provider original under `media-output/`; Studio indexes that same
file. The decorated destination payload with the private prompt is discarded.
Signed or otherwise unverified originals remain downloadable only in Studio.

Studio keeps the authorization, budget, publication and deletion records.
Reconcile and Retry saving only read or finish the existing operation; they
never call Workers AI. If paid execution cannot be established and no original
was retained, the reservation remains for reconciliation. Deletion blocks
access first and retries storage erasure from the existing cron.

`IMAGES` fits Detail references. Cloudflare bills transformations separately
from model calls and [documents a Free plan allowance](https://developers.cloudflare.com/images/pricing/).
Durable Object requests/storage and R2 count against their respective service
limits. Check the target account before enabling more usage. Draft uses the
Darkroom multipart adapter for FLUX.2 Klein 9B; edits, video and audio remain on
fal.ai.

The lockfile pins the three newly published packages. Remove the exact
temporary release-age exceptions after the date in `pnpm-workspace.yaml`.

## Optional public destinations

A published page can offer an owner-configured next step. All three variables
are optional and independent installations may omit every one; the page still
shows its media, download and a secondary **Owner sign-in** link.

| Variable | Destination |
| --- | --- |
| `PUBLIC_BUILD_URL` | **Build your own Media Studio** |
| `PUBLIC_STORY_URL` | **See how this was made** |
| `LAUNCH_KIT_URL` | **Open Launch Kit** in the owner's media detail view |

Set them as ordinary Worker variables, not secrets. Only plain HTTPS URLs
without credentials are accepted; an invalid value is ignored rather than
rendered. No destination is fetched at runtime and no link creates a Composer,
Launch Kit or provider dependency.

## Agent handoff from Composer

Init exports the pinned source, the studio defaults and the creative direction.
The agent creates an owner-controlled repository from that pin, replaces the
operator's account, Worker name, route and storage identifiers with the owner's,
creates the D1/R2 resources and AI/Images bindings, applies the complete D1 migration set, sets
the owner passphrase and session secret, and deploys through the guarded command.
The owner is asked only for the passphrase/session values (and, if they choose
video, a funded fal key). Composer never receives those values.

## Update path

1. Change and review the studio source.
2. Push the reviewed `main`.
3. Run `pnpm run deploy` in the studio repository.
4. Promote the new commit and manifest digest in Composer's
   `config/media-studio-standalone.json` and re-export affected specifications.
5. Keep the previous commit recorded for code rollback. Media and metadata
   restore remain separate operations.

## Data and recovery

- Deleting media is a tombstone plus R2 byte deletion. Publications using it are
  withdrawn. A late provider result cannot recreate the asset.
- A failed save keeps the exact provider bytes under the generation record and
  offers "Retry saving". Retrying does not call the model again.
- The monthly allowance is one atomic D1 update per project and month. Unknown
  outcomes keep their reservation until reconciled.
- The metadata project export contains metadata, prompts, lineage, costs and
  publications; media downloads are separate. It is not an R2 backup or a
  restore. The portable project bundle and owner CLI add live media bytes and a
  fresh-installation restore; see [portable project bundles](portable-project.md).
  The hosted restore used fresh D1 and R2 resources in the same Cloudflare account.
  The target API and Wrangler read back matching bytes. A separate owner's account
  and the hosted browser restore remain open. [Hosted restore receipt](https://github.com/loftwah/composer-media-studio/issues/157#issuecomment-6908133526), [independent owner acceptance](https://github.com/loftwah/composer-media-studio/issues/2).
