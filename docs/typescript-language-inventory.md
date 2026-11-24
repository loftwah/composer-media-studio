# TypeScript migration and language inventory

Inventory at Studio main revision `8f13d2b` on 24 November 2026. The generated path table maps shipped scripts to their authored sources. The language totals below come from GitHub.

## Strict-check coverage

`tsconfig.json` sets `strict: true` with `noEmit: true`. Its `include` is an explicit allowlist: 65 named modules under `src/lib` and `src/mcp`, plus the `src/frontend/**/*.ts` and `src/frontend/**/*.tsx` globs. These are the entry points for the strict application check.

`tsconfig.launcher.json` sets `strict: true` and `noEmitOnError: true` for the 12 browser entries in `src/browser/`. `scripts/launcher-assets.mjs` compiles them with that config and writes the checked public files, preserving each public path.

`pnpm check` runs, in order:

1. `tsc --noEmit` with `tsconfig.json`.
2. `node scripts/launcher-assets.mjs --check`, which recompiles the 12 browser entries and fails if any checked output differs.
3. `node --import ./tests/support/workers-runtime.mjs --test tests/*.test.mjs`.

`scripts/deploy.mjs` is the guarded release path. It refuses a dirty tree, a branch other than `main`, or `main` that is not pushed. It then runs `pnpm check`, builds the frontend, uploads the Worker, and reads back the exact source revision from `/healthz` and `/build.json` with no-cache requests. A release is only reported passed when that identity matches.

## The 12 generated JavaScript paths

`.gitattributes` marks these 12 exact paths as `linguist-generated`. Every line maps one-to-one to an authored source and to an entry in both `tsconfig.launcher.json` and the asset list in `scripts/launcher-assets.mjs`. The generator writes a source-pointer header, and these are the only JavaScript outputs excluded from GitHub's byte count.

| Checked output | Authored owner | Bytes |
| --- | --- | ---: |
| `public/brand/launcher.js` | `src/browser/launcher.ts` | 28,942 |
| `public/gallery-focus.js` | `src/browser/gallery-focus.ts` | 3,815 |
| `public/public-piece.js` | `src/browser/public-piece.ts` | 3,652 |
| `public/compare.js` | `src/browser/compare.ts` | 9,054 |
| `public/review.js` | `src/browser/review.ts` | 13,534 |
| `public/recipe-selection.js` | `src/browser/recipe-selection.ts` | 1,757 |
| `public/voice-handoff.js` | `src/browser/voice-handoff.ts` | 3,098 |
| `public/studio-comparison.js` | `src/browser/studio-comparison.ts` | 2,697 |
| `public/studio-route.js` | `src/browser/studio-route.ts` | 2,997 |
| `public/studio-login-return.js` | `src/browser/studio-login-return.ts` | 2,182 |
| `public/theme.js` | `src/browser/theme.ts` | 1,683 |
| `public/login.js` | `src/browser/login.ts` | 1,901 |
| **Total generated** | | **75,312** |

## What still counts as JavaScript

After removing the 12 generated outputs, GitHub's JavaScript total is 2,043,157 bytes across 225 files. That total reconciles exactly with the tracked `.js` and `.mjs` files minus the generated table above.

| Group | Files | Bytes | Share |
| --- | ---: | ---: | ---: |
| Test files, fixtures and browser checks (`tests/**/*.mjs`) | 181 | 1,439,080 | 70.4% |
| Runtime source (`src/**/*.mjs`) | 17 | 291,073 | 14.2% |
| Authored public assets (`public/*.js`, unmarked) | 11 | 209,027 | 10.2% |
| Tooling (`scripts/**/*.mjs`) | 15 | 103,546 | 5.1% |
| `vite.config.mjs` | 1 | 431 | 0.0% |

### Runtime source

Five substantial modules account for 285,825 of the 291,073 runtime bytes. These modules retain their authored JavaScript source and are bundled into the Worker.

| File | Bytes | Current role |
| --- | ---: | --- |
| `src/worker.mjs` | 126,326 | Worker entry, route and response assembly. Imports strict TypeScript route and response owners. |
| `src/lib/jobs.mjs` | 81,185 | Durable job engine: admission, leases, provider dispatch, retries and publication handoff. |
| `src/lib/portable-bundle.mjs` | 29,306 | Portable archive staging, verification and D1/R2 commit path. The manifest and export builders are already strict TypeScript. |
| `src/lib/providers.mjs` | 25,797 | Provider adapters and runtime catalogue. The public catalogue projection is already strict TypeScript. |
| `src/mcp/tools.mjs` | 23,211 | Transport-independent MCP tool definitions and dispatcher. OAuth is already strict TypeScript. |

The remaining 5,248 bytes are 12 compatibility shims that preserve existing `.mjs` import paths by re-exporting strict TypeScript owners: `ui.mjs`, `review-rooms.mjs`, `util.mjs`, `auth.mjs`, `loftwahfm-import.mjs`, `render-links.mjs`, `darkroom.mjs`, `upload-links.mjs`, `fal-webhook.mjs`, `oauth.mjs`, `publication-policy.mjs` and `publication-bulk.mjs`. Their behaviour lives in the TypeScript files; Linguist still counts the shim files as JavaScript.

### Authored public assets

`public/studio.js` is the largest single authored JavaScript file at 202,250 bytes. It is the legacy progressive Studio browser module, referenced by the script tag in `src/lib/studio-shell.ts`; GitHub counts it as authored JavaScript.

