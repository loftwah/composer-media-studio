import { useState } from 'react';

// Ask the saved plan what is actually wrong with a shot. Everything shown here
// comes from the plan, the take, its job receipt and recorded hashes; the call
// makes no model request, provider request or charge.

type SavedPlan = { id: string; revision: number; scenes: { id: string }[] };
type Evidence = {
  timing: string;
  direction: string | null;
  reference: { id: string; title: string; shaLabel: string; available: boolean } | null;
  take: { id: string; title: string; shaLabel: string; durationMs: number | null; available: boolean; coversSceneMs: boolean } | null;
  receipt: { id: string; status: string; model: string; providerRequestId: string | null; errorCode: string | null; errorDetail: string | null; costEstimateMicro: number | null } | null;
};
type Rerun = { required: boolean; generationId: string | null; modelLabel: string | null; estimateLabel: string | null; basis: string; note?: string; settings?: { prompt: string | null; aspect: string | null; durationSeconds: number | null; referenceSha256: string | null } | null };
type Shot = { sceneId: string; position: number; code: string; summary: string; nextStep: string; requiresRerun: boolean; rerun: Rerun | null; evidence: Evidence };
type WaitingJob = { id: string; model: string; status: string; code: string; summary: string; nextStep: string };
type Diagnosis = {
  plan: { id: string; revision: number; updatedAt: number; revisionDigest: string };
  answer: string;
  shots: Shot[];
  waitingJobs: WaitingJob[];
  cost: { rerunLabel: string | null; basis: string; shotCount: number };
  nothingSubmitted: boolean;
};

export function ShotDoctor({ projectId, plan }: { projectId: string; plan: SavedPlan }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    if (busy || !selected.length) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/song-plans/${encodeURIComponent(plan.id)}/shot-diagnosis`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: plan.revision, sceneIds: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `The saved shots could not be read (${response.status}).`);
      setResult(data as Diagnosis);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The saved shots could not be read.');
    } finally { setBusy(false); }
  }

  return <details className="scene-direction-editor">
    <summary>Why is this shot wrong, and what would a rerun cost?</summary>
    <p className="small">Reads only the saved plan, the selected take, its job receipt and recorded source hashes. It makes no model or provider request, generates nothing and charges nothing.</p>
    <fieldset className="scene-direction-selection" disabled={busy}>
      <legend>Shots to inspect</legend>
      {plan.scenes.map((scene, index) => <label className="song-check" key={scene.id}>
        <input type="checkbox" checked={selected.includes(scene.id)} onChange={event => {
          const checked = event.currentTarget.checked;
          setSelected(current => checked ? [...current, scene.id] : current.filter(id => id !== scene.id));
          setResult(null); setError('');
        }} /> Scene {index + 1}
      </label>)}
    </fieldset>
    <div className="row"><button type="button" disabled={busy || !selected.length} onClick={() => void check()}>{busy ? 'Reading saved evidence…' : 'Check these shots'}</button></div>
    {error && <p role="alert">{error}</p>}
    {result && <div className="scene-direction-preview" aria-live="polite">
      <p><strong>{result.answer}</strong></p>
      <p className="small">Read plan revision {result.plan.revision} · revision identity <code>{result.plan.revisionDigest.slice(0, 12)}</code>. Nothing was submitted, generated or charged.</p>
      <ol>{result.shots.map(shot => <li key={shot.sceneId}>
        <strong>Scene {shot.position} — {shot.code === 'ok' ? 'no recorded fault' : shot.code.replaceAll('_', ' ')}</strong>
        <p>{shot.summary}</p>
        <p className="small">{shot.nextStep}</p>
        <dl>
          <dt>Timing</dt><dd>{shot.evidence.timing}</dd>
          <dt>Direction</dt><dd>{shot.evidence.direction || 'No saved direction'}</dd>
          <dt>Reference still</dt><dd>{shot.evidence.reference ? `${shot.evidence.reference.title} · SHA-256 ${shot.evidence.reference.shaLabel}${shot.evidence.reference.available ? '' : ' · deleted'}` : 'None'}</dd>
          <dt>Selected take</dt><dd>{shot.evidence.take ? `${shot.evidence.take.title} · ${shot.evidence.take.durationMs === null ? 'duration unmeasured' : `${shot.evidence.take.durationMs} ms`} · SHA-256 ${shot.evidence.take.shaLabel}${shot.evidence.take.available ? '' : ' · deleted'}` : 'None saved'}</dd>
          <dt>Job receipt</dt><dd>{shot.evidence.receipt ? `${shot.evidence.receipt.id} · ${shot.evidence.receipt.status} · ${shot.evidence.receipt.model}${shot.evidence.receipt.errorCode ? ` · ${shot.evidence.receipt.errorCode}` : ''}${shot.evidence.receipt.providerRequestId ? ` · provider request ${shot.evidence.receipt.providerRequestId}` : ''}` : 'No job is linked to this take'}</dd>
          {shot.evidence.receipt?.errorDetail && <><dt>Provider detail</dt><dd>{shot.evidence.receipt.errorDetail}</dd></>}
          <dt>Rerun</dt><dd>{shot.rerun?.required ? `${shot.rerun.estimateLabel ? `${shot.rerun.estimateLabel} at the saved estimate` : 'No recorded price'}${shot.rerun.modelLabel ? ` · ${shot.rerun.modelLabel}` : ''}. ${shot.rerun.basis}${shot.rerun.note ? ` ${shot.rerun.note}` : ''}` : 'Not needed'}</dd>
        </dl>
      </li>)}</ol>
      {result.waitingJobs.length > 0 && <div>
        <h5>Jobs without a saved result</h5>
        <ul>{result.waitingJobs.map(job => <li key={job.id}><strong>{job.model} · {job.status}</strong><p>{job.summary}</p><p className="small">{job.nextStep}</p></li>)}</ul>
      </div>}
    </div>}
  </details>;
}
