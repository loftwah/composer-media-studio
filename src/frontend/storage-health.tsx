import { useState } from "react";

type KindTotals = { assets: number; bytes: number; originals: number; derivatives: number; unknown: number };
type DuplicateGroup = {
  sha256: string;
  bytes: number;
  mime: string;
  count: number;
  extraBytes: number;
  assets: { id: string; title: string | null; href: string }[];
};
type StorageReport = {
  format: string;
  readOnly: boolean;
  writes: number;
  generatedAt: number;
  totals: {
    liveAssets: number;
    liveBytes: number;
    originals: number;
    derivatives: number;
    unknownRole: number;
    protectedAssets: number;
    protectedBytes: number;
    publishedAssets: number;
    publishedBytes: number;
    missingObjects: number;
    missingBytes: number;
    danglingReferences: number;
    unknownLegacyRows: number;
    duplicateGroups: number;
    duplicateExtraAssets: number;
    duplicateWastedBytes: number;
    unreferencedObjects: number;
    unreferencedBytes: number;
    tombstonedAssets: number;
    tombstonedBytes: number;
    erasurePending: number;
  };
  byKind: Record<"image" | "video" | "audio", KindTotals>;
  duplicateContent: DuplicateGroup[];
  unknownLegacy: { assetId: string; title: string; reasons: string[]; deletedAt: number | null }[];
  missingReferencedObjects: { assetId: string; key: string | null; reason: string; bytes: number }[];
  coverage: { complete: boolean; note: string };
  cleanup: { status: string; note: string };
};

