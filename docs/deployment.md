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
limits. Check the target account before enabling more usage. Draft remains
direct Workers AI; edits, video and audio remain on fal.ai.

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
- The project export contains metadata, prompts, lineage, costs and publications;
  media downloads are separate. An export is not an R2 backup.


## Optional LoftwahFM soundtrack import

The first-party deployment sets the `LOFTWAHFM` service binding to the
existing LoftwahFM Worker. Remove it if your account does not operate that
Worker. Studio can use the public LoftwahFM media route across accounts.
The importer passes no listener credentials. The upstream public media
handler still decides whether the track is available, and the Studio requires
edit access and rights confirmation before preserving the track in a project.
