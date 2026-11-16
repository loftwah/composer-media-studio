import { directorHandoff, currentDirectorHandoff } from './director-handoff.mjs';
import { ShotDoctor } from './shot-doctor';
import { useEffect, useRef, useState } from 'react';

type Change = { sceneId:string; before:{direction:string;referenceAssetId:string|null}; after:{direction:string;referenceAssetId:string|null} };
type Review = { proposal:{projectId:string;planId:string;expectedRevision:number;changes:Change[]}; reviewDigest:string; revision?:{id:string;revision:number;updatedAt:number;digest:string} };
type SavedPlan = {id:string;revision:number;scenes:{id:string;direction:string;referenceAssetId:string|null}[]};
const drafts = new Map<string,string>();
const intentDrafts = new Map<string,string>();

/** Review a typed agent proposal against the actual saved plan. No model is called. */
export function SceneProposalReview({ projectId, plan, images, changed, canEdit, onApply }: { projectId:string;plan:SavedPlan;images:{id:string;title:string}[];changed:boolean;canEdit:boolean;onApply:(review:Review,acceptSceneIds:string[])=>boolean }) {
  const referenceName = (id:string|null) => id ? (images.find(image => image.id===id)?.title || `Unavailable reference (${id})`) : 'none';
  const key=`${projectId}:${plan.id}`, [source,setSource]=useState(()=>drafts.get(key) ?? ''), [review,setReview]=useState<Review|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [declined,setDeclined]=useState<string[]>([]);
  const [intent,setIntent]=useState(()=>intentDrafts.get(key) ?? '');
  const [selected,setSelected]=useState<string[]>([]);
  const [handoff,setHandoff]=useState<{text:string; fingerprint:string}|null>(null);
  const [copyStatus,setCopyStatus]=useState('');
  const [ask,setAsk]=useState('');
  const [askBusy,setAskBusy]=useState(false);
  const [askError,setAskError]=useState('');
  const [askInfo,setAskInfo]=useState('');
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
      setReview(data); setDeclined([]);
    } catch(error) {if(!task.signal.aborted)setError(error instanceof Error?error.message:'Could not preview the proposal.');}
    finally {if(controller.current===task){controller.current=null;setBusy(false);}}
  }
  function apply() {
    const accept=review ? review.proposal.changes.filter(change=>!declined.includes(change.sceneId)).map(change=>change.sceneId) : [];
    if (!accept.length) {setError('Include at least one reviewed change to apply. Declining every change leaves the plan as it is.');return;}
    if (!review || changed || review.proposal.expectedRevision!==plan.revision || !onApply(review, accept)) {setError('The plan or draft changed. Review again after saving or discarding your edits.');return;}
    drafts.delete(key);setSource('');setReview(null);setDeclined([]);setError('');
  }
  async function askDirector() {
    if (askBusy || changed || !ask.trim() || !selected.length) return;
    setAskBusy(true); setAskError(''); setAskInfo(''); setReview(null);
    try {
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/song-plans/${encodeURIComponent(plan.id)}/director`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:plan.revision,request:ask.trim(),sceneIds:selected})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error?.message || `The Studio Director could not answer (${response.status}).`);
      if(data.proposal?.expectedRevision!==plan.revision) throw new Error('The plan changed while the Director was thinking. Reload before applying anything.');
      setReview(data); setDeclined([]); setAsk('');
      setAskInfo(`${data.director?.model || 'The Studio Director'} proposed ${data.proposal.changes.length} direction change${data.proposal.changes.length===1?'':'s'}. Nothing has been applied, generated or charged.`);
    } catch(error) { if(!changed) setAskError(error instanceof Error?error.message:'The Studio Director could not answer.'); }
    finally { setAskBusy(false); }
  }
  return <details className="scene-direction-editor"><summary>Review a scene proposal</summary><details><summary>Ask the Studio Director</summary><p className="small">Describe the change in your own words. The Director reads the saved plan and the ticked scenes, then returns a typed direction proposal for you to review. It cannot change takes, timing, references or captions, generate media, publish or spend. A model reply is a suggestion, not a saved edit.</p><fieldset disabled={changed || askBusy}><legend>Scenes the Director may change</legend>{plan.scenes.map((scene,index)=><label key={scene.id} className="song-check"><input type="checkbox" checked={selected.includes(scene.id)} onChange={event=>{const checked=event.currentTarget.checked;setSelected(current=>checked?[...current,scene.id]:current.filter(id=>id!==scene.id));setHandoff(null);setCopyStatus('');setAskError('');setAskInfo('');setReview(null);}} /> Scene {index+1}</label>)}</fieldset><label>What should change?<textarea value={ask} maxLength={1200} disabled={askBusy} placeholder="For example: make scenes 2 and 3 warmer and slower without changing the takes." onChange={event=>{setAsk(event.currentTarget.value);setAskError('');setAskInfo('');setReview(null);}} /></label><div className="row"><button type="button" disabled={changed || askBusy || !ask.trim() || !selected.length} onClick={()=>void askDirector()}>{askBusy?'Asking the Director…':'Ask the Director'}</button></div>{changed && <p className="small">Save or discard existing scene-plan edits before asking the Director.</p>}{askError && <p role="alert">{askError}</p>}{askInfo && <p className="small" role="status">{askInfo}</p>}</details><details><summary>Ask your connected agent for a proposal</summary><p className="small">Choose scenes and describe the change. Preparing this brief stays in your browser. It includes the selected saved directions and reference IDs, which may be private. Share it only with an agent you trust. No message, model request or paid action is sent by Studio.</p><fieldset disabled={changed || busy}><legend>Saved scenes to include</legend>{plan.scenes.map((scene,index)=><label key={scene.id} className="song-check"><input type="checkbox" checked={selected.includes(scene.id)} onChange={event=>{const checked=event.currentTarget.checked;setSelected(current=>checked?[...current,scene.id]:current.filter(id=>id!==scene.id));setHandoff(null);setCopyStatus('');}} /> Scene {index+1}</label>)}</fieldset><label>What would you like to change?<textarea value={intent} maxLength={1200} disabled={busy} onChange={event=>{const value=event.currentTarget.value;setIntent(value);intentDrafts.set(key,value);setHandoff(null);setCopyStatus('');}} /></label><button type="button" className="secondary" disabled={changed || busy || !intent.trim() || !selected.length} onClick={()=>{const text=directorHandoff(projectId,plan,selected,intent);if(text){setHandoff({text,fingerprint:handoffFingerprint});setCopyStatus('');}}}>Prepare agent brief</button>{handoffCurrent && <div><label>Review the private brief before sharing<textarea readOnly value={handoffCurrent} rows={10} onFocus={event=>event.currentTarget.select()} /></label><button type="button" className="secondary" onClick={()=>{if (!navigator.clipboard) { setCopyStatus('Select the brief above and copy it manually.'); return; } void navigator.clipboard.writeText(handoffCurrent).then(()=>setCopyStatus('Copied. Paste it into your connected agent.'),()=>setCopyStatus('Copy failed. Select the brief above and copy it manually.'));}}>Copy brief</button>{copyStatus && <p className="small" role="status">{copyStatus}</p>}</div>}</details><p className="small">Paste a typed proposal from your connected agent. Preview compares it with this saved plan; applying changes your draft only. Save the scene plan to keep it. No model or paid request is used.</p>
    <label>Proposal JSON<textarea value={source} disabled={busy} maxLength={16384} onChange={event=>{const value=event.target.value;drafts.set(key,value);setSource(value);setReview(null);setError('');}} /></label>
    {changed && <p className="small">Save or discard existing scene-plan edits before previewing a proposal.</p>}
    <button type="button" className="secondary" disabled={busy || changed || !source.trim()} onClick={()=>void preview()}>Preview proposal</button>
    {error && <p role="alert">{error}</p>}
    {review && <div className="scene-direction-preview"><p>Review these changes. Timing, selected takes and captions stay unchanged. Untick a change to decline it; only ticked changes reach your draft.</p>{review.revision && <p className="small">Read plan revision {review.revision.revision} · revision identity <code>{review.revision.digest.slice(0,12)}</code></p>}<ol>{review.proposal.changes.map(change=>{const refused=declined.includes(change.sceneId);return <li key={change.sceneId}><label className="song-check"><input type="checkbox" checked={!refused} onChange={event=>{const include=event.currentTarget.checked;setDeclined(current=>include?current.filter(id=>id!==change.sceneId):[...current,change.sceneId]);setError('');}} /> Include this change {refused && <span className="small">(declined)</span>}</label><strong>Scene {plan.scenes.findIndex(scene=>scene.id===change.sceneId)+1}</strong><dl><dt>Before</dt><dd>{change.before.direction || 'No direction'} · reference {referenceName(change.before.referenceAssetId)}</dd><dt>After</dt><dd>{change.after.direction || 'No direction'} · reference {referenceName(change.after.referenceAssetId)}</dd></dl></li>;})}</ol><button type="button" disabled={!canEdit || changed || review.proposal.expectedRevision!==plan.revision || declined.length===review.proposal.changes.length} onClick={apply}>Apply {review.proposal.changes.length-declined.length} of {review.proposal.changes.length} change{review.proposal.changes.length===1?'':'s'} to draft</button></div>}
    <ShotDoctor projectId={projectId} plan={plan} />
  </details>;
}
