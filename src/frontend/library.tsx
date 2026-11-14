import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { useEffect, useState } from "react";
import type { AssembleProps, CreateProps, HistoryProps, LibraryProps, MediaAssetV1, PublishProps, SettingsProps, ViewerProps } from "./contracts";
import { CreateWorkbench } from "./create";
import { Assemble, Settings } from "./assemble-settings";
import { History, Publish } from "./history-publish";
import { isLocalRenderProvenance } from "../../public/asset-caption.js";
import "./library.css";

const bytesLabel = (bytes: number) => !bytes ? "—" : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const dateLabel = (timestamp: string | number) => timestamp ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp)) : "";
const extension = (mime: string) => mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

function AssetCard({ asset, comparing, selected, full }: { asset: MediaAssetV1; comparing: boolean; selected: boolean; full: boolean }) {
  return <article className="asset">
    <button type="button" className="thumb" data-action="open-asset" data-id={asset.id} aria-label={`Open ${asset.title}`}>
      {asset.kind === "video" ? <video src={asset.file} preload="metadata" muted playsInline aria-label={asset.title} /> : asset.kind === "audio" ? <span className="audio-card"><canvas width="240" height="64" data-waveform={asset.file} aria-hidden="true"/><span className="audio-time">{asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : "audio"}</span></span> : <img src={asset.file} alt={asset.title} loading="lazy" decoding="async"/>}
      <span className="badge">{asset.kind}</span>
    </button>
    <div className="meta"><strong title={asset.title}>{asset.title}</strong><small>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}{bytesLabel(asset.bytes)} · {asset.source}</small></div>
    {comparing && asset.kind === "image" && <button type="button" className="secondary compare-select" data-action="compare-toggle" data-id={asset.id} aria-pressed={selected} aria-label={`${selected ? "Remove" : "Select"} ${asset.title} ${selected ? "from" : "for"} comparison`} disabled={full && !selected}>{selected ? "Selected" : "Compare"}</button>}
    <button type="button" data-action="open-asset" data-id={asset.id}>Open</button>
  </article>;
}

