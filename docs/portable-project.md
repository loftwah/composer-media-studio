# Portable Studio project bundles

A portable bundle is a private, self-contained archive of one Studio project:
its D1 records and the exact R2 media bytes needed to reconstruct the editable
work in another owner-controlled Studio installation. It is separate from the
older metadata-only `/api/projects/:id/export`, which remains available for
backward compatibility.

The bundle never contains Studio provider keys, worker secrets, session
cookies, bearer tokens, Composer workspace bindings, MCP grants, signed media
URLs, monthly budget reservations or installation-wide publication policies.
Restored publications are withdrawn, hidden and unlisted until the owner
reviews and publishes again. Provider jobs are never replayed.

## Owner commands

Run these from a checkout of this repository with Node 22.23+ or 24.22+.
`STUDIO_PASSPHRASE` is the owner passphrase for the target installation. You
may instead pass `STUDIO_SESSION_COOKIE` or `--cookie` from a signed-in browser.
The CLI talks to the Studio's existing owner API; it does not read D1/R2
directly and does not need a second importer service.

Export a project to an owner-controlled file:

```sh
STUDIO_PASSPHRASE='the owner passphrase' \
node scripts/studio-project.mjs export \
  --studio https://media.example.com \
  --project prj_abc123 \
  --out ./portable/my-project.studio \
  --confirm
```

`--confirm` is required because the command writes a private archive. The file
is created with mode `0600` and an existing file is not overwritten unless you
add `--force`. The command downloads every listed media object, verifies its
size, MIME and SHA-256 against the manifest, and writes nothing if a check
fails.

Inspect and verify an archive before importing:

```sh
node scripts/studio-project.mjs inspect --bundle ./portable/my-project.studio
```

Dry-run against a fresh installation. This reads and validates the archive and
reports conflicts, required bytes, duplicate content and warnings, and writes
nothing:

```sh
STUDIO_PASSPHRASE='the fresh installation passphrase' \
node scripts/studio-project.mjs import \
  --studio https://fresh.example.com \
  --bundle ./portable/my-project.studio \
  --dry-run
```

Restore for real:

```sh
STUDIO_PASSPHRASE='the fresh installation passphrase' \
node scripts/studio-project.mjs import \
  --studio https://fresh.example.com \
  --bundle ./portable/my-project.studio \
  --confirm
```

The restore creates a new project id and new asset/record ids, stages every
media object under a new project-owned R2 key, verifies each hash again, and
commits the project and records in one D1 batch. A repeated import of the same
bundle is idempotent: it returns `already_imported` and the original restored
project id. A different bundle from the same source project, or a bundle that
collides on the source project slug, is refused without overwriting anything;
restore a newer export into a fresh installation or remove the earlier restored
project deliberately.

Read-only inventory, including duplicate content useful to #158:

```sh
STUDIO_PASSPHRASE='the owner passphrase' \
node scripts/studio-project.mjs inventory --studio https://media.example.com
```

Opt-in cleanup of a restore's unreferenced staging objects. It never deletes a
live original or a published dependency:

```sh
STUDIO_PASSPHRASE='the owner passphrase' \
node scripts/studio-project.mjs cleanup \
  --studio https://media.example.com \
  --import-id imp_abc123 \
  --confirm
```

All commands accept `--json` for machine-readable output. `export`, `import`,
`inventory` and `cleanup` print progress to stderr.

## HTTP API used by the CLI

