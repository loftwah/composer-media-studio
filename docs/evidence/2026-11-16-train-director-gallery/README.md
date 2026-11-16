# Director, upload handoff and gallery facets — 16 November 2026

Three guarded Studio releases in one session, all from clean pushed `main` through
`pnpm deploy`. No provider media spend, no new service or credential.

| Source | Worker | Release | What changed |
| --- | --- | --- | --- |
| `0e34ee5f9831` | `e3e9d1ee-b691-44bc-99fd-b56b78d01177` | 28.1 s | Signed, single-use large-file upload handoff for agents (#11) |
| `30fcd6b3c4be` | `40c89c10-01db-436e-83eb-787f50d05d2a` | 31.8 s | Neutral white-label Director, truthful states, bounded drafts (#15, #67) |
| `69e120e66b9a` | `15b6a980-1e55-49dc-8f6b-50249ec9a734` | 27.6 s | Gallery facets, honest totals, public cache boundary (#13) |

## Upload handoff (#11)

`studio_begin_asset_upload` returns a ten-minute, single-use PUT URL bound to one
project, one agent connection, the declared byte count and the file's SHA-256.
The bytes take the same sniffing, limits, R2 keys and admission as a form upload.
A synthetic 6.05 MiB WAV (asserted >4 MiB) goes begin → PUT → `studio_get_asset`
with exact hash, duration, sample rate and channels; a second upload of the same
hash returns the existing asset. Expired, reused, wrong-project, changed-signature,
hash-mismatch, oversized, short-body, non-media, read-only, revoked-connection and
owner-session calls are refused before any asset row is written.

Not claimed: a live >10 MiB upload through a fresh agent OAuth consent (the existing
Codex connection is logged out), or any paid generation.

## The Director is neutral and truthful (#15, #67)

The visible identity resolves once per page load: runtime `DIRECTOR_NAME`, then
build-time `VITE_DIRECTOR_NAME`, then the neutral **Creative Director**. Unset is
the normal state; no name placeholder appears and no character art is required.
The model prompt is identity-free, so a display name cannot change what may be
proposed. Unsaved agent text is kept in this browser tab, bounded to four plans,
and labelled as unsaved.

Played in the owner session against proof project `prj_c0b0c0580e8c461b93726b24b99a1912`,
saved plan **Agent proof · three beats**:

1. Tick **Scene 2**, ask *"Make scene 2 slower and warmer. Keep the same take,
   timing, reference and captions."*
2. The panel set `aria-busy="true"` while asking, then showed **one** typed change
   pinned to **revision 4 · revision identity `60c001a26353`** with a before/after
   and **"Nothing has been applied, generated or charged."**
3. **Apply 1 of 1 change to draft** → persistent receipt **"Applied to this draft —
   not saved. … Nothing was generated or charged."**
4. **Save scene plan** → **Revision 5 · revision identity `205ed62815d5`**. The
   project API read the same revision, digest and directions; scenes 1 and 3 kept
   their saved directions and no take changed.

390 × 844: no horizontal overflow, the ask control is keyboard reachable, focus
stays on the ask control through the asking and error states, and the real heading
outline is `h2` workbench → `h3` saved plan → `h4` Director with no skipped level.

Browser harness: **53/53 checks**, 9 screenshots, one bounded Workers AI text call
per run (no media provider). Unit suite at that release: 466/466.

## Gallery browse (#13)

`/gallery` now has server-rendered, no-JS **Project**, **Type** and **Creation**
facets plus a database-derived total. Creation is derived only from stored fields
(assembled, refinement, variation, original) and is absent when it cannot be
proven. All filters combine, survive pagination and deep-link back from a work page.
Public gallery/home moved from `no-store` to the documented `public, max-age=60`;
owner routes stay `private, no-store`. The home hero now prefers a stored
page-size preview over a full poster.

Live: `/gallery` reports **16 works**, the project facet lists 9 projects, and
`/gallery?kind=image` reports **2 works** with `cache-control: public, max-age=60`.
390 px: no horizontal overflow. Tests: **476/476**.

Not claimed: the owner rollout decision, per-project public/private policy UX, or
the wider tag/rights facets from the 16 November direction. Nothing was published,
listed, unlisted or withdrawn.

## Evidence

- `director-1440.png`, `director-390.png` — the live neutral Director after saving
  revision 5, on the synthetic proof project.
- `gallery-facets-1440.png`, `gallery-facets-390.png` — the live public gallery
  filtered to images.

The private Foilbury comparison view was inspected live (it lands on **Motion from
a still** with three models, blind until a take is chosen) but is not captured here
because it contains the owner's private project media and no vote was cast on the
owner's behalf.
