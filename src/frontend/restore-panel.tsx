// MIT. The owner-facing restore surface in the live Studio home screen.
//
// It reads a sealed portable bundle locally, previews exactly what will be
// written through the existing owner restore API, then reports real staged and
// committed counts. Every retry resumes the same import, so a retry never
// duplicates rows or bytes.

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {
  commitSentence,
  formatBytes,
  openBundle,
  planFacts,
  previewDecision,
  progressFor,
  progressSentence,
  readBundleBlob,
  restoreProblem,
  stageQueue,
  type OpenedBundle,
  type PreviewReport,
  type ProgressSnapshot,
  type RestoreProblem,
  type StageAckStatus,
  type StageTarget,
} from "./restore-flow";
import "./restore.css";

type Phase = "idle" | "reading" | "previewing" | "ready" | "staging" | "committing" | "done";

interface BeginResponse {
  status: "staging" | "already_imported";
  resumed?: boolean;
  restarted?: boolean;
  importId?: string;
  projectId?: string;
  assets?: StageTarget[];
}

interface StatusResponse {
  status?: string;
  staged?: string[];
  stagedBytes?: number;
}

interface CommitCounts {
  assets?: number;
  mediaAssets?: number;
  contentBytes?: number;
  generations?: number;
  compositions?: number;
  subjects?: number;
  songPlans?: number;
  publications?: number;
}

interface CommitResponse {
  status?: string;
  projectId?: string;
  counts?: CommitCounts;
}

interface Restored {
  projectId: string;
  name?: string;
  counts?: CommitCounts;
  already: boolean;
}

interface ApiError extends Error {
  code?: string;
  status?: number;
  report?: PreviewReport | null;
}

const IDLE_STATUS = "Choose a bundle to see what it contains. Nothing is written until you start the restore.";

function apiError(status: number, payload: unknown): ApiError {
  const body = payload as { error?: { code?: string; message?: string }; report?: PreviewReport | null } | null;
  const error = new Error(body?.error?.message ?? `The studio answered ${status}.`) as ApiError;
  error.code = body?.error?.code;
  error.status = status;
  error.report = body?.report ?? null;
  return error;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await readJson(response);
  if (!response.ok) throw apiError(response.status, payload);
  return payload;
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    signal,
    headers: { accept: "application/json" },
  });
  const payload = await readJson(response);
  if (!response.ok) throw apiError(response.status, payload);
  return payload;
}

const mediaCount = (plan: PreviewReport["plan"]) =>
  plan?.mediaAssets ?? (plan?.blobs ?? 0);

