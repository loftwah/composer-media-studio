# Studio #10 — project tabs, viewer return and measured contrast

Date: 16 November 2026
Branch: `train/viewer-tabs` (the commit that adds this document)
Live production inspected: revision `4c734ad603788afea07724be054d46d9cb85a558`,
built 16 November 2026 09:07 UTC (`/build.json`)

This records the remaining concrete navigation and contrast work for
[#10](https://github.com/loftwah/composer-media-studio/issues/10). Physical-device,
screen-reader, switch and touch-assistive proof remains
[#182](https://github.com/loftwah/composer-media-studio/issues/182) and is not
claimed here. No deploy, publication, provider request or paid generation was
made.

## What changed

### 1. Project tabs are a real tablist

The shared project shell in `public/studio.js` now renders one
`role="tablist"` with seven `role="tab"` buttons:

- every tab has a stable `id` (`project-tab-library`, …), `aria-controls="project-panel"`,
  `aria-selected` and a roving `tabindex` (`0` only on the selected tab);
- the single `role="tabpanel"` is `id="project-panel"` and is labelled with
  `aria-labelledby="project-tab-<selected>"`;
- ArrowLeft/ArrowRight move selection with wrap, Home/End jump to the ends, and
  focus follows selection after the hash render;
- clicking a tab or the header's Create shortcut uses the same activation path.

The React content branch and the no-bundle fallback share this shell markup, so
the contract is identical when `creative/home.js` loads and when the harness
blocks it.

### 2. Unknown project tabs keep a usable screen

`#/p/:id/nonsense` used to select no tab and render an empty panel. Hash parsing
now lives in the DOM-free `public/studio-route.js`:

- a valid project tab keeps its route;
- an unknown project tab resolves to `tab: "library"` with `unknownTab` retained;
- boot and later hash changes replace the bad hash with
  `#/p/:id/library` and show **“That studio section doesn't exist, so Library is
  open.”**;
- structurally malformed hashes (`#/a/one-segment`, extra path segments) remain
  invalid and keep the existing stable-page message.

### 3. The fallback missing-asset viewer has Close

`public/studio.js` `assetView()` now gives the missing-asset state the same
visible **Close** button as the React branch. It also has
`role="dialog" aria-modal="true"` with a labelled heading. Escape closes it,
the header becomes usable again, and focus moves to Library search.

### 4. Viewer origin survives History/Create results

The old `libraryReturn` only remembered the library grid. The viewer now records
project, tab, action, control ordinal and scroll offset before opening:

- library cards and **Open** buttons keep their exact thumb/Open control;
- `open-asset-link` controls (History result rows, and any Create result row that
  uses the same action) return to the History/Create tab;
- if that tab rebuilds without the original control, focus lands on a stable
  control in the same tab (search, or the selected tab) instead of the body.

React History now uses `data-action="open-asset-link"` for **Open result**; the
vanilla History row does the same. Library cards still use the existing
`open-asset` action.

### 5. The viewer route is a labelled modal with an inert background

Both viewer branches now expose:

- `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the
  visible asset title (or “Asset unavailable”);
- the site header and skip link marked `inert` and `aria-hidden` while the
  viewer route is open, restored on close;
- the existing Tab containment, Escape, Close, Back to library and browser
  Back/Forward behaviour unchanged. The hash router was not replaced, and a
  valid deep link still loads the viewer directly.

## Impeccable record — find, fix, re-inspect

Actual skill path: `/Users/deanlofts/.agents/skills/impeccable` (v4.8.0).
`impeccable context --target src/frontend/library.tsx` ran in this worktree and
read `PRODUCT.md`/`DESIGN.md`. The `audit` reference and `craft-floor` were read
before editing. A detector run and a scored five-dimension audit were **not**
performed, so no audit score is claimed.

| Finding | Before | Fix | After |
| --- | --- | --- | --- |
| Project tabs were buttons with `role="tab"` but no tablist, `aria-controls`, roving tabindex or arrow keys; the panel only had `aria-label` | Incomplete tab pattern | One tablist, stable tab ids, roving tabindex, panel `aria-labelledby`, arrow/Home/End handling | 7 tabs, selected tab `tabindex=0`, panel labelled by selected tab; browser checks pass in React and fallback |
| `#/p/:id/nonsense` selected no tab and rendered an empty panel | Blank, unexplained panel | Route normalisation to Library + plain message + stable hash | Direct boot and in-page change both land on Library with content and message |
| Fallback missing asset had Back but no Close | Escape-only dismissal, no visible close | Same Close control and dialog labelling as React | Close present, focused on open, Escape returns to Library search |
| Viewer only remembered the library grid | History/Create result always returned to Library | Record tab/action/control/scroll origin and restore it | Result opened from History returns to History; library returns to exact card |
| Viewer had a Tab trap but no modal semantics | Background remained exposed | `role="dialog"`, `aria-modal`, background `inert` | Header/skip inert while open, restored on close |
| Light accent text `#c74400` on paper `#f4f0e8` | 4.34:1 — fails 4.5 normal text | Light `--accent` is `#b23d00` | 5.19:1 on paper; 5.41:1 on surface |
| Light focus ring `#fc5b05` on paper | 2.78:1 — fails 3:1 essential control | Focus ring uses `--accent` in both themes; internal focused headings follow the same token | 5.19:1 light, 5.61:1 dark |
| Dark search placeholder used the browser default grey | 3.58:1 on `#1d1f23` — fails 4.5 | `::placeholder` uses `--muted` | 7.85:1 dark; 6.23:1 light |
| Input focus outline was 35% accent (`#f7bc99` light / `#672f13` dark) | 1.47:1 / 1.69:1 outline, although the ink border already passed at 15.62/15.99 | Full `--accent` outline; ink border retained | Outline 5.19/5.61 plus border 15.62/15.99 |

Re-inspection: `tests/browser/viewer.mjs` passed **59/59** checks, including both
branches, and the branch-stylesheet contrast replay has **0** non-disabled
failures. Disabled controls are recorded separately below because WCAG 1.4.3
exempts inactive components.

## Contrast receipt

### Method

- Chromium 1.65.0, headless, Playwright from
  `/Users/deanlofts/gits/just-stuff/node_modules/playwright/index.mjs`.
- Live signed-out routes on `https://media.loftwah.com`: `/`, `/gallery`, and the
  published work `/p/hSV7NN15-vlPvqXK` (“Pippa · moonlit garden restyle”).
- 1440×900 and 390×844; `light` and `dark` selected through the shipped
  `media-studio-theme` preference before load.
- Computed `color`, `backgroundColor`, font size/weight, opacity, outline,
  border and `::placeholder` were read from the rendered DOM. Backgrounds were
  composited through transparent and `color(srgb …)`/`oklab(…)` values. Ratios
  use WCAG 2.x relative luminance: 4.5:1 normal text, 3:1 large text and
  essential control indicators.
- The **live before** JSON is production revision `4c734ad` with its own
  stylesheet. The **branch after** JSON is the same live route DOM with
  `public/studio.css` from this branch served by Playwright request
  interception. This is a real computed-style re-measure of the branch CSS, not
  a production deployment; production still serves the old CSS.
- Nothing on the signed-out routes rendered `.danger`, `.status`, `.badge` or a
  disabled control (counts were 0 at every route/theme/width). Those shipped
  state pairs were measured by adding a probe with the real classes to the live
  gallery document and reading the resulting computed styles. That is a
  stylesheet check, not a claim about a signed-in Studio screen.

Raw data: `contrast-live-before.json`, `contrast-branch-after.json`. The 390 px
ratios were identical to 1440 for every measured pair.

### Text, links and controls — branch after

| Route | Element / selector | Light foreground / background | Ratio | Dark foreground / background | Ratio | Result |
| --- | --- | --- | --- | --- | --- | --- |
| home | body text `body` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| home | muted intro `.gallery-intro-copy > p` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| home | display heading `.gallery-intro h1` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass (large) |
| home | accent eyebrow `.eyebrow` | `#b23d00` / `#f4f0e8` | 5.19 | `#fc5b05` / `#17181b` | 5.61 | pass |
| home | text link `.gallery-actions a:not(.button)` | `#1f5c58` / `#f4f0e8` | 6.77 | `#8adeb0` / `#17181b` | 11.12 | pass |
| home | primary button `.gallery-actions .button` | `#f4f0e8` / `#17181b` | 15.62 | `#17181b` / `#f2f3f5` | 15.99 | pass |
| home | secondary button `.gallery-actions .button.secondary` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| home | header link `.header-nav a[href="/gallery"]` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| home | wordmark `.wordmark` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| home | theme toggle `.theme-toggle` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| home | hero label `.gallery-hero-art small` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| home | hero title `.gallery-hero-art strong` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| home | hero type `.gallery-hero-art > span > span` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| home | section link `.gallery-heading a` | `#1f5c58` / `#f4f0e8` | 6.77 | `#8adeb0` / `#17181b` | 11.12 | pass |
| home | card title `.gallery-card-copy strong` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| home | card type `.gallery-card-copy > span` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| home | card description `.gallery-description` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| gallery | body text `body` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| gallery | muted lede `.gallery-intro-copy > p` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| gallery | display heading `.gallery-intro h1` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass (large) |
| gallery | accent eyebrow `.eyebrow` | `#b23d00` / `#f4f0e8` | 5.19 | `#fc5b05` / `#17181b` | 5.61 | pass |
| gallery | filter label `.gallery-controls label` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| gallery | search input `.gallery-controls input[name="q"]` | `#17181b` / `#ffffff` | 17.75 | `#f2f3f5` / `#1d1f23` | 14.86 | pass |
| gallery | search placeholder `::placeholder` | `#5c616a` / `#ffffff` | 6.23 | `#afb3bb` / `#1d1f23` | 7.85 | pass |
| gallery | type select `.gallery-controls select[name="kind"]` | `#17181b` / `#ffffff` | 17.75 | `#f2f3f5` / `#1d1f23` | 14.86 | pass |
| gallery | order select `.gallery-controls select[name="order"]` | `#17181b` / `#ffffff` | 17.75 | `#f2f3f5` / `#1d1f23` | 14.86 | pass |
| gallery | apply button `.gallery-controls button` | `#f4f0e8` / `#17181b` | 15.62 | `#17181b` / `#f2f3f5` | 15.99 | pass |
| gallery | work count `.gallery-count` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| gallery | card title `.gallery-card-copy strong` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| gallery | card type `.gallery-card-copy > span` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| gallery | card description `.gallery-description` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| gallery | header link `.header-nav a[href="/gallery"]` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| gallery | theme toggle `.theme-toggle` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| work | body text `body` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass |
| work | piece heading `main h1` | `#17181b` / `#f4f0e8` | 15.62 | `#f2f3f5` / `#17181b` | 15.99 | pass (large) |
| work | accent eyebrow `.eyebrow` | `#b23d00` / `#f4f0e8` | 5.19 | `#fc5b05` / `#17181b` | 5.61 | pass |
| work | lede `.lede` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |
| work | caption `.caption` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| work | small facts `.small` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| work | download button `.button:not(.secondary)` | `#f4f0e8` / `#17181b` | 15.62 | `#17181b` / `#f2f3f5` | 15.99 | pass |
| work | secondary button `.button.secondary` | `#17181b` / `#fffdf8` | 17.46 | `#f2f3f5` / `#23252a` | 13.81 | pass |
| work | body link `main a[href^="http"]` | `#1f5c58` / `#f4f0e8` | 6.77 | `#8adeb0` / `#17181b` | 11.12 | pass |
| work | footer `.public-footer` | `#5c616a` / `#f4f0e8` | 5.48 | `#afb3bb` / `#17181b` | 8.44 | pass |
| work | theme toggle `.theme-toggle` | `#3f4249` / `#f4f0e8` | 8.85 | `#d5d8de` / `#17181b` | 12.43 | pass |

### Focus, hover and state probe — branch after

| Element / state | Light | Dark | Result |
| --- | --- | --- | --- |
| theme toggle focus outline (`:focus-visible`) | `#b23d00` / `#f4f0e8` · 5.19 | `#fc5b05` / `#17181b` · 5.61 | pass |
| home text-link focus outline | `#b23d00` / `#f4f0e8` · 5.19 | `#fc5b05` / `#17181b` · 5.61 | pass |
| home primary button focus outline / border | 5.19 / 15.62 | 5.61 / 15.99 | pass |
| gallery apply-button focus outline / border | 5.19 / 15.62 | 5.61 / 15.99 | pass |
| gallery search focus outline / border | 5.19 / 15.62 | 5.61 / 15.99 | pass |
| work download focus outline / border | 5.80 / 17.46 | 4.85 / 13.81 | pass |
| danger button `.button.danger` | `#ffffff` / `#a3321c` · 6.93 | `#17181b` / `#ff9a86` · 8.64 | pass |
| danger hover | same 6.93 | same 8.64 | pass |
| primary hover | 15.62 | 15.99 | pass |
| secondary hover | 15.62 | 15.99 | pass |
| status Saved `.status.ok` | `#246b43` / `#dcebdd` · 5.21 | `#8adeb0` / `#1f3a2b` · 7.75 | pass |
| status Generating `.status.run` | `#7a4a12` / `#f7e3c8` · 5.96 | `#f0c27a` / `#3d2c16` · 8.09 | pass |
| status Failed `.status.bad` | `#a3321c` / `#f4d9d2` · 5.18 | `#ff9a86` / `#46231d` · 6.73 | pass |
| status Outcome unknown `.status.unknown` | `#4b3f7a` / `#e3e0f2` · 7.08 | `#c8c1ff` / `#2d2a44` · 8.21 | pass |
| status Prepared `.status` | `#3f4249` / `#e7e0d4` · 7.67 | `#d5d8de` / `#202227` · 11.15 | pass |
| warning notice `.notice.warn` | `#17181b` / `#f6ded7` · 13.82 | `#f2f3f5` / `#3c241f` · 12.92 | pass |
| disabled primary button (opacity .5) | `#f4f0e8` / `#868482` · 3.28 | `#17181b` / `#858688` · 4.84 | WCAG 1.4.3 exempts inactive controls; recorded |
| disabled danger button (opacity .5) | `#faf8f4` / `#cc9182` · 2.49 | `#17181b` / `#8b5951` · 3.08 | WCAG 1.4.3 exempts inactive controls; recorded |

## Verification

| Check | Result |
| --- | --- |
| `node --test tests/studio-route.test.mjs` through `pnpm check` | 6/6 route and keyboard-order tests pass |
| `pnpm check` | pass (recorded in the delivery message for this commit) |
| `pnpm build:frontend` | pass |
| `tests/browser/viewer.mjs` | **59/59** checks pass |
| Browser viewports | 1440×900 and emulated 390×844; light and dark |
| Browser receipts | `viewer-10-receipt.json`; screenshots in `screens/` |
| Contrast live before | 18 non-disabled failures across the sampled routes |
| Contrast branch after | 0 non-disabled failures; disabled pairs recorded and exempt |

The browser harness now checks:

- tablist role, seven tabs, roving tabindex, `aria-controls` and panel labelling;
- ArrowRight/Home/End selection and focus, and the same contract with the React
  bundle blocked;
- unknown tab normalisation on in-page navigation and direct boot;
- dialog role, `aria-modal`, accessible name, header/skip inert and restoration;
- Library origin focus and scroll, History result origin, Back/Forward;
- fallback viewer Close, Escape and missing-asset Close with focus return;
- 390 px overflow and focus entry.

## Remaining limits

- **#182 stays open:** no physical phone/tablet, VoiceOver, NVDA, TalkBack,
  switch-control, zoom or high-contrast mode run. 390 px is an emulated viewport.
- The viewer is a **route with modal semantics**, not a native `<dialog>` or a
  separate window. Background `inert` and Tab containment provide the modal
  behaviour; screen-reader announcement still needs #182.
- A viewer opened by a deep link has no same-document origin. Escape/Close opens
  Library and focuses its search; it cannot return focus to a control the user
  never used.
- Browser Forward reopens the viewer but does not carry the original result-row
  focus target across the closed history entry; it falls back to the library.
  Normal Back/Forward route semantics remain intact.
- The branch-stylesheet contrast after-run reuses the live signed-out DOM; it is
  not a production deployment. Live production still serves revision
  `4c734ad` with the old `#c74400` accent and `#fc5b05` focus ring until the
  integrator deploys this branch.
- Signed-in Studio routes (library, viewer, Create, History, Publish, Settings)
  were not measured live because they require the owner session. Danger,
  status, badge and disabled styles were measured through the shipped
  stylesheet probe described above, not by encountering them on a public page.
- No Impeccable detector or scored audit was run; the skill context, audit
  reference and craft floor were read, and the changes were re-inspected in the
  browser and contrast measurements.

## Evidence files

- `contrast-live-before.json` — production `4c734ad`, all routes/themes/widths.
- `contrast-branch-after.json` — same live DOM with this branch's `studio.css`.
- `viewer-10-receipt.json` — 59-check browser receipt.
- `screens/viewer-1440x900.png`, `screens/viewer-390x844.png`,
  `screens/library-return-focus-1440x900.png` — current branch rendering.
