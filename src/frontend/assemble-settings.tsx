import { LocalRenderer } from "./local-render-ui";
import { shotRange } from "../../public/shot-trims.js";
import { FootagePlans } from "./footage-plans";
import { SongPlans } from "./song-plans";
import type {
  AssembleProps,
  CompositionV1,
  ComposeGenerationV1,
  MediaAssetV1,
  SettingsProps,
} from "./contracts";

const pending = (status: string) =>
  [
    "admitted",
    "submitting",
    "submitted",
    "running",
    "provider_complete",
    "saving",
    "cancel_requested",
  ].includes(status);
const money = (micro: number) => {
  const n = Number(micro ?? 0) / 1_000_000;
  return n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
};
const date = (value: string | number) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "";
const bytes = (n: number) =>
  !n
    ? "—"
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const labels: Record<string, [string, string]> = {
  saved: ["ok", "Saved"],
  admitted: ["", "Prepared"],
  submitting: ["run", "Submitting"],
  submitted: ["run", "Submitted"],
  running: ["run", "Generating"],
  provider_complete: ["run", "Copying result"],
  saving: ["run", "Saving"],
  failed: ["bad", "Failed"],
  cancel_requested: ["unknown", "Cancel requested"],
  cancelled: ["", "Cancelled"],
  unknown: ["unknown", "Outcome unknown"],
  discarded_after_delete: ["bad", "Discarded after delete"],
};

