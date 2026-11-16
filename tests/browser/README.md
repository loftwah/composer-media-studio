# Browser evidence harnesses

These scripts drive a real Chromium/Firefox/WebKit browser against a **local**
wrangler fixture. They are evidence tooling, not part of `pnpm check`, and they
never deploy, publish or spend on a media provider.

## Prerequisites

- `pnpm build:frontend` so `public/creative/` exists.
- A Playwright install with Chromium, Firefox and WebKit. Set
  `PLAYWRIGHT_MODULE` to the module entry when Playwright is not a local
  dependency, for example:

  ```sh
  npm --prefix /tmp/pw install playwright
  PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
    STUDIO_BROWSER_DIR=/tmp/studio-fixture \
    node tests/browser/workbench.mjs
  ```

- `STUDIO_BROWSER_DIR` is the owned temporary root for the SQLite/R2 fixture.
  Delete it after the run; it is not evidence.
- `STUDIO_BROWSER_OUT` (optional) keeps screenshots and JSON receipts under an
  ignored `output/` directory.

## Fixture

```sh
STUDIO_BROWSER_DIR=/tmp/studio-fixture node tests/browser/fixture.mjs
```

Creates one fictional project with three reference stills, seven short clips, a
40 s bed, a six-scene promo brief with long direction text and a six-scene song
plan with captions. All media is synthesised locally with `ffmpeg`; no owner
data is used.

The fixture uses `https://localhost:8791` because the Studio session cookie is
`Secure`; WebKit refuses it over plain `http`. Wrangler's self-signed local
certificate is accepted only inside these scripts.

## Runs

| Script | Proves |
| --- | --- |
| `workbench.mjs` | Six long scenes across 1728→320 widths, 200%/400% reflow, add/remove and focus, draft retention, save/reopen, a real 409 conflict, an emulated mobile keyboard, reduced motion, sibling routes and the Firefox/WebKit core. |
| `launcher.mjs` | The Apps trigger and its dialog ship together, open by keyboard/mouse, list Studio-local destinations only, close on Escape/Close and return focus; an orphan trigger is removed. |
| `director.mjs` | One real Workers AI reply becomes a typed proposal; nothing is saved until review, apply and save; reload and the project API show the same revision. Needs a logged-in wrangler account for the remote `AI` binding, and makes one bounded text call per run. |
| `shot-doctor.mjs` | Saved-evidence shot diagnosis, a typed proposal with one change declined and one approved, the same revision identity in the workbench and a real scoped MCP client over the local HTTPS endpoint, a stale-revision message, a no-take state, and a locally assembled two-shot MP4 that plays. No model or paid provider. |
| `viewer.mjs` | The project tabs (tablist, roving tabindex, Arrow/Home/End), the in-project asset viewer as a labelled modal with an inert background: focus enters the viewer and Tab stays inside, Escape and Close return focus to the exact card and restore library scroll, a History result returns to History, Back and browser Back/Forward keep working, unknown tabs land on a usable Library, and both the React and no-bundle fallback viewers (including a missing asset) expose Close. |
| `film.mjs` (see `output/` receipts) | A 30–60 s local film from saved takes, a mixed source track and captions, plus a one-take replacement and decoded output checks. It reads the owner's existing production R2 objects read-only before uploading them into the isolated fixture; it does not write to production. |

The film harness is intentionally not committed with production project IDs.
Reconstruct it from the receipts in the issue evidence when a production read is
authorised again.
