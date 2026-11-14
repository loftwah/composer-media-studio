import { directorHandoff, currentDirectorHandoff } from './director-handoff.mjs';
import { useEffect, useRef, useState } from 'react';

type Change = { sceneId:string; before:{direction:string;referenceAssetId:string|null}; after:{direction:string;referenceAssetId:string|null} };
type Review = { proposal:{projectId:string;planId:string;expectedRevision:number;changes:Change[]}; reviewDigest:string };
type SavedPlan = {id:string;revision:number;scenes:{id:string;direction:string;referenceAssetId:string|null}[]};
const drafts = new Map<string,string>();
const intentDrafts = new Map<string,string>();

/** Review a typed agent proposal against the actual saved plan. No model is called. */
export function SceneProposalReview({ projectId, plan, images, changed, canEdit, onApply }: { projectId:string;plan:SavedPlan;images:{id:string;title:string}[];changed:boolean;canEdit:boolean;onApply:(review:Review)=>boolean }) {
  const referenceName = (id:string|null) => id ? (images.find(image => image.id===id)?.title || `Unavailable reference (${id})`) : 'none';
  const key=`${projectId}:${plan.id}`, [source,setSource]=useState(()=>drafts.get(key) ?? ''), [review,setReview]=useState<Review|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [intent,setIntent]=useState(()=>intentDrafts.get(key) ?? '');
  const [selected,setSelected]=useState<string[]>([]);
  const [handoff,setHandoff]=useState<{text:string; fingerprint:string}|null>(null);
  const [copyStatus,setCopyStatus]=useState('');
  const handoffFingerprint=JSON.stringify({projectId,plan,selected,intent});
  const handoffCurrent=currentDirectorHandoff(handoff, handoffFingerprint, changed);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if (changed) {setHandoff(null);setCopyStatus('');}},[changed]);
  useEffect(()=>{if (!source.trim() && !intent.trim()) return; const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[source,intent]);
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
  return <details className="scene-direction-editor"><summary>Review a scene proposal</summary><details><summary>Ask your connected agent for a proposal</summary><p className="small">Choose scenes and describe the change. Preparing this brief stays in your browser. It includes the selected saved directions and reference IDs, which may be private. Share it only with an agent you trust. No message, model request or paid action is sent by Studio.</p><fieldset disabled={changed || busy}><legend>Saved scenes to include</legend>{plan.scenes.map((scene,index)=><label key={scene.id} className="song-check"><input type="checkbox" checked={selected.includes(scene.id)} onChange={event=>{const checked=event.currentTarget.checked;setSelected(current=>checked?[...current,scene.id]:current.filter(id=>id!==scene.id));setHandoff(null);setCopyStatus('');}} /> Scene {index+1}</label>)}</fieldset><label>What would you like to change?<textarea value={intent} maxLength={1200} disabled={busy} onChange={event=>{const value=event.currentTarget.value;setIntent(value);intentDrafts.set(key,value);setHandoff(null);setCopyStatus('');}} /></label><button type="button" className="secondary" disabled={changed || busy || !intent.trim() || !selected.length} onClick={()=>{const text=directorHandoff(projectId,plan,selected,intent);if(text){setHandoff({text,fingerprint:handoffFingerprint});setCopyStatus('');}}}>Prepare agent brief</button>{handoffCurrent && <div><label>Review the private brief before sharing<textarea readOnly value={handoffCurrent} rows={10} onFocus={event=>event.currentTarget.select()} /></label><button type="button" className="secondary" onClick={()=>{if (!navigator.clipboard) { setCopyStatus('Select the brief above and copy it manually.'); return; } void navigator.clipboard.writeText(handoffCurrent).then(()=>setCopyStatus('Copied. Paste it into your connected agent.'),()=>setCopyStatus('Copy failed. Select the brief above and copy it manually.'));}}>Copy brief</button>{copyStatus && <p className="small" role="status">{copyStatus}</p>}</div>}</details><p className="small">Paste a typed proposal from your connected agent. Preview compares it with this saved plan; applying changes your draft only. Save the scene plan to keep it. No model or paid request is used.</p>
    <label>Proposal JSON<textarea value={source} disabled={busy} maxLength={16384} onChange={event=>{const value=event.target.value;drafts.set(key,value);setSource(value);setReview(null);setError('');}} /></label>
    {changed && <p className="small">Save or discard existing scene-plan edits before previewing a proposal.</p>}
    <button type="button" className="secondary" disabled={busy || changed || !source.trim()} onClick={()=>void preview()}>Preview proposal</button>
    {error && <p role="alert">{error}</p>}
    {review && <div className="scene-direction-preview"><p>Review these changes. Timing, selected takes and captions stay unchanged.</p><ol>{review.proposal.changes.map(change=><li key={change.sceneId}><strong>Scene {plan.scenes.findIndex(scene=>scene.id===change.sceneId)+1}</strong><dl><dt>Before</dt><dd>{change.before.direction || 'No direction'} · reference {referenceName(change.before.referenceAssetId)}</dd><dt>After</dt><dd>{change.after.direction || 'No direction'} · reference {referenceName(change.after.referenceAssetId)}</dd></dl></li>)}</ol><button type="button" disabled={!canEdit || changed || review.proposal.expectedRevision!==plan.revision} onClick={apply}>Apply to draft</button></div>}
  </details>;
}
