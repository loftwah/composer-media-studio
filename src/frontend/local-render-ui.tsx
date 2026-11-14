import { useEffect, useRef, useState } from 'react';
import type { CompositionV1, MediaAssetV1 } from './contracts';
import './local-render.css';

export function LocalRenderer({ projectId, composition, assets, canEdit }: { projectId: string; composition: CompositionV1; assets: MediaAssetV1[]; canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; caption: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'uncertain'>('idle');
  const [savedAssetId, setSavedAssetId] = useState('');
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const saveAttempt = useRef(false);
  useEffect(() => () => { controller.current?.abort(); if (preview.current) URL.revokeObjectURL(preview.current); }, []);
  const start = async () => {
    if (busy || controller.current) return;
    setError(''); setStatus('Checking this browser…'); setBusy(true);
    const task = new AbortController(); controller.current = task;
    const snapshot = structuredClone(composition), media = structuredClone(assets);
    try {
      const { renderLocalMp4 } = await import('./local-render');
      const blob = await renderLocalMp4(snapshot, media, task.signal, setStatus);
      if (task.signal.aborted) return;
      if (preview.current) URL.revokeObjectURL(preview.current);
      const url = URL.createObjectURL(blob); preview.current = url; saveAttempt.current = false; setSaveState('idle'); setSavedAssetId('');
      const caption = `Browser MP4 from storyboard ${snapshot.id}, saved version ${snapshot.updatedAt ?? snapshot.createdAt}; clips ${snapshot.shots.map(s => s.assetId).join(', ')}; soundtrack ${snapshot.audioAssetId ?? 'none'}.`;
      setResult({blob,url,caption}); setStatus('MP4 ready to preview or download.');
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
      setSavedAssetId(data.asset.id); setSaveState('saved');
    } catch (err) { setError(`${(err as Error).message || 'Save could not be confirmed.'} Check the library before trying again; your download remains available.`); setSaveState('uncertain'); }
  };
  return <details className="local-render"><summary>Render MP4 on this device</summary>
    <p className="small">Uses the saved storyboard and WAV soundtrack mix on this device. No provider or generation charge. It uses H.264/AAC when your browser supports them, keeps other clip audio muted, and fits clips inside a small frame based on the first shot. Captions are separate; AAC encoding can add a short tail. Maximum 6 clips, 60 seconds, 4K source frames and 128 MiB input.</p>
    <p className="small">Renderer: <a href="/third-party/mediabunny.txt">Mediabunny licence and source</a>. Keep this page open while rendering. The result uses this saved version; later edits are not included.</p>
    <div className="row"><button type="button" className="secondary" onClick={() => void start()} disabled={busy || saveState === 'saving'}>Make local MP4</button>{busy && <button type="button" className="quiet" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    {status && <p role="status" className="small">{status}</p>}{error && <p role="alert" className="notice">{error}</p>}
    {result && <div className="local-render-result"><video controls playsInline preload="metadata" src={result.url} aria-label={`Preview local render of ${composition.title}`} /><div className="row"><a className="button secondary" href={result.url} download="studio-local-render.mp4">Download MP4</a>{canEdit && saveState !== 'saved' && <button type="button" className="secondary" disabled={saveState !== 'idle' || busy} onClick={() => void save()}>{saveState === 'saving' ? 'Saving…' : 'Save to library'}</button>}{savedAssetId && <a href={`#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(savedAssetId)}`}>Open saved video</a>}</div></div>}
  </details>;
}
