import { useEffect, useRef, useState } from 'react';
import type { MediaAssetV1 } from './contracts';
import { TakeRangePreview } from './song-plans';
import { FootageSceneExport } from './footage-scene-export';
import './song-plans.css';
import './footage-plans.css';

type Scene = { id: string; sourceStartMs: number; sourceEndMs: number; direction: string; referenceAssetId: string | null; selectedTakeId: string | null };
type Plan = { id: string; sourceAssetId: string; sourceSha256: string; rightsConfirmed: boolean; revision: number; title: string; treatment: string; aspect: string; scenes: Scene[]; totalMs: number };
type CachedDraft = { saved: Plan | null; draft: Plan | null };
const cache = new Map<string, CachedDraft>();
const copy = <T,>(value: T): T => structuredClone(value);
const seconds = (ms: number) => String(ms / 1000);
const milliseconds = (value: string) => Math.round(Number(value) * 1000);
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data?.error?.message ?? `Request failed (${response.status})`) as Error & { status: number }; error.status = response.status; throw error; }
  return data;
}
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  return <label>{label} <span className="small">seconds</span><input type="number" min="0" step="0.001" defaultValue={seconds(value)} key={value} onBlur={e => onCommit(milliseconds(e.currentTarget.value))} /></label>;
}
function SourceRangePreview({ source, scene, index }: { source: MediaAssetV1; scene: Scene; index: number }) {
  const [open, setOpen] = useState(false);
  const valid = Number.isSafeInteger(scene.sourceStartMs) && Number.isSafeInteger(scene.sourceEndMs) && scene.sourceStartMs >= 0 && scene.sourceEndMs > scene.sourceStartMs && scene.sourceEndMs <= (source.durationMs ?? 0);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Preview source range for scene {index + 1}</summary>{open && <><TakeRangePreview take={source} index={index} startMs={scene.sourceStartMs} endMs={scene.sourceEndMs} valid={valid} sourceFootage />{!valid && <p className="small">Choose a start and end within the source before previewing.</p>}</>}</details>;
}
export function FootagePlans({ projectId, assets, canEdit }: { projectId: string; assets: MediaAssetV1[]; canEdit: boolean }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/footage-plans`;
  const videos = assets.filter(a => a.kind === 'video' && a.durationMs && a.durationMs > 0);
  const images = assets.filter(a => a.kind === 'image');
  const [plans, setPlans] = useState<Plan[]>([]);
  const cached = cache.get(projectId);
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(cached?.draft));
  const [saved, setSaved] = useState<Plan | null>(cached?.saved ?? null);
  const [draft, setDraft] = useState<Plan | null>(cached?.draft ?? null);
  const [sourceId, setSourceId] = useState(videos[0]?.id ?? '');
  const sourcePreview = useRef<HTMLVideoElement | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [markStatus, setMarkStatus] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(seconds(Math.min(videos[0]?.durationMs ?? 30000, 60000)));
  const [count, setCount] = useState('4');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const changed = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  const latest = useRef<CachedDraft>({ saved, draft });
  latest.current = { saved, draft };
  useEffect(() => () => { cache.set(projectId, copy(latest.current)); }, [projectId]);
  useEffect(() => { if (!changed) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [changed]);
  useEffect(() => { let alive = true; setLoading(true); request(base).then(data => { if (alive) setPlans(data.plans); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [base]);
  const open = (plan: Plan) => { setSaved(copy(plan)); setDraft(copy(plan)); setConflict(false); };
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await operation(); } catch (e) { const err = e as Error & { status?: number }; setError(err.status === 409 ? 'This cut map changed elsewhere. Your edits are still here; reload the saved map to review the latest version.' : err.message); setConflict(err.status === 409); } finally { setBusy(false); } };
  const reload = async (id: string) => { const data = await request(base); setPlans(data.plans); const latest = (data.plans as Plan[]).find(p => p.id === id); if (!latest) throw new Error('This saved cut map is no longer available.'); open(latest); };
  const changeScene = (index: number, patch: Partial<Scene>) => setDraft(current => current && ({ ...current, scenes: current.scenes.map((scene, i) => i === index ? { ...scene, ...patch } : scene) }));
  const mayLeave = () => !changed || window.confirm('Discard unsaved changes to this cut map?');
  const selectedSource = videos.find(video => video.id === sourceId);
  const planSource = draft && videos.find(video => video.id === draft.sourceAssetId);
  const markPlayhead = (edge: 'start' | 'end') => {
    const player = sourcePreview.current;
    const durationMs = selectedSource?.durationMs;
    if (!player || !previewReady || !durationMs || !Number.isFinite(player.duration) || !Number.isFinite(player.currentTime)) {
      setMarkStatus('The source video is not ready.');
      return;
    }
    const point = Math.max(0, Math.min(durationMs, Math.floor(player.duration * 1000), Math.round(player.currentTime * 1000)));
    if (edge === 'start') setStart(seconds(point)); else setEnd(seconds(point));
    setMarkStatus(`${edge === 'start' ? 'Start' : 'End'} set to ${seconds(point)} seconds. Check both times before creating the cut map.`);
  };
  return <section className="footage-workspace" aria-labelledby="footage-title"><details open={workspaceOpen} onToggle={event => setWorkspaceOpen(event.currentTarget.open)}><summary id="footage-title">Plan from existing footage</summary><div className="footage-content">
    <p>Choose a source video and map its cuts. Your original stays untouched. Map an edit and export saved source ranges. It does not detect cuts or restyle footage.</p>
    {error && <p className="notice" role="alert">{error} {conflict && saved && <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm('Discard unsaved edits and load the latest saved cut map?')) void run(async () => { await reload(saved.id); setMessage('Loaded the latest saved cut map.'); }); }}>Reload saved map</button>}</p>}
    {message && <p className="notice calm" role="status">{message}</p>}
    {loading ? <p>Loading saved cut maps…</p> : <>
      {!canEdit && <p className="small">This connection can view cut maps; editing requires project edit access.</p>}
      <div className="song-plan-columns"><div><h3>Start with a video</h3>{videos.length === 0 ? <p>No measured video yet. Upload an MP4 or WebM in the library, then return here.</p> : <form onSubmit={e => { e.preventDefault(); if (!mayLeave()) return; void run(async () => { const result = await request(base, 'POST', { sourceAssetId: sourceId, rightsConfirmed: rights, title, aspect: '16:9', sourceStartMs: milliseconds(start), sourceEndMs: milliseconds(end), sceneCount: Number(count) }); setPlans(current => [result.plan, ...current]); open(result.plan); setTitle(''); setRights(false); setMessage('Cut map saved. Adjust the suggested ranges below.'); }); }}><fieldset disabled={!canEdit || busy}>
        <label>Source video<select value={sourceId} onChange={e => { const id = e.target.value; setPreviewReady(false); setMarkStatus(''); setSourceId(id); setRights(false); setStart('0'); setEnd(seconds(Math.min(videos.find(v => v.id === id)?.durationMs ?? 30000, 60000))); }}>{videos.map(v => <option key={v.id} value={v.id}>{v.title} · {seconds(v.durationMs ?? 0)}s</option>)}</select></label>
        {selectedSource && <><video key={selectedSource.id} ref={sourcePreview} className="footage-preview" controls playsInline preload="metadata" src={selectedSource.file} aria-label={`Preview source ${selectedSource.title}`} onLoadedMetadata={() => setPreviewReady(true)} onError={() => { setPreviewReady(false); setMarkStatus('The source preview could not load. You can still enter times manually.'); }} /><p className="small">Pause at a point in the video, then use it as the start or end. You can still enter times below.</p><div className="row"><button type="button" className="secondary" disabled={!previewReady} onClick={() => markPlayhead('start')}>Use playhead for start</button><button type="button" className="secondary" disabled={!previewReady} onClick={() => markPlayhead('end')}>Use playhead for end</button></div><p className="small" role="status">{markStatus}</p></>}
        <label>Cut map title<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="My footage edit" /></label>
        <div className="song-plan-times"><label>Start <span className="small">seconds</span><input required type="number" min="0" step="0.001" value={start} onChange={e => setStart(e.target.value)} /></label><label>End <span className="small">seconds</span><input required type="number" min="0" step="0.001" value={end} onChange={e => setEnd(e.target.value)} /></label><label>Scenes<select value={count} onChange={e => setCount(e.target.value)}>{[1,2,3,4,5,6].map(n => <option key={n}>{n}</option>)}</select></label></div>
        <p className="small">Select up to 60 seconds. Even divisions are starting suggestions, not detected cuts.</p><label className="song-check"><input type="checkbox" checked={rights} required onChange={e => setRights(e.target.checked)} /> I own this footage or have permission to use it.</label><button type="submit" disabled={!rights || !sourceId}>Create cut map</button></fieldset></form>}</div>
        <div><h3>Saved cut maps</h3>{plans.length === 0 ? <p>No saved cut maps yet.</p> : <ul className="song-plan-list">{plans.map(plan => <li key={plan.id}><button type="button" className="secondary" aria-pressed={saved?.id === plan.id} onClick={() => { if (mayLeave()) { open(plan); setError(''); setMessage(''); } }}><strong>{plan.title}</strong><span>{plan.scenes.length} scenes · revision {plan.revision}</span></button></li>)}</ul>}</div></div>
      {draft && saved && <div className="song-editor"><div className="song-editor-heading"><div><h3>{saved.title}</h3><p className="small">Revision {saved.revision} · all times refer to the original source video.</p></div><span className="small">{changed ? 'Unsaved changes' : 'Saved'}</span></div>
        {planSource ? <p>Source: <strong>{planSource.title}</strong> · {seconds(planSource.durationMs ?? 0)}s</p> : <p className="notice">The source video is no longer available in this studio.</p>}
        <fieldset disabled={!canEdit || busy} className="song-editor-fields"><label>Cut map title<input maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Treatment<textarea maxLength={1200} value={draft.treatment} onChange={e => setDraft({ ...draft, treatment: e.target.value })} placeholder="Describe your intended edit" /></label><label>Frame<select value={draft.aspect} onChange={e => setDraft({ ...draft, aspect: e.target.value })}><option value="16:9">Landscape 16:9</option><option value="9:16">Portrait 9:16</option><option value="1:1">Square 1:1</option></select></label>
        <h4>Source ranges</h4><p className="small">Keep ranges in source order without overlaps. Gaps are allowed; all selected ranges together must stay under 60 seconds.</p><ol className="song-scenes">{draft.scenes.map((scene,index) => <li key={scene.id}><strong>Scene {index + 1}</strong><div className="song-plan-times"><TimeField label="Start" value={scene.sourceStartMs} onCommit={n => changeScene(index, { sourceStartMs:n })}/><TimeField label="End" value={scene.sourceEndMs} onCommit={n => changeScene(index, { sourceEndMs:n })}/></div>{workspaceOpen && planSource && <SourceRangePreview source={planSource} scene={scene} index={index}/>}{workspaceOpen && planSource && saved.scenes[index]?.id === scene.id && <FootageSceneExport key={`${saved.id}:${saved.revision}:${scene.id}`} projectId={projectId} plan={saved} scene={saved.scenes[index]} index={index} disabled={changed || conflict || busy}/>}<label>Direction<textarea maxLength={1200} value={scene.direction} onChange={e => changeScene(index, { direction:e.target.value })} placeholder="Describe the intended treatment" /></label><div className="song-plan-times"><label>Reference still<select value={scene.referenceAssetId ?? ''} onChange={e => changeScene(index, { referenceAssetId:e.target.value || null })}><option value="">None</option>{images.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><label>Selected take<select value={scene.selectedTakeId ?? ''} onChange={e => changeScene(index, { selectedTakeId:e.target.value || null })}><option value="">None</option>{videos.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div><div className="row"><button type="button" className="quiet" disabled={draft.scenes.length >= 6 || scene.sourceEndMs - scene.sourceStartMs < 2} onClick={() => { const middle = scene.sourceStartMs + Math.floor((scene.sourceEndMs - scene.sourceStartMs) / 2); setDraft({ ...draft, scenes: draft.scenes.flatMap((item, i) => i === index ? [{ ...item, sourceEndMs: middle }, { ...item, id: `scn_${crypto.randomUUID().replaceAll('-', '')}`, sourceStartMs: middle, selectedTakeId: null }] : [item]) }); }}>Split scene {index + 1}</button>{draft.scenes.length > 1 && <button type="button" className="quiet" onClick={() => setDraft({ ...draft, scenes:draft.scenes.filter((_,i) => i !== index) })}>Remove scene {index + 1}</button>}</div></li>)}</ol>
        <button type="button" disabled={!changed || conflict || !planSource} onClick={() => void run(async () => { const result = await request(`${base}/${saved.id}`, 'PATCH', { expectedRevision:saved.revision, title:draft.title, treatment:draft.treatment, aspect:draft.aspect, scenes:draft.scenes }); setPlans(current => current.map(p => p.id === result.plan.id ? result.plan : p)); open(result.plan); setMessage('Cut map saved.'); })}>Save cut map</button></fieldset>
        {changed && <button type="button" className="quiet" onClick={() => { if (window.confirm('Discard unsaved edits to this cut map?')) open(saved); }}>Discard unsaved edits</button>}
      </div>}
    </>}
  </div></details></section>;
}
