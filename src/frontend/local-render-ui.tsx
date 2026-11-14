import { useEffect, useRef, useState } from 'react';
import type { CompositionV1, MediaAssetV1 } from './contracts';
import './local-render.css';
import { resolveCaptionSnapshot, type CaptionSnapshot } from './local-captions';
import { defaultFraming, framingNote, resolveFrame, type FrameAspect, type FrameFit, type Framing } from './local-framing';

export function LocalRenderer({ projectId, composition, assets, canEdit, onAssetSaved }: { projectId: string; composition: CompositionV1; assets: MediaAssetV1[]; canEdit: boolean; onAssetSaved: (asset: MediaAssetV1) => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; caption: string; captioned: boolean; framing: string; receiptId: string | null } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'uncertain'>('idle');
  const [savedAssetId, setSavedAssetId] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(false);
  const [framing, setFraming] = useState<Framing>(defaultFraming);
  const [expanded, setExpanded] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [readyPreviewKey, setReadyPreviewKey] = useState('');
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const saveAttempt = useRef(false);
  useEffect(() => () => { controller.current?.abort(); if (preview.current) URL.revokeObjectURL(preview.current); }, []);
  const start = async () => {
    if (busy || controller.current) return;
    setError(''); setStatus('Checking this browser…'); setBusy(true);
    const task = new AbortController(); controller.current = task;
    let snapshot = structuredClone(composition), media = structuredClone(assets);
    const chosenFraming = { ...framing };
    try {
      let captions: CaptionSnapshot | undefined;
      if (includeCaptions) {
        setStatus('Checking the saved storyboard and song plan…');
        const base=`/api/projects/${encodeURIComponent(projectId)}`;
        const [projectResponse, plansResponse]=await Promise.all([
          fetch(base,{ credentials:'same-origin', signal:task.signal }),
          fetch(`${base}/song-plans`,{ credentials:'same-origin', signal:task.signal }),
        ]);
        if (!projectResponse.ok || !plansResponse.ok) throw new Error('Could not check the saved storyboard and song plan. Try again.');
        const projectData=await projectResponse.json(), planData=await plansResponse.json();
        const current: CompositionV1 | undefined=projectData.compositions?.find((item: CompositionV1)=>item.id===snapshot.id);
        const renderIdentity=(item: CompositionV1) => JSON.stringify({id:item.id,updatedAt:item.updatedAt,shots:item.shots,totalMs:item.totalMs,audioAssetId:item.audioAssetId,audioTracks:item.audioTracks,originSongPlan:item.originSongPlan});
        if (!current || renderIdentity(current)!==renderIdentity(snapshot) || !Array.isArray(projectData.assets) || !Array.isArray(planData.plans)) throw new Error('The saved storyboard changed. Reload it before using captions.');
        snapshot=structuredClone(current); media=structuredClone(projectData.assets);
        captions=resolveCaptionSnapshot(snapshot,media,planData.plans.find((item: {id:string})=>item.id===snapshot.originSongPlan?.id));
      }
      let receiptId: string | null = null;
      if (canEdit) {
        setStatus('Recording the saved storyboard snapshot…');
        const receiptResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/compositions/${encodeURIComponent(snapshot.id)}/local-render-receipts`, {
          method: 'POST', credentials: 'same-origin', signal: task.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt: snapshot.updatedAt, includeCaptions: Boolean(captions), framing: chosenFraming }),
        });
        const receiptData = await receiptResponse.json().catch(() => ({}));
        if (!receiptResponse.ok || typeof receiptData.receipt?.id !== 'string') throw new Error(receiptData.error?.message || 'Could not record this saved storyboard. Reload it and try again.');
        receiptId = receiptData.receipt.id;
      }
      const first = media.find(asset => asset.id === snapshot.shots[0]?.assetId);
      if (!first) throw new Error('The first clip is no longer available.');
      const frame = resolveFrame(chosenFraming, first);
      const { renderLocalMp4 } = await import('./local-render');
      const blob = await renderLocalMp4(snapshot, media, task.signal, setStatus, captions, chosenFraming);
      if (task.signal.aborted) return;
      if (preview.current) URL.revokeObjectURL(preview.current);
      const url = URL.createObjectURL(blob); preview.current = url; saveAttempt.current = false; setSaveState('idle'); setSavedAssetId('');
      const frameDescription = framingNote(frame);
      const caption = `Browser MP4 from saved storyboard; ${frameDescription}${captions ? '; owner-confirmed captions' : ''}. ${receiptId ? 'Source evidence is in the private render receipt.' : 'No private render receipt was created.'}`;
      setResult({blob,url,caption,captioned:Boolean(captions),framing:frameDescription,receiptId}); setStatus('MP4 ready to preview or download.');
    } catch (err) { if (task.signal.aborted) setStatus('Local render cancelled.'); else setError((err as Error).message || 'The local render failed.'); }
    finally { if (controller.current === task) controller.current = null; setBusy(false); }
  };
  const save = async () => {
    if (!result || saveState !== 'idle' || saveAttempt.current) return;
    saveAttempt.current = true;
    setSaveState('saving'); setError('');
    const form = new FormData();
    form.set('file', new File([result.blob], 'studio-local-render.mp4', { type: 'video/mp4' }));
    form.set('title', `Local render — ${composition.title}`.slice(0, 100)); form.set('caption', result.caption); if (result.receiptId) form.set('localRenderReceiptId', result.receiptId);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: 'POST', credentials: 'same-origin', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.asset?.id) throw new Error(data?.error?.message ?? `Save could not be confirmed (${response.status}).`);
      onAssetSaved(data.asset); setSavedAssetId(data.asset.id); setSaveState('saved');
    } catch (err) { setError(`${(err as Error).message || 'Save could not be confirmed.'} Check the library before trying again; your download remains available.`); setSaveState('uncertain'); }
  };
  const firstAsset = assets.find(asset => asset.id === composition.shots[0]?.assetId);
  const selectedShot = composition.shots[previewIndex] ?? composition.shots[0];
  const selectedAsset = assets.find(asset => asset.id === selectedShot?.assetId && asset.kind === 'video');
  const previewKey = `${composition.id}:${composition.updatedAt}:${selectedShot?.assetId}:${selectedShot?.trimStartMs ?? 0}`;
  const sourcePreviewReady = readyPreviewKey === previewKey;
  let frame: ReturnType<typeof resolveFrame> | null = null;
  try { if (firstAsset) frame = resolveFrame(framing, firstAsset); } catch { /* renderer reports missing dimensions */ }
  const resetSourcePreview = () => { setReadyPreviewKey(''); setSourcePreviewError(false); };
  return <details className="local-render" onToggle={event => setExpanded(event.currentTarget.open)}><summary>Render MP4 on this device</summary>
    <p className="small">Uses the saved storyboard and WAV soundtrack mix on this device. No provider or generation charge. It uses H.264/AAC when your browser supports them and keeps other clip audio muted. Trim points select the nearest source frame at or before each 30 fps output frame; originals stay unchanged. AAC encoding can add a short tail. Maximum 6 clips, 60 seconds, 4K source frames and 128 MiB input.</p>
    <div className="local-framing"><div className="local-framing-fields"><label>Output frame<select value={framing.aspect} disabled={busy} onChange={event => setFraming(current => ({ ...current, aspect: event.target.value as FrameAspect }))}><option value="source">First shot orientation (default)</option><option value="16:9">Landscape 16:9</option><option value="9:16">Portrait 9:16</option><option value="1:1">Square 1:1</option></select></label><label>Fit inside frame<select value={framing.fit} disabled={busy} onChange={event => setFraming(current => ({ ...current, fit: event.target.value as FrameFit }))}><option value="contain">Show whole shot (may add bars)</option><option value="cover">Fill frame (centre crops edges)</option></select></label><label>Shot to inspect<select value={Math.min(previewIndex, Math.max(0, composition.shots.length - 1))} disabled={busy} onChange={event => { setPreviewIndex(Number(event.target.value)); resetSourcePreview(); }}>{composition.shots.map((shot, index) => <option key={`${shot.assetId}-${index}`} value={index}>Shot {index + 1}: {assets.find(asset => asset.id === shot.assetId)?.title ?? 'Unavailable clip'}</option>)}</select></label></div>
      <p className="small">{framing.fit === 'cover' ? 'Fill removes edges where a shot has a different shape. Check each shot before rendering.' : 'Show whole shot keeps every edge; bars can appear where the shapes differ.'} This source preview starts at the saved in-point; playback can continue beyond the selected end. Captions are added only to the final MP4.</p>
      {expanded && frame && selectedAsset ? <div className="local-framing-preview" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}><video key={`${selectedAsset.id}-${selectedShot?.trimStartMs ?? 0}`} src={selectedAsset.file} controls muted playsInline preload="metadata" aria-label={`Framing preview for shot ${previewIndex + 1}: ${selectedAsset.title}`} style={{ objectFit: framing.fit }} onLoadedMetadata={event => { const start = (selectedShot?.trimStartMs ?? 0) / 1000; if (start > 0) event.currentTarget.currentTime = start; }} onLoadedData={() => { if (!(selectedShot?.trimStartMs ?? 0)) setReadyPreviewKey(previewKey); }} onSeeked={() => setReadyPreviewKey(previewKey)} onError={() => { setReadyPreviewKey(''); setSourcePreviewError(true); }}/></div> : <p className="small">A source preview is unavailable. Check the saved clips.</p>}
      {expanded && !sourcePreviewReady && !sourcePreviewError && frame && selectedAsset && <p role="status" className="small">Loading source preview…</p>}
      {expanded && sourcePreviewError && <p className="notice">The source preview could not be loaded. Check the clip before choosing a crop.</p>}
    </div>
    <p className="small">Renderer: <a href="/third-party/mediabunny.txt">Mediabunny licence and source</a>. Keep this page open while rendering. The result uses this saved version; later edits are not included.</p>
    {composition.originSongPlan ? <label className="local-caption-option"><input type="checkbox" checked={includeCaptions} disabled={busy || saveState === 'saving'} onChange={event=>setIncludeCaptions(event.target.checked)} /> Burn in saved captions from the linked song plan</label> : <p className="small">Captions can be burned in when this storyboard was made from a saved song plan.</p>}
    {includeCaptions && <p className="small">Uses only saved, permission-confirmed captions from the exact linked plan revision. Timing follows 30 fps video frames; overlapping cues and text that cannot fit are refused. The encoded MP4 is both the preview and download. The saved plan and storyboard are frozen at the start; later edits are not included. Captions are not transcription or lip sync.</p>}
    <div className="row"><button type="button" className="secondary" onClick={() => void start()} disabled={busy || saveState === 'saving' || (framing.fit === 'cover' && !sourcePreviewReady)}>Make local MP4</button>{busy && <button type="button" className="quiet" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    {status && <p role="status" className="small">{status}</p>}{error && <p role="alert" className="notice">{error}</p>}
    {result && <div className="local-render-result"><p className="small">{result.framing}. {result.captioned ? 'This preview and download contain the saved captions.' : 'This preview and download do not contain captions.'} Changed framing settings apply to the next render.</p><video controls playsInline preload="metadata" src={result.url} aria-label={`Preview local render of ${composition.title}`} /><div className="row"><a className="button secondary" href={result.url} download="studio-local-render.mp4">Download MP4</a>{canEdit && saveState !== 'saved' && <button type="button" className="secondary" disabled={saveState !== 'idle' || busy} onClick={() => void save()}>{saveState === 'saving' ? 'Saving…' : 'Save to library'}</button>}{savedAssetId && <a href={`#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(savedAssetId)}`}>Open saved video</a>}</div></div>}
  </details>;
}