const bytesLabel = (bytes: number) => {
  if (!bytes) return "0 bytes";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const reasonLabel = (value: string) => value.replaceAll("_", " ");

function StorageHealthPanel({ projectId }: { projectId: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "forbidden" | "error">("idle");
  const [report, setReport] = useState<StorageReport | null>(null);
  const download = `/api/projects/${encodeURIComponent(projectId)}/storage-report?download=1`;

  async function load() {
    setPhase("loading");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/storage-report`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 403) { setPhase("forbidden"); return; }
      if (!response.ok) throw new Error("report unavailable");
      const data = (await response.json()) as StorageReport;
      if (!data || data.format !== "media-studio.storage-report/v1") throw new Error("unexpected report");
      setReport(data);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }

  const totals = report?.totals;
  const duplicateWaste = totals?.duplicateWastedBytes ?? 0;
  const liveLegacy = report?.unknownLegacy.filter((entry) => entry.deletedAt === null) ?? [];
  const statusLine = totals
    ? totals.missingObjects > 0
      ? `${totals.missingObjects} saved ${totals.missingObjects === 1 ? "file is" : "files are"} missing from storage`
      : totals.duplicateGroups > 0
        ? `${totals.duplicateGroups} duplicate ${totals.duplicateGroups === 1 ? "group" : "groups"} keep ${bytesLabel(duplicateWaste)} of extra copies`
        : totals.unknownLegacyRows > 0
          ? `${totals.unknownLegacyRows} ${totals.unknownLegacyRows === 1 ? "row has" : "rows have"} incomplete provenance`
          : "All checked files are present"
    : "Read-only storage report";

  return <details className="storage-health" onToggle={(event) => { if (event.currentTarget.open && phase === "idle") void load(); }}>
    <summary><span>Storage health</span><span className="small">{statusLine}</span></summary>
    <div className="storage-health-body">
      <div className="storage-health-head">
        <div>
          <h2>Saved storage in this project</h2>
          <p className="small">Counts saved records and checks the exact R2 objects. This view never deletes, moves, re-encodes or publishes anything.</p>
        </div>
        <a className="button secondary" href={download} download>Download JSON</a>
      </div>
      {phase === "loading" && <p role="status" className="small">Reading saved records and object metadata…</p>}
      {phase === "forbidden" && <p className="notice calm">Storage health is available to the studio owner or an admin grant. The library itself is unchanged.</p>}
      {phase === "error" && <p className="notice warn" role="alert">The storage report could not be read. <button type="button" className="quiet" onClick={() => void load()}>Try again</button></p>}
      {phase === "ready" && report && totals && <>
        <dl className="storage-figures">
          <div><dt>Live media</dt><dd>{bytesLabel(totals.liveBytes)}<small>{totals.liveAssets} saved {totals.liveAssets === 1 ? "file" : "files"}</small></dd></div>
          <div><dt>Protected</dt><dd>{bytesLabel(totals.protectedBytes)}<small>{totals.protectedAssets} used or published</small></dd></div>
          <div><dt>Published</dt><dd>{bytesLabel(totals.publishedBytes)}<small>{totals.publishedAssets} on a public page</small></dd></div>
          <div className={totals.missingObjects ? "storage-figure--warn" : ""}><dt>Missing</dt><dd>{totals.missingObjects}<small>{bytesLabel(totals.missingBytes)} recorded</small></dd></div>
          <div className={duplicateWaste ? "storage-figure--warn" : ""}><dt>Duplicate copies</dt><dd>{bytesLabel(duplicateWaste)}<small>{totals.duplicateGroups} exact {totals.duplicateGroups === 1 ? "group" : "groups"}</small></dd></div>
          <div className={totals.unknownLegacyRows ? "storage-figure--warn" : ""}><dt>Unknown provenance</dt><dd>{totals.unknownLegacyRows}<small>not labelled unused</small></dd></div>
        </dl>

        <div className="storage-kind-grid" aria-label="Storage by media kind">
          {(["image", "video", "audio"] as const).map((kind) => {
            const entry = report.byKind[kind] ?? { assets: 0, bytes: 0, originals: 0, derivatives: 0, unknown: 0 };
            return <div className="storage-kind" key={kind}>
              <strong>{kind[0].toUpperCase() + kind.slice(1)}</strong>
              <span>{bytesLabel(entry.bytes)}</span>
              <small>{entry.assets} {entry.assets === 1 ? "file" : "files"} · {entry.originals} original · {entry.derivatives} derived{entry.unknown ? ` · ${entry.unknown} unknown` : ""}</small>
            </div>;
          })}
        </div>

        {(totals.missingObjects > 0 || totals.danglingReferences > 0) && <div className="notice warn">
          <strong>Saved references need attention.</strong>{" "}
          {totals.missingObjects > 0 && `${totals.missingObjects} live ${totals.missingObjects === 1 ? "asset has" : "assets have"} no stored object. `}
          {totals.danglingReferences > 0 && `${totals.danglingReferences} ${totals.danglingReferences === 1 ? "saved record points" : "saved records point"} at a missing or deleted asset. `}
          Nothing was removed; inspect the JSON report for the exact IDs.
        </div>}

        {report.duplicateContent.length > 0 && <div className="storage-duplicates">
          <h3>Exact duplicate content</h3>
          <p className="small">Matched by SHA-256, byte size and MIME inside this project. A shared filename alone is not a duplicate.</p>
          <ul>{report.duplicateContent.slice(0, 5).map((group) => <li key={`${group.sha256}-${group.bytes}`}>
            <span>{group.count} copies · {bytesLabel(group.bytes)} each · {group.mime}</span>
            <span className="small">SHA-256 {group.sha256.slice(0, 12)}… · {bytesLabel(group.extraBytes)} extra</span>
          </li>)}</ul>
          {report.duplicateContent.length > 5 && <p className="small">Show the remaining {report.duplicateContent.length - 5} in the JSON report.</p>}
        </div>}

        {liveLegacy.length > 0 && <div className="storage-legacy">
          <h3>Incomplete provenance</h3>
          <p className="small">These saved rows are reported as unknown, not unused. A delete requires separate evidence and approval.</p>
          <ul>{liveLegacy.slice(0, 5).map((entry) => <li key={entry.assetId}>
            <span>{entry.title || entry.assetId}</span>
            <span className="small">{entry.reasons.map(reasonLabel).join(" · ")}</span>
          </li>)}</ul>
        </div>}

        {report.totals.tombstonedAssets > 0 && <p className="small">{report.totals.tombstonedAssets} deleted {report.totals.tombstonedAssets === 1 ? "record is" : "records are"} tombstoned{report.totals.erasurePending ? `, ${report.totals.erasurePending} with pending byte cleanup` : ""}. Tombstoned rows are outside live totals.</p>}
        <p className="small">{report.coverage.note} {report.cleanup.note}</p>
      </>}
    </div>
  </details>;
}

type AssetUse = {
  type: string;
  label: string;
  parentLabel: string | null;
  detail: string | null;
  href: string;
  available: boolean;
  active: boolean;
};
type Usage = {
  asset: {
    referenceState: "used" | "unused" | "unknown" | "tombstoned";
    published: boolean;
    protected: boolean;
    legacyReasons: string[];
  };
  uses: AssetUse[];
  notes: string[];
  coverage: { complete: boolean };
};

function AssetUses({ projectId, assetId }: { projectId: string; assetId: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "signed-out" | "error">("idle");
  const [usage, setUsage] = useState<Usage | null>(null);

  async function load() {
    setPhase("loading");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/uses`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 401) { setPhase("signed-out"); return; }
      if (!response.ok) throw new Error("usage unavailable");
      setUsage(await response.json());
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }

  return <details className="asset-technical asset-uses" onToggle={(event) => { if (event.currentTarget.open && phase === "idle") void load(); }}>
    <summary>Used in</summary>
    {phase === "loading" && <p role="status" className="small">Reading saved references…</p>}
    {phase === "signed-out" && <p className="notice">Your Studio session has ended. <a href="/studio">Sign in to Studio</a> to read this asset's saved references.</p>}
    {phase === "error" && <p className="notice warn" role="alert">Saved references could not be read. <button type="button" className="quiet" onClick={() => void load()}>Try again</button></p>}
    {phase === "ready" && usage && <>
      {usage.uses.length > 0
        ? <ul className="asset-use-list">{usage.uses.map((use, index) => <li key={`${use.type}-${use.href}-${index}`}>
            <a href={use.href}>{use.label}</a>
            {use.detail && <span>{use.detail}</span>}
            {use.parentLabel && <span className="small">{use.parentLabel}{use.available ? "" : " · source unavailable"}</span>}
          </li>)}</ul>
        : <p className="small">{usage.asset.referenceState === "unknown"
            ? "No saved reference was found, but this asset's saved provenance is incomplete. It is unknown, not unused."
            : "No saved reference was found in this project's saved records. This is not a claim that the bytes are safe to delete."}</p>}
      {usage.asset.legacyReasons.length > 0 && <p className="small">Incomplete provenance: {usage.asset.legacyReasons.map(reasonLabel).join(" · ")}.</p>}
      {usage.asset.published && <p className="small">A public page uses this saved version.</p>}
      <p className="small">{usage.notes.join(" ")}</p>
    </>}
  </details>;
}

export { StorageHealthPanel, AssetUses };
