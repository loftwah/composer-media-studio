# Owner restore UX — local browser proof

Date: 16 November 2026. Issue: [#157](https://github.com/loftwah/composer-media-studio/issues/157).
Source: branch `codex/157-restore-ux`, based on `main` at `b91615d`. No
deployment, production D1/R2 access, publication or provider call was made.
Every record and media file here is fictional.

This note covers the acceptance line “bounded preview/progress/error/retry UX on
desktop and phone”. The earlier API/CLI proof is in
[the restore proof](../2026-11-16-restore-proof/README.md).

## What was exercised

Two separate local `wrangler dev` installations, each with its own on-disk D1
database and R2 bucket under one temporary root:

| Instance | Port | Purpose |
| --- | ---: | --- |
| Source | 8811 | Fictional project, media uploads, CLI export |
| Target A | 8792 | Full desktop journey, already-imported repeat |
| Target B | 8795 | Stop mid-staging, reload, continue |
| Target C | 8796 | Stop, remove staged files, restore from scratch; phone full journey; offline retry |
| Target D | 8794 | `STUDIO_PORTABLE_STORAGE_LIMIT_BYTES=1000` refusal |

The browser run used the installed Google Chrome through `playwright-core`
1.65.1, headless, at 1440 × 900 and 390 × 844. Session sign-in was the real
standalone owner passphrase in a git-ignored `.dev.vars`; both local
installations shared that fictional secret and, because cookies are host-scoped
rather than port-scoped, the same local session. That is a local-test artifact,
not a product behaviour.

## Fixture

Project “Fictional Beacon Study”, exported with
`node scripts/studio-project.mjs export --confirm`:

- 5 media assets / 5 distinct blobs / 41,249 content bytes: two PNG stills (the
  second an edited variant with `parent_asset_id`), two MP4 takes (the second a
  trimmed variant), one WAV;
- one storyboard with two shots and the audio source;
- bundle `beacon.studio`, 47,344 bytes, `bundleId` `a038ac2a0df1…`.

## Observed

- **Preview**: “5 files · 40 KB”, 5 asset records, 1 storyboard, 0 publications,
  0 provider jobs, monthly budget “Not restored”, plus the three warnings in a
  disclosure. Status: “Preview ready: 5 files, 40 KB. Nothing has been written.”
- **Progress** came from server acknowledgements only, one line per file:
  `Staging “Beacon reference still” (1 of 5). 0 of 5 files staged · 0 bytes of
  40 KB verified.` … `All 5 files are staged.` The `role="status"
  aria-live="polite"` region carried the same text, and the `<progress>`
  element advanced 0→5 files.
- **Success**: “Restored into this studio” — “Fictional Beacon Study” was
  restored with 5 files, 40 KB, 1 storyboard. The link opened
  `#/p/<restored>/library`, and the studio appeared on the home screen.
- **Repeat**: choosing the same bundle again showed “Already in this studio …
  so nothing was written again.”
- **Wrong file**: a metadata-only JSON export was refused with “That is not a
  Studio bundle” and the `.studio` explanation; focus moved to the alert.
- **Truncated file**: “The bundle is incomplete”, before any request.
- **Storage limit** (Target D): 409 `insufficient_storage` rendered as “Not
  enough storage in this studio”, naming
  `STUDIO_PORTABLE_STORAGE_LIMIT_BYTES`; no primary action was offered and no
  import row was written.
- **Stop and resume** (Target B): stopped at
  “2 of 5 files staged · 3 KB of 40 KB verified”; the status line said
  “Stopped. 2 of 5 files are staged on this studio. Nothing was activated;
  continue to resume.” A full page reload then previewed “An earlier attempt at
  this bundle is unfinished here”, offered **Continue restore**, resumed at
  “3 of 5 files staged”, and committed.
- **Network interruption and retry** (Target C, fresh): offline mid-staging
  produced “This studio could not be reached — The request did not complete.
  Check the connection and try again. Retrying continues the same restore;
  nothing is duplicated.” Only **Retry restore** was offered as the primary
  action; going back online and pressing it resumed the same import and
  committed. The installation ended with one import, 5 assets / 41,249 bytes,
  0 duplicate-content groups and 5 R2 objects.

## Independent counts

Verified through the owner API and the on-disk R2 directory, not from the UI
text:

- Target A: 1 project, private; 5 assets; asset
  `(kind, mime, bytes, sha256)` set identical to the source; one storyboard with
  2 shots; 0 live publications; one `committed` import, 5 assets / 41,249 bytes;
  0 duplicate-content groups; 5 R2 objects on disk.
- Target B (resumed): 1 project, one `committed` import, 5 assets / 41,249
  bytes, 0 duplicate groups, 5 R2 objects — the two staged files were not sent
  again.
- Target C (cleanup then restore): 1 project, one `committed` import, 5 assets /
  41,249 bytes, 0 duplicate groups, 5 R2 objects; the cleanup had removed the
  one staged object before the fresh import. It was then wiped and reused for
  the network-interruption retry, which ended with the same counts.

## Layout and accessibility

- No horizontal overflow at 1440 px or 390 px in the idle, preview, progress and
  done states (`documentElement.scrollWidth - innerWidth` was 0 each time).
- The file input is 46 px tall at 390 px; an earlier build rendered a 320 px
  tall label because a 20 rem flex-basis became a height in column mode, which
  this run caught and fixed.
- Focus moves to the error heading (`role="alert"`) on refusal and to the
  success heading on commit; the file input, the primary action and “Choose
  another bundle” are reachable in DOM order.
- No page errors or console errors were recorded in any run.

## Not proven

- A genuinely separate Cloudflare account or the production installation. The
  remaining owner gate is still an export from the real installation and a
  restore into a separate fresh owner-controlled D1/R2 installation.
- A real Composer bridge session in the browser. The API-level 403
  `owner_required` for a bridge session is covered by
  `tests/portable-project-api.test.mjs`; the panel renders the explanation when
  the session is not the standalone owner.
- Large-project pacing: the fixture is 41 KB. The bounded reader holds one blob
  (at most 64 MB) and the manifest (at most 1.5 MB) at a time, but no
  near-limit bundle was streamed through the browser here.
- The aggregate blob-stream hash is not recomputed in the browser (Web Crypto
  has no streaming SHA-256). Every blob and the manifest are hashed
  individually, the container length is checked exactly, and the server repeats
  every asset hash before commit.

## Cleanup

The temporary persistence root, fixture scripts, bundles and the git-ignored
`.dev.vars` were removed after this run. Nothing was written under the
repository’s `.wrangler/state`.
