import { useEffect, useRef, useState } from 'react';
import './song-plans.css';

type Scene = { spoken: string; visual: string };
type Draft = { title: string; audience: string; brief: string; cta: string; aspect: string; targetSeconds: number; scenes: Scene[] };
type Saved = Draft & { id: string; revision: number };
type Cache = { draft: Draft; saved: Saved | null };
const empty = (): Draft => ({ title:'', audience:'', brief:'', cta:'', aspect:'16:9', targetSeconds:20, scenes:[{spoken:'',visual:''},{spoken:'',visual:''}] });
const cache = new Map<string, Cache>();
const copy = <T,>(x:T):T => structuredClone(x);
const content = (x: Draft) => ({ title:x.title, audience:x.audience, brief:x.brief, cta:x.cta, aspect:x.aspect, targetSeconds:x.targetSeconds, scenes:x.scenes });
async function request(path:string, method='GET', body?:unknown) {
  const response=await fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) { const error=new Error(data.error?.message ?? `Request failed (${response.status})`) as Error & {status:number}; error.status=response.status; throw error; }
  return data;
}
export function PromoBriefs({projectId,canEdit,onVoiceDraft}:{projectId:string;canEdit:boolean;onVoiceDraft:(script:string)=>string|null}) {
  const base=`/api/projects/${encodeURIComponent(projectId)}/promo-briefs`;
  const cached=cache.get(projectId);
  const [draft,setDraft]=useState<Draft>(()=>copy(cached?.draft ?? empty()));
  const [saved,setSaved]=useState<Saved|null>(()=>copy(cached?.saved ?? null));
  const [items,setItems]=useState<Saved[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [conflict,setConflict]=useState(false);
  const latest=useRef({draft,saved}); latest.current={draft,saved};
  const dirty=JSON.stringify(content(draft))!==JSON.stringify(saved ? content(saved) : empty());
  useEffect(()=>()=>{cache.set(projectId,copy(latest.current));},[projectId]);
  useEffect(()=>{if(!dirty)return; const warn=(event:BeforeUnloadEvent)=>event.preventDefault(); window.addEventListener('beforeunload',warn); return ()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{let active=true; request(base).then(data=>{if(active)setItems(data.briefs);}).catch(e=>{if(active)setError(e.message);}); return ()=>{active=false;};},[base]);
  const mayLeave=()=>!dirty||window.confirm('Discard unsaved changes to this brief?');
  const open=(item:Saved|null)=>{setSaved(item?copy(item):null);setDraft(item?copy(content(item)):empty());setError('');setMessage('');setConflict(false);};
  async function save() {
    setBusy(true);setError('');setMessage('');
    try { const data=await request(saved?`${base}/${encodeURIComponent(saved.id)}`:base,saved?'PATCH':'POST',{...content(draft),...(saved?{expectedRevision:saved.revision}:{})});
      const updated:Saved=data.brief; setSaved(copy(updated));setDraft(copy(content(updated)));setItems(current=>[updated,...current.filter(x=>x.id!==updated.id)]);setMessage('Brief saved privately in this studio.');
    } catch(e) { const err=e as Error & {status?:number}; if(err.status===409) { setConflict(true); try { const data=await request(base); setItems(data.briefs); } catch {} setError('This brief changed elsewhere. Your edits are still here. Review the latest saved version before replacing your draft.'); } else setError(err.message); } finally {setBusy(false);}
  }
  const newest=conflict ? items.find(item=>item.id===saved?.id) : null;
  const script=draft.scenes.map(scene=>scene.spoken.trim()).filter(Boolean).join('\n\n');
  const words=script.trim()?script.trim().split(/\s+/u).length:0;
  const estimated=words ? Math.round(words/140*60) : 0;
  return <section className="song-plans" aria-labelledby="promo-brief-title"><div className="song-plans-heading"><div><h2 id="promo-brief-title">Plan a spoken promo</h2><p>Write the brief and scene ideas before making sound. This is a private draft, not a recording, timed storyboard or finished film.</p></div></div>
    {error&&<p role="alert" className="notice">{error}</p>}{message&&<p role="status" className="notice calm">{message}</p>}
    {newest && <details><summary>Review latest saved version {newest.revision}</summary><p><strong>{newest.title}</strong> · {newest.targetSeconds}s · {newest.aspect}</p><p>{newest.brief}</p><p>Audience: {newest.audience || '—'} · Call to action: {newest.cta || '—'}</p><ol>{newest.scenes.map((scene,index)=><li key={index}><p>Spoken: {scene.spoken || '—'}</p><p>Visual: {scene.visual || '—'}</p></li>)}</ol><button type="button" className="secondary" onClick={()=>{if(window.confirm('Replace your unsaved draft with this saved version?'))open(newest);}}>Load this version</button></details>}
    <div className="song-plan-columns"><div><label>Saved brief<select value={saved?.id ?? ''} disabled={busy} onChange={event=>{const item=items.find(x=>x.id===event.target.value)??null;if(!mayLeave()){event.currentTarget.value=saved?.id??'';return;}open(item);}}><option value="">New brief</option>{items.map(item=><option key={item.id} value={item.id}>{item.title} · v{item.revision}</option>)}</select></label><p className="small">A saved brief does not start a provider request. Open the script in Studio Voice, review the words and estimate, then choose the saved audio in the scene planner.</p></div>
    <form className="stack" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={!canEdit||busy}><label>Title<input value={draft.title} maxLength={80} required onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>Audience<input value={draft.audience} maxLength={300} onChange={event=>setDraft({...draft,audience:event.target.value})}/></label><label>What is this about?<textarea value={draft.brief} maxLength={1200} onChange={event=>setDraft({...draft,brief:event.target.value})}/></label><label>Call to action<input value={draft.cta} maxLength={300} onChange={event=>setDraft({...draft,cta:event.target.value})}/></label><label>Frame<select value={draft.aspect} onChange={event=>setDraft({...draft,aspect:event.target.value})}>{['16:9','9:16','1:1'].map(x=><option key={x}>{x}</option>)}</select></label><label>Target length in seconds<input type="number" min={15} max={30} step={1} value={draft.targetSeconds} onChange={event=>setDraft({...draft,targetSeconds:Number(event.target.value)})}/></label>
      {draft.scenes.map((scene,index)=><div key={index} className="scene-direction-editor"><h4>Scene {index+1}</h4><label>Spoken words<textarea value={scene.spoken} maxLength={600} onChange={event=>setDraft({...draft,scenes:draft.scenes.map((s,i)=>i===index?{...s,spoken:event.target.value}:s)})}/></label><label>Visual idea<textarea value={scene.visual} maxLength={600} onChange={event=>setDraft({...draft,scenes:draft.scenes.map((s,i)=>i===index?{...s,visual:event.target.value}:s)})}/></label>{draft.scenes.length>2&&<button type="button" className="quiet" onClick={()=>{if ((scene.spoken||scene.visual)&&!window.confirm(`Remove scene ${index+1} and its text?`))return;setDraft({...draft,scenes:draft.scenes.filter((_,i)=>i!==index)});}}>Remove scene</button>}</div>)}
      <button type="button" className="secondary" disabled={draft.scenes.length>=6} onClick={()=>setDraft({...draft,scenes:[...draft.scenes,{spoken:'',visual:''}]})}>Add scene</button><p className="small">{words} words · roughly {estimated} seconds at 140 words per minute. Delivery and pauses change the actual duration.</p><button type="submit" disabled={conflict}>{saved?'Save changes':'Save brief'}</button></fieldset></form></div>
    {script&&<div className="scene-direction-editor"><h3>Your script</h3><p className="small">Opening this in Studio Voice prepares a draft only. It does not submit a request. Earlier Create drafts remain recoverable during this session.</p><textarea aria-label="Combined spoken script" readOnly value={script} rows={5} onFocus={event=>event.currentTarget.select()}/><button type="button" disabled={!canEdit||busy} onClick={()=>{const problem=onVoiceDraft(script);if(problem)setError(problem);}}>Open in Studio Voice</button> <button type="button" className="secondary" onClick={()=>{if(!navigator.clipboard?.writeText){setError('Copy is unavailable here. Select and copy the script above.');return;} void navigator.clipboard.writeText(script).then(()=>setMessage('Script copied. Paste it into the narration field when ready.')).catch(()=>setError('Could not copy automatically. Select and copy the script above.'));}}>Copy spoken script</button></div>}
  </section>;
}
