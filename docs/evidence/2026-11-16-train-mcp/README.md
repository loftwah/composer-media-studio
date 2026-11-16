# Studio MCP: OpenCode, signed upload and the revisioned Director loop

Date: 16 November 2026 (Australia/Melbourne, UTC+11)

Live source: `4c734ad603788afea07724be054d46d9cb85a558`
Worker version: `8ea0feb7-bd40-4803-8cb6-8fed3197ee5a`
Release: checked, built and deployed by `scripts/deploy.mjs` in 33.0 s; `/build.json` read back the same revision.

This note records the live proof for Studio #11 and the precision-edit slice of
#15. It uses the controlled fictional project **Agent proof · 16 Nov 2026**
(`prj_c0b0c0580e8c461b93726b24b99a1912`). No provider generation, spend,
publication or deletion occurred.

## 1. A real OpenCode client

OpenCode `2.2.7` completed the Studio OAuth/PKCE flow for the single project
above. The client was configured to request `studio.read studio.edit`; the
consent page named `opencode` and listed the project. `opencode mcp list`
reported `media-studio connected`.

A separate read-only agent run (`opencode-go/deepseek-v4.1-flash`) called
`studio_list_song_plans` once and returned:

- plan `plan_b84c3211a6634076b47e1f86cc92c522`, **Agent proof · three beats**,
  revision **6**;
- scene 2 direction exactly
  `The test pattern holds; a slow horizontal pan moves left to right at a steady, readable pace, with a warm glow that stays constant rather than pulsing. No cuts and no new elements enter frame.`

No edit, generate, publish or spend tool was called by that run. The transcript
is retained in the ignored local output directory; no private project text is
committed here.

The scope caveat is documented in `docs/mcp-integration.md`: OpenCode asks for
`studio.read` by default, so an owner who needs edits must set
`oauth.scope: "studio.read studio.edit"` before authorising.

## 2. Signed single-use upload over 10 MiB

The owner-approved **After Hours** MP3 is 10,705,704 bytes with SHA-256
`b3da7feff1528019939031a4dc542827b8faf9032b78f586f772e008ec8a7a42`
(320 kbps, 48 kHz, stereo, 267,600 ms).

1. `studio_begin_asset_upload` returned one 10-minute PUT URL bound to the
   project, the agent connection, the byte count and the hash.
2. One ordinary `PUT` stored the exact bytes. The response was `201`,
   `reused: false`, asset
   `asset_51223c54134ed8f1cf29e981acbf780f1ee312efdd4584b30a4d09238c0c8b42`.
3. `studio_get_asset` read back the same bytes, hash, duration, sample rate and
   channels. `studio_get_project` listed the asset in the same project.
4. Reusing the URL returned `409 upload_link_used`. No second asset was written.
5. `studio_create_song_plan` saved **After Hours · agent upload proof** at
   revision 1 (`plan_f34a4231b0b24f919a224810f333e33f`) with the same
   `songSha256`, proving the uploaded original is usable in the project rather
   than only stored.

## 3. Propose, decline, apply, save, read back

Starting from saved revision **5**, digest `205ed62815d56582cdfcd49147bc365e702e214491f17b16db543b6387290361`:

| Step | Surface | Exact result |
| --- | --- | --- |
| Private brief | Assemble → Creative Director → connected agent | Generated from revision 5 and scenes 2–3; the requested words and both saved directions were included. |
| Preview | `studio_preview_scene_proposal` (MCP) | Two direction changes, review digest `5917d94310a2c7d7836af732e1943fa9c9ccfbad5d2e038b42fce412d55bc576`, pinned to revision 5. |
| Review | Assemble → Review the proposal | Showed both before/after pairs at revision 5. |
| Decline | Workbench | Scene 3 was unticked; the panel reported “Keeping 1 of 2 changes. 1 declined change will keep the saved direction.” |
| Apply | Workbench | Scene 2 only was applied to the draft. |
| Save | Workbench | **Save scene plan** wrote revision **6**, digest `a888a359cbaa51bcaa7c420a8fac3245ac6d58df454118a506ae0a4042c8521f`. |
| Read back | MCP and OpenCode | Revision 6 contains the new scene 2 direction; scene 3 remains `Return to the plate; hold to the end.` |

The exact scene 2 direction after the save is the string quoted in section 1.
Timing, references and selected takes were unchanged; the declined scene kept
its saved value.

## 4. Product fix found while replaying

Assemble used to open with the spoken-promo form, then the footage planner, and
only then the saved music plan. A returning owner had to scroll past two empty
creation forms to reach the revision and Director they came back for.

The release now leads Assemble with **Plan a music video** and its saved plans.
Live checks: 1440 and 390 px have no horizontal overflow, the saved plan list
shows revision 6, and the page order is music plan → spoken promo → footage.
The change is `src/frontend/assemble-settings.tsx` in the same live revision.

## Boundaries

- No media provider was called. Spend remained $0.00 of $5.00.
- No asset was published, unlisted, withdrawn or deleted.
- The proof is browser-emulated desktop/phone, not a physical device.
- Named character art remains Studio #67. Provider-backed generation and the
  public result remain Studio #2/#4. This note does not claim them.
