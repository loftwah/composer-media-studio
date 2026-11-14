import type {
  GenerationV1,
  HistoryProps,
  MediaAssetV1,
  ModelV1,
  PublishProps,
} from "./contracts";
import "./history-publish.css";

const pendingStatuses = new Set([
  "admitted",
  "submitting",
  "submitted",
  "running",
  "provider_complete",
  "saving",
  "cancel_requested",
]);
const cancellableStatuses = new Set([
  "admitted",
  "submitting",
  "submitted",
  "running",
]);
const statusLabels: Record<string, [string, string]> = {
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
const money = (micro: number) => {
  const value = Number(micro ?? 0) / 1_000_000;
  return value === 0
    ? "$0.00"
    : value < 0.01
      ? `$${value.toFixed(3)}`
      : `$${value.toFixed(2)}`;
};
const date = (timestamp: string | number) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(timestamp))
    : "";
const time = (timestamp: string | number) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(timestamp))
    : "";

function JobCard({
  job,
  asset,
  model,
}: {
  job: GenerationV1;
  asset?: MediaAssetV1;
  model?: ModelV1;
}) {
  const [tone, label] = statusLabels[job.status] ?? ["", job.status];
  const pending = pendingStatuses.has(job.status);
  return (
    <article className="job" data-job={job.id}>
      <header>
        <div className="row">
          <span className={`status ${tone}`}>{label}</span>
          <strong>{model?.label ?? job.model}</strong>
          <span className="small">
            {job.kind} · {date(job.createdAt)} {time(job.createdAt)}
          </span>
        </div>
        <span className="small">
          Estimated allocation: {money(job.costObservedMicro ?? job.costEstimateMicro)}
        </span>
      </header>
      <p className="prompt">{job.prompt}</p>
      <p className="small">
        {job.aspect ?? ""}{" "}
        {job.durationSeconds ? `· ${job.durationSeconds}s` : ""}{" "}
        {job.error ? `· ${job.error.message}` : ""}
      </p>
      {asset && (
        <div className="result">
          {asset.kind === "video" ? (
            <video src={asset.file} controls playsInline preload="metadata" />
          ) : asset.kind === "audio" ? (
            <audio
              src={asset.file}
              controls
              preload="metadata"
              className="history-audio"
            />
          ) : (
            <img src={asset.file} alt={asset.title} loading="lazy" />
          )}
        </div>
      )}
      <div className="row">
        {asset && (
          <>
            <button
              type="button"
              className="secondary"
              data-action="open-asset"
              data-id={asset.id}
            >
              Open result
            </button>
            <button
              type="button"
              className="secondary"
              data-action="reuse-job"
              data-id={job.id}
            >
              Reuse settings
            </button>
          </>
        )}
        {pending && job.kind === "video" && (
          <button
            type="button"
            className="secondary"
            data-action="refresh-job"
            data-id={job.id}
          >
            Refresh
          </button>
        )}
        {cancellableStatuses.has(job.status) && (
          <button
            type="button"
            className="secondary"
            data-action="cancel-job"
            data-id={job.id}
          >
            Cancel
          </button>
        )}
        {["provider_complete", "saving"].includes(job.status) && (
          <button type="button" data-action="save-retry" data-id={job.id}>
            Retry saving
          </button>
        )}
        {job.status === "unknown" && (
          <button
            type="button"
            className="secondary"
            data-action="reconcile-job"
            data-id={job.id}
          >
            Reconcile
          </button>
        )}
        {!pending && !asset && (
          <button
            type="button"
            className="quiet"
            data-action="delete-job"
            data-id={job.id}
          >
            Remove from history
          </button>
        )}
      </div>
    </article>
  );
}

export function History({ generations, assets, models }: HistoryProps) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const modelsById = new Map(models.map((model) => [model.id, model]));
  return (
    <section className="history-workspace">
      <div className="spread">
        <h2>Generation history</h2>
        <button
          type="button"
          className="button secondary"
          data-action="tab"
          data-tab="create"
        >
          New request
        </button>
      </div>
      <p className="small">
        Saved results live in the library. Failed and unknown outcomes keep
        their exact request, cost state and recovery options.
      </p>
      <div className="stack history-list">
        {generations.length === 0 && (
          <div className="card">
            <p>No requests yet.</p>
          </div>
        )}
        {generations.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            asset={job.assetId ? assetsById.get(job.assetId) : undefined}
            model={modelsById.get(job.model)}
          />
        ))}
      </div>
    </section>
  );
}

export function Publish({ publications, origin }: PublishProps) {
  return (
    <section className="publish-workspace">
      <div className="spread">
        <h2>Published pages</h2>
        <button type="button" className="button" data-action="choose-publish">
          Publish a piece
        </button>
      </div>
      <p className="small">
        Publishing creates a public page with only the title, description and
        media. Prompts, other projects and private filenames stay private.
        Withdrawal stops new visits; downloads already taken cannot be recalled.
      </p>
      <div className="stack history-list">
        {publications.length === 0 && (
          <div className="card">
            <p>Nothing published yet.</p>
          </div>
        )}
        {publications.map((publication) => (
          <article className="job" key={publication.id}>
            <header>
              <strong>{publication.title}</strong>
              <span className="small">{date(publication.createdAt)}</span>
            </header>
            <p className="small">
              <a
                href={publication.path}
                target="_blank"
                rel="noopener noreferrer"
              >
                {origin}
                {publication.path}
              </a>
            </p>
            <div className="row">
              <a
                className="button secondary"
                href={publication.path}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open page
              </a>
              <button
                type="button"
                className="quiet"
                data-action="revoke"
                data-id={publication.id}
              >
                Withdraw
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
