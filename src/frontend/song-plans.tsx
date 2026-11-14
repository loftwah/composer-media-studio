import { useEffect, useRef, useState } from 'react';
import type { CompositionV1, MediaAssetV1 } from './contracts';
import './song-plans.css';
import { previewTakeFit } from './song-fit';
import { previewSceneDirections, type DirectionMode } from './scene-direction';
import { scenePlanChanged } from './song-plan-dirty';
import { nextCaptionSlot } from './caption-slot';
import { splitCaption } from './caption-split';
import { joinCaptions } from './caption-join';
import { shiftCaptionTimes } from './caption-shift';
import { listenFromCaption } from './caption-listen';
import { previewSceneReferences, type ReferenceMode } from './scene-reference';
import { SubjectLibrary, previewSubjectChanges } from './subject-library';
import { SceneMediaReview } from './scene-media-review';

type Scene = { id: string; startMs: number; endMs: number; direction: string; referenceAssetId: string | null; selectedTakeId: string | null };
type Cue = { id: string; startMs: number; endMs: number; text: string; speaker: string };
type Plan = { id: string; songAssetId: string; revision: number; title: string; treatment: string; aspect: string; startMs: number; endMs: number; scenes: Scene[]; captions?: { cues: Cue[] } | null };
const seconds = (ms: number) => String(ms / 1000);
const milliseconds = (s: string) => Math.round(Number(s) * 1000);
const copy = <T,>(value: T): T => structuredClone(value);
type DirectionDraft = { selectedIds: string[]; text: string; mode: DirectionMode };
type ReferenceDraft = { selectedIds: string[]; mode: ReferenceMode; assetId: string };
type CachedDraft = { saved: Plan | null; draft: Plan | null; cues: Cue[]; captionRights: boolean; directionDraft: DirectionDraft; referenceDraft: ReferenceDraft; sourceStarts: Record<string, string> };
const emptyDirectionDraft = (): DirectionDraft => ({ selectedIds: [], text: '', mode: 'append' });
const emptyReferenceDraft = (): ReferenceDraft => ({ selectedIds: [], mode: 'set', assetId: '' });
const draftCache = new Map<string, CachedDraft>();