export function RestorePanel({ canRestore }: { canRestore: boolean }) {
  const titleId = useId();
  const fileId = useId();
  const hintId = useId();
  const statusId = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [bundle, setBundle] = useState<OpenedBundle | null>(null);
  const [preview, setPreview] = useState<PreviewReport | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [assets, setAssets] = useState<StageTarget[]>([]);
  const [acks, setAcks] = useState<Record<string, StageAckStatus>>({});
  const [problem, setProblem] = useState<RestoreProblem | null>(null);
  const [restored, setRestored] = useState<Restored | null>(null);
  const [removing, setRemoving] = useState(false);
  const [status, setStatus] = useState(IDLE_STATUS);
  const fileInput = useRef<HTMLInputElement>(null);
  const alertHeading = useRef<HTMLHeadingElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (problem) alertHeading.current?.focus();
  }, [problem]);
  useEffect(() => {
    if (restored) successHeading.current?.focus();
  }, [restored]);

  const busy = phase === "reading" || phase === "previewing" || phase === "staging" || phase === "committing";
  const decision = previewDecision(preview);
  const progress: ProgressSnapshot = progressFor(assets, acks);
  const blocked = decision === "blocked";

  function clearPanel() {
    abort.current?.abort();
    abort.current = null;
    setPhase("idle");
    setFile(null);
    setBundle(null);
    setPreview(null);
    setImportId(null);
    setAssets([]);
    setAcks({});
    setProblem(null);
    setRestored(null);
    setRemoving(false);
    setStatus(IDLE_STATUS);
  }

  function reset() {
    clearPanel();
    // Clear the native picker so the same file can be chosen again.
    if (fileInput.current) fileInput.current.value = "";
  }

  async function previewFile(chosen: File) {
    const controller = new AbortController();
    abort.current = controller;
    setPhase("reading");
    setProblem(null);
    setRestored(null);
    setStatus(`Reading “${chosen.name}” and checking its hashes in this browser. Nothing has been sent yet.`);
    try {
      const opened = await openBundle(chosen);
      if (!mounted.current || controller.signal.aborted) return;
      setBundle(opened);
      setPhase("previewing");
      setStatus("Checking the bundle against this studio. A preview writes nothing.");
      const result = (await postJson("/api/studio/restore/preview", { manifest: opened.manifest }, controller.signal)) as PreviewReport;
      if (!mounted.current || controller.signal.aborted) return;
      setPreview(result);
      setPhase("ready");
      if (result.status === "already_imported") {
        setRestored({
          projectId: String(result.projectId),
          name: result.project?.name ?? opened.manifest.project.name,
          counts: result.plan,
          already: true,
        });
        setStatus("This bundle is already in this studio. Nothing was written.");
        return;
      }
      const planned = mediaCount(result.plan);
      setStatus(
        result.status === "resume_staging"
          ? `An earlier attempt at this bundle is unfinished. Continue to send only the files this studio does not already hold. ${planned} ${planned === 1 ? "file" : "files"} planned.`
          : result.importStatus === "failed"
            ? `An earlier attempt was cleaned up, so this starts a clean restore of ${planned} ${planned === 1 ? "file" : "files"}, ${formatBytes(result.plan?.contentBytes)}. Nothing exists from the earlier attempt.`
            : `Preview ready: ${planned} ${planned === 1 ? "file" : "files"}, ${formatBytes(result.plan?.contentBytes)}. Nothing has been written.`,
      );
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      const failure = error as ApiError;
      if (failure.report) setPreview(failure.report);
      setProblem(restoreProblem(error));
      setPhase("ready");
      setStatus("The bundle was refused before anything was written.");
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    // Keep the browser's own file name visible in the picker.
    clearPanel();
    if (!chosen) return;
    setFile(chosen);
    await previewFile(chosen);
  }

  async function start() {
    if (!file || !bundle || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setRestored(null);
    setPhase("staging");
    setStatus("Starting the restore. Nothing is visible in the studio until every file is verified.");
    let planned: StageTarget[] = [];
    let staged: Record<string, StageAckStatus> = {};
    try {
      const begun = (await postJson("/api/studio/restore", { manifest: bundle.manifest }, controller.signal)) as BeginResponse;
      const name = preview?.project?.name ?? bundle.manifest.project.name;
      if (begun.status === "already_imported") {
        setRestored({ projectId: String(begun.projectId), name, counts: preview?.plan, already: true });
        setPhase("done");
        setStatus("This bundle is already in this studio. Nothing was written.");
        return;
      }
      const id = begun.importId;
      planned = begun.assets ?? [];
      if (!id || planned.length === 0) throw new Error("This restore did not return any media to stage.");
      setImportId(id);
      setAssets(planned);
      // The server knows which staging keys it already holds, so a resumed
      // restore sends only the missing files.
      const serverStatus = (await getJson(
        `/api/studio/restore/${encodeURIComponent(id)}`,
        controller.signal,
      )) as StatusResponse;
      const already = Array.isArray(serverStatus.staged) ? serverStatus.staged : [];
      for (const sourceId of already) staged[sourceId] = "already_staged";
      setAcks({ ...staged });
      setStatus(progressSentence(progressFor(planned, staged), null));
      const queue = stageQueue(planned, already);
      const offset = planned.length - queue.length;
      for (const [index, asset] of queue.entries()) {
        if (controller.signal.aborted) return;
        const title = asset.title || asset.sourceId;
        setStatus(progressSentence(progressFor(planned, staged), { title, index: offset + index + 1 }));
        const bytes = await readBundleBlob(file, bundle, asset);
        if (controller.signal.aborted) return;
        const response = await fetch(
          `/api/studio/restore/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.sourceId)}`,
          {
            method: "POST",
            credentials: "same-origin",
            signal: controller.signal,
            headers: { "content-type": "application/octet-stream" },
            body: new Blob([bytes], { type: "application/octet-stream" }),
          },
        );
        const payload = (await readJson(response)) as { status?: string };
        if (!response.ok) throw apiError(response.status, payload);
        if (payload.status !== "staged" && payload.status !== "already_staged")
          throw new Error(`The studio did not confirm “${title}”. Nothing was activated.`);
        staged = { ...staged, [asset.sourceId]: payload.status };
        setAcks({ ...staged });
        setStatus(progressSentence(progressFor(planned, staged), null));
      }
      if (controller.signal.aborted) return;
      setPhase("committing");
      setStatus(`All ${planned.length} files are staged. Verifying every byte again and activating the restored studio…`);
      const committed = (await postJson(
        `/api/studio/restore/${encodeURIComponent(id)}/commit`,
        { confirm: true },
        controller.signal,
      )) as CommitResponse;
      if (!mounted.current) return;
      setRestored({ projectId: String(committed.projectId), name, counts: committed.counts, already: false });
      setPhase("done");
      setStatus(commitSentence(committed.counts, name));
    } catch (error) {
      if (!mounted.current) return;
      if (controller.signal.aborted) {
        setPhase("ready");
        const snapshot = progressFor(planned, staged);
        setStatus(
          snapshot.done
            ? `Stopped. ${snapshot.done} of ${snapshot.total} files are staged on this studio. Nothing was activated; continue to resume.`
            : "Stopped before any file was staged. Nothing was activated.",
        );
        return;
      }
      const failure = error as ApiError;
      if (failure.report) setPreview(failure.report);
      setProblem(restoreProblem(error));
      setPhase("ready");
      setStatus("The restore stopped before activating anything. Staged files are kept so a retry can resume.");
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  async function retry() {
    if (!file) return;
    if (!preview) {
      await previewFile(file);
      return;
    }
    await start();
  }

  async function removeStaged() {
    if (!importId || busy || removing) return;
    setRemoving(true);
    setProblem(null);
    try {
      await postJson(`/api/studio/restore/${encodeURIComponent(importId)}/cleanup`, { confirm: true });
      if (!mounted.current) return;
      setImportId(null);
      setAcks({});
      setAssets([]);
      // The bundle is still previewed, but its next restore is a clean start.
      setPreview((current) =>
        current ? { ...current, status: "ready", importStatus: "failed", importId: null } : current,
      );
      setStatus("Staged files were removed from this studio. No project or record was activated.");
    } catch (error) {
      if (mounted.current) setProblem(restoreProblem(error));
    } finally {
      if (mounted.current) setRemoving(false);
    }
  }

  const retryable = Boolean(problem?.retryable && file && !blocked);
  const canStart = Boolean(file && bundle && preview && !blocked && !busy && !restored && !problem);
  const showMeter =
    progress.total > 0 &&
    (phase === "staging" || phase === "committing" || (!busy && progress.done > 0 && !restored));

  return (
    <section className="creative-restore" aria-labelledby={titleId}>
      <div className="creative-section-head">
        <div>
          <h2 id={titleId}>Restore a studio from a bundle</h2>
          <p>
            A portable bundle carries one studio&rsquo;s records and the exact
            original media. Restoring creates a new studio in this installation;
            nothing here is overwritten.
          </p>
        </div>
      </div>
      <div className="card stack restore-panel">
        {!canRestore ? (
          <p className="notice calm">
            Restoring a bundle is an installation-owner action. Open this Studio
            directly at <code>/studio</code> and sign in with its owner
            passphrase. An App Composer session cannot restore an
            installation-wide project.
          </p>
        ) : (
          <>
            <p className="small restore-panel-intro">
              Choose the <code>.studio</code> file you exported. Studio reads it
              in this browser, checks its hashes and shows you a preview before
              anything is written. A retry resumes the same restore instead of
              duplicating it.
            </p>
            <div className="restore-choose">
              <label htmlFor={fileId}>
                Studio bundle file
                <input
                  ref={fileInput}
                  id={fileId}
                  type="file"
                  accept=".studio,application/octet-stream"
                  disabled={busy}
                  onChange={(event) => void choose(event)}
                  aria-describedby={hintId}
                />
              </label>
            </div>
            <p className="small" id={hintId}>
              Up to 200 assets and 512 MB of media per bundle. A metadata-only
              JSON export cannot be restored because it carries no media bytes.
            </p>
            {file && (
              <p className="small restore-file">
                Chosen: <span className="restore-file-name">{file.name}</span> · {formatBytes(file.size)}
              </p>
            )}

            {preview && preview.plan && (
              <div className="restore-preview">
                <p className="eyebrow">Preview</p>
                <h3 className="restore-project">
                  {preview.project?.name ?? bundle?.manifest.project.name ?? "This studio"}
                </h3>
                <p className="small restore-project-meta">
                  {preview.status === "resume_staging"
                    ? "An earlier attempt at this bundle is unfinished here."
                    : preview.importStatus === "failed"
                      ? "An earlier attempt here was cleaned up; this starts a clean restore."
                      : "Would be restored as a new, separate studio in this installation."}{" "}
                  Bundle <code>{String(preview.bundleId ?? "").slice(0, 12)}…</code>
                </p>
                <dl className="restore-facts">
                  {planFacts(preview.plan, bundle).map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>
                        {fact.value}
                        {fact.note && <small>{fact.note}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {preview.duplicateContent && preview.duplicateContent.length > 0 && (
                  <p className="small">
                    {preview.duplicateContent.length}{" "}
                    {preview.duplicateContent.length === 1 ? "group of assets shares" : "groups of assets share"}{" "}
                    identical bytes and {preview.duplicateContent.length === 1 ? "is" : "are"} stored once.
                  </p>
                )}
                {preview.existingContent && preview.existingContent.length > 0 && (
                  <p className="small">
                    Some of this media already exists elsewhere in this studio.
                    The restore still writes its own copies so the restored
                    studio works independently.
                  </p>
                )}
                {preview.conflicts && preview.conflicts.length > 0 && (
                  <ul className="restore-conflicts">
                    {preview.conflicts.map((conflict) => (
                      <li key={`${conflict.code}-${conflict.projectId ?? ""}`}>{conflict.message}</li>
                    ))}
                  </ul>
                )}
                {preview.warnings && preview.warnings.length > 0 && (
                  <details className="restore-warnings">
                    <summary>What restore does not bring back</summary>
                    <ul>
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {showMeter && (
              <div className="restore-meter">
                <progress
                  max={Math.max(progress.total, 1)}
                  value={progress.done}
                  aria-label="Restore progress"
                  aria-valuetext={`${progress.done} of ${progress.total} files staged`}
                >
                  {progress.done} of {progress.total} files staged
                </progress>
                <p className="small">
                  {progress.done} of {progress.total} files staged · {formatBytes(progress.bytesDone)} of{" "}
                  {formatBytes(progress.bytesTotal)} verified on this studio
                </p>
              </div>
            )}

            <p className="restore-status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
              {status}
            </p>

            {problem && (
              <div className="notice warn restore-problem">
                <h3 ref={alertHeading} tabIndex={-1} role="alert">
                  {problem.title}
                </h3>
                <p>{problem.detail}</p>
                {problem.action && <p className="small">{problem.action}</p>}
              </div>
            )}

            {restored && (
              <div className="notice calm restore-done">
                <h3 ref={successHeading} tabIndex={-1}>
                  {restored.already ? "Already in this studio" : "Restored into this studio"}
                </h3>
                <p>
                  {restored.already
                    ? `“${restored.name ?? "This studio"}” was already restored here, so nothing was written again.`
                    : commitSentence(restored.counts, restored.name)}
                </p>
                <p className="small">
                  It is private. Its publications, if any, arrived withdrawn and
                  hidden, and no provider job was replayed or charged.
                </p>
                <a className="button secondary" href={`#/p/${encodeURIComponent(restored.projectId)}/library`}>
                  Open the restored studio →
                </a>
              </div>
            )}

            <div className="restore-actions">
              {busy && (
                <button type="button" className="secondary" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              )}
              {canStart && (
                <button type="button" className="button" onClick={() => void start()}>
                  {decision === "resume" ? "Continue restore" : "Restore into this studio"}
                </button>
              )}
              {retryable && !busy && (
                <button type="button" className="button" onClick={() => void retry()}>
                  Retry restore
                </button>
              )}
              {importId && !busy && !restored && (
                <button type="button" className="quiet" onClick={() => void removeStaged()} disabled={removing}>
                  {removing ? "Removing staged files…" : "Remove staged files"}
                </button>
              )}
              {(restored || problem) && !busy && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    reset();
                    fileInput.current?.focus();
                  }}
                >
                  Choose another bundle
                </button>
              )}
            </div>
            <p className="small restore-privacy">
              Private by default: the restored studio is private, its pages are
              unlisted and withdrawn, and no key, session or signed URL travels
              inside a bundle.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