function Library({ projectId, assets, query, filter, canImportShare, comparing, compareIds }: LibraryProps) {
  const selected = compareIds.map(id => assets.find(asset => asset.id === id && asset.kind === "image")).filter((asset): asset is MediaAssetV1 => Boolean(asset));
  const trimmed = query.trim().toLowerCase();
  const visible = assets.filter(asset => (filter === "all" || asset.kind === filter) && (!trimmed || `${asset.title} ${asset.caption} ${asset.mime} ${asset.source}`.toLowerCase().includes(trimmed)));
  return <div className="library-workspace">
    <div className="spread library-controls"><div className="row">
      <label className="sr-only" htmlFor="search">Search media</label>
      <input id="search" type="search" placeholder="Search titles, captions, types…" defaultValue={query} data-input="search" />
      <div className="row" role="group" aria-label="Filter">{(["all", "image", "video", "audio"] as const).map(value => <button key={value} type="button" className="quiet" data-action="filter" data-filter={value} aria-pressed={filter === value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    </div><div className="row"><button type="button" className="secondary" data-action="compare-mode" aria-pressed={comparing}>{comparing ? "Close comparison" : "Compare stills"}</button><label className="button secondary library-upload" htmlFor="upload">Upload media<input id="upload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" hidden data-input="upload" /></label></div></div>
    {comparing && <section className="compare-panel" aria-labelledby="compare-title">
      <div className="spread"><div><h2 id="compare-title">Compare stills</h2><p className="small">Choose two images from this studio to review them side by side. Your originals stay unchanged.</p></div><button type="button" className="quiet" data-action="compare-clear" disabled={selected.length === 0}>Clear selection</button></div>
      <p className="sr-only" role="status">{selected.length} of 2 images selected</p>
      <div className="compare-grid">{[0, 1].map(index => { const asset = selected[index]; return asset ? <figure className="compare-frame" key={asset.id}><img src={asset.file} alt={asset.title}/><figcaption><div><strong>{asset.title}</strong><span className="small">{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ""}{asset.source}</span></div><div className="row"><button type="button" className="secondary" data-action="open-asset" data-id={asset.id}>Open</button><button type="button" className="quiet" data-action="compare-toggle" data-id={asset.id} aria-label={`Remove ${asset.title} from comparison`}>Remove</button></div></figcaption></figure> : <div className="compare-empty" key={`empty-${index}`}><strong>{index === 0 ? "Choose the first still" : "Choose another still"}</strong><span>Use Compare on an image below.</span></div>; })}</div>
    </section>}
    {assets.length === 0 && <div className="card"><h2>Nothing here yet.</h2><p>Upload a photo or a clip to start the library. You can generate new stills once uploads work.</p><button type="button" className="button" data-action="tab" data-tab="create">Make the first image</button></div>}
    {assets.length > 0 && visible.length === 0 && <p className="notice">No media matches that search or filter. <button type="button" className="quiet" data-action="clear-library">Clear search and filters</button></p>}
    <div className="asset-grid">{visible.map(asset => <AssetCard key={asset.id} asset={asset} comparing={comparing} selected={compareIds.includes(asset.id)} full={compareIds.length >= 2}/>)}</div>
    {canImportShare && <details className="share-import" data-project-id={projectId}><summary>Import from Woodhouse Share</summary><form className="stack" data-form="woodhouse-import"><p className="small">Find the asset ID in <a href="/portfolio" target="_blank" rel="noopener noreferrer">Share artwork</a>. The original and source credit are saved to this project.</p><label>Share asset ID <input name="assetId" required maxLength={128} pattern="[a-z0-9][a-z0-9\-]{0,127}" /></label><label><span><input name="reuseConfirmed" type="checkbox" required /> I have permission to reuse this original.</span></label><div><button className="button secondary" type="submit">Import original</button></div></form></details>}
    <div className="dropzone library-dropzone" id="dropzone"><p><strong>Drop files here</strong> or use Upload media.</p><p className="small">JPEG, PNG, WebP, MP4, WebM, WAV, MP3 or M4A. Images and audio up to 32 MB, video up to 64 MB.</p></div>
  </div>;
}

type RenderReceipt = {
  storyboard: { id: string; updatedAt: number };
  shots: { assetId: string; sha256: string; startMs: number; endMs: number }[];
  totalMs: number;
  soundtrack: { assetId: string; sha256: string } | null;
  tracks: { assetId: string; sha256: string; role: string; startMs: number; trimStartMs: number; trimEndMs: number; gainDb: number; fadeInMs: number; fadeOutMs: number }[];
  captions: { planId: string; revision: number; songAssetId: string; songSha256: string } | null;
  framing: { aspect: string; fit: string };
  output: { sha256: string };
};

function PrivateRenderReceipt({ assetId, reentryUrl }: { assetId: string; reentryUrl: string }) {
  const [receipt, setReceipt] = useState<RenderReceipt | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'signed-out' | 'error'>('idle');
  async function load() {
    if (state === 'loading' || state === 'ready' || state === 'missing') return;
    setState('loading');
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/local-render-receipt`, { credentials: 'same-origin' });
      if (response.status === 401) { setState('signed-out'); return; }
      if (response.status === 404) { setState('missing'); return; }
      const data = await response.json();
      if (!response.ok || !data.receipt) throw new Error('Receipt unavailable');
      setReceipt(data.receipt); setState('ready');
    } catch { setState('error'); }
  }
  return <details className="asset-technical" onToggle={event => { if (event.currentTarget.open) void load(); }}><summary>Private render receipt</summary>
    {state === 'loading' && <p role="status">Loading receipt…</p>}
    {state === 'signed-out' && <p role="alert">Your Studio session has ended. <a href={reentryUrl}>{reentryUrl === "/studio" ? "Sign in to Studio" : "Continue with App Composer"}</a> to view this receipt.</p>}
    {state === 'missing' && <p>No private render receipt is recorded for this asset.</p>}
    {state === 'error' && <p role="alert">The receipt could not be loaded. <button type="button" className="quiet" onClick={() => void load()}>Try again</button></p>}
    {receipt && <><p>The server recorded the saved storyboard and source hashes. Framing, captions and rendering were reported by the browser; the server did not verify the rendered pixels.</p>
      <dl className="kv"><dt>Storyboard</dt><dd>{receipt.storyboard.id} · version {receipt.storyboard.updatedAt}</dd><dt>Frame</dt><dd>{receipt.framing.aspect} · {receipt.framing.fit === 'cover' ? 'centre crop' : 'show whole shot'}</dd><dt>Duration</dt><dd>{(receipt.totalMs / 1000).toFixed(1)}s</dd><dt>Output SHA-256</dt><dd>{receipt.output.sha256}</dd></dl>
      <p><strong>Shots and saved source hashes</strong></p><ol>{receipt.shots.map((shot, i) => <li key={i}>{shot.assetId} · {shot.startMs}–{shot.endMs} ms<br/>SHA-256 {shot.sha256}</li>)}</ol>
      {receipt.soundtrack && <p>Mixed soundtrack: {receipt.soundtrack.assetId}<br/>SHA-256 {receipt.soundtrack.sha256}</p>}
      {receipt.tracks.length > 0 && <><p><strong>Soundtrack sources</strong></p><ul>{receipt.tracks.map((track, i) => <li key={i}>{track.role}: {track.assetId} · {track.trimStartMs}–{track.trimEndMs} ms · starts {track.startMs} ms · gain {track.gainDb} dB · fades {track.fadeInMs}/{track.fadeOutMs} ms<br/>SHA-256 {track.sha256}</li>)}</ul></>}
      {receipt.captions && <p>Saved captions: plan {receipt.captions.planId}, revision {receipt.captions.revision}; song {receipt.captions.songAssetId}<br/>SHA-256 {receipt.captions.songSha256}</p>}
    </>}
  </details>;
}

type FootageReceipt = { plan: { id: string; revision: number }; source: { assetId: string; sha256: string; startMs: number; endMs: number }; framing: { aspect: string; fit: string; quality: string; width: number; height: number }; output: { sha256: string } };
function PrivateFootageReceipt({ assetId }: { assetId: string }) {
  const [receipt, setReceipt] = useState<FootageReceipt | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/assets/${encodeURIComponent(assetId)}/footage-export-receipt`, {credentials:'same-origin',signal:controller.signal}).then(response => response.ok ? response.json() : null).then(data => { if (data?.receipt) setReceipt(data.receipt); }).catch(() => {}); return () => controller.abort(); }, [assetId]);
  if (!receipt) return null;
  return <details className="asset-technical"><summary>Private source receipt</summary><p>The server checked the saved source and cut-map revision. The browser reported the render; the server did not verify its pixels.</p><dl className="kv"><dt>Cut map</dt><dd>{receipt.plan.id} · revision {receipt.plan.revision}</dd><dt>Source</dt><dd>{receipt.source.assetId} · {receipt.source.startMs}–{receipt.source.endMs} ms</dd><dt>Source SHA-256</dt><dd>{receipt.source.sha256}</dd><dt>Frame</dt><dd>{receipt.framing.width} × {receipt.framing.height} · {receipt.framing.fit}</dd><dt>Output SHA-256</dt><dd>{receipt.output.sha256}</dd></dl></details>;
}

function AssetVideo({ asset, reentryUrl }: { asset: MediaAssetV1; reentryUrl: string }) {
  const [error, setError] = useState<'signed-out' | 'unavailable' | null>(null);
  async function reportError() {
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      const session = await response.json();
      setError(session.signedIn === false ? 'signed-out' : 'unavailable');
    } catch { setError('unavailable'); }
  }
  return <><video src={asset.file} controls playsInline preload="metadata" onError={() => void reportError()}/>{error === 'signed-out' && <p className="notice" role="alert">Your Studio session has ended. <a href={reentryUrl}>{reentryUrl === "/studio" ? "Sign in to Studio" : "Continue with App Composer"}</a> to play this video.</p>}{error === 'unavailable' && <p className="notice" role="alert">This video could not be played. Check your connection and try again.</p>}</>;
}

