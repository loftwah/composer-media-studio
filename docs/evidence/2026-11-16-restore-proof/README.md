# Portable Studio restore proof — local D1/R2 installations

Date: 16 November 2026. Issue: [#157](https://github.com/loftwah/composer-media-studio/issues/157).
Source: branch `codex/studio-restore-20261116`, based on `main` at `c7729e5`, plus
the staging bookkeeping fix recorded below. No deployment, production D1/R2
access, publication or withdrawal was performed. Every record and media file in
this proof is fictional.

This run proves the shipped `studio-project-bundle/v1` path end to end on two
separate local `wrangler dev` installations, each with its own on-disk D1
database and R2 bucket:

- export through `scripts/studio-project.mjs export` and the owner HTTP API;
- preview/dry-run, staging, commit and retry through `/api/studio/restore*`;
- exact media bytes and SHA-256 before and after;
- editable relationships after a worker restart;
- private-by-default publications;
- rejection of malformed archives;
- convergence after an interrupted restore.

The only environment-specific constants were a fictional owner passphrase and
session secret in the git-ignored `.dev.vars`. No provider key was configured
and no generation was dispatched.

## Identity and toolchain

| Item | Value |
| --- | --- |
| Repository | `/Users/deanlofts/gits/composer-media-studio` |
| Worktree | `/private/tmp/studio-restore-20261116` |
| Branch | `codex/studio-restore-20261116` |
| Base commit | `c7729e5fab7afe75ef8daba7aad877611b8b698a` |
| Runtime | Node `v22.23.4` for the local instances, CLI and restore transcripts; the final `pnpm check` also passed under Node `v26.13.1`. pnpm `12.19.0`, Wrangler `4.162.0` |
| Local persistence root | `/private/var/folders/qm/ltm8shgs7tv9k8qfqgfpjxq80000gn/T/opencode/studio-restore-20261116` |
| D1 database name | `media-studio` (local only) |
| R2 bucket name | `media-studio` (local only) |
| Owner session | standalone `mode=owner`, passphrase login through `/api/login` |

The persistence root is removed after this evidence was captured; it is not a
retained fixture.

## Local installations

Each installation is a separate `wrangler dev --local --persist-to <dir>`
process with its own `source/`, `target/`, `retry/`, `live/`, `fixcheck/` and
`negatives-db/` directory. They never share D1 or R2 state.

| Instance | Port | Persistence directory | Purpose |
| --- | --- | --- | --- |
| Source | 8791 | `source/` | Fictional project, export, live publication |
| Target | 8792 | `target/` | Fresh restore, restart, repeat import |
| Retry | 8793 | `retry/` | Interrupted staging, restart, refused commit, retry |
| Negatives | 8795 | `negatives-db/` | Broken bundles; `STUDIO_PORTABLE_STORAGE_LIMIT_BYTES=1000` |
| Live | 8796 | `live/` | Restore of a bundle exported while a page was live |
| Fix check | 8797 | `fixcheck/` | Staging crash-window reproduction and fixed behaviour |

Migrations were applied with:

```sh
npx wrangler d1 migrations apply media-studio --local --persist-to <instance-dir>
```

All 21 migrations, including `0018_portable_project_imports.sql`, applied.

## Fixture inventory

Project: `prj_2d26995a06374b0db3f5d96c89222320` — "Fictional Lantern Study",
private, creative direction and defaults set. Media was generated locally with
ffmpeg and uploaded through the real project asset API.

| Asset | Kind | Bytes | SHA-256 | Relationship |
| --- | --- | ---: | --- | --- |
| Lantern reference still | image/png | 1,534 | `e9197ada910e7cd0f1d38f20e0a9d808bc001a518dff9a28ef733974ee517756` | Subject reference |
| Lantern still, web crop | image/png | 878 | `15042b7cc980ec6ae643bc9a9a51a934997a8c5a64b35fe8e74548dc81ccaca6` | Edited variant; `parent_asset_id` → reference still; linked to saved generation |
| Lantern motion take | video/mp4 | 57,816 | `984f04d36760678fc566490928ac915d28abc99fb212978c9759c0a166c30502` | Selected take; storyboard shot |
| Lantern motion take, small cut | video/mp4 | 20,566 | `5a04fe038f6cd59cec34b8ddc1ea32b34d34c906de97aac015140707c638fa3e` | Edited variant; `parent_asset_id` → motion take; trimmed storyboard shot |
| Fictional lantern hum | audio/wav | 529,278 | `8217b33d58ba3c262ff065e4f05413337f8245da0f70fe821dbf5a098cb343dd` | Song plan source; storyboard audio |

Total media: 610,072 bytes in 5 distinct blobs.

Editable state:

- Subject `sub_31f8652dc54b434eaeb7086e17c1f7aa`, two append-only versions
  (revision 1 and 2), reference fingerprint bound to the reference still.
- Song plan `plan_a6f3de6d4be846ab92c344e479746740`, revision 3, two scenes
  covering 0–2,500 ms and 2,500–5,000 ms. Scene 1 has the reference still, the
  motion take as selected take and subject version 2 as `subjectOrigin`; scene 2
  has the edited still and the edited take. Two owner-supplied caption cues.
- Storyboard `cmp_7bfbfd2eed084fe3934a723f0d381727` with two shots (whole motion
  take, trimmed edited take) and the audio source.
- Two fictional generation records: one `saved` image generation linked to the
  edited still, with provider request/status/response URLs, and one `submitted`
  video generation that must never be replayed. Both were inserted directly into
  local D1 to model provider history without a provider call.
- Two publications: one withdrawn before the first export, and one live
  (`/p/-cpCoQsW8w8JzA63`) when the second bundle was exported.

## Bundles

| Bundle | Bytes | Archive SHA-256 | Manifest `bundleId` | Records |
| --- | ---: | --- | --- | --- |
| `lantern.studio` | 620,635 | `90a3b25ed3ec44c0facd706841fe17a7d02a15ef91218eb59e69986c4ff35e35` | `bc609c8ffe85c6cccebd8f4c3e5b355d3629ce4e383edf81de5876b14c385d94` | 5 assets, 2 generations, 1 storyboard, 2 subject versions, 1 song plan, 1 publication |
| `lantern-second.studio` | 620,635 | `90a3b25ed3ec44c0facd706841fe17a7d02a15ef91218eb59e69986c4ff35e35` | same | Second export of unchanged project |
| `lantern-live.studio` | 621,002 | `ce7156ce91e59c23d4913f15d8370d8ec8f8c7856cf50bba325e3bae46500369` | `470a2c5c0e6a818cb982f713d6e3b849e3436cf4dfc0ddf18d95534f953724e0` | Same project plus the live publication; 2 publications |

Two exports of the unchanged project produced byte-identical archives, so the
determinism claim holds for this project.

`inspect` verified both bundles locally, and the CLI compared every downloaded
media file with the manifest before writing the archive. A deliberately
corrupted copy (`tampered.studio`, one byte flipped in the media stream) failed:

```text
studio-project: Media 5a04fe038f6cd59cec34b8ddc1ea32b34d34c906de97aac015140707c638fa3e does not match its hash.
exit 1
```

No import request was sent for that file.

## Restore A — fresh installation

Target installation `target/`, owner session through the CLI passphrase.

Dry run:

```sh
STUDIO_PASSPHRASE='<fictional>' node scripts/studio-project.mjs import \
  --studio http://127.0.0.1:8792 --bundle .../lantern.studio --dry-run --json
```

Result: `status: dry_run`, preview `status: ready`, 5 assets / 610,072 bytes /
5 blobs / 7 records, no conflicts or blockers, three privacy warnings,
`writes: 0`. D1 after the dry run still had 0 projects and 0 imports.

Confirmed restore:

```sh
STUDIO_PASSPHRASE='<fictional>' node scripts/studio-project.mjs import \
  --studio http://127.0.0.1:8792 --bundle .../lantern.studio --confirm --json
```

Result: `status: restored`, import `imp_8dd34e2669c34924948822cf1f75bd5c`,
project `prj_72d7d80c56d44464afe832ae001dc844`, all 5 media entries staged, then
committed. D1 after commit:

```text
projects=1 assets=5 generations=2 compositions=1 subject_versions=2
song_plans=1 publications=1 budgets=0 imports=1 live_publications=0
non_private_projects=0
```

`verify-restore.mjs` checked 43 assertions through the owner API. All passed:

- restored project id, name and `visibility=private`;
- every asset's byte size, MIME and SHA-256, and an HTTP download of each asset
  hashing to the same SHA-256 as the bundle;
- edited variants still point at their remapped parent assets;
- two subject versions, latest revision 2, reference id and fingerprint intact;
- song plan revision, scene references, selected takes, subject-origin mapping
  and both caption cues intact;
- storyboard shots and audio remapped to the restored assets;
- the saved generation remains `saved` and points at the restored variant; the
  unfinished generation is terminal with `restored_not_dispatched` and no
  provider request/status/response URL;
- no live publication is exposed by the project endpoint;
- the source publication URL `/p/nS_CBRiOQvmrWstn` returns 404;
- only an owner-mode session was used.

The source and target R2 buckets each held exactly five objects. Hash sets of
the stored objects were identical:

```text
source: 15042b7c… 5a04fe03… 8217b33d… 984f04d3… e9197ada…
target: 15042b7c… 5a04fe03… 8217b33d… 984f04d3… e9197ada…
```

### Restart

The target worker was stopped and started again against the same `target/`
persistence directory. The same 43 assertions passed after the restart, and the
project reopened with its assets, plan, storyboard and private publication
state intact.

### Repeat import

A second CLI import of the same bundle returned `already_imported` without a new
import row or project. Staging an asset after commit returned
`already_committed`. Counts stayed at 1 project, 5 assets and 1 import row.

## Restore B — a live publication is withdrawn

After Restore A, a publication was created on the source and left live. The
source page `/p/-cpCoQsW8w8JzA63` returned 200, including from the source worker
after the restore. `lantern-live.studio` was exported and restored into the
separate `live/` installation as project
`prj_6d2c499797b74773acb3d4cdb2f1297e` (import
`imp_bf5b47a3f7b845e1b311a2d1384423b7`).

Results:

- the source page was still 200 on the source installation — the proof did not
  withdraw or modify it;
- the old source URL returned 404 on the fresh installation;
- both restored publications were `hidden=1`, `listed=0`, `revoked_at` set, with
  new random slugs (`HD9vE40UIKb4CupI`, `jsD-P0WZx8CGFCqK`) that also return
  404;
- `live_publications=0`, `non_private_projects=0`, `budgets=0`;
- `/gallery` and `/` contained no occurrence of the fictional title;
- all 43 relationship and hash assertions passed again.

Trying to restore `lantern-live.studio` into the installation that already held
`lantern.studio` was refused with `409`, conflicts `project_slug_exists` and
`source_project_exists`, and no new project or import row was written.

## Interrupted restore and retry

Installation `retry/`, import `imp_1c16166699694583bcaf13c6122d21b9`, project
`prj_9c241a2cbef14236a3cf76cbd28146ee`.

1. Started a normal restore and staged only the 529,278-byte audio asset.
2. Stopped the worker process.
3. Restarted it against the same persistence directory and posted the same
   manifest again: `202`, `status=staging`, `resumed=true`, same import and same
   owned project id.
4. Committed immediately: `409 missing_media`, and no committed project or
   asset rows existed. This is the deliberate failed restore.
5. Staged every asset again; the already-present audio returned
   `already_staged`, the other four returned `staged`.
6. Committed: `200 committed`, project id equal to the staged id.
7. Repeat import: `already_imported` with the same project id.
8. Inventory: one import row, 5 live assets, 610,072 bytes, no duplicate content.
9. All 43 verification assertions passed, including after the interruption.

The retry did not duplicate assets, create a second project, restore a budget or
expose a page. R2 held exactly five objects, not six.

## Gap found and fixed

Reproduction on `negatives-db/` with the pre-fix code:

- started an import and staged the reference still (1,534 bytes);
- removed the key from `staged_keys_json` to model a worker dying after the R2
  write and before the D1 bookkeeping write;
- retried staging: returned `already_staged` but left `staged_keys_json` empty;
- opt-in cleanup returned `deleted: []` and the R2 object remained, then the
  import was marked failed. A later restart would allocate a new project id and
  key, orphaning that object permanently.

Fix in `src/lib/portable-bundle.mjs`: a small `recordStagedKey` helper now
re-reads the import row and records the key both after a new R2 write and when
the object already exists. Cleanup can therefore find and delete an object left
by an interrupted attempt. The focused regression test
`an object staged before a crash is recorded on retry and can be cleaned up` in
`tests/portable-project.test.mjs` fails on the old code and passes on the fix.

Real local re-check on `fixcheck/` with the fixed code:

- same crash-window simulation, then retry returned `already_staged` and
  `staged_keys_json` contained the key;
- cleanup returned `deleted: [<key>]`, `originalAssetsTouched: 0`, and the R2
  object count went from 1 to 0;
- re-importing the same bundle after the failed import committed 5 assets and
  passed all 43 assertions.

## Negative bundle rejection

`run-negatives.mjs` posted sealed variants to
`POST /api/studio/restore/preview` on the fresh `negatives-db/` installation.
All 13 cases were rejected safely; the installation ended with 0 projects,
0 assets and only the explicitly cleaned failed import.

| Case | HTTP | Code | Result |
| --- | ---: | --- | --- |
| Bad asset/blob hash | 400 | `integrity_failed` | "A live asset disagrees with its media blob" |
| Traversal blob path | 400 | `path_traversal` | "A bundle blob path is not content-addressed" |
| Missing media blob | 400 | `missing_media` | "A live asset has no media bytes in the bundle" |
| Missing asset dependency | 400 | `missing_dependency` | Storyboard refers to media not in the bundle |
| Cross-project subject reference | 400 | `missing_dependency` | Subject refers to media not in the bundle |
| Duplicate asset id | 400 | `duplicate_entry` | "invalid or duplicated" |
| Oversized image entry (40 MiB) | 400 | `invalid_bundle` | "Blob size is not a supported integer" |
| Unsupported MIME | 400 | `invalid_bundle` | "Unsupported media type application/zip" |
| Unsupported schema version | 400 | `incompatible_schema` | "Unsupported bundle schema version 2" |
| Publication slug with `../` | 400 | `invalid_bundle` | "A publication slug is not supported" |
| Insufficient configured storage | 409 | `insufficient_storage` | Blocked before any write |
| MIME mismatch at staging | 415 | `unsupported_type` | PNG bytes declared as `video/mp4` |
| Cleanup after wrong-MIME attempt | 200 | `cleaned` | No project rows activated |

A tampered archive file was also refused locally by `inspect` before any HTTP
request, as recorded above.

## Privacy and secret checks

Scanned the 621,002-byte `lantern-live.studio` archive for the local passphrase,
session secret, cookie name, provider URLs, fictional provider request ids, R2
key field and source project key prefix:

```text
fictional-restore-proof-owner-passphrase: 0
fictional-restore-proof-session-secret: 0
studio_session: 0
provider.invalid: 0
fictitious-request-id: 0
r2_key: 0
projects/prj_: 0
```

The manifest already contains no provider request/status/response URLs by
construction; these checks confirm it for this archive. No `FAL_KEY`,
`BRIDGE_SECRET` or `COMPOSER_ORIGIN` grant was configured or used. The restored
generation rows are terminal historical records and the scheduler does not
resume them.

The legacy metadata-only `GET /api/projects/:id/export` remained available:
200, 12,561 bytes, project/assets/generations/recipes/publications/subjects/
songPlans/promoBriefs keys, no media bytes, no secrets and no R2 keys.

## Acceptance check

| Issue criterion | Result in this run |
| --- | --- |
| Export and import a real project with still, edited variant, video, audio, storyboard and character/reference version into a fresh isolated D1/R2 installation; same bytes and hashes; editable work and relationships survive restart | **PASS locally.** 5 media files, 610,072 bytes and all five SHA-256 values matched through API downloads and on-disk R2 objects; 43 assertions passed before and after a worker restart. Media variants were ffmpeg-edited files with parent lineage, not paid provider generations; provider history was fictional metadata. |
| Reject bad checksum, missing dependency, traversal, duplicate id, oversized entry, incompatible schema, insufficient storage; no partial active records | **PASS.** 13/13 rejected with useful codes; 0 projects and 0 assets after the run. |
| Interruption after partial R2 staging converges without duplicate assets, billing, public exposure or orphaned permanent files | **PASS locally after the fix.** Resume reused the same import and project; incomplete commit was refused; retry committed 5 assets, 0 duplicate content, 0 budgets, 0 live publications. The crash-window orphan was reproduced, fixed, and cleanup then deleted it. |
| Private by default; no provider key, session, bearer token, signed URL, grant or secret; no automatic generation or publish | **PASS for measured scope.** Project `private`, all restored publications withdrawn/hidden/unlisted with new slugs, old and new public URLs 404, gallery clean, secret scans zero, unfinished generations terminal. |
| Bounded preview/progress/error/retry UX on desktop and phone, including large projects | **NOT PROVEN HERE.** The API and CLI paths were exercised; no browser desktop/phone run or large-project streaming UX was performed. |
| Record source, fixtures, imported bytes, fresh installation proof, live-source verification and remaining volume/format limits | **DONE for this local proof** by this document. The limits remain 200 asset records, 2,000 record rows, 32 MiB image/audio, 64 MiB video, 512 MiB media stream and 1.5 MB manifest. |
| Integrate with Composer's own-source/export principle without making standalone Studio depend on Composer; preserve metadata-only export | **PARTIAL.** Standalone Studio and the legacy metadata export still work without Composer. No Composer-side import or bridge was exercised. |

### Not proven here

- **A genuinely separate Cloudflare account or the production installation.**
  No production D1 or R2 object was read or written, nothing was deployed, and
  no production publication was created or withdrawn. The remaining owner-run
  gate is:
  1. export from the real installation with
     `STUDIO_PASSPHRASE='<real owner passphrase>' node scripts/studio-project.mjs export --studio https://media.loftwah.com --project prj_<real> --out ./private/<name>.studio --confirm`;
  2. verify with `node scripts/studio-project.mjs inspect --bundle ./private/<name>.studio`;
  3. restore into a separate fresh owner-controlled D1/R2 installation with
     `STUDIO_PASSPHRASE='<fresh passphrase>' node scripts/studio-project.mjs import --studio https://<fresh-origin> --bundle ./private/<name>.studio --dry-run`, then repeat with `--confirm`;
  4. record the archive hash, per-asset hashes and edited-flow reopening in #157.
  This proof does not establish that the production account can be restored;
  it only establishes the format and code path on local installations.
- **Provider-originated variants and provider replay.** Variants were local
  ffmpeg edits; generation rows were fictional metadata inserted directly into
  local D1. No paid model was called and no provider job was replayed.
- **Browser/phone restore UX, progress and retry UI.** Only the HTTP API and CLI
  were used.
- **Large projects and format coverage.** No project near the 200-asset,
  512 MiB or 1.5 MB manifest limits was tested. MIME coverage was PNG, MP4 and
  WAV only; JPEG, WebP, AVIF, WebM, MP3, M4A and OGG were not exercised here.
- **Whole-installation disaster recovery, cross-account backup automation,
  encryption at rest and Composer-side integration.** These remain out of scope
  per the issue.
- **Tombstones.** No deleted asset was included in these bundles; tombstone
  restore remains covered by the in-memory tests only.

## Cleanup

The local persistence directories, fixture scripts, bundles and temporary
`.dev.vars` under the worktree were removed after capture. The git-ignored
`.dev.vars` contained only the fictional local passphrase and session secret;
no real credential was ever written to the repository.
