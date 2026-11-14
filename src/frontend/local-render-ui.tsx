import { useEffect, useRef, useState } from 'react';
import type { CompositionV1, MediaAssetV1 } from './contracts';
import './local-render.css';
import { resolveCaptionSnapshot, type CaptionSnapshot } from './local-captions';

export function LocalRenderer({ projectId, composition, assets, canEdit, onAssetSaved }: { projectId: string; composition: CompositionV1; assets: MediaAssetV1[]; canEdit: boolean; onAssetSaved: (asset: MediaAssetV1) => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; caption: string; captioned: boolean } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'uncertain'>('idle');
  const [savedAssetId, setSavedAssetId] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const saveAttempt = useRef(false);
  useEffect(() => () => { controller.current?.abort(); if (preview.current) URL.revokeObjectURL(preview.current); }, []);
  const start = async () => {
    if (busy || controller.current) return;
    setError(''); setStatus('Checking this browser…'); setBusy(true);
    const task = new AbortController(); controller.current = task;
    let snapshot = structuredClone(composition), media = structuredClone(assets);
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
      const { renderLocalMp4 } = await import('./local-render');
      const blob = await renderLocalMp4(snapshot, media, task.signal, setStatus, captions);
      if (task.signal.aborted) return;
      if (preview.current) URL.revokeObjectURL(preview.current);
      const url = URL.createObjectURL(blob); preview.current = url; saveAttempt.current = false; setSaveState('idle'); setSavedAssetId('');
      const caption = `Browser MP4 from storyboard ${snapshot.id}, saved version ${snapshot.updatedAt ?? snapshot.createdAt}${captions ? `; owner-confirmed captions from song plan ${captions.planId} revision ${captions.revision}; source song SHA256 ${snapshot.originSongPlan?.songSha256}` : ''}; clips ${snapshot.shots.map(s => `${s.assetId}${s.trimStartMs !== undefined ? ` (${s.trimStartMs}–${s.trimEndMs}ms)` : ''}`).join(', ')}; soundtrack ${snapshot.audioAssetId ?? 'none'}.`;
      setResult({blob,url,caption,captioned:Boolean(captions)}); setStatus('MP4 ready to preview or download.');
    } catch (err) { if (task.signal.aborted) setStatus('Local render cancelled.'); else setError((err as Error).message || 'The local render failed.'); }
    finally { if (controller.current === task) controller.current = null; setBusy(false); }
  };
  const save = async () => {
    if (!result || saveState !== 'idle' || saveAttempt.current) return;
    saveAttempt.current = true;
    setSaveState('saving'); setError('');
    const form = new FormData();
    form.set('file', new File([result.blob], 'studio-local-render.mp4', { type: 'video/mp4' }));
    form.set('title', `Local render — ${composition.title}`.slice(0, 100)); form.set('caption', result.caption.slice(0,400));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: 'POST', credentials: 'same-origin', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.asset?.id) throw new Error(data?.error?.message ?? `Save could not be confirmed (${response.status}).`);
      onAssetSaved(data.asset); setSavedAssetId(data.asset.id); setSaveState('saved');
    } catch (err) { setError(`${(err as Error).message || 'Save could not be confirmed.'} Check the library before trying again; your download remains available.`); setSaveState('uncertain'); }
  };
  return <details className="local-render"><summary>Render MP4 on this device</summary>
    <p className="small">Uses the saved storyboard and WAV soundtrack mix on this device. No provider or generation charge. It uses H.264/AAC when your browser supports them, keeps other clip audio muted, and fits clips inside a small frame based on the first shot. Trim points select the nearest source frame at or before each 30 fps output frame; originals stay unchanged. AAC encoding can add a short tail. Maximum 6 clips, 60 seconds, 4K source frames and 128 MiB input.</p>
    <p className="small">Renderer: <a href="/third-party/mediabunny.txt">Mediabunny licence and source</a>. Keep this page open while rendering. The result uses this saved version; later edits are not included.</p>
    {composition.originSongPlan ? <label className="local-caption-option"><input type="checkbox" checked={includeCaptions} disabled={busy || saveState === 'saving'} onChange={event=>setIncludeCaptions(event.target.checked)} /> Burn in saved captions from the linked song plan</label> : <p className="small">Captions can be burned in when this storyboard was made from a saved song plan.</p>}
    {includeCaptions && <p className="small">Uses only saved, permission-confirmed captions from the exact linked plan revision. Timing follows 30 fps video frames; overlapping cues and text that cannot fit are refused. The encoded MP4 is both the preview and download. The saved plan and storyboard are frozen at the start; later edits are not included. Captions are not transcription or lip sync.</p>}
    <div className="row"><button type="button" className="secondary" onClick={() => void start()} disabled={busy || saveState === 'saving'}>Make local MP4</button>{busy && <button type="button" className="quiet" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    {status && <p role="status" className="small">{status}</p>}{error && <p role="alert" className="notice">{error}</p>}
    {result && <div className="local-render-result"><p className="small">{result.captioned ? 'This preview and download contain the saved captions.' : 'This preview and download do not contain captions.'}</p><video controls playsInline preload="metadata" src={result.url} aria-label={`Preview local render of ${composition.title}`} /><div className="row"><a className="button secondary" href={result.url} download="studio-local-render.mp4">Download MP4</a>{canEdit && saveState !== 'saved' && <button type="button" className="secondary" disabled={saveState !== 'idle' || busy} onClick={() => void save()}>{saveState === 'saving' ? 'Saving…' : 'Save to library'}</button>}{savedAssetId && <a href={`#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(savedAssetId)}`}>Open saved video</a>}</div></div>}
  </details>;
}