The CLI uses these owner routes. They are the existing Studio API, not a
separate backend. Portable restore and inventory are restricted to a standalone
owner session; a Composer bridge session cannot create an installation-wide
project or read restore inventory.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/portable-export` | Sealed manifest (no media bytes) |
| `POST` | `/api/studio/restore/preview` | Validate a manifest and report conflicts; writes nothing |
| `POST` | `/api/studio/restore` | Create or resume a staging restore |
| `POST` | `/api/studio/restore/:importId/assets/:assetId` | Stage one raw media entry |
| `POST` | `/api/studio/restore/:importId/commit` | Verify all staged bytes and activate records |
| `GET` | `/api/studio/restore/:importId` | Restore status |
| `GET` | `/api/studio/imports` | Read-only imports and duplicate-content inventory |
| `POST` | `/api/studio/restore/:importId/cleanup` | Opt-in staging cleanup |

Every write requires the normal Studio owner/admin session. The legacy
`GET /api/projects/:id/export` metadata export is unchanged.

## Archive format: `studio-project-bundle/v1`

The archive is deterministic and bounded. It is not a ZIP and performs no
decompression, so archive bombs and zip-slip paths do not apply. Bytes are laid
out as:

```text
STUDIO-PROJECT-BUNDLE/1\n
<10-digit zero-padded manifest length>\n
<canonical manifest JSON>
<blob bytes in manifest blobs order>
<blob-stream SHA-256>\n
<manifest SHA-256>\n
```

- The manifest is canonical JSON with sorted object keys. `manifest.bundleId`
  and `manifest.integrity.contentSha256` are the SHA-256 of the canonical
  content excluding `bundleId` and `integrity`. Re-sealing changed content
  yields a different bundle id.
- `manifest.blobs[]` lists every distinct media object by content hash, path
  `assets/<sha256>`, MIME, and byte size. Identical bytes are stored once. The
  path is a logical content address; the archive does not extract files into the
  filesystem, so it cannot write outside an owner-chosen directory.
- `manifest.assets[]` lists every asset record. A live record names a blob and
  must agree with its SHA-256, size and MIME. A deleted record is a
  `tombstone`: it carries metadata but no bytes and no media dependency.
- `manifest.generations`, `compositions`, `recipes`, `subjects`, `songPlans`,
  `footagePlans`, `publications` and `promoBriefs` carry editable state,
  lineage, prompts and historical timing. Asset and subject ids inside nested
  JSON are rewritten to new owned ids on restore.
- The two trailing SHA-256 lines verify the exact manifest text and the ordered
  media stream. Every blob is also hashed individually before use.

### Determinism

Two exports of the same unchanged project produce byte-identical archives. The
manifest does not contain an export timestamp or random id; it contains the
source project's own timestamps and stable record ordering.

### Limits

| Limit | Value |
| --- | --- |
| Asset records per bundle | 200 |
| Record rows per bundle | 2,000 |
| Image entry | 32 MiB |
| Audio entry | 32 MiB |
| Video entry | 64 MiB |
| Whole media stream | 512 MiB |
| Manifest | 1.5 MB |

These are deliberately conservative. A larger project should be split or
handled by a later release; the current code refuses rather than buffering an
unbounded archive inside the Worker. The archive itself is assembled by the
owner CLI on the owner's machine and is read into bounded memory for hashing
and upload. The Worker receives only the manifest and one bounded asset at a
time.

Set the optional plain Worker variable `STUDIO_PORTABLE_STORAGE_LIMIT_BYTES` to
a non-zero number to make the dry run and staging refuse when the installation's
live asset bytes plus the bundle would exceed that limit. Without it, Studio
does not assume an R2 quota on the owner's behalf.

## What is portable

- Project name, slug, creative direction, visibility, references and defaults.
- Asset metadata, titles, captions, source, lineage (`parent_asset_id`,
  `generation_id`), original bytes and content hashes.
- Generation records, prompts, model/provider names, historical cost estimates
  and allocated values as history. Provider request ids and signed status or
  response URLs are not exported. Non-saved provider jobs become terminal
  `failed` records with `restored_not_dispatched`; the scheduler cannot resume
  them.
- Storyboards/compositions, custom recipes, approved subject versions, song
  plans (including captions and scene directions), footage cut maps, promo
  briefs and publication records.
- Deleted assets as tombstones so lineage remains legible; their bytes are not
  included.

## What is not portable, and why

- Provider keys, worker secrets, owner passphrases, session cookies and bearer
  tokens are never read or written.
- Composer workspace ownership and grant checks are installation-specific.
- MCP clients, codes, tokens, spend reservations and installation-wide
  publication policy are not project work.
- Monthly budget reservations and provider invoices are not restored; a restore
  does not invent spend.
- Signed media URLs, render links, local-render receipts and footage-export
  receipts are ephemeral.
- Public URLs are not resurrected. Publication records restore withdrawn,
  hidden and unlisted under new random public slugs; the original slug remains
  archive metadata only.
- D1/R2 disaster recovery, cross-account backup automation and encrypted remote
  storage are separate concerns. A bundle is a project portability format, not
  a whole-installation backup.

## Verification status

The complete path is proven against fictional local fixtures and an in-memory
D1/R2 stand-in: deterministic export, byte and hash round trip, fresh
installation restore, editable project/plan/reference reopening, tampered
manifest/asset refusal, missing media refusal, duplicate-import idempotence,
dry-run no-write, credential absence and opt-in cleanup.

**Production restore against the real Cloudflare D1/R2 installation is NOT
VERIFIED in this change.** The implementation was developed and tested without
production credentials; no production D1 or R2 object was read or written, no
deployment was performed and no public page was changed. The remaining gate is
an owner-run export from the real installation followed by a restore into a
separate fresh D1/R2 installation, with the resulting hashes and editable flows
recorded in #157.
