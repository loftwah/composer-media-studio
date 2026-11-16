# Hosted restore proof — production export into a separate fresh D1/R2 Studio

Date: 16 November 2026. Issue: [#157](https://github.com/loftwah/composer-media-studio/issues/157).

This closes the last open claim in #157: a real production export restored into a
**separate, fresh, owner-controlled D1/R2 installation**, with the restored bytes
read back and hashed. Every asset, publication and promo record in the source
project is an abstract gradient and a trimmed fixture recording; no personal
media or unrelated owner project data was read.

The proof ran against a temporary Worker in the existing Loftwah account with its
own new D1 database and its own new R2 bucket. Production (`composer-media-studio`,
D1 `media-studio`, R2 `media-studio`) was never deployed to, migrated or written.
All temporary resources were deleted at the end of the run; see [Teardown](#teardown).

## Identity and toolchain

| Item | Value |
| --- | --- |
| Repository worktree | `/private/var/folders/qm/ltm8shgs7tv9k8qfqgfpjxq80000gn/T/opencode/batch-20261116/studio-157` |
| Branch | `codex/batch-157-fresh-restore` |
| Deployed source revision | `5241e411ed48c33215e1efbb040f7ee963b13ff2` (branch base; `origin/main` advanced one unrelated agent-403 copy commit, `5313d8f`, which touches no restore code) |
| Runtime | Node `v22.23.4`, pnpm `12.19.0`, Wrangler `4.162.0` |
| Cloudflare account | Loftwah `1003dc1d93af0ebea56b2f1252f89627` (same account, separate resources) |
| Temporary Worker | `media-studio-restoreproof-1611`, version `db3fdc3f-7a70-452c-8ab8-4c6ac6449a1f` |
| Temporary Worker URL | `https://media-studio-restoreproof-1611.loftwah.workers.dev` |
| Temporary D1 | `media-studio-restoreproof-1611-db`, id `7e157898-b617-42b1-8081-a3ff7dc9ae17` (region OC) |
| Temporary R2 | `media-studio-restoreproof-1611-media` (region OC) |
| Temporary config | `<temp-root>/wrangler.restoreproof.jsonc`; the repository `wrangler.jsonc` was not edited |
| Owner session | standalone `mode=owner`; `OWNER_PASSPHRASE` and `SESSION_SECRET` generated with `openssl rand` per phase and passed only through the process environment |

## Source export

The bundle was exported from the real production installation before this run
and supplied read-only at
`/private/var/folders/qm/ltm8shgs7tv9k8qfqgfpjxq80000gn/T/opencode/batch-20261116/withdrawal-proof.studio`.

| Item | Value |
| --- | --- |
| Container bytes | 732,563 |
| Container SHA-256 | `1dfd47539748e1581a6740ae75a33b92a733ffc604cd2846ddb6dd1f5645b2da` |
| Bundle id | `4d35b82e946bfbb096973107ecc4f89acbaab520d17fe331e1cd26d2363c4ed5` |
| Source project | `prj_c7a0ca6f15a94f9eadc8edb001fb34c6` — "Withdrawal proof · 15 Nov 2026", private |
| Stats | 2 assets / 2 blobs / 727,777 content bytes; 1 publication; 1 promo brief; 0 generations, compositions, recipes, subjects, plans |

`node scripts/studio-project.mjs inspect --bundle <bundle> --json` reported
`status: verified`, schema `studio-project-bundle/v1`, and the same container
hash. The two media entries are:

| Source asset | Kind | MIME | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `asset_4f1038ca0b5f4b1497d97874492be063` | image | `image/png` | 535,733 | `4a28077aa6591dd7d2bbd6fb9ef210e398e36e6ff9fafa6d751dc4f15807fbd4` |
| `asset_39e89716ee5a41c9a722e80999ef044a` | audio | `audio/wav` | 192,044 | `d425e9b952ddfa42f354bfe1375909b8c8990eebbc257b5281793de122824944` |

## Temporary target

```sh
npx wrangler d1 create media-studio-restoreproof-1611-db
npx wrangler r2 bucket create media-studio-restoreproof-1611-media
pnpm build:frontend   # gitignored public/creative build used by the Worker assets binding
npx wrangler d1 migrations apply media-studio-restoreproof-1611-db --remote \
  --config <temp-root>/wrangler.restoreproof.jsonc
npx wrangler deploy --config <temp-root>/wrangler.restoreproof.jsonc
printf '%s' "$STUDIO_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE \
  --config <temp-root>/wrangler.restoreproof.jsonc
printf '%s' "$SESSION_SECRET" | npx wrangler secret put SESSION_SECRET \
  --config <temp-root>/wrangler.restoreproof.jsonc
```

All 24 migrations (`0001`–`0024`) applied, including
`0018_portable_project_imports.sql`. The temporary config bound only the new D1
and R2 resources, had no custom route or cron, and set `PUBLIC_ORIGIN` /
`RENDER_ORIGIN` to the temporary workers.dev origin.

## Preview — writes 0

```sh
STUDIO_PASSPHRASE=… node scripts/studio-project.mjs import \
  --studio https://media-studio-restoreproof-1611.loftwah.workers.dev \
  --bundle <bundle> --dry-run --json
```

```json
{
  "status": "dry_run",
  "writes": 0,
  "archiveSha256": "1dfd47539748e1581a6740ae75a33b92a733ffc604cd2846ddb6dd1f5645b2da",
  "preview": {
    "status": "ready",
    "project": { "sourceId": "prj_c7a0ca6f15a94f9eadc8edb001fb34c6", "visibility": "private" },
    "plan": { "assets": 2, "mediaAssets": 2, "blobs": 2, "contentBytes": 727777, "publications": 1, "promoBriefs": 1, "records": 2 },
    "duplicateContent": [],
    "existingContent": [],
    "conflicts": [],
    "blockers": []
  }
}
```

Warnings were the expected three: restored pages are withdrawn, hidden and
unlisted; provider jobs and budgets are not restored; media is rewritten to new
project-owned R2 keys.

## Committed restore

```sh
STUDIO_PASSPHRASE=… node scripts/studio-project.mjs import \
  --studio https://media-studio-restoreproof-1611.loftwah.workers.dev \
  --bundle <bundle> --confirm --json
```

| Item | Value |
| --- | --- |
| Status | `restored` |
| Import id | `imp_c616056483384265a715f3757f4d846c` (committed `2026-11-16T05:20:19.980Z`) |
| Restored project | `prj_ed5245e9c1eb4f37be5f6b7a07920020` (source id not reused; slug `06uTq0Qa0a0` is preserved by the restore design) |
| Counts | 2 assets, 2 media assets, 2 blobs, 727,777 bytes, 1 publication, 1 promo brief |
| Asset id map | `asset_4f1038ca…` → `asset_b0d66f934d8948b293550b911b6927d5`; `asset_39e89716…` → `asset_1baad935e5d14c188fc3666742778464` |
| Publication id map | `pub_82d2e9f3352f4c94b54cac20d5719f9f` → `pub_4503e5ee1ef448d0897fe8ab9a0e7b1b` |
| Promo id map | `promo_65a8772359a94e13b63336e24a493e1b` → `promo_ce19b8ab60a2466d97f37f1fd6f9c79d` |
| Archive hash | `1dfd47539748e1581a6740ae75a33b92a733ffc604cd2846ddb6dd1f5645b2da` |

## Independent read-back

These checks did not use the CLI's import report. A temporary script in the
run's temp root signed in through `/api/login`, read
`GET /api/state`, `GET /api/projects/:id`, `GET /api/assets/:id/download`,
`GET /api/projects/:id/portable-export` and
`GET /api/studio/imports?projectId=…`, and hashed every downloaded body. The
script was not committed and its temp root was removed.

All 19 assertions passed:

- exactly one project exists in the installation, with the source name, a new
  project id, `visibility=private` and the source creative direction;
- exactly two live assets, both private to the project; no un-revoked
  publication is listed by the project API;
- the `(kind, mime, byte length, SHA-256)` set downloaded from the target is
  identical to the source bundle, and each stored row hash/size matches the
  bytes actually read;
- the target's own portable-export manifest reports the same stats
  (2 assets, 2 blobs, 727,777 bytes, 1 publication, 1 promo brief);
- the publication is withdrawn, hidden and unlisted (`hidden=1`, `listed=0`,
  `revokedAt=1794806419980`), was given a new slug `VvUzusBxUTmrVBT3` (source
  `_XElRvsq5xHTVt2A`), and kept its title, description, created time and
  `assetRevision=1`;
- the promo brief kept `revision=3`, its created time and its spec shape;
- one committed import record, `duplicateContent: []`, and installation totals
  of 2 assets / 727,777 bytes.

Restored media, read back through the Worker and hashed locally:

| Restored asset | Kind | MIME | Bytes | SHA-256 | Target R2 key |
| --- | --- | --- | ---: | --- | --- |
| `asset_b0d66f934d8948b293550b911b6927d5` | image | `image/png` | 535,733 | `4a28077aa6591dd7d2bbd6fb9ef210e398e36e6ff9fafa6d751dc4f15807fbd4` | `projects/prj_ed5245e9c1eb4f37be5f6b7a07920020/assets/asset_b0d66f934d8948b293550b911b6927d5/original.png` |
| `asset_1baad935e5d14c188fc3666742778464` | audio | `audio/wav` | 192,044 | `d425e9b952ddfa42f354bfe1375909b8c8990eebbc257b5281793de122824944` | `projects/prj_ed5245e9c1eb4f37be5f6b7a07920020/assets/asset_1baad935e5d14c188fc3666742778464/original.wav` |

R2 was checked with Wrangler as well. Wrangler `4.162.0` exposes no remote
object-list command, so the two expected keys were read from the target D1
(`wrangler d1 execute … --command "SELECT id,kind,mime,bytes,sha256,r2_key FROM assets" --json`)
and each object was fetched with
`wrangler r2 object get media-studio-restoreproof-1611-media/<key> --file <tmp> --remote`.
Both downloaded objects hashed to the values above at the exact expected sizes.
`wrangler r2 bucket info` reported `object_count: 0` / `0 B` at that moment, a
known lag in bucket usage metrics; the object reads themselves prove both
objects exist with the right bytes.

## Safety 1 — a repeat import does not duplicate anything

Running the same command with `--confirm` again returned:

```json
{ "status": "already_imported", "projectId": "prj_ed5245e9c1eb4f37be5f6b7a07920020", "importId": null, "writes": 0 }
```

A fresh independent read-back after that attempt still found exactly one
project, 2 live assets, 1 committed import, 1 publication, 1 promo brief, zero
duplicate groups and the same 2 R2 objects. No second project or asset copy was
created.

## Safety 2 — truncated and corrupt containers are refused before any write

| Container | Mutation | SHA-256 | Result |
| --- | --- | --- | --- |
| `truncated.studio` | first 700,000 bytes of 732,563 | `0151a098982c3abe117f3bd3b7e0167b844d2da18fd56aca18b69ba6852c00bb` | `inspect` and `import --confirm` both exit 1: "The bundle integrity trailer is malformed." |
| `flipped.studio` | one byte at offset 600,000 XOR `0xff` | `4ae610a4820ba02f8bac7ef4f6af9bb38f242cf1d770bd5fbce9694c1c0ef5cf` | `inspect` and `import --confirm` both exit 1: "Media d425e9b9… does not match its hash." |

`decodePortableBundle` validates the container size, manifest seal, every media
hash and the media-stream trailer before `cmdImport` makes any HTTP request, so
both containers were refused locally and nothing reached the Worker. The target
state after both attempts was unchanged: 1 project, 2 assets, 1 import, and the
final independent read-back passed every assertion.

## Teardown

```sh
npx wrangler r2 object delete media-studio-restoreproof-1611-media/<key> --remote   # both keys
npx wrangler r2 bucket delete media-studio-restoreproof-1611-media
npx wrangler delete media-studio-restoreproof-1611 --config <temp-root>/wrangler.restoreproof.jsonc --force
npx wrangler d1 delete media-studio-restoreproof-1611-db -y
rm -rf <temp-root>
```

Confirmed afterwards:

- Cloudflare API `GET /accounts/1003…/workers/scripts/media-studio-restoreproof-1611` → `10007 This Worker does not exist on your account.`;
- `https://media-studio-restoreproof-1611.loftwah.workers.dev/` → HTTP 404;
- `wrangler d1 list` → no `restoreproof` database;
- `wrangler r2 bucket list` → no `restoreproof` bucket;
- durable-object namespace list → no namespace matching `restoreproof`;
- the production resources (`composer-media-studio`, D1 `media-studio`, R2
  `media-studio`) remain present and were not modified.

The temporary owner passphrase and session secret were never written to disk,
never echoed, and are discarded with the deleted Worker and temp root. The
bundle and all run transcripts lived in the deleted temp root; only this
redacted evidence file is retained.

## Remaining limits

- The target is a separate new Worker, D1 and R2 in the **same** Cloudflare
  account, not a second Cloudflare account. That is the fresh owner-controlled
  target #157 asked for.
- The proof used the owner API and CLI, not the browser restore panel. The panel
  was exercised separately on local installations in
  `docs/evidence/2026-11-16-restore-ux/README.md`.
- The project is private and its publication is withdrawn, hidden and unlisted
  in stored state; no anonymous public page URL was fetched during this run.
- Provider jobs and budgets are excluded by design; nothing was re-published,
  generated or charged, and no publication URL was re-created.
- Restore keeps the source project slug; it creates a new project id, new asset
  ids and a new publication slug. That is current behaviour, not a claim that
  every identifier changes.
- The temporary target was deployed from `5241e41`; `origin/main` `5313d8f`
  changes only agent 403 copy and does not touch the portable restore path.
