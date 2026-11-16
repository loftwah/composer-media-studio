import { directorHandoff, currentDirectorHandoff } from './director-handoff.mjs';
import { ShotDoctor } from './shot-doctor';
import { useEffect, useRef, useState } from 'react';
import './scene-proposal-review.css';

// Three different ways to change a saved song plan live here, and each says what
// it costs and whether anything is saved:
//   1. the Studio Director (one bounded model request, proposes only),
//   2. a connected agent (a private brief built in this browser, then a typed
//      proposal pasted back),
//   3. the manual editor further down the plan.
// Nothing in this component saves a plan. Applying writes to the draft only.

type Change = { sceneId: string; before: { direction: string; referenceAssetId: string | null }; after: { direction: string; referenceAssetId: string | null } };
type Review = {
  proposal: { projectId: string; planId: string; expectedRevision: number; changes: Change[] };
  reviewDigest: string;
  revision?: { id: string; revision: number; updatedAt: number; digest: string };
  director?: { model: string };
};
type SavedPlan = { id: string; revision: number; revisionDigest?: string; scenes: { id: string; direction: string; referenceAssetId: string | null }[] };
type Origin = 'director' | 'agent';

const drafts = new Map<string, string>();
const intentDrafts = new Map<string, string>();
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Choose a reviewed scene-direction proposal from the Director or an agent. No model runs without an explicit ask, and nothing is saved here. */
export function SceneProposalReview({ projectId, plan, images, changed, canEdit, onApply }: { projectId: string; plan: SavedPlan; images: { id: string; title: string }[]; changed: boolean; canEdit: boolean; onApply: (review: Review, acceptSceneIds: string[]) => boolean }) {
  const referenceName = (id: string | null) => id ? (images.find(image => image.id === id)?.title || `Unavailable reference (${id})`) : 'none';
  const key = `${projectId}:${plan.id}`;
  const [source, setSource] = useState(() => drafts.get(key) ?? '');
  const [review, setReview] = useState<Review | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewInfo, setPreviewInfo] = useState('');
  const [applyError, setApplyError] = useState('');
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ kept: number; total: number } | null>(null);
  const [intent, setIntent] = useState(() => intentDrafts.get(key) ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [handoff, setHandoff] = useState<{ text: string; fingerprint: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [askInfo, setAskInfo] = useState('');
  const handoffFingerprint = JSON.stringify({ projectId, plan, selected, intent });
  const handoffCurrent = currentDirectorHandoff(handoff, handoffFingerprint, changed);
  const previewController = useRef<AbortController | null>(null);
  const askController = useRef<AbortController | null>(null);
  useEffect(() => () => { previewController.current?.abort(); askController.current?.abort(); }, []);
  useEffect(() => { if (changed) { setHandoff(null); setCopyStatus(''); } }, [changed]);
  useEffect(() => { if (!source.trim() && !intent.trim()) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [source, intent]);

  // The revision the last answer was read from, once the server has confirmed it.
  const readRevision = review?.revision?.revision ?? plan.revision;
  const readDigest = review?.revision?.digest ?? plan.revisionDigest;
  const keptCount = review ? review.proposal.changes.length - declined.length : 0;
  const missing = !selected.length ? 'Tick at least one scene first.' : !ask.trim() ? 'Describe the change you want.' : '';

  async function preview() {
    if (busy || changed) return;
    setPreviewError(''); setPreviewInfo(''); setReview(null); setOrigin(null); setReceipt(null); setAskInfo('');
    let input: unknown, oldDigest: string | undefined;
    try {
      const parsed = JSON.parse(source); const proposal = parsed?.proposal;
      if (proposal) {
        if (proposal.projectId !== projectId || proposal.planId !== plan.id || !Array.isArray(proposal.changes)) throw new Error('This proposal belongs to another plan.');
        input = { expectedRevision: proposal.expectedRevision, changes: proposal.changes.map((item: { sceneId: string; after: { direction: string; referenceAssetId: string | null } }) => ({ sceneId: item.sceneId, direction: item.after.direction, referenceAssetId: item.after.referenceAssetId })) };
        oldDigest = parsed.reviewDigest;
      } else input = parsed;
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'Paste a valid proposal.'); return; }
    const task = new AbortController(); previewController.current = task; setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/song-plans/${encodeURIComponent(plan.id)}/scene-proposal/preview`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: task.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || 'Could not preview the proposal.');
      if (oldDigest && oldDigest !== data.reviewDigest) throw new Error('The proposal or its references changed. Ask for a fresh preview.');
      setReview(data); setOrigin('agent'); setDeclined([]);
      setPreviewInfo(`${plural(data.proposal.changes.length, 'change')} ready to review below. Nothing has been applied or saved.`);
    } catch (error) { if (!task.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Could not preview the proposal.'); }
    finally { if (previewController.current === task) { previewController.current = null; setBusy(false); } }
  }

  function apply() {
    if (!review) return;
    setApplyError('');
    const accept = review.proposal.changes.filter(change => !declined.includes(change.sceneId)).map(change => change.sceneId);
    if (!accept.length) { setApplyError('Include at least one reviewed change to apply. Declining every change leaves the plan as it is.'); return; }
    if (changed || review.proposal.expectedRevision !== plan.revision || !onApply(review, accept)) { setApplyError('The plan or draft changed. Review again after saving or discarding your edits.'); return; }
    drafts.delete(key); setSource(''); setDeclined([]); setApplyError(''); setAskInfo(''); setPreviewInfo('');
    setReceipt({ kept: accept.length, total: review.proposal.changes.length });
    setReview(null); setOrigin(null);
  }

  async function askDirector() {
    if (asking || changed || !ask.trim() || !selected.length) return;
    askController.current?.abort();
    const task = new AbortController(); askController.current = task;
    setAsking(true); setAskError(''); setAskInfo(''); setReview(null); setOrigin(null); setReceipt(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/song-plans/${encodeURIComponent(plan.id)}/director`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: plan.revision, request: ask.trim(), sceneIds: selected }), signal: task.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || `The Studio Director could not answer (${response.status}).`);
      if (data.proposal?.expectedRevision !== plan.revision) throw new Error('The plan changed while the Director was thinking. Reload before applying anything.');
      setReview(data); setOrigin('director'); setDeclined([]); setAsk('');
      setAskInfo(`Read saved plan revision ${plan.revision} and proposed ${plural(data.proposal.changes.length, 'direction change')}. Nothing has been applied, generated or charged.`);
    } catch (error) {
      if (!task.signal.aborted && !changed) setAskError(error instanceof Error ? error.message : 'The Studio Director could not answer.');
    } finally {
      if (askController.current === task) { askController.current = null; setAsking(false); }
    }
  }

  return <>
    <section className="director-panel" aria-labelledby="director-title" data-director="chat">
      <div className="director-head">
        <h4 id="director-title">Studio Director</h4>
        <p className="director-lede">Describe a change in your own words. The Director reads this saved plan and the scenes you tick, then proposes direction edits you review one by one. Nothing is applied, generated or charged until you apply it to your draft.</p>
        <p className="director-read">Reads saved plan revision {readRevision}{readDigest ? <> · revision identity <code>{readDigest.slice(0, 12)}</code></> : null} with directions, timing, reference and take titles, and overlapping caption text. Your unsaved edits are not sent.</p>
      </div>
      <fieldset className="director-scenes" disabled={!canEdit || changed || asking}>
        <legend>Scenes the Director or your agent may change</legend>
        <div className="director-scene-list">{plan.scenes.map((scene, index) => <label key={scene.id} className="song-check"><input type="checkbox" checked={selected.includes(scene.id)} onChange={event => {
          const checked = event.currentTarget.checked;
          setSelected(current => checked ? [...current, scene.id] : current.filter(id => id !== scene.id));
          setHandoff(null); setCopyStatus(''); setAskError(''); setAskInfo(''); setReview(null); setOrigin(null);
        }} /> Scene {index + 1}</label>)}</div>
      </fieldset>
      <div className="director-ask">
        <div className="director-ask-row">
          <label>What should change?<textarea value={ask} maxLength={1200} disabled={!canEdit || asking} placeholder="For example: make scenes 2 and 3 warmer and slower without changing the takes." onChange={event => { setAsk(event.currentTarget.value); setAskError(''); setAskInfo(''); setReview(null); setOrigin(null); }} /></label>
          <button type="button" disabled={!canEdit || changed || asking || !ask.trim() || !selected.length} onClick={() => void askDirector()}>{asking ? 'Asking the Director…' : 'Ask the Director'}</button>
        </div>
        <p className="small">{changed ? 'Save or discard your scene-plan edits before asking the Director.' : 'One bounded Workers AI request, included in this installation. It generates no media and charges no media provider.'}</p>
        {!changed && missing && <p className="small director-hint">{missing}</p>}
        {asking && <p className="director-status" role="status">Reading saved plan revision {plan.revision} and drafting a proposal…</p>}
        {askError && <p role="alert">{askError}</p>}
        {askInfo && <p className="director-status" role="status">{askInfo}</p>}
      </div>
    </section>

    <section className="director-agent" aria-labelledby="director-agent-title" data-director="agent">
      <h4 id="director-agent-title">Your connected agent</h4>
      <p className="small">Studio builds a private brief in this browser. You take it to an agent with Studio access, then paste the typed proposal back. It uses the scenes ticked above. No message is sent and nothing is charged by Studio; your agent may charge you under its own plan. Nothing is saved until you save the scene plan.</p>
      <div className="director-agent-steps">
        <div className="director-step">
          <label>1. What would you like to change?<textarea value={intent} maxLength={1200} disabled={!canEdit || busy} onChange={event => { const value = event.currentTarget.value; setIntent(value); intentDrafts.set(key, value); setHandoff(null); setCopyStatus(''); }} /></label>
          <button type="button" className="secondary" disabled={!canEdit || changed || busy || !intent.trim() || !selected.length} onClick={() => { const text = directorHandoff(projectId, plan, selected, intent); if (text) { setHandoff({ text, fingerprint: handoffFingerprint }); setCopyStatus(''); } }}>Prepare private brief</button>
          {!selected.length && <p className="small">Tick at least one scene above.</p>}
        </div>
        <div className="director-step">
          {handoffCurrent
            ? <><label>2. Private brief — review before sharing<textarea readOnly value={handoffCurrent} rows={8} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="secondary" onClick={() => { if (!navigator.clipboard) { setCopyStatus('Select the brief above and copy it manually.'); return; } void navigator.clipboard.writeText(handoffCurrent).then(() => setCopyStatus('Copied. Paste it into your connected agent.'), () => setCopyStatus('Copy failed. Select the brief above and copy it manually.')); }}>Copy brief</button>{copyStatus && <p className="small" role="status">{copyStatus}</p>}</>
            : <><p className="director-step-title">2. Private brief</p><p className="small">The brief appears here after you prepare it. It stays in this browser and includes the ticked saved directions and reference ids, which may be private. Share it only with an agent you trust.</p></>}
        </div>
        <div className="director-step">
          <label>3. Paste the agent's typed proposal<textarea value={source} disabled={busy} maxLength={16384} placeholder="Paste the proposal JSON your agent returned." onChange={event => { const value = event.currentTarget.value; drafts.set(key, value); setSource(value); setReview(null); setOrigin(null); setPreviewError(''); setPreviewInfo(''); }} /></label>
          <button type="button" className="secondary" disabled={busy || changed || !source.trim()} onClick={() => void preview()}>{busy ? 'Previewing…' : 'Preview proposal'}</button>
          <p className="small" role="status">{previewInfo || 'Preview compares the proposal with this saved plan. A review appears below; applying changes your draft only.'}</p>
          {changed && <p className="small">Save or discard your scene-plan edits before previewing a proposal.</p>}
          {previewError && <p role="alert">{previewError}</p>}
        </div>
      </div>
    </section>

    {review && <section className="director-review" aria-labelledby="director-review-title" data-director="review">
      <div className="director-review-head">
        <h4 id="director-review-title">Review the proposal</h4>
        <p className="small">
          {origin === 'director' ? 'From the Studio Director' : 'Pasted from your connected agent'}
          {origin === 'director' && review.director?.model ? <> · <code>{review.director.model}</code></> : null}
          {' · '}pinned to saved plan revision {review.proposal.expectedRevision}
          {review.revision ? <> · revision identity <code>{review.revision.digest.slice(0, 12)}</code></> : null}
        </p>
      </div>
      <p>Timing, selected takes and captions stay unchanged. Untick a change to decline it; only ticked changes reach your draft. Nothing is saved until you save the scene plan.</p>
      <p className="director-status" role="status">Keeping {keptCount} of {plural(review.proposal.changes.length, 'change')}. {declined.length ? `${plural(declined.length, 'declined change')} will keep the saved direction.` : 'Nothing has been applied to your draft yet.'}</p>
      <ol className="director-changes">{review.proposal.changes.map(change => {
        const refused = declined.includes(change.sceneId);
        const position = plan.scenes.findIndex(scene => scene.id === change.sceneId) + 1;
        return <li key={change.sceneId}>
          <label className="song-check"><input type="checkbox" checked={!refused} onChange={event => {
            const include = event.currentTarget.checked;
            setDeclined(current => include ? current.filter(id => id !== change.sceneId) : [...current, change.sceneId]);
            setApplyError('');
          }} /> Include this change to <strong>Scene {position}</strong></label>
          <p className="small">{refused ? 'Declined — this scene keeps its saved direction.' : 'Kept — applies to your draft only, not saved yet.'}</p>
          <dl><dt>Before</dt><dd>{change.before.direction || 'No direction'} · reference {referenceName(change.before.referenceAssetId)}</dd><dt>After</dt><dd>{change.after.direction || 'No direction'} · reference {referenceName(change.after.referenceAssetId)}</dd></dl>
        </li>;
      })}</ol>
      <div className="row">
        <button type="button" disabled={!canEdit || changed || review.proposal.expectedRevision !== plan.revision || keptCount === 0} onClick={apply}>Apply {keptCount} of {review.proposal.changes.length} {review.proposal.changes.length === 1 ? 'change' : 'changes'} to draft</button>
        {!canEdit && <span className="small">This connection can review a proposal; applying needs project edit access.</span>}
      </div>
      {applyError && <p role="alert">{applyError}</p>}
    </section>}

    {receipt && <p className="director-receipt" data-director="applied"><strong>Applied to this draft — not saved.</strong> {receipt.kept} of {receipt.total} reviewed {receipt.total === 1 ? 'change is' : 'changes are'} in the draft now. Save the scene plan to keep {receipt.kept === 1 ? 'it' : 'them'}.</p>}

    <ShotDoctor projectId={projectId} plan={plan} />
  </>;
}
