# Delivery batch — 16 November 2026

Record of what reached production in this batch, what is still open, and the next
safe step for each item. Issue receipts remain the detailed evidence.

## Confirmed source and live revisions

| Surface | Source | Live identity | How it was verified |
| --- | --- | --- | --- |
| Media Studio | `a83e0b0e3128` | Worker version deployed 2026-11-16T05:54:11Z | `/healthz` revision read back by the guarded release; Director panel inspected live at 1440 and 390 |
| Media Studio | `1a30fa58ab23` | Worker version deployed 2026-11-16T05:49:21Z | live refusal copy checked on `/tools/audio-trim` with a 10-byte text file named `.wav` |
| Media Studio | `5313d8fb4044` | Worker `ec757e96-5901-4cc3-a52f-1b92aaa95889` | agent 403 copy re-run against production with a real Codex client |
| Media Studio | `faae369` | docs only | evidence commit; no runtime change, no deploy |

Release times in this batch: 24.4 s, 29.4 s and 26.5 s against a 180 s target.

## What changed

- A real Codex client authenticated over OAuth PKCE to the production MCP server
  and edited a saved song plan: diagnosis, preview, decline one change, apply one,
  revision 2 → 3, with the same revision and digest in the workbench and the API.
  Issue #11.
- A project-scoped agent connection now says which project it holds instead of
  blaming the workspace. Found by using the workflow, fixed and re-verified live.
  Issue #11.
- The Director is a named, visible panel in Assemble instead of three nested
  disclosures four thousand pixels down; honest applied-to-draft versus saved
  states. Issue #15.
- Portable restore proven into a separate fresh Worker/D1/R2 installation, then
  the whole target was deleted. Issue #157, closed.
- Unreadable media inputs return the tool's own refusal instead of a raw parser
  error. Issue #20, closed; device coverage moved to #182.

## Still open, with the next safe step

| Issue | State | Next safe step |
| --- | --- | --- |
| #11 | Open | Provider-backed generation needs an explicit spend decision; the in-MCP upload path needs a streaming transport for a full-length song |
| #15 | Open | Named character and original approved art (#67); an owner-recorded walkthrough |
| #13 | Open | Owner decision on the public rollout; opt-in analytics and leaderboards are later slices |
| #182 | Open | Physical iPhone, mobile Safari and screen-reader observation for the local tools |

## Queue and resources

- No temporary Cloudflare resources remain; the `restoreproof` Worker, D1 and R2
  were deleted and independently re-checked.
- Production `composer-media-studio`, D1 `media-studio` and R2 `media-studio` were
  never migrated or written outside the normal guarded release.