The other 6,777 bytes are authored browser helpers and entry shims: `asset-caption.js` (1,384), `wav.js` (1,343), `shot-trims.js` (725), `derivative-size.js` (710), `restyle-history.js` (707), `restyle-history-refresh.js` (655), and the four small tool launchers `video-clip.js`, `images.js`, `audio-trim.js` and `add-music.js` (311–314 each). The four launchers import the built `/creative/home.js`; The launchers are maintained by hand. Four of these helpers have hand-maintained `.d.ts` declarations, and two more declaration files sit beside generated modules. In the 24 November readback, those six public declarations (1,345 bytes) are not included in GitHub's TypeScript total.

### Tests and tooling

The largest test files cover image title comparison (56,922 bytes), review rooms (37,378), MCP OAuth (34,920), portable projects (32,432) and release timing (32,160). The 181 tracked files under `tests/` include fixtures and browser checks. Tests, the 15 release and maintenance scripts, and `vite.config.mjs` retain their Node or local-build entry points.

## Representative migrations

These pull requests record the conversion and its release evidence.

| PR | Merge commit | Scope |
| --- | --- | --- |
| [#200](https://github.com/loftwah/composer-media-studio/pull/200) | `d4ef2f5` | Native image receipt source |
| [#511](https://github.com/loftwah/composer-media-studio/pull/511) | `a22ac26` | Shared utilities |
| [#515](https://github.com/loftwah/composer-media-studio/pull/515) | `cdc9c60` | Darkroom runtime |
| [#517](https://github.com/loftwah/composer-media-studio/pull/517) | `223f52d` | MCP OAuth |
| [#552](https://github.com/loftwah/composer-media-studio/pull/552) | `dcf53f5` | Public discovery responses |
| [#558](https://github.com/loftwah/composer-media-studio/pull/558) | `b4cdb80` | Portable inventory and bundle descriptions |
| [#561](https://github.com/loftwah/composer-media-studio/pull/561) | `152ebd4` | `/compare.js` source |
| [#562](https://github.com/loftwah/composer-media-studio/pull/562) | `c5531e8` | `/review.js` source |
| [#569](https://github.com/loftwah/composer-media-studio/pull/569) | `9e20b15` | Studio route and sign-in return modules |
| [#575](https://github.com/loftwah/composer-media-studio/pull/575) | `955b663` | Recipe selection and voice draft helpers |
| [#578](https://github.com/loftwah/composer-media-studio/pull/578) | `faf9c87` | Portable manifest validation |
| [#580](https://github.com/loftwah/composer-media-studio/pull/580) | `dae08fc` | Portable export manifests |
| [#591](https://github.com/loftwah/composer-media-studio/pull/591) | `abf8bb3` | `/theme.js` source |
| [#599](https://github.com/loftwah/composer-media-studio/pull/599) | `18d783c` | `/login.js` source |
| [#601](https://github.com/loftwah/composer-media-studio/pull/601) | `685abed` | Public publication routing |
| [#604](https://github.com/loftwah/composer-media-studio/pull/604) | `3a26b80` | Gallery and showcase reads |
| [#618](https://github.com/loftwah/composer-media-studio/pull/618) | `f173715` | Public homepage and help responses |
| [#623](https://github.com/loftwah/composer-media-studio/pull/623) | `b770d02` | Response security headers and route choices |
| [#627](https://github.com/loftwah/composer-media-studio/pull/627) | `d8e74b8` | Saved-model comparison route |
| [#629](https://github.com/loftwah/composer-media-studio/pull/629) | `a543e22` | Saved asset and generation views |

## GitHub language bytes

The owning issue opened on 17 November 2026 with JavaScript at 2,112,168 bytes and TypeScript at 604,423 bytes. The table records readbacks reported during the migration and the current GitHub API readback.

| Point | JavaScript | TypeScript | Lead |
| --- | ---: | ---: | --- |
| 17 Nov baseline (issue) | 2,112,168 | 604,423 | JavaScript +1,507,745 |
| After #591 | 1,932,184 | 1,848,660 | JavaScript +83,524 |
| After #599 | 1,957,311 | 1,897,082 | JavaScript +60,229 |
| 24 Nov tool-page checkpoint | 1,971,954 | 1,939,555 | JavaScript +32,399 |
| After #618 | 2,005,838 | 1,987,645 | JavaScript +18,193 |
| After #627 | 2,026,057 | 2,021,223 | JavaScript +4,834 |
| **Current readback, 24 Nov 03:40 UTC** | **2,043,157** | **2,048,397** | **TypeScript +5,240** |

The current `/languages` response also reports CSS 129,369 and Rust 52,349. TypeScript is 47.94% of those four totals and JavaScript 47.81%. The repository API now reports `language: TypeScript`.

The byte totals reconcile exactly with the tree:

- JavaScript: 2,118,469 tracked `.js`/`.mjs` bytes − 75,312 generated = 2,043,157.
- TypeScript: 2,049,742 tracked `.ts`/`.tsx`/`.mts` bytes − 1,345 bytes in six public `.d.ts` declaration shims = 2,048,397. This subtraction reconciles the tracked bytes with the 24 November API readback.

These figures change as commits land and GitHub recalculates statistics, so treat the API readback as the source. The recorded TypeScript lead was 5,240 bytes. GitHub may refresh the repository language field and the byte API at different times.

## Provenance commands

All commands are read-only and can be rerun from the repository root:

```sh
# Live language bytes, bypassing a stale local cache.
curl -sS -H 'Cache-Control: no-cache' \
  https://api.github.com/repos/loftwah/composer-media-studio/languages

# The 12 markers and their source pointers.
cat .gitattributes
rg -n 'source:|output:' scripts/launcher-assets.mjs

# Generated outputs, authored JavaScript and TypeScript totals.
git ls-files '*.js' '*.mjs' '*.ts' '*.tsx' '*.mts'

# Current checked outputs; requires installed dependencies.
node scripts/launcher-assets.mjs --check
```
