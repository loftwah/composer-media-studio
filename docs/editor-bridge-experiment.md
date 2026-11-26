# Let an agent assemble, revise and hand off a Studio film

This is a runnable local experiment under [Studio #14](https://github.com/loftwah/composer-media-studio/issues/14),
[Prints #31](https://github.com/loftwah/prints-desktop/issues/31) and Composer's
[MUSIC-DIRECTION-01](https://github.com/loftwah/app-composer/blob/main/benchmarks/creative-production/music-direction-01.md).
It takes the existing `CompositionV1` contract and explicitly selected local
media, produces real MP4s and editable cut timelines, then demonstrates a
one-shot correction. It adds no server, provider, product state or UI.

## Run the proof

Prerequisites: Python 3.10+, `ffmpeg` with libx264 and AAC, and `ffprobe` on
PATH. The bundle extraction command also needs the repository's supported Node
version (22.23+ or 24.22+). No full frontend build is needed.

```sh
python3 scripts/editor-bridge-probe.py doctor
python3 scripts/editor-bridge-probe.py demo --output output/editor-proof-01
```

Use a new output directory for each run. The demo generates four synthetic test
clips and a quiet tone, renders a 30-second landscape and portrait master, and
replaces shot two in a second landscape master. It checks all decoded video
frames outside that shot, the decoded audio, retained masters and three cache
hits. These are technical fixtures, not a music film or a public showcase.

Open these files:

- `output/editor-proof-01/v1/landscape/master.mp4`
- `output/editor-proof-01/v1/portrait/master.mp4`
- `output/editor-proof-01/v2/landscape/master.mp4`
- `output/editor-proof-01/demo-receipt.json`

Each profile directory also contains its media and `timeline.fcpxml`. FCPXML is
checked for well-formed XML only; native editor import has not been tested.

For OpenTimelineIO, use an existing compatible SDK or an isolated environment.
The observed probe used the official Python SDK **0.18.1**. No package is
installed automatically:

```sh
python3 -m venv output/editor-proof-venv
output/editor-proof-venv/bin/python -m pip install opentimelineio==0.18.1
output/editor-proof-venv/bin/python scripts/editor-bridge-probe.py demo \
  --output output/editor-proof-02
```

On Windows, the interpreter is under `Scripts/python.exe`. When the SDK is
available, the probe also writes `timeline.otio` and reopens it with that SDK to
check duration and clip count. SDK validation is not native-editor validation.
Keep each timeline beside its `media` directory when moving it.

## Render an existing Studio storyboard

First mix and save the storyboard's soundtrack in Studio. Its `audioAssetId`
must refer to that saved WAV. An unmixed stem recipe is not an audio master.
Use the existing authorised [portable export](portable-project.md) to obtain a
private `.studio` archive. It retains media and full project records; the
older text-and-timing song-plan export is insufficient.

```sh
node scripts/editor-bridge-project.mjs --bundle /path/to/project.studio --list
node scripts/editor-bridge-project.mjs --bundle /path/to/project.studio \
  --composition cmp_selected --out output/editor-inputs-01

python3 scripts/editor-bridge-probe.py render \
  --composition output/editor-inputs-01/composition.json \
  --assets output/editor-inputs-01/assets.json \
  --output output/editor-film-v1 --cache output/editor-cache \
  --profile both
```

The extraction wrapper uses the existing `decodePortableBundle` and validator;
it does not reimplement the archive format. It verifies the archive before
writing, extracts only the selected storyboard's clips and saved mix, and
keeps the complete source composition record, asset metadata and archive hash.
An existing destination or a damaged archive is refused.

The renderer also accepts an existing flat API `CompositionV1` JSON and a local
asset map. Keys are exact asset IDs; values are local paths, or preferably
objects containing `path` and the expected `sha256`. Relative paths resolve
against the asset-map file, not the current working directory. Extracted maps
include expected hashes automatically. URLs are refused.

For a correction, save a separate revised composition file and any new asset
mapping. Keep the composition ID, change the selected shot/timing and revision
metadata, and run into a new output directory with the same `--cache`. Original
media and previous masters remain available. The cache includes source bytes,
source range, output settings and FFmpeg version, so unaffected shots can be
reused. The cache is local acceleration, not a second project database.

## Supported scope

| Concern | This probe |
| --- | --- |
| Film | 2–6 hard-cut shots; 2–60 seconds total |
| Source video | Each source at most 16 seconds and within the existing 4K input envelope |
| Input storage | At most 128 MiB of selected files |
| Sound | One saved WAV premix, at most 16 MiB; within 100 ms of the composition duration |
| Output | 1280 × 720 or 720 × 1280, 30 fps, H.264/AAC; at most 64 MiB per master |
| Timing | Integer millisecond trims that map exactly to output frames; unaligned boundaries are refused |
| Compute | One FFmpeg invocation at a time; two encoder threads and one filter thread |
| Calls | No model, provider, network, upload or publication call |
| Interchange | Normalised shot derivatives plus one soundtrack; editable order and cuts |

`durationMs` means the selected source range length, not speed change. Source
timestamps are rebased before trimming. The saved premix starts at output zero;
`originSongPlan.sourceStartMs` is retained as provenance and is not applied to
the mix again. The exported soundtrack is normalised to 48 kHz stereo and the
exact composition length. Existing `audioTracks` are retained as provenance
when a premix is present; the probe does not remix them.

Trims, centre cropping and frame-rate conversion are baked into the
interchange clips. Original media is untouched and remains identified in the
source receipt, but source handles and individual effects are not recreated
in the exported timeline. Portrait framing is a mechanical centre-crop test.
The probe does not render separately stored captions, slates, transitions,
grading, Fusion effects or speed changes. It refuses unknown composition and
shot fields instead of silently treating them as supported. A cut-only export
must not be described as a complete Studio export when the project relies on
those other features.

Output and scratch paths are private to the invoking user. Source and output
receipts can contain local filenames and project metadata; keep them with the
owner's private project. Cache files may be removed when that experiment no
longer needs rerenders. A failed render retains a failure receipt and completed
work in its new directory; it does not delete or overwrite an earlier run.

## Observed technical result

Verified **2026/11/26 AEDT (Australia/Melbourne, UTC+11) / 2026/11/26 UTC** in a
Linux x86-64 workspace with Python 3.12, FFmpeg 7.1.5, Node 24.22.3 and OTIO 0.18.1.

| Observation | Result |
| --- | --- |
| First landscape + portrait render, including verification | 12.153 seconds combined |
| One-shot landscape revision, including verification | 3.367 seconds |
| Each master | 900 decoded frames; 30 seconds; H.264/AAC |
| Master sizes | 5,809,776 bytes landscape; 2,997,933 portrait; 5,720,627 revised landscape |
| Largest single child-process peak RSS | 183.17 MiB, measured across the process lifetime |
| Full demo working tree | 63,186,991 bytes, including fixtures, cache, timelines and all outputs |
| Revision | Three cache hits; one rendered replacement; unaffected decoded frames and decoded audio match exactly |
| Existing bundle → extraction → renderer | Passed; same master hash as rendering its source composition directly |
| Extraction integrity | Exact selected bytes and composition preserved; unused reference excluded; damaged archive and existing destination refused |
| OTIO | SDK write/read check passed; native import not run |
| Native application, Prints bridge, cloud host, real-song craft | Not exercised by this technical proof |

The render times exclude fixture creation and the demo's later cross-version
frame comparison. Peak RSS is the largest individual child process, not total
machine memory or a per-render allocation. These are observations from one
small fixture in this environment, not predictions for a Mac or complex film.
No media-generation provider was called. Agent inference and electricity were
not measured; no claim of zero total cost is made.

## Optional Resolve Studio proof

Blackmagic now provides native AI-assistant integration in Resolve 21.1 and
names Codex in its [official announcement](https://www.blackmagicdesign.com/media/partial/release/20260908-03).
Its [feature matrix](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_Studio_21_Features.pdf)
lists AI Assistants and scripting as **Studio** features. Do not buy an editor
licence just to run this first experiment.

If a compatible Studio installation is already available, its
[reference manual](https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_21.1_Reference_Manual.pdf)
describes **File → Setup AI Assistants** (page 4318). Use the existing official
local integration and restart the assistant if the application requests it.
Do not install a community bridge merely because it appeared in an old plan.

Have the agent report the actual application version/edition and available
operations, create a separate experiment project, import `timeline.otio`, check
for offline media and verify cut count/duration/audio. Save and render, then
make one visible edit in a copied timeline and inspect the new exported video.
Keep the first project/timeline/master. Report actual operations and failures;
an acknowledged API call alone does not prove the rendered result.

The official manual describes `.otio` import and relinking on pages 527–530.
[OTIO](https://opentimelineio.readthedocs.io/en/latest/) references media rather
than embedding it, and its [adapter matrix](https://opentimelineio.readthedocs.io/en/latest/tutorials/feature-matrix.html)
shows that effects and retiming support vary. This experiment deliberately
starts with cuts and one soundtrack. Native reimport, media relinking and an
edit after reopening remain separate checks until performed.

## Product follow-through

Studio owns the canonical film project and its existing export/download/upload
paths. Prints owns its native brief and reference workspace; the shipped
[local grant CLI](https://github.com/loftwah/prints-desktop/blob/main/docs/agent-workspace.md)
supports discovery, reading and scoped edits, but does not expose original
media bytes or a film renderer. Do not invent such an operation or extract
private app state. The typed production handoff stays under Prints #31.

Composer retains the existing benchmark and review records. Cloudflare can
coordinate the job and hold permitted results; the native process runs on the
local computer or a separately qualified Fungi/Oyster host. A regular Worker
is not a desktop editor host. No cloud computer, service or recurring job is
created by this probe.

After the mechanics pass, choose an authorised LoftwahFM segment and 4–6 owned
shots. Finish a 30–60 second film, watch and listen to it, request one useful
correction, and retain both versions with cost and effort. Only that actual
creative-production run can advance MUSIC-DIRECTION-01. Synthetic patterns,
JSON validation and codec checks supply no human-quality score.
