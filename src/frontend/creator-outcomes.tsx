import { useEffect, useRef, useState } from "react";

type Metric = { key: string; label: string; value: number | null; coverage: string };
type Report = {
  from: string;
  until: string;
  generatedAt: string;
  metrics: Metric[];
};
type Phase = "idle" | "loading" | "ready" | "signed-out" | "forbidden" | "error";
type Days = 7 | 30;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const captureFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const countFormat = new Intl.NumberFormat(undefined);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function parseReport(data: unknown, projectId: string): Report | null {
  if (!isRecord(data) || data.format !== "media-studio.creator-outcomes/v1" ||
    data.schemaVersion !== 1 || data.projectId !== projectId || !isTimestamp(data.generatedAt) ||
    !isRecord(data.window) || data.window.timezone !== "UTC" ||
    !isTimestamp(data.window.fromInclusive) || !isTimestamp(data.window.toExclusive) ||
    Date.parse(data.window.fromInclusive) >= Date.parse(data.window.toExclusive) ||
    !Array.isArray(data.metrics) || data.metrics.length !== 5) return null;
  const metrics: Metric[] = [];
  for (const metric of data.metrics) {
    if (!isRecord(metric) || typeof metric.key !== "string" || typeof metric.label !== "string" ||
      typeof metric.coverage !== "string") return null;
    const { key, label, value, coverage, status } = metric;
    if (!(status === "unavailable" && value === null) &&
      !(status === "partial" && typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return null;
    metrics.push({ key, label, value, coverage });
  }
  return { from: data.window.fromInclusive, until: data.window.toExclusive, generatedAt: data.generatedAt, metrics };
}

export function SavedOutcomes({ projectId }: { projectId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState<Days>(7);
  const active = useRef<AbortController | null>(null);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/creator-outcomes`;
  useEffect(() => () => active.current?.abort(), []);

  async function load(period: Days) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPhase("loading");
    try {
      const response = await fetch(`${endpoint}?days=${period}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) {
        setReport(null);
        setPhase(response.status === 401 ? "signed-out" : "forbidden");
        return;
      }
      if (!response.ok) throw new Error("Saved outcomes unavailable");
      const ready = parseReport(await response.json(), projectId);
      if (controller.signal.aborted) return;
      if (!ready) throw new Error("Unexpected saved outcomes report");
      setReport(ready);
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    } finally {
      active.current = null;
    }
  }

  function selectDays(period: Days) {
    if (period === days || active.current) return;
    setDays(period);
    void load(period);
  }

  // Pin the download to the window of the capture on screen, not to the
  // selected preset: a failed refresh for another period leaves that capture
  // (and its dates) visible, and the JSON must match it.
  const download = report
    ? `${endpoint}?download=1&from=${encodeURIComponent(report.from)}&until=${encodeURIComponent(report.until)}`
    : `${endpoint}?download=1`;

  const shownDays = report ? (Date.parse(report.until) - Date.parse(report.from)) / 86_400_000 : days;
  const summary = shownDays === days ? `Last ${days} complete UTC days` : `Showing ${shownDays} days`;

  return <details className="storage-health" onToggle={event => {
    if (event.currentTarget.open && phase === "idle") void load(days);
  }}>
    <summary><span>Saved outcomes</span><span className="small">{summary}</span></summary>
    <div className="storage-health-body">
      <div className="storage-health-head">
        <div>
          <h2>Saved outcomes in this project</h2>
          <p className="small">This private report counts recorded saves and publication changes. Exports kept only on this device are outside its coverage.</p>
        </div>
        {report && <a className="button secondary" href={download} download>Download outcomes JSON</a>}
      </div>
      {phase !== "signed-out" && phase !== "forbidden" && <div className="row" role="group" aria-label="Reporting period">
        <span className="small">Period</span>
        {([7, 30] as const).map(period =>
          <button key={period} type="button" className="quiet" aria-pressed={days === period}
            disabled={phase === "loading"} onClick={() => selectDays(period)}>
            {days === period ? <strong>{period} days</strong> : `${period} days`}
          </button>,
        )}
      </div>}
      {phase === "loading" && <p role="status">{report ? "Refreshing saved outcomes…" : "Reading saved outcomes…"}</p>}
      {phase === "signed-out" && <p role="alert"><a href="/studio">Sign in to Studio</a> to view saved outcomes.</p>}
      {phase === "forbidden" && <p role="alert">This session cannot view the project’s saved outcomes.</p>}
      {phase === "error" && <p role="alert">{report ? "Refresh failed. The figures below are from the previous capture." : "Saved outcomes are unavailable. Try again."}</p>}
      {report && <>
        <p className="small">{dateFormat.format(Date.parse(report.from))} through {dateFormat.format(Date.parse(report.until) - 1)} UTC · Captured {captureFormat.format(Date.parse(report.generatedAt))} UTC</p>
        <ul aria-label="Saved outcome aggregates">
          {report.metrics.map(metric => <li key={metric.key}>
            <strong>{metric.label}</strong> · {metric.value === null ? "Unavailable" : countFormat.format(metric.value)}
            <p className="small">{metric.coverage}</p>
          </li>)}
        </ul>
      </>}
      {(phase === "ready" || phase === "error") &&
        <button type="button" className="secondary" onClick={() => void load(days)}>{phase === "error" ? "Retry" : "Refresh saved outcomes"}</button>}
    </div>
  </details>;
}