async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data?.error?.message ?? `Request failed (${response.status})`) as Error & { status: number; code?: string }; error.status = response.status; error.code = data?.error?.code; throw error; }
  return data;
}
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  return <label>{label} <span className="small">seconds</span><input type="number" min="0" step="0.001" defaultValue={seconds(value)} key={value} onBlur={e => onCommit(milliseconds(e.currentTarget.value))} /></label>;
}
export function TakeRangePreview({ take, index, startMs, endMs, valid, sourceFootage = false }: { take: MediaAssetV1; index: number; startMs: number; endMs: number; valid: boolean; sourceFootage?: boolean }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('');
  function waitFor(player: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => finish(new Error('Preview timed out')), 15000);
      const finish = (error?: Error) => { window.clearTimeout(timer); player.removeEventListener(event, done); player.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve(); };
      const done = () => finish();
      const failed = () => finish(new Error('Preview could not load'));
      const cancelled = () => finish(new Error('Preview cancelled'));
      player.addEventListener(event, done, { once: true }); player.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', cancelled, { once: true });
    });
  }
  useEffect(() => {
    generation.current++;
    pending.current?.abort();
    if (active.current) {
      active.current = false;
      video.current?.pause();
      setStatus('The range changed. Preview it again.');
    }
  }, [take.id, startMs, endMs, valid]);
  useEffect(() => () => { generation.current++; pending.current?.abort(); active.current = false; video.current?.pause(); }, []);
  async function playRange() {
    const player = video.current;
    if (!player || !valid) return;
    const request = ++generation.current;
    pending.current?.abort();
    const task = new AbortController(); pending.current = task;
    setStatus('Loading selected portion…'); active.current = true;
    try {
      if (player.readyState < 1) { const ready = waitFor(player, 'loadedmetadata', task.signal); player.load(); await ready; }
      if (request !== generation.current) return;
      if (!Number.isFinite(player.duration) || endMs / 1000 > player.duration + 0.001) throw new Error('Clip duration changed');
      if (Math.abs(player.currentTime - startMs / 1000) > 0.001) {
        player.currentTime = startMs / 1000;
        if (player.seeking) await waitFor(player, 'seeked', task.signal);
      }
      if (request !== generation.current) return;
      await player.play();
      if (request !== generation.current) { player.pause(); return; }
      if (player.currentTime + 0.1 < startMs / 1000) { active.current = false; player.pause(); throw new Error('Clip did not seek'); }
      if (active.current) setStatus('Playing the selected portion.');
    } catch {
      if (request !== generation.current) return;
      active.current = false;
      setStatus('The preview could not play. Check the clip and try again.');
    }
  }
  return <div className="song-take-preview"><video ref={video} controls playsInline preload="none" src={take.file} aria-label={`${sourceFootage ? 'Original footage' : 'Original take'} for scene ${index + 1}`} onTimeUpdate={event => { if (active.current && event.currentTarget.currentTime >= endMs / 1000) { active.current = false; event.currentTarget.pause(); event.currentTarget.currentTime = endMs / 1000; setStatus('Selected portion finished.'); } }} onEnded={() => { if (active.current) { generation.current++; active.current = false; setStatus('Selected portion finished.'); } }} onPause={() => { if (active.current) { generation.current++; pending.current?.abort(); active.current = false; setStatus('Preview paused.'); } }} onError={() => { generation.current++; active.current = false; setStatus('The preview could not load. Check the clip and try again.'); }}/><button type="button" className="secondary" disabled={!valid} onClick={() => void playRange()}>Preview selected portion</button><p className="small">{sourceFootage ? 'The browser preview is approximate and uses the original footage and its audio. It does not change or render the source.' : 'The browser preview is approximate and uses the original clip’s audio. The local MP4 renderer mutes clip audio.'}</p>{status && <p className="small" role="status">{status}</p>}</div>;
}
export function SongPlans({ projectId, assets, canEdit, onStoryboard }: { projectId: string; assets: MediaAssetV1[]; canEdit: boolean; onStoryboard: (composition: CompositionV1) => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/song-plans`;
  const songs = assets.filter(a => a.kind === 'audio' && a.durationMs && a.durationMs >= 2000);
  const images = assets.filter(a => a.kind === 'image');
  const videos = assets.filter(a => a.kind === 'video');
  const [plans, setPlans] = useState<Plan[]>([]);
  const cached = draftCache.get(projectId);
  const [saved, setSaved] = useState<Plan | null>(cached?.saved ?? null);
  const [draft, setDraft] = useState<Plan | null>(cached?.draft ?? null);
  const [cues, setCues] = useState<Cue[]>(cached?.cues ?? []);
  const [songId, setSongId] = useState(songs[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(seconds(Math.min(songs[0]?.durationMs ?? 30000, 60000)));
  const [count, setCount] = useState('4');
  const [rights, setRights] = useState(false);
  const [captionRights, setCaptionRights] = useState(cached?.captionRights ?? false);
  const [captionOffset, setCaptionOffset] = useState('');
  const [showCaptionShift, setShowCaptionShift] = useState(false);
  const captionAudio = useRef<HTMLAudioElement | null>(null);
  const captionListen = useRef<AbortController | null>(null);
  const [captionAudioError, setCaptionAudioError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [trimConsent, setTrimConsent] = useState(false);
  const [sourceStarts, setSourceStarts] = useState<Record<string, string>>(cached?.sourceStarts ?? {});
  const [showFitPreview, setShowFitPreview] = useState(false);
  const [directionDraft, setDirectionDraft] = useState<DirectionDraft>(cached?.directionDraft ?? emptyDirectionDraft());
  const [showDirectionPreview, setShowDirectionPreview] = useState(false);
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft>(cached?.referenceDraft ?? emptyReferenceDraft());
  const [showReferencePreview, setShowReferencePreview] = useState(false);
  const changedPlan = Boolean(draft && saved && scenePlanChanged(draft, saved));
  const changedStarts = Object.values(sourceStarts).some(value => value !== '0' && value !== '0.0' && value !== '0.00' && value !== '0.000');
  useEffect(() => { setTrimConsent(false); }, [saved?.id, saved?.revision]);
  const changedCues = Boolean(saved && JSON.stringify(cues) !== JSON.stringify(saved.captions?.cues ?? []));
  const changedDirection = Boolean(directionDraft.text.trim() || directionDraft.selectedIds.length);
  const changedReference = Boolean(referenceDraft.selectedIds.length || referenceDraft.assetId || referenceDraft.mode === 'clear');
  const latest = useRef<CachedDraft>({ saved, draft, cues, captionRights, directionDraft, referenceDraft, sourceStarts });
  latest.current = { saved, draft, cues, captionRights, directionDraft, referenceDraft, sourceStarts };
  useEffect(() => () => { draftCache.set(projectId, copy(latest.current)); }, [projectId]);
  useEffect(() => { if (!(changedPlan || changedCues || changedDirection || changedReference || changedStarts)) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [changedPlan, changedCues, changedDirection, changedReference, changedStarts]);
  const open = (plan: Plan) => { setSaved(copy(plan)); setDraft(copy(plan)); setCues(copy(plan.captions?.cues ?? [])); setCaptionOffset(''); setShowCaptionShift(false); setCaptionRights(Boolean(plan.captions)); setConflict(false); setStoryboardId(null); setShowFitPreview(false); setDirectionDraft(emptyDirectionDraft()); setShowDirectionPreview(false); setReferenceDraft(emptyReferenceDraft()); setShowReferencePreview(false); setSourceStarts({}); };
  const refresh = async (selectId?: string) => { const data = await request(base); const list: Plan[] = data.plans; setPlans(list); if (selectId) { const found = list.find(p => p.id === selectId); if (found) open(found); } };
  useEffect(() => { let alive = true; setLoading(true); request(base).then(data => { if (alive) setPlans(data.plans); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [base]);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await operation(); } catch (e) { const err = e as Error & { status?: number; code?: string }; setError(['storyboard_changed', 'take_changed'].includes(err.code ?? '') ? err.message : err.status === 409 ? 'This plan changed elsewhere. Your edits are still here; reload the saved plan to review the latest version.' : err.message); setConflict(err.status === 409 && !['storyboard_changed', 'take_changed'].includes(err.code ?? '')); } finally { setBusy(false); } };
  const savedScenes = (updated: Plan) => { setPlans(current => current.map(p => p.id === updated.id ? updated : p)); setSaved(copy(updated)); setDraft(copy(updated)); };
  const savedCaptions = (updated: Plan) => { setPlans(current => current.map(p => p.id === updated.id ? updated : p)); setSaved(copy(updated)); setDraft(current => current && ({ ...current, revision: updated.revision, captions: copy(updated.captions) })); setCues(copy(updated.captions?.cues ?? [])); };
  const changeScene = (index: number, patch: Partial<Scene>) => setDraft(current => current && ({ ...current, scenes: current.scenes.map((scene, i) => i === index ? { ...scene, ...patch } : scene) }));
  const changeCue = (index: number, patch: Partial<Cue>) => setCues(current => current.map((cue, i) => i === index ? { ...cue, ...patch } : cue));
  const mayLeave = () => !(changedPlan || changedCues || changedDirection || changedReference || changedStarts) || window.confirm('Discard unsaved changes to this plan?');
  const selectedSong = songs.find(song => song.id === songId);
  const takeReview = saved?.scenes.map((scene, index) => {
    const take = videos.find(video => video.id === scene.selectedTakeId);
    const raw = sourceStarts[scene.id] ?? '0';
    const startMs = /^\d+(?:\.\d{1,3})?$/.test(raw) ? Math.round(Number(raw) * 1000) : NaN;
    return { index, scene, take, sceneMs: scene.endMs - scene.startMs, raw, startMs };
  }) ?? [];
  const invalidTakes = takeReview.some(({ take, sceneMs, startMs }) => !take?.durationMs || take.durationMs < sceneMs || take.durationMs > 16000 || !Number.isSafeInteger(startMs) || startMs < 0 || startMs + sceneMs > take.durationMs);
  const trimmedTakes = takeReview.filter(({ take, sceneMs, startMs }) => take?.durationMs && Number.isSafeInteger(startMs) && (startMs > 0 || take.durationMs > sceneMs));
  const fit = showFitPreview && draft ? previewTakeFit(draft, videos, cues, saved?.captions?.cues ?? []) : null;
  const captionSlot = draft ? nextCaptionSlot(draft.startMs, draft.endMs, cues) : null;
  const shiftedCaptions = showCaptionShift && saved ? shiftCaptionTimes(cues, captionOffset, saved.startMs, saved.endMs) : null;
  const planSong = songs.find(song => song.id === saved?.songAssetId);
  useEffect(() => { const player = captionAudio.current; setCaptionAudioError(''); return () => { captionListen.current?.abort(); player?.pause(); }; }, [saved?.id, planSong?.id, planSong?.file]);
  const listenFromCue = (cue: Cue) => {
    const player = captionAudio.current;
    if (!player || !planSong?.durationMs || !Number.isSafeInteger(cue.startMs) || cue.startMs < 0 || cue.startMs >= planSong.durationMs) return;
    captionListen.current?.abort();
    const task = new AbortController(); captionListen.current = task;
    setCaptionAudioError('');
    void listenFromCaption(player, cue.startMs, planSong.durationMs, task.signal).catch(() => { if (!task.signal.aborted) setCaptionAudioError('Could not play from this caption. The song may not be seekable; try the audio controls.'); });
  };
  return <section className="song-plans" aria-labelledby="song-plans-title">
    <div className="song-plans-heading"><div><h2 id="song-plans-title">Plan a music video</h2><p>Choose a song, shape its scenes and prepare captions. Planning is free; it does not generate or render video.</p></div></div>
    {error && <p className="notice" role="alert">{error} {conflict && saved && <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm('Discard unsaved edits and load the latest saved plan?')) void run(async () => { await refresh(saved.id); setMessage('Loaded the latest saved plan.'); }); }}>Reload saved plan</button>}</p>}
    {message && <p className="notice calm" role="status">{message}</p>}
    {loading ? <p>Loading saved plans…</p> : <>
      {!canEdit && <p className="small">This connection can view and download plans; editing requires project edit access.</p>}
      <div className="song-plan-columns">
        <div><h3>Start with a song</h3>{songs.length === 0 ? <p>No measured audio yet. Upload an MP3 or WAV in the library, then return here.</p> : <form className="stack" onSubmit={e => { e.preventDefault(); if (!mayLeave()) return; void run(async () => { const result = await request(base, 'POST', { songAssetId: songId, rightsConfirmed: rights, title, aspect: '16:9', startMs: milliseconds(start), endMs: milliseconds(end), sceneCount: Number(count) }); setPlans(current => [result.plan, ...current]); open(result.plan); setTitle(''); setRights(false); setMessage('Plan saved. Adjust the suggested scenes below.'); }); }}>
          <fieldset disabled={!canEdit || busy}><label>Song<select value={songId} onChange={e => { const id = e.target.value; setSongId(id); setRights(false); setStart('0'); setEnd(seconds(Math.min(songs.find(s => s.id === id)?.durationMs ?? 30000, 60000))); }}>{songs.map(song => <option key={song.id} value={song.id}>{song.title} · {seconds(song.durationMs ?? 0)}s</option>)}</select></label>
          {selectedSong && <audio controls preload="none" src={selectedSong.file} aria-label={`Listen to ${selectedSong.title}`} />}
          <label>Plan title<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="My music video" /></label>
          <div className="song-plan-times"><label>Start <span className="small">seconds</span><input required type="number" min="0" step="0.001" value={start} onChange={e => setStart(e.target.value)} /></label><label>End <span className="small">seconds</span><input required type="number" min="0" step="0.001" value={end} onChange={e => setEnd(e.target.value)} /></label><label>Scenes<select value={count} onChange={e => setCount(e.target.value)}>{[2,3,4,5,6].map(n => <option key={n}>{n}</option>)}</select></label></div>
          <p className="small">Choose 2–60 seconds. The even scene divisions are suggestions, not beat or lyric detection.</p><label className="song-check"><input type="checkbox" checked={rights} required onChange={e => setRights(e.target.checked)} /> I own this song or have permission to use it.</label><button type="submit" disabled={!rights || !songId}>Create plan</button></fieldset>
        </form>}</div>
        <div><h3>Saved plans</h3>{plans.length === 0 ? <p>No saved song plans yet.</p> : <ul className="song-plan-list">{plans.map(plan => <li key={plan.id}><button type="button" className="secondary" aria-pressed={saved?.id === plan.id} onClick={() => { if (mayLeave()) { open(plan); setError(''); setMessage(''); } }}><strong>{plan.title}</strong><span>{plan.scenes.length} scenes · revision {plan.revision}</span></button></li>)}</ul>}</div>
      </div>
      <SubjectLibrary projectId={projectId} planId={draft?.id ?? null} scenes={draft?.scenes ?? []} images={images} canEdit={canEdit} conflict={conflict} onApply={(subject, proposal) => setDraft(current => { if (!current) return current; const result = previewSubjectChanges(current.scenes, subject, proposal, images); if (result.error) return current; const edits = new Map(result.edits.map(edit => [edit.id, edit])); return { ...current, scenes: current.scenes.map(scene => { const edit = edits.get(scene.id); return edit ? { ...scene, direction: edit.after, referenceAssetId: edit.afterRef } : scene; }) }; })}/>
      {draft && saved && <div className="song-editor"><div className="song-editor-heading"><div><h3>{saved.title}</h3><p className="small">Revision {saved.revision} · source times are measured from the beginning of the song.</p></div><span className="small">{changedPlan || changedCues || changedDirection || changedReference || changedStarts ? 'Unsaved changes' : 'Saved'}</span></div>
        <fieldset disabled={!canEdit || busy} className="song-editor-fields"><label>Plan title<input maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Treatment<textarea maxLength={1200} value={draft.treatment} onChange={e => setDraft({ ...draft, treatment: e.target.value })} placeholder="What should the film feel like?" /></label><label>Frame<select value={draft.aspect} onChange={e => setDraft({ ...draft, aspect: e.target.value })}><option value="16:9">Landscape 16:9</option><option value="9:16">Portrait 9:16</option><option value="1:1">Square 1:1</option></select></label>
        <h4>Scenes</h4><p className="small">Keep scenes in order with no gaps or overlaps. These are plans, not generated clips.</p>
        <ol className="song-scenes">{draft.scenes.map((scene, index) => <li key={scene.id}><strong>Scene {index + 1}</strong><div className="song-plan-times"><TimeField label="Start" value={scene.startMs} onCommit={n => changeScene(index, { startMs: n })}/><TimeField label="End" value={scene.endMs} onCommit={n => changeScene(index, { endMs: n })}/></div><label>Direction<textarea maxLength={1200} value={scene.direction} onChange={e => changeScene(index, { direction: e.target.value })} placeholder="Describe this scene" /></label><div className="song-plan-times"><label>Reference still<select value={scene.referenceAssetId ?? ''} onChange={e => changeScene(index, { referenceAssetId: e.target.value || null })}><option value="">None</option>{images.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><label>Selected take<select value={scene.selectedTakeId ?? ''} onChange={e => changeScene(index, { selectedTakeId: e.target.value || null })}><option value="">None</option>{videos.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div><SceneMediaReview index={index} referenceId={scene.referenceAssetId} takeId={scene.selectedTakeId} assets={assets}/></li>)}</ol>
        <div className="scene-direction-editor"><h4>Edit directions together</h4><p className="small">Choose scenes and write your own direction. Review each change before applying it to this draft; no media is generated or changed.</p>
          <fieldset className="scene-direction-selection"><legend>Scenes to change</legend>{draft.scenes.map((scene, index) => <label className="song-check" key={scene.id}><input type="checkbox" checked={directionDraft.selectedIds.includes(scene.id)} onChange={e => { const checked = e.currentTarget.checked; setDirectionDraft(current => ({ ...current, selectedIds: checked ? [...current.selectedIds, scene.id] : current.selectedIds.filter(id => id !== scene.id) })); setShowDirectionPreview(false); }} /> Scene {index + 1} <span className="small">{seconds(scene.startMs)}–{seconds(scene.endMs)}s</span></label>)}</fieldset>
          <label>Direction for selected scenes<textarea maxLength={1200} value={directionDraft.text} onChange={e => { setDirectionDraft(current => ({ ...current, text: e.target.value })); setShowDirectionPreview(false); }} placeholder="For example: use brighter light" /></label>
          <label>How to apply<select value={directionDraft.mode} onChange={e => { const mode = e.target.value as DirectionMode; setDirectionDraft(current => ({ ...current, mode })); setShowDirectionPreview(false); }}><option value="append">Add to each existing direction</option><option value="replace">Replace each existing direction</option></select></label>
          <button type="button" className="secondary" onClick={() => setShowDirectionPreview(true)}>Preview direction changes</button>
          {showDirectionPreview && (() => { const preview = previewSceneDirections(draft.scenes, directionDraft.selectedIds, directionDraft.text, directionDraft.mode); return <div className="scene-direction-preview" aria-live="polite">{preview.error ? <p>{preview.error}</p> : <><p>Only the directions below will change. Scene timing, references and selected takes stay as they are.</p><ol>{preview.edits.map(edit => <li key={edit.id}><strong>Scene {draft.scenes.findIndex(scene => scene.id === edit.id) + 1}</strong><dl><dt>Before</dt><dd>{edit.before || 'No direction yet'}</dd><dt>After</dt><dd>{edit.after}</dd></dl></li>)}</ol><button type="button" disabled={conflict} onClick={() => { setDraft(current => { if (!current) return current; const next = previewSceneDirections(current.scenes, directionDraft.selectedIds, directionDraft.text, directionDraft.mode); if (next.error) return current; const edits = new Map(next.edits.map(edit => [edit.id, edit.after])); return { ...current, scenes: current.scenes.map(scene => edits.has(scene.id) ? { ...scene, direction: edits.get(scene.id)! } : scene) }; }); setDirectionDraft(emptyDirectionDraft()); setShowDirectionPreview(false); setMessage('Directions applied to your draft. Save the scene plan when ready.'); }}>Apply directions to draft</button></>}</div>; })()}
        </div>
        <div className="scene-direction-editor"><h4>Change references together</h4><p className="small">Choose scenes and a saved still from this studio, or explicitly clear their references. Review each change before applying it to this draft. Takes, timing and directions stay unchanged.</p>
          <fieldset className="scene-direction-selection"><legend>Scenes for reference change</legend>{draft.scenes.map((scene, index) => <label className="song-check" key={scene.id}><input type="checkbox" checked={referenceDraft.selectedIds.includes(scene.id)} onChange={e => { const checked = e.currentTarget.checked; setReferenceDraft(current => ({ ...current, selectedIds: checked ? [...current.selectedIds, scene.id] : current.selectedIds.filter(id => id !== scene.id) })); setShowReferencePreview(false); }} /> Scene {index + 1} <span className="small">{seconds(scene.startMs)}–{seconds(scene.endMs)}s</span></label>)}</fieldset>
          <label>Reference action<select value={referenceDraft.mode} onChange={e => { setReferenceDraft(current => ({ ...current, mode: e.target.value as ReferenceMode, assetId: '' })); setShowReferencePreview(false); }}><option value="set">Use a saved still</option><option value="clear">Clear references</option></select></label>
          {referenceDraft.mode === 'set' && <label>Saved still<select value={referenceDraft.assetId} onChange={e => { setReferenceDraft(current => ({ ...current, assetId: e.target.value })); setShowReferencePreview(false); }}><option value="">Choose a still from this studio</option>{images.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></label>}
          <div className="row"><button type="button" className="secondary" onClick={() => setShowReferencePreview(true)}>Preview reference changes</button>{changedReference && <button type="button" className="quiet" onClick={() => { setReferenceDraft(emptyReferenceDraft()); setShowReferencePreview(false); }}>Clear reference proposal</button>}</div>
          {showReferencePreview && (() => { const preview = previewSceneReferences(draft.scenes, referenceDraft.selectedIds, referenceDraft.mode, referenceDraft.assetId, images.map(asset => asset.id)); const label = (id: string | null) => id ? images.find(asset => asset.id === id)?.title ?? 'Unavailable still' : 'None'; return <div className="scene-direction-preview" aria-live="polite">{preview.error ? <p>{preview.error}</p> : <><p>Only these scene references will change.</p><ol>{preview.edits.map(edit => <li key={edit.id}><strong>Scene {draft.scenes.findIndex(scene => scene.id === edit.id) + 1}</strong><dl><dt>Before</dt><dd>{label(edit.before)}</dd><dt>After</dt><dd>{label(edit.after)}</dd></dl></li>)}</ol><button type="button" disabled={conflict} onClick={() => { const current = previewSceneReferences(draft.scenes, referenceDraft.selectedIds, referenceDraft.mode, referenceDraft.assetId, images.map(asset => asset.id)); if (current.error) return; const edits = new Map(current.edits.map(edit => [edit.id, edit.after])); setDraft(previous => previous && ({ ...previous, scenes: previous.scenes.map(scene => edits.has(scene.id) ? { ...scene, referenceAssetId: edits.get(scene.id)! } : scene) })); setReferenceDraft(emptyReferenceDraft()); setShowReferencePreview(false); setMessage('References applied to your draft. Save the scene plan when ready.'); }}>Apply references to draft</button></>}</div>; })()}
        </div>
        <div className="song-fit"><h4>Fit scenes to selected takes</h4><p className="small">Preview contiguous source times using each take’s measured length. No clips are trimmed or altered.</p><button type="button" className="secondary" onClick={() => setShowFitPreview(current => !current)} aria-expanded={showFitPreview} aria-controls="take-fit-preview">{showFitPreview ? 'Hide timing preview' : 'Preview take timing'}</button>
          {fit && <div id="take-fit-preview" className="song-fit-preview" aria-live="polite">
            {'detail' in fit ? <p>{fit.detail}</p> : <><p>{fit.status === 'exact' ? 'The selected takes exactly fill this song segment.' : `The takes finish at ${seconds(fit.endMs)}s, ${seconds(fit.differenceMs)}s before the current segment end (${seconds(draft.endMs)}s).`}</p>
              <ol>{fit.scenes.map((scene, index) => <li key={scene.id}>Scene {index + 1}: {seconds(draft.scenes[index].startMs)}–{seconds(draft.scenes[index].endMs)}s → <strong>{seconds(scene.startMs)}–{seconds(scene.endMs)}s</strong> <span className="small">({seconds(scene.durationMs)}s take)</span></li>)}</ol>
              {fit.status === 'captions' ? <p>Saved or unsaved captions extend beyond the proposed end. Adjust and save those captions before shortening the segment.</p> : <><p className="small">{fit.status === 'shorter' ? 'Applying also shortens the selected song segment to the proposed end. The original song and takes stay unchanged.' : 'The song segment stays the same. Your other draft edits stay in place.'} Save the scene plan afterwards.</p><button type="button" disabled={conflict} onClick={() => { setDraft(current => { if (!current) return current; const next = previewTakeFit(current, videos, cues, saved.captions?.cues ?? []); if (next.status !== 'exact' && next.status !== 'shorter') return current; return { ...current, endMs: next.endMs, scenes: current.scenes.map((scene, index) => ({ ...scene, startMs: next.scenes[index].startMs, endMs: next.scenes[index].endMs })) }; }); setShowFitPreview(false); setMessage('Timing applied to your draft. Save the scene plan when ready.'); }}>{fit.status === 'shorter' ? 'Apply timing and shorter segment' : 'Apply timing to draft'}</button></>}
            </>}
          </div>}
        </div>
        <button type="button" disabled={!changedPlan || conflict} onClick={() => void run(async () => { const result = await request(`${base}/${saved.id}`, 'PATCH', { expectedRevision: saved.revision, title: draft.title, treatment: draft.treatment, aspect: draft.aspect, startMs: draft.startMs, endMs: draft.endMs, scenes: draft.scenes }); savedScenes(result.plan); setMessage('Scene plan saved.'); })}>Save scene plan</button></fieldset>
        <div className="song-storyboard"><h4>Prepare the storyboard</h4><p className="small">Choose a saved take for every scene and an in-point within each take. The scene length sets the out-point. Originals stay unchanged. The song segment becomes a soundtrack track: mix it in the storyboard before rendering. Saved captions can be burned into a matching storyboard’s local MP4 or downloaded separately. Saving a storyboard is free and does not render. In-points are kept in this draft and the saved storyboard, not in the song plan.</p>
          {takeReview.map(({ index, scene, take, sceneMs, raw, startMs }) => <div className="song-take-range" key={scene.id}><strong>Scene {index + 1}: {take?.title ?? 'Choose a take above'}</strong>{take?.durationMs && <><TakeRangePreview key={take.id} take={take} index={index} startMs={startMs} endMs={startMs + sceneMs} valid={Number.isSafeInteger(startMs) && startMs >= 0 && take.durationMs <= 16000 && startMs + sceneMs <= take.durationMs}/><label>In point for scene {index + 1} <span className="small">seconds from the start of the original</span><input type="number" min="0" max={Math.max(0, (take.durationMs - sceneMs) / 1000)} step="0.001" value={raw} disabled={!canEdit || busy} onChange={event => { setSourceStarts(current => ({ ...current, [scene.id]: event.target.value })); setTrimConsent(false); setStoryboardId(null); }}/></label><p className="small">{Number.isSafeInteger(startMs) && startMs >= 0 && startMs + sceneMs <= take.durationMs ? `Keep ${seconds(startMs)}–${seconds(startMs + sceneMs)}s of ${seconds(take.durationMs)}s.` : `Choose an in-point from 0 to ${seconds(Math.max(0, take.durationMs - sceneMs))}s.`}</p></>}</div>)}
          {invalidTakes && <p className="notice">Every scene needs a selected take of at most 16 seconds and a valid in-point that leaves enough footage for the scene.</p>}
          {trimmedTakes.length > 0 && <label className="song-check"><input type="checkbox" checked={trimConsent} onChange={event => setTrimConsent(event.target.checked)} /> I want to use the selected portions in the storyboard.</label>}
          <button type="button" className="secondary" disabled={!canEdit || busy || conflict || changedPlan || changedReference || invalidTakes || (trimmedTakes.length > 0 && !trimConsent)} onClick={() => void run(async () => { const sceneStarts = takeReview.map(({ scene, startMs }) => ({ sceneId: scene.id, startMs })); const result = await request(`${base}/${saved.id}/storyboard`, 'POST', { expectedRevision: saved.revision, ...(trimmedTakes.length ? { allowTrim: true } : {}), ...(sceneStarts.some(item => item.startMs !== 0) ? { sceneStarts } : {}) }); onStoryboard(result.composition); setStoryboardId(result.composition.id); setSourceStarts({}); setTrimConsent(false); setMessage(result.created ? 'Storyboard saved. Open it below and mix the soundtrack before rendering.' : 'This selection already has a storyboard. Open it below.'); })}>Make storyboard from saved plan</button>{changedPlan && <p className="small">Save scene changes first.</p>}{changedReference && <p className="small">Apply or clear the reference proposal first.</p>}{storyboardId && <button type="button" className="quiet" data-action="compose-load" data-id={storyboardId}>Open storyboard</button>}</div>
        <div className="song-captions"><h4>Captions</h4><p className="small">Enter your own words and timings. Download saved captions as SRT or WebVTT, or burn them into a local MP4 from a matching saved storyboard. Downloads are timed from the start of this segment.</p>{planSong ? <><audio key={`${saved.id}:${planSong.id}:${planSong.file}`} ref={captionAudio} controls preload="metadata" src={planSong.file} aria-label={`Listen to plan song ${planSong.title}`} onError={() => setCaptionAudioError('Could not load the plan song.')} /><p className="small">Listen from a caption start to check your timing. Browser playback is approximate and continues until paused.</p>{captionAudioError && <p role="status" className="small">{captionAudioError}</p>}</> : <p className="small">The plan song is unavailable; captions can still be edited.</p>}<fieldset disabled={!canEdit || busy}><details><summary>Shift all caption timings</summary><p className="small">Move every draft caption earlier or later by the same amount. Text, speakers, durations and gaps stay the same; the shift must fit the saved song segment.</p><label>Shift in seconds <span className="small">use a minus sign to move earlier</span><input type="number" step="0.001" value={captionOffset} onChange={e => { setCaptionOffset(e.target.value); setShowCaptionShift(false); }} /></label><button type="button" className="secondary" onClick={() => setShowCaptionShift(true)}>Preview shift</button>{showCaptionShift && (shiftedCaptions ? <div><p className="small">Review the source-song times below. Applying changes the draft only; save captions when ready.</p><ol>{shiftedCaptions.map((cue, i) => <li key={cue.id}>Caption {i + 1}: {seconds(cues[i].startMs)}–{seconds(cues[i].endMs)}s → {seconds(cue.startMs)}–{seconds(cue.endMs)}s</li>)}</ol><button type="button" disabled={conflict} onClick={() => { setCues(current => shiftCaptionTimes(current, captionOffset, saved.startMs, saved.endMs) ?? current); setShowCaptionShift(false); setMessage('Caption timing shifted in your draft. Save captions when ready.'); }}>Apply shift to draft</button></div> : <p role="status" className="small">Enter a non-zero shift of up to three decimal places that keeps every caption inside the saved song segment.</p>)}</details><ol className="song-scenes">{cues.map((cue, index) => <li key={cue.id}><strong>Caption {index + 1}</strong>{planSong && <button type="button" className="secondary" aria-label={`Listen from caption ${index + 1} start`} disabled={!Number.isSafeInteger(cue.startMs) || cue.startMs < 0 || cue.startMs >= (planSong.durationMs ?? 0)} onClick={() => listenFromCue(cue)}>Listen from start</button>}<div className="song-plan-times"><TimeField label="Start" value={cue.startMs} onCommit={n => changeCue(index, { startMs: n })}/><TimeField label="End" value={cue.endMs} onCommit={n => changeCue(index, { endMs: n })}/></div><label>Words<input required maxLength={300} value={cue.text} onChange={e => changeCue(index, { text: e.target.value })}/></label><label>Speaker <span className="small">optional</span><input maxLength={80} value={cue.speaker} onChange={e => changeCue(index, { speaker: e.target.value })}/></label><button type="button" className="secondary" aria-label={`Split caption ${index + 1}`} disabled={cues.length >= 100 || !splitCaption(cue, `${cue.id}_preview`)} onClick={() => { const parts = splitCaption(cue, `cue_${crypto.randomUUID().replaceAll('-', '')}`); if (parts) setCues(current => current.flatMap((item, i) => i === index ? parts : [item])); }}>Split caption</button><button type="button" className="secondary" aria-label={`Join caption ${index + 1} with next`} disabled={!joinCaptions(cue, cues[index + 1])} onClick={() => setCues(current => { const joined = joinCaptions(current[index], current[index + 1]); return joined ? current.flatMap((item, i) => i === index ? [joined] : i === index + 1 ? [] : [item]) : current; })}>Join with next</button><button type="button" className="quiet" onClick={() => setCues(current => current.filter((_, i) => i !== index))}>Remove caption</button></li>)}</ol><button type="button" className="secondary" disabled={cues.length >= 100} onClick={() => { const slot = captionSlot ?? { startMs: draft.startMs, endMs: Math.min(draft.startMs + 2000, draft.endMs) }; setCues(current => [...current, { id: `cue_${crypto.randomUUID().replaceAll('-', '')}`, ...slot, text: '', speaker: '' }]); }}>Add caption</button>{!captionSlot && cues.length < 100 && <p className="small">No free time remains. A new caption will overlap; adjust the timing if needed.</p>}<p className="small">New captions use an open time window as a starting point. Split divides words and time roughly in half; adjust both to match the audio. Splitting needs at least two words, two milliseconds and room for another caption. Join works for adjacent captions with matching speakers and no gap or overlap; it keeps their combined time.</p><label className="song-check"><input type="checkbox" checked={captionRights} onChange={e => setCaptionRights(e.target.checked)} /> I own these words or have permission to use them.</label><button type="button" disabled={!captionRights || !changedCues || conflict} onClick={() => void run(async () => { const result = await request(`${base}/${saved.id}/captions`, 'PATCH', { expectedRevision: saved.revision, rightsConfirmed: captionRights, cues }); savedCaptions(result.plan); setMessage('Captions saved.'); })}>Save captions</button></fieldset>
        {(changedPlan || changedCues || changedDirection || changedReference || changedStarts) && <button type="button" className="quiet" onClick={() => { if (window.confirm('Discard unsaved edits to this plan?')) open(saved); }}>Discard unsaved edits</button>}
        {Boolean(saved.captions?.cues.length) && <p className="song-downloads">Download saved captions: <a href={`${base}/${saved.id}/captions?format=srt&download=1`}>SRT</a> · <a href={`${base}/${saved.id}/captions?format=vtt&download=1`}>WebVTT</a>{changedCues && <span className="small"> (downloads do not include unsaved edits)</span>}</p>}</div>
      </div>}
    </>}
  </section>;
}
