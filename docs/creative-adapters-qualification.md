# Creative compute adapters — qualification matrix

Status: **qualification only. No adapter is installed, executed or authorised.**
Date: 16 November 2026 (Australia/Melbourne). Owner: Media Studio #151.
Method: every licence and hardware statement below was read from the named
primary source at the exact revision in the table. Nothing was inferred from a
blog, a model hub summary or another project. No inference job, download,
dependency install or spend occurred for this document.

The Studio's existing control plane (Worker, D1, R2, scoped MCP, local renderer)
is unchanged. GPU work cannot run in a Cloudflare Worker; every candidate below
needs an explicit local or hosted GPU runner that does not exist yet. The
current Mac has no authorised CUDA runner and no hosted GPU adapter has been
approved, so every execution verdict is BLOCKED or PILOT-not-run.

## Matrix

| Adapter | Source pinned | Code licence | Weights / third-party | Territory or commercial limit | Documented hardware | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Hunyuan3D-2 | `Tencent-Hunyuan/Hunyuan3D-2@f8db630` (2025-10-28) | Tencent Hunyuan 3D 2.0 Community Licence (not OSI) | Same licence covers code and weights | **Not licensed in the EU, UK or South Korea**; commercial use above 1M monthly active users needs Tencent's written licence; outputs may not train other models; notice and provider-disclosure duties | 6 GB VRAM for shape, 16 GB for shape + texture (README) | **BLOCKED** for a general product; territory-limited research only with legal review |
| TRELLIS | `microsoft/TRELLIS@193e050` (2026-10-27) | MIT for models and most code | `diffoctreerast` renderer is a derivative of Inria/MPII diff-gaussian-rasterization under a **non-commercial research licence**; modified FlexiCubes is Apache-2.0 | The bundled radiance-field renderer cannot be used commercially without replacement; mesh-only paths may avoid it, not verified | NVIDIA GPU with at least 16 GB VRAM; verified on A100/A6000 (README) | **PILOT (research)**; **BLOCKED** for commercial output while the non-commercial renderer is required |
| LTX-2.5 | `Lightricks/LTX-2@f0f2f86` (2026-11-12), weights `Lightricks/LTX-2.5` | Apache-2.0 for the repository code | LTX-2.x Community Licence for weights and derivatives (last amended 2026-10-29) | Entities with **annual revenue ≥ US$10M** need a paid Commercial Use Agreement for any revenue-generating or end-user use; non-commercial evaluation is allowed; derivatives stay under the same licence with attribution | 22B distilled transformer, bf16; README documents fp8, CPU/disk offload and multi-GPU but states no minimum VRAM | **PILOT**, subject to the owner confirming the revenue threshold and an approved GPU runner |
| LivePortrait | `KlingAIResearch/LivePortrait@9b294b3` (2026-06-01) | MIT (Kuaishou) | The InsightFace **models are non-commercial research only**; the licence says commercial use requires removing and replacing them | Any real-person source/driver needs explicit consent and provenance; no deepfake or unapproved likeness use | Not stated in the fetched revision; CUDA/PyTorch stack | **BLOCKED** for commercial use until the face detector is replaced; consent-gated research only |
| RIFE | `hzwer/ECCV2022-RIFE@5d8adb` (2025-09-10) | MIT | Pretrained weights are external downloads whose own licence is **not stated** in the repository; must be confirmed before redistribution | Frame interpolation only; not generative video, not a universal 60 fps switch; scene cuts need handling | 30+ fps at 2× 720p on an RTX 2080 Ti (README) | **PILOT** — the best next candidate, pending weight-licence confirmation and a CUDA runner |
| MusicGen / AudioCraft | `facebookresearch/audiocraft@896ec7c` (2025-03-13 head) | MIT | **Model weights are CC BY-NC 4.0** per the official MusicGen model card | Non-commercial only; not a replacement for the Studio's existing fal stable-audio / owner-upload / local mix routes | 300M, 1.5B and 3.3B parameter variants; no VRAM figure in the model card | **DEFER** (research comparator only; no commercial generation) |

## What each verdict means here

- **BLOCKED** — cannot be offered as a Studio capability under the current
  licence facts or runner. A code change does not fix a licence.
- **PILOT** — worth a single measured, owner-authorised job on a real runner
  before any product surface. None has run.
- **DEFER** — no product use; keep as a comparator.

## Runner and entitlement truth

- No GPU runner is configured for this Studio, and none is authorised for this
  task. Hunyuan, TRELLIS, LTX, LivePortrait and RIFE document NVIDIA/CUDA
  paths; no fetched revision documents Apple Silicon/MPS support.
- The existing paid paths remain the Studio's only generation routes: Workers
  AI for stills and the Director's text proposal, and fal for video, sound and
  edits. None of those endpoints is one of the six adapters above.
