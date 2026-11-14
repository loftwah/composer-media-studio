import { useEffect, useRef, useState } from 'react';

type Change = { sceneId:string; before:{direction:string;referenceAssetId:string|null}; after:{direction:string;referenceAssetId:string|null} };
type Review = { proposal:{projectId:string;planId:string;expectedRevision:number;changes:Change[]}; reviewDigest:string };
type SavedPlan = {id:string;revision:number;scenes:{id:string;direction:string;referenceAssetId:string|null}[]};
const drafts = new Map<string,string>();

/** Review a typed agent proposal against the actual saved plan. No model is called. */
export function SceneProposalReview({ projectId, plan, images, changed, canEdit, onApply }: { projectId:string;plan:SavedPlan;images:{id:string;title:string}[];changed:boolean;canEdit:boolean;onApply:(review:Review)=>boolean }) {
  const referenceName = (id:string|null) => id ? (images.find(image => image.id===id)?.title || `Unavailable reference (${id})`) : 'none';
  const key=`${projectId}:${plan.id}`, [source,setSource]=useState(()=>drafts.get(key) ?? ''), [review,setReview]=useState<Review|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if (!source.trim()) return; const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[source]);
  async function preview() {
    if (busy || changed) return;
    setError(''); setReview(null); let input:unknown, oldDigest:string|undefined;
    try {
      const parsed=JSON.parse(source); const proposal=parsed?.proposal;
      if (proposal) {
        if (proposal.projectId !== projectId || proposal.planId !== plan.id || !Array.isArray(proposal.changes)) throw new Error('This proposal belongs to another plan.');
        input={expectedRevision:proposal.expectedRevision,changes:proposal.changes.map((item:{sceneId:string;after:{direction:string;referenceAssetId:string|null}})=>({sceneId:item.sceneId,direction:item.after.direction,referenceAssetId:item.after.referenceAssetId}))}; oldDigest=parsed.reviewDigest;
      } else input=parsed;
    } catch(error) {setError(error instanceof Error ? error.message : 'Paste a valid proposal.');return;}
    const task=new AbortController();controller.current=task;setBusy(true);
    try {
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/song-plans/${encodeURIComponent(plan.id)}/scene-proposal/preview`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:task.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error?.message || 'Could not preview the proposal.');
      if(oldDigest && oldDigest!==data.reviewDigest)throw new Error('The proposal or its references changed. Ask for a fresh preview.');
      setReview(data);
    } catch(error) {if(!task.signal.aborted)setError(error instanceof Error?error.message:'Could not preview the proposal.');}
    finally {if(controller.current===task){controller.current=null;setBusy(false);}}
  }
  function apply() {
    if (!review || changed || review.proposal.expectedRevision!==plan.revision || !onApply(review)) {setError('The plan or draft changed. Review again after saving or discarding your edits.');return;}
    drafts.delete(key);setSource('');setReview(null);setError('');
  }
  return <details className="scene-direction-editor"><summary>Review a scene proposal</summary><p className="small">Paste a typed proposal from your connected agent. Preview compares it with this saved plan; applying changes your draft only. Save the scene plan to keep it. No model or paid request is used.</p>
    <label>Proposal JSON<textarea value={source} disabled={busy} maxLength={16384} onChange={event=>{const value=event.target.value;drafts.set(key,value);setSource(value);setReview(null);setError('');}} /></label>
    {changed && <p className="small">Save or discard existing scene-plan edits before previewing a proposal.</p>}
    <button type="button" className="secondary" disabled={busy || changed || !source.trim()} onClick={()=>void preview()}>Preview proposal</button>
    {error && <p role="alert">{error}</p>}
    {review && <div className="scene-direction-preview"><p>Review these changes. Timing, selected takes and captions stay unchanged.</p><ol>{review.proposal.changes.map(change=><li key={change.sceneId}><strong>Scene {plan.scenes.findIndex(scene=>scene.id===change.sceneId)+1}</strong><dl><dt>Before</dt><dd>{change.before.direction || 'No direction'} · reference {referenceName(change.before.referenceAssetId)}</dd><dt>After</dt><dd>{change.after.direction || 'No direction'} · reference {referenceName(change.after.referenceAssetId)}</dd></dl></li>)}</ol><button type="button" disabled={!canEdit || changed || review.proposal.expectedRevision!==plan.revision} onClick={apply}>Apply to draft</button></div>}
  </details>;
}
