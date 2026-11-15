# Motion stack qualification — eight projects

Status: **source and licence review only. No library is installed, bundled or
used by the Studio.** This is the first acceptance item of #150; the editable
layered motion scene, editor, export and cross-app LEGO are **not** delivered.
Date: 16 November 2026 (Australia/Melbourne). Primary sources read at the pinned
revisions below.

Sizes are the npm `dist.unpackedSize` for the published version, not the
gzipped bytes a browser downloads. Browser/GPU notes come from the project's own
documentation at that revision and were **not** measured here. "Seekable" means
the library can draw frame N without replaying the preceding wall-clock
animation; that is the property an offline exporter needs.

| Project | Pin | Licence | Unpacked | Model | Seekable export | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Anime.js | `animejs@4.5.0`, repo `01b81be` | MIT | 2.13 MB | DOM, SVG, CSS, objects | `seek()` exists; DOM/SVG still needs rasterising before encoding | **PILOT** for title/kinetic type |
| react-spring | `@react-spring/web@10.1.2`, repo `83e4760` | MIT | 56 KB | React spring physics | Continuous springs are not frame-exact; no first-class seek | **PILOT (UI only)**; not a film renderer |
| PixiJS | `pixi.js@8.23.0`, repo `1e70768` | MIT | 80.4 MB (all packages/assets) | WebGL/WebGPU 2D scene graph | Ticker can be stepped manually and the canvas captured; GPU/driver variance must be pinned | **PILOT** for one authored 2D FX scene |
| p5.js | `p5@2.4.0`, repo `c60c735` | LGPL-2.1 | 16.4 MB | Creative-coding canvas | `noLoop()` + `redraw()` can step; sketch code must be sandboxed | **DEFER** (optional authored sketch adapter; LGPL obligations) |
| Matter.js | `matter-js@0.20.0`, repo `b8ee71c` | MIT | 0.93 MB | Rigid-body physics | Fixed timestep plus a seed can be baked; the engine is not a renderer | **DEFER** until a baked-simulation scene is wanted |
| D3 | `d3@7.9.2`, repo `db118c9` | ISC | 0.88 MB | Data joins, SVG, scales | Pure attribute updates are seekable if the data snapshot is frozen; transitions must be avoided or driven manually | **PILOT** for a truthful chart scene |
| OpenToonz | `v1.8.0`, repo `35f17de` | BSD-3-Clause plus bundled third-party licences | Desktop application | Traditional 2D animation | Not a browser library; interchange/handoff only | **RESEARCH/handoff**; do not embed |
| Tone.js | `tone@15.1.22`, repo `42e6eec` | MIT | 5.4 MB | Web Audio scheduling/synthesis | `OfflineAudioContext` rendering is deterministic; stems can be frozen | **PILOT** for a short original SFX bed |

## What this changes in the plan

- The Studio should not add all eight. The only film-facing candidates worth a
  measured pilot are **Anime.js** (seekable type), **PixiJS** (one authored FX
  scene), **D3** (a frozen-data chart) and **Tone.js** (a rendered stem).
- react-spring belongs to UI motion, not exported film. Matter.js and p5.js are
  optional adapters behind a sandbox and a frozen seed/data snapshot.
- OpenToonz is a desktop interchange reference, not a dependency.
- Nothing here justifies replacing the existing local renderer or the fal/Workers
  AI routes. The export contract stays: canvas frames + the existing audio mixer
  into the existing Mediabunny H.264/AAC path, with the same preview/render
  revision.

## Determinism and sandbox requirements before any pilot

1. A scene manifest with stable project/scene/layer/asset IDs, fps, duration,
   seed, effect version and a frozen data snapshot.
2. `draw(frame)` must be a pure function of the manifest and frame number; no
   wall-clock, no unseeded RNG, no network.
3. DOM/SVG effects must be rasterised by a pinned renderer version, or avoided.
4. Untrusted sketch/shader/HTML input must never run with project credentials;
   the CSP, allowed media origins and resource caps are part of the pilot.
5. Export must reuse the current saved-revision check so a preview and an export
   cannot disagree about the revision.

## Not established here

- Why the previous Remotion deliverables looked poor. The issue requires
  reproducing that with direction, staging, typography, pacing and source truth
  before selecting a replacement. This document does not blame a library.
- Real bundle cost, frame timing, GPU memory, phone performance or quality for
  any library. Those need a measured pilot, not a licence table.
- Human art-direction acceptance. No motion scene was made.

## Sources

- <https://github.com/juliangarnier/anime/tree/01b81be1df6843ccfe0a71c0699a746bf740dd77>, <https://www.npmjs.com/package/animejs/v/4.5.0>
- <https://github.com/pmndrs/react-spring/tree/83e476061290532ab517c4d4dfd60de21589e78e>, <https://www.npmjs.com/package/@react-spring/web/v/10.1.2>
- <https://github.com/pixijs/pixijs/tree/1e707686d00a2a8cd6432b047e56034fc7e7a909>, <https://www.npmjs.com/package/pixi.js/v/8.23.0>
- <https://github.com/processing/p5.js/tree/c60c7357641e59a0c7f8029f988ba176f5243a3c>, <https://www.npmjs.com/package/p5/v/2.4.0>
- <https://github.com/liabru/matter-js/tree/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5>, <https://www.npmjs.com/package/matter-js/v/0.20.0>
- <https://github.com/d3/d3/tree/db118c93a429e82b83f091dbaa18fd0a82c06130>, <https://www.npmjs.com/package/d3/v/7.9.2>
- <https://github.com/opentoonz/opentoonz/tree/35f17defecab11bd9af69d24ea44eaf66b5a67f9>, <https://github.com/opentoonz/opentoonz/releases/tag/v1.8.0>
- <https://github.com/Tonejs/Tone.js/tree/42e6eec421d35e4280b00317392dc3725e44bf8e>, <https://www.npmjs.com/package/tone/v/15.1.22>