- No new subscription, GPU rental, model download or API key was created.
  `#65` still owns budget and job admission; `#11` owns agent access.
- The Supervisor/Director must never choose one of these adapters from a model
  name alone. A typed capability record has to say *available / unconfigured /
  licence-blocked / requires external runner / failed*, as #151 requires.

## What is unknown and how it would be qualified

| Unknown | Why it matters | Next evidence |
| --- | --- | --- |
| RIFE pretrained weight licence and checksum | The code is MIT but the shipped weights are the operative artifact | Pin the exact release archive, checksum and any bundled notice; if none, do not redistribute |
| TRELLIS mesh-only path without `diffoctreerast` | Could make a commercial mesh workflow possible | Run the mesh export with the non-commercial renderer removed, and record the exact dependency graph |
| LivePortrait replacement detector | Only blocks commercial use at the detector, not the animation code | Choose a permissively licensed detector and re-run one consented source/driver pair |
| LTX-2.5 minimum VRAM and real output quality | No official minimum is stated; 22B bf16 is large | One measured job on an approved GPU with `--quantization fp8-cast` and recorded peak memory |
| Hunyuan output rights in an eligible territory | Territory and MAU terms shape who may use it at all | Written confirmation from Tencent for the actual entity and user count |
| MusicGen commercial use | Weights are non-commercial | Do not use; keep the existing licensed music route |
| Any Apple Silicon path | The owner's current machine is a Mac | Do not claim support; measure only if a documented MPS path exists |

## Recommended order (no spend implied)

1. **RIFE** as a post-process pilot on an existing Studio clip, once weights are
   pinned and a CUDA runner is approved. It is the smallest, most reversible
   change and directly tests the runner contract.
2. **LTX-2.5** only after the owner confirms the revenue threshold and a GPU
   runner; one sound-on scene, not a film.
3. **TRELLIS** mesh-only research if a commercial renderer replacement exists.
4. **LivePortrait** only with a replacement detector and explicit consent.
5. **Hunyuan3D** only with territory/MAU legal sign-off.
6. **MusicGen** remains a comparator, not a product route.

## Acceptance mapping for #151

- Six-model matrix with pinned sources, code/weights/dependency licences,
  territory, hardware and verdict: **this document**.
- Fresh Studio usable with zero GPU or model account: **already true**; the
  Studio's uploads, library, projects, exports and local renderer do not depend
  on any adapter. Not re-verified in this run beyond the existing test suite.
- At least one real inference/post-process through an authorised route:
  **not done** — no runner, no spend, no authorisation.
- RIFE 24→48 fps or 3D/portrait pilot: **not done**; labelled unsupported.
- Reopen with browser and scoped agent, failure matrix, benchmark, recipe:
  **not done** for these adapters.

Nothing in this document marks #151 complete. It records the licence and runner
facts that any completion must build on, and the parts that remain unknown.

## Sources (commit-pinned)

- Hunyuan3D-2 licence and README: <https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/LICENSE>, <https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/README.md>
- TRELLIS licence, README and the two submodule notices: <https://github.com/microsoft/TRELLIS/blob/193e0502b5cb3eb5997ec457d5340e95d09b158e/LICENSE>, <https://github.com/microsoft/TRELLIS/blob/193e0502b5cb3eb5997ec457d5340e95d09b158e/README.md>, <https://github.com/JeffreyXiang/diffoctreerast/blob/master/LICENSE>, <https://github.com/nv-tlabs/FlexiCubes/blob/main/LICENSE.txt>
- LTX-2 code, weights licence and model files: <https://github.com/Lightricks/LTX-2/tree/f0f2f8607189c78a72420b2b63cb1975b5eca179>, <https://github.com/Lightricks/LTX-2/blob/f0f2f8607189c78a72420b2b63cb1975b5eca179/LICENSE-2_x>, <https://huggingface.co/Lightricks/LTX-2.5>
- LivePortrait licence and InsightFace note: <https://github.com/KlingAIResearch/LivePortrait/blob/9b294b3d0536135442ea73cb01e6cb3ca7029dd3/LICENSE>
- RIFE licence and README: <https://github.com/hzwer/ECCV2022-RIFE/blob/5d8adbdd40e12c2c8f91930eff838aebe561c086/LICENSE>, <https://github.com/hzwer/ECCV2022-RIFE/blob/5d8adbdd40e12c2c8f91930eff838aebe561c086/README.md>
- AudioCraft licence and MusicGen model card: <https://github.com/facebookresearch/audiocraft/blob/896ec7c47f5e5d1e5aa1e4b260c4405328bf009d/LICENSE>, <https://github.com/facebookresearch/audiocraft/blob/896ec7c47f5e5d1e5aa1e4b260c4405328bf009d/model_cards/MUSICGEN_MODEL_CARD.md>