function AssetViewer({ projectId, asset, still, launchKitUrl, reentryUrl }: ViewerProps) {
  const back = `#/p/${encodeURIComponent(projectId)}/library`;
  if (!asset) return <p className="notice">That asset is no longer in the library. <a data-viewer-back href={back}>Back to the library</a>.</p>;
  const isVideo = asset.kind === "video", isAudio = asset.kind === "audio";
  const localRender = isLocalRenderProvenance(asset.caption);
  return <div className="asset-viewer">
    <p><a className="button secondary" data-viewer-back href={back}>← Back to library</a></p>
    <div className="viewer">
      <div className="stage">{isVideo ? <AssetVideo key={asset.id} asset={asset} reentryUrl={reentryUrl}/> : isAudio ? <div className="audio-stage"><canvas width="840" height="200" data-waveform={asset.file} aria-hidden="true"/><audio src={asset.file} controls preload="metadata"/></div> : <img src={asset.file} alt={asset.title}/>}</div>
      <aside className="card stack"><div><p className="eyebrow">{asset.kind} · {asset.source}</p><h1 className="asset-viewer-title">{asset.title}</h1></div>
        {localRender ? <p>MP4 rendered on this device from a saved storyboard{asset.caption?.includes('; owner-confirmed captions') ? ', with saved captions' : ''}.</p> : asset.caption && <p>{asset.caption}</p>}
        <dl className="kv"><dt>Size</dt><dd>{bytesLabel(asset.bytes)}</dd>{Boolean(asset.width) && <><dt>Frame</dt><dd>{asset.width} × {asset.height}</dd></>}{Boolean(asset.durationMs) && <><dt>Duration</dt><dd>{(asset.durationMs! / 1000).toFixed(1)}s</dd></>}{isAudio && Boolean(asset.sampleRate) && <><dt>Audio</dt><dd>{asset.sampleRate} Hz · {asset.channels ?? "—"} channel{asset.channels === 1 ? "" : "s"}</dd></>}<dt>Type</dt><dd>{asset.mime}</dd><dt>Added</dt><dd>{dateLabel(asset.createdAt)}</dd></dl>
        {asset.hasLocalRenderReceipt && <PrivateRenderReceipt key={asset.id} assetId={asset.id} reentryUrl={reentryUrl}/>}
        {isVideo && <PrivateFootageReceipt key={asset.id} assetId={asset.id}/>}
        <details className="asset-technical"><summary>Technical details</summary><dl className="kv"><dt>SHA-256</dt><dd>{asset.sha256}</dd></dl>{localRender && <p>{asset.caption}</p>}</details>
        <div className="row"><a className="button secondary" href={asset.download} download>Download</a><button type="button" className="secondary" data-action="rename-asset" data-id={asset.id}>Rename</button>{still && <button type="button" className="secondary" data-action="vary-asset" data-id={still.id}>{isVideo ? "Make a variation of its still" : "Make a variation"}</button>}</div>
        <div className="row"><button type="button" className="secondary" data-action="animate-asset" data-id={asset.id} disabled={asset.kind !== "image"}>Animate this still</button><button type="button" className="secondary" data-action="publish-asset" data-id={asset.id}>Publish page</button></div>
        {asset.kind === "image" && <div className="row"><button type="button" className="secondary" data-action="edit-asset" data-mode="fill" data-id={asset.id}>Masked fill / outpaint</button><button type="button" className="secondary" data-action="edit-asset" data-mode="cutout" data-id={asset.id}>Remove background</button><button type="button" className="secondary" data-action="edit-asset" data-mode="upscale" data-id={asset.id}>Upscale ×2</button></div>}
        {still ? <div className="stack launch-kit-source"><p className="eyebrow">Launch Kit source</p><div className="row"><a className="button secondary" href={still.download} download={`launch-kit-source-${still.id}.${extension(still.mime)}`}>{isVideo ? "Download poster for Launch Kit" : "Download for Launch Kit"}</a>{launchKitUrl && <a className="button secondary" href={launchKitUrl} target="_blank" rel="noopener noreferrer">Open Launch Kit</a>}</div><p className="small">{isVideo ? `1. Download the retained still${still.title ? ` “${still.title}”` : ""}. 2. Import that still into Launch Kit. The clip stays here; only the still becomes the source artwork.` : "1. Download the still. 2. Import it into Launch Kit as the source artwork. Finishing and export stay in Launch Kit."}{!launchKitUrl && " Open your own Launch Kit installation to import it."}</p></div> : <p className="notice asset-no-source">{isVideo ? "This clip has no retained poster or source still, so it cannot supply Launch Kit artwork or a variation reference. Choose a still in the library instead." : "This file type cannot be imported into Launch Kit or used as a variation reference. Upload a JPEG, PNG or WebP still."}{isVideo && <> <button type="button" className="quiet" data-action="choose-still">Choose a still</button></>}</p>}
        {isVideo && still && <p className="small">A variation uses “{still.title}”, the still, not this clip.</p>}
        <button type="button" className="quiet" data-action="delete-asset" data-id={asset.id}>Delete from library</button>
      </aside>
    </div>
  </div>;
}

let root: Root | undefined;
export function renderLibrary(container: HTMLElement, props: LibraryProps): void { root ??= createRoot(container); flushSync(() => root!.render(<Library {...props}/>)); }
export function renderViewer(container: HTMLElement, props: ViewerProps): void { root ??= createRoot(container); flushSync(() => root!.render(<AssetViewer {...props}/>)); }
export function renderCreate(container: HTMLElement, props: CreateProps): void { root ??= createRoot(container); flushSync(() => root!.render(<CreateWorkbench {...props}/>)); }
export function renderHistory(container: HTMLElement, props: HistoryProps): void { root ??= createRoot(container); flushSync(() => root!.render(<History {...props}/>)); }
export function renderPublish(container: HTMLElement, props: PublishProps): void { root ??= createRoot(container); flushSync(() => root!.render(<Publish {...props}/>)); }
export function renderAssemble(container: HTMLElement, props: AssembleProps): void { root ??= createRoot(container); flushSync(() => root!.render(<Assemble {...props}/>)); }
export function renderSettings(container: HTMLElement, props: SettingsProps): void { root ??= createRoot(container); flushSync(() => root!.render(<Settings {...props}/>)); }
export function unmountMedia(): void { if (root) { root.unmount(); root = undefined; } }
