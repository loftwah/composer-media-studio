# Director shot diagnosis, approve/decline and playable export — local proof

Date: 16 November 2026. Issues: [Studio #15](https://github.com/loftwah/composer-media-studio/issues/15),
[Studio #11](https://github.com/loftwah/composer-media-studio/issues/11).
Branch `codex/15-director-edit`, based on `main` at `9feaa97`.
No deploy, production D1/R2 access, publication, model call or paid provider
request was made. Every project, shot, take and recording below is fictional.

## What was exercised

One continuous project-grounded flow on a fictional project made by the test
fixture and the local browser fixture:

1. The shot doctor read the saved plan revision, the selected take, its job
   receipt (settings and admission estimate) and recorded source hashes, then
   named the failing shot, its measured cause and the rerun cost. Nothing was
   submitted.
2. A two-change proposal was previewed. One change was declined and one was
   approved; only the approved direction reached the saved plan.
3. The same plan ID, integer revision and content-derived revision identity were
   read back from the Director's response, the native workbench API and a real
   scoped MCP client over the local `/mcp` endpoint.
4. Stale revision, revoked grant and a provider job with no answer each returned
   an explanation and a next action.
5. A saved two-shot storyboard was exported by the existing local Assemble
   renderer. The downloaded file decoded and played in Chromium and was measured
   with `ffprobe`.

## Focused automated proof

`tests/director-shot-doctor.test.mjs` (7 tests, fictional fixtures):

- `the answer names the failing shot, its saved cause and cost without submitting a job`
  — a 3.0 s take in a 4.0 s scene is reported from the saved durations; the
  `$0.12` rerun estimate is the job's recorded `cost_estimate_micro`, not a new
  quote; a longer take is flagged as possibly costing more; the scene with no
  take reports no recorded price.
- `one reviewed change is approved and the other declined, and only the approved scene is saved`
  — the declined scene keeps its exact saved object (direction, take, timing,
  reference); replaying the reviewed digest is refused at the new revision.
- `the same persisted revision identity is read from the Director, the workbench and a scoped MCP tool`
  — the Director proposal, workbench API, shot doctor and scoped MCP read all
  expose the same `planId`, `revision` and SHA-256 `revisionDigest` over the
  saved spec; the digest changes after another save.
- `a stale revision says what changed and what to do` — 409, current revision and
  reload instruction.
- `a revoked agent grant says the connection is gone and how to reconnect` — a
  real OAuth PKCE token works, `/mcp/connections` revokes it, the next call is
  refused with reconnect guidance.
- `a provider job that never answered is reported with reconcile guidance and no resubmit`
  — an `unknown` job with a provider request ID is reported; its row and the plan
  revision are unchanged.
- `the assembled export saves owned bytes that decode as a playable MP4` — the
  composition render is admitted, completed through the webhook path with
  fictional saved bytes, measured with the studio's own MediaBunny reader, and
  the saved R2 bytes match their SHA-256.

## Real-browser proof

`tests/browser/shot-doctor.mjs` against a local `wrangler dev` fixture
(`https://localhost:8891`), Chromium, official MCP SDK client. 26 checks passed:

- shot diagnosis showed the saved revision identity and the take's SHA-256 and
  stated that nothing was submitted;
- a typed two-change proposal was previewed, one change was unticked, the
  button text became “Apply 1 of 2 changes to draft”, and after saving only the
  approved direction was stored — take IDs, timing and captions were unchanged;
- the workbench heading, plan API and scoped MCP read showed the same revision
  and 12-character identity; `studio_diagnose_shot` over MCP returned it too;
- a stale preview displayed “The plan changed to revision 4. Reload it, then
  preview the edit again. Nothing was applied.”;
- clearing a scene's take and saving produced “no saved take”, the next step, and
  the honest absence of a recorded price;
- the phone pass at 390 × 844 had no horizontal overflow.

The exported file was downloaded from the browser and measured locally:

```text
format_name: mov,mp4,m4a,3gp,3g2,mj2
duration:   11.200000
size:       1644208
stream:     h264, 640x360, 11.200000 s
```

Chromium played the saved blob: `readyState` 4, duration 11.2 s, `currentTime`
advanced past 0.2 s, `paused` false. The card warned that it had rendered the
current saved storyboard rather than a stale card preview, which is the intended
behaviour. “Save to library” then showed “Open saved video”.

The browser harness is evidence tooling, not part of `pnpm check`. Generated
screenshots, the receipt and the exported MP4 stay under the ignored
`output/browser-evidence/shot-doctor/` directory; the local persistence root was
removed after the run.

## Checks run

```sh
mise exec node@26.13.1 -- pnpm check
mise exec node@26.13.1 -- pnpm build:frontend
mise exec node@26.13.1 -- node --import ./tests/support/workers-runtime.mjs --test tests/director-shot-doctor.test.mjs
```

All passed: 454 tests in `pnpm check`, including the 7 new focused tests.

## Not proven

- No live Codex or OpenCode client was used. The MCP proof uses the official
  TypeScript SDK client against the local server, with real OAuth PKCE consent,
  a project-scoped read token and revocation.
- No deployed or production environment was checked or changed.
- No model-generated proposal was used in the browser run; the proposal was
  typed so the review and decline path could be isolated without an AI binding.
  The Workers AI Director route itself is unchanged by this work.
- No paid provider request was made. The export was the existing browser-local
  Assemble renderer, and the provider-completion test used saved fictional bytes.