function CompositionCard({
  projectId,
  canEdit,
  onAssetSaved,
  composition,
  generations,
  assets,
  assemblyCost,
  socialCost,
}: {
  projectId: string;
  canEdit: boolean;
  onAssetSaved: (asset: MediaAssetV1) => void;
  composition: CompositionV1;
  generations: ComposeGenerationV1[];
  assets: MediaAssetV1[];
  assemblyCost: number;
  socialCost: number;
}) {
  const renders = generations.filter((g) => g.compositionId === composition.id);
  const hasTrims = composition.shots.some((shot) => shot.trimStartMs !== undefined || shot.trimEndMs !== undefined);
  const busy = renders.some((g) => pending(g.status));
  const changed =
    renders.length > 0 &&
    Number(composition.updatedAt ?? composition.createdAt ?? 0) >
      Math.max(...renders.map((g) => Number(g.createdAt ?? 0)));
  return (
    <article className="job">
      <header>
        <div className="row">
          <strong>{composition.title}</strong>
          <span className="small">
            {composition.shots.length} shots ·{" "}
            {(composition.totalMs / 1000).toFixed(1)}s
            {composition.audioAssetId ? " · mixed bed" : ""}
            {composition.audioTracks?.length
              ? ` · ${composition.audioTracks.length} source tracks`
              : ""}
          </span>
        </div>
        <span className="small">{date(composition.createdAt)}</span>
      </header>
      {changed && (
        <p className="small" style={{ margin: 0 }}>
          <strong>Changed since the last render.</strong> Render again to
          include the latest edits; earlier results are kept.
        </p>
      )}
      <details><summary>Review saved shot timings</summary><ol>{composition.shots.map((shot, index) => {
        const asset = assets.find((item) => item.id === shot.assetId);
        const range = shotRange(shot, asset);
        return <li key={`${shot.assetId}-${index}`}>{asset?.title ?? "Unavailable clip"}: {range ? `${range.start}–${range.end} ms of ${asset!.durationMs} ms` : "unavailable or invalid range"}</li>;
      })}</ol></details>
      <div className="row">
        <button
          className="button secondary"
          data-action="compose-render"
          data-variant="assembly"
          data-id={composition.id}
          disabled={busy || hasTrims}
        >
          Render master · {money(assemblyCost)}
        </button>
        <button
          className="button secondary"
          data-action="compose-render"
          data-variant="social"
          data-id={composition.id}
          disabled={busy || hasTrims}
          title="The selected order, composed into a 720 × 1280 (9:16) master with the saved sound, after a one-second vertical slate"
        >
          Make 9:16 cut · {money(socialCost)}
        </button>
        <button
          className="quiet"
          data-action="compose-load"
          data-id={composition.id}
        >
          Edit shots
        </button>
      </div>
      {hasTrims && <p className="small">Paid provider rendering cannot preserve these trims. Use the local MP4 renderer below.</p>}
      <LocalRenderer projectId={projectId} composition={composition} assets={assets} canEdit={canEdit} onAssetSaved={onAssetSaved} />
      <div className="render-list">
        {renders.length === 0 && (
          <p className="small" style={{ margin: 0 }}>
            No provider render yet. Provider rendering copies the participating clips and audio for that job.
          </p>
        )}
        {renders.map((g) => {
          const asset = assets.find((a) => a.id === g.assetId);
          const [tone, label] = labels[g.status] ?? ["", g.status];
          return (
            <div className="render-row" data-job={g.id} key={g.id}>
              <div className="row">
                <span className={`status ${tone}`}>{label}</span>
                <strong>
                  {g.variant === "social" ? "9:16 cut" : "Assembled master"}
                </strong>
                <span className="small">
                  Estimated allocation:{" "}
                  {money(g.costObservedMicro ?? g.costEstimateMicro)}
                </span>
              </div>
              {asset ? (
                <>
                  <video
                    src={asset.file}
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <p className="small" style={{ margin: 0 }}>
                    {asset.width} × {asset.height} ·{" "}
                    {((asset.durationMs ?? 0) / 1000).toFixed(2)}s ·{" "}
                    {bytes(asset.bytes)} · assembled from{" "}
                    {composition.shots.length} shots
                  </p>
                </>
              ) : (
                <p className="small" style={{ margin: 0 }}>
                  {g.error ? g.error.message : "Provider is rendering."}
                </p>
              )}
              <div className="row">
                {asset && (
                  <>
                    <a
                      className="button secondary"
                      href={asset.download}
                      download
                    >
                      Download
                    </a>
                    <button
                      className="secondary"
                      data-action="open-asset"
                      data-id={asset.id}
                    >
                      Open
                    </button>
                    <button
                      className="secondary"
                      data-action="publish-asset"
                      data-id={asset.id}
                    >
                      Publish
                    </button>
                  </>
                )}
                {pending(g.status) && (
                  <button
                    className="quiet"
                    data-action="refresh-job"
                    data-id={g.id}
                  >
                    Refresh
                  </button>
                )}
                {g.status === "unknown" && (
                  <button
                    className="secondary"
                    data-action="reconcile-job"
                    data-id={g.id}
                  >
                    Reconcile
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {renders.some((g) => g.variant === "social") && (
        <p className="small" style={{ margin: 0 }}>
          The 9:16 cut keeps the selected shot order and uses the same sound. It
          opens with a deterministic 1080 × 1920 slate, then composes the takes
          into a 720 × 1280 master. It is not a rename or a stretch of the 16:9
          cut.
        </p>
      )}
    </article>
  );
}

export function Assemble({
  projectId,
  canEdit,
  onSongStoryboard,
  onAssetSaved,
  compose,
  assets,
  compositions,
  generations,
  assemblyCost,
  socialCost,
}: AssembleProps) {
  const clips = assets.filter(
    (a) => a.kind === "video" && a.source !== "assembled",
  );
  const audio = assets.filter((a) => a.kind === "audio");
  const chosen = compose.shotIds
    .map((id) => clips.find((a) => a.id === id))
    .filter((a): a is MediaAssetV1 => Boolean(a));
  const total = chosen.reduce((sum, a) => sum + (shotRange(compose.shotTrims[a.id] ?? {}, a)?.durationMs ?? 0), 0);
  const mixedBed = audio.find((asset) => asset.id === compose.audioAssetId);
  const staleBed = Boolean(compose.audioAssetId && (!mixedBed?.durationMs || Math.abs(mixedBed.durationMs - total) > 100));
  return (
    <>
      <FootagePlans key={`footage-${projectId}`} projectId={projectId} assets={assets} canEdit={canEdit} />
      <SongPlans key={projectId} projectId={projectId} assets={assets} canEdit={canEdit} onStoryboard={onSongStoryboard} />
      <div className="spread">
        <h2 style={{ margin: 0 }}>Storyboard and assembly</h2>
        <span className="small">
          {chosen.length} shot{chosen.length === 1 ? "" : "s"} ·{" "}
          {(total / 1000).toFixed(1)}s assembled
        </span>
      </div>
      <p className="small">
        Order saved clips, add one audio bed, then render a bounded export. The
        composition stays editable; rendering again creates a new result and
        keeps the earlier one.
      </p>
      <div className="grid two" style={{ marginTop: "1rem" }}>
        <div className="card stack">
          <p className="eyebrow">The cut</p>
          {compose.editingId && (
            <p className="notice calm" style={{ margin: 0 }}>
              Editing a saved storyboard. Saving updates it in place and keeps
              every earlier render.
            </p>
          )}
          <label>
            Title
            <input
              data-compose="title"
              maxLength={80}
              defaultValue={compose.title}
              placeholder="Field notes, cut one"
            />
          </label>
          <div>
            <p className="small" style={{ margin: "0 0 0.4rem" }}>
              <strong>Shots in order</strong>
            </p>
            {chosen.length === 0 && (
              <p className="small" style={{ margin: 0 }}>
                Add at least two saved clips.
              </p>
            )}
            <ol className="shot-list">
              {chosen.map((asset, index) => (
                <li key={asset.id}>
                  <span className="shot-index">{index + 1}</span>
                  <span className="shot-title">
                    {asset.title}
                    <br />
                    <span className="small">
                      {compose.shotTrims[asset.id] ? `Using ${compose.shotTrims[asset.id].trimStartMs}–${compose.shotTrims[asset.id].trimEndMs} ms of original` : `${((asset.durationMs || 0) / 1000).toFixed(1)}s`} ·{" "}
                      {asset.width}×{asset.height}
                    </span>
                  </span>
                  <span className="row">
                    <button type="button" className="secondary" data-action="compose-trim" data-id={asset.id} aria-label={`Trim ${asset.title}`} disabled={!canEdit || !asset.durationMs}>Trim</button>
                    <button
                      className="quiet"
                      data-action="compose-up"
                      data-id={asset.id}
                      aria-label={`Move ${asset.title} earlier`}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="quiet"
                      data-action="compose-down"
                      data-id={asset.id}
                      aria-label={`Move ${asset.title} later`}
                      disabled={index === chosen.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      className="quiet"
                      data-action="compose-remove"
                      data-id={asset.id}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mixer">
            <div className="spread">
              <p className="small" style={{ margin: 0 }}>
                <strong>Soundtrack</strong> · up to four saved tracks
              </p>
              <span className="small">
                {compose.audioAssetId ? "mixed bed saved" : "not mixed yet"}
              </span>
            </div>
            {compose.audioTracks.length === 0 && (
              <p className="small" style={{ margin: "0.4rem 0" }}>
                Add music, narration or an effect. Trim, gain and fades are
                applied once in the browser and saved as a new WAV; the separate
                tracks stay as lineage.
              </p>
            )}
            {compose.audioTracks.map((track, index) => {
              const asset = audio.find((a) => a.id === track.assetId);
              return (
                <div
                  className="mix-row"
                  data-mix-row={index}
                  key={track.assetId}
                >
                  <div className="spread">
                    <strong className="small">
                      {index + 1}. {asset?.title ?? "Missing track"}
                    </strong>
                    <button
                      className="quiet"
                      type="button"
                      data-action="mix-remove"
                      data-index={index}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mix-fields">
                    <label>
                      Role
                      <select
                        data-mix="role"
                        data-index={index}
                        defaultValue={track.role}
                      >
                        {["music", "voice", "effect"].map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(
                      [
                        ["Start (ms)", "startMs", track.startMs],
                        ["Trim start (ms)", "trimStartMs", track.trimStartMs],
                        [
                          "Trim end (ms)",
                          "trimEndMs",
                          track.trimEndMs || asset?.durationMs || 0,
                        ],
                        ["Gain (dB)", "gainDb", track.gainDb],
                        ["Fade in (ms)", "fadeInMs", track.fadeInMs],
                        ["Fade out (ms)", "fadeOutMs", track.fadeOutMs],
                      ] as const
                    ).map(([label, key, value]) => (
                      <label key={key}>
                        {label}
                        <input
                          type={key === "gainDb" ? "range" : "number"}
                          min={key === "gainDb" ? -24 : 0}
                          max={
                            key === "gainDb"
                              ? 12
                              : key.startsWith("fade")
                                ? 3000
                                : undefined
                          }
                          step={key === "gainDb" ? 1 : 100}
                          data-mix={key}
                          data-index={index}
                          defaultValue={Number(value) || 0}
                        />
                        {key === "gainDb" && (
                          <span className="small">{Number(value) || 0} dB</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <select id="mix-add" aria-label="Add an audio track">
                <option value="">Choose a saved audio asset</option>
                {audio.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ·{" "}
                    {a.durationMs
                      ? `${(a.durationMs / 1000).toFixed(0)}s`
                      : "audio"}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                type="button"
                data-action="mix-add"
                disabled={compose.audioTracks.length >= 4}
              >
                Add track
              </button>
              <button
                className="button"
                type="button"
                data-action="mix-render"
                disabled={compose.audioTracks.length === 0}
              >
                Mix soundtrack
              </button>
            </div>
            {compose.audioAssetId && (<>
              <p className="small" style={{ margin: "0.4rem 0 0" }}>
                Mixed bed:{" "}
                {audio.find((a) => a.id === compose.audioAssetId)?.title ??
                  compose.audioAssetId}
                . Rendering uses this saved WAV; the separate tracks remain in
                the composition manifest.
              </p>
              <button className="quiet" type="button" data-action="mix-clear">Remove mixed bed</button>
              {staleBed && <p className="notice warn">The mixed bed does not match the shot durations. Mix again or remove the bed before saving.</p>}
            </>)}
          </div>
          {audio.length === 0 && (
            <p className="small" style={{ margin: 0 }}>
              Upload or generate sound in Create to add music, narration or an
              effect.
            </p>
          )}
          <div className="row">
            <button
              className="button"
              data-action="compose-save"
              disabled={chosen.length < 2 || total > 60000 || staleBed}
            >
              {compose.editingId ? "Save changes" : "Save storyboard"}
            </button>
            {compose.editingId && (
              <button className="quiet" data-action="compose-new">
                Start a new storyboard
              </button>
            )}
          </div>
          {total > 60000 && (
            <p className="small" style={{ margin: 0, color: "var(--bad)" }}>
              Keep the cut under 60 seconds to stay inside the bounded render.
            </p>
          )}
        </div>
        <div className="card stack">
          <p className="eyebrow">Saved clips</p>
          {clips.length === 0 && (
            <p className="small" style={{ margin: 0 }}>
              No clips yet. Animate a still or upload an MP4 first.
            </p>
          )}
          <ul className="clip-picker">
            {clips.map((a) => {
              const used = compose.shotIds.includes(a.id);
              return (
                <li key={a.id}>
                  <span>
                    {a.title}{" "}
                    <span className="small">
                      {((a.durationMs || 0) / 1000).toFixed(1)}s
                    </span>
                  </span>
                  <button
                    className={used ? "quiet" : "secondary"}
                    data-action={used ? "compose-remove" : "compose-add"}
                    data-id={a.id}
                  >
                    {used ? "Added" : "Add shot"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <h3 style={{ marginTop: "1.6rem" }}>Saved storyboards</h3>
      {compositions.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No storyboard saved yet.</p>
        </div>
      )}
      <div className="stack">
        {compositions.map((c) => (
          <CompositionCard
            key={c.id}
            projectId={projectId}
            canEdit={canEdit}
            onAssetSaved={onAssetSaved}
            composition={c}
            generations={generations}
            assets={assets}
            assemblyCost={assemblyCost}
            socialCost={socialCost}
          />
        ))}
      </div>
    </>
  );
}

export function Settings({ project, draft }: SettingsProps) {
  const refs = project.references ?? [];
  return (
    <form
      className="grid two"
      data-form="settings"
      data-project-id={project.id}
    >
      <div className="card stack">
        <p className="eyebrow">Studio</p>
        <label>
          Name
          <input
            name="name"
            defaultValue={draft?.name ?? project.name}
            maxLength={80}
            required
          />
        </label>
        <label>
          Creative direction
          <textarea
            name="creativeDirection"
            defaultValue={draft?.creativeDirection ?? project.creativeDirection}
            maxLength={600}
            rows={4}
          />
        </label>
        <label>
          Visibility
          <select
            name="visibility"
            defaultValue={draft?.visibility ?? project.visibility}
          >
            <option value="private">Private — only this studio</option>
            <option value="unlisted">Unlisted — reachable with its link</option>
          </select>
        </label>
        <p className="small">
          Visibility applies to the studio itself, not to published pieces.
          Published pages are public until withdrawn.
        </p>
        <button className="button" type="submit">
          Save studio
        </button>
      </div>
      <div className="card stack">
        <p className="eyebrow">Creative references</p>
        <p className="small" style={{ margin: 0 }}>
          Save links that inform this studio. They are notes for you and your
          agent; the studio does not fetch or execute them.
        </p>
        <div id="references">
          {refs.length === 0 && <p className="small">No references yet.</p>}
          {refs.map((ref) => (
            <div
              className="row"
              key={ref.id}
              style={{
                justifyContent: "space-between",
                borderTop: "1px solid var(--line)",
                paddingTop: "0.5rem",
              }}
            >
              <span>
                <strong>{ref.title}</strong>
                <br />
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="small"
                >
                  {ref.url}
                </a>
              </span>
              <button
                className="quiet"
                data-action="remove-reference"
                data-id={ref.id}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <input
            name="referenceTitle"
            aria-label="Reference title"
            placeholder="Reference title"
            maxLength={100}
            defaultValue={draft?.referenceTitle ?? ""}
          />
          <input
            name="referenceUrl"
            aria-label="Reference URL"
            type="url"
            placeholder="https://…"
            defaultValue={draft?.referenceUrl ?? ""}
          />
          <button
            className="secondary"
            type="button"
            data-action="add-reference"
          >
            Add
          </button>
        </div>
        <hr
          style={{
            border: 0,
            borderTop: "1px solid var(--line)",
            margin: "0.5rem 0",
          }}
        />
        <p className="small">
          Ownership: this studio owns its D1 metadata, R2 media and provider
          keys. Export downloads the project record, prompts and lineage without
          secrets. Media files download separately while they still exist.
        </p>
        <a
          className="button secondary"
          href={`/api/projects/${encodeURIComponent(project.id)}/export`}
          download
        >
          Download project export
        </a>
      </div>
    </form>
  );
}
