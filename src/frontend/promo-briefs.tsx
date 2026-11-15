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
const wordsIn = (value: string) => value.trim() ? value.trim().split(/\s+/u).length : 0;
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
  const [activeScene,setActiveScene]=useState(0);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [conflict,setConflict]=useState(false);
  const latest=useRef({draft,saved}); latest.current={draft,saved};
  const dirty=JSON.stringify(content(draft))!==JSON.stringify(saved ? content(saved) : empty());
  const active=Math.min(activeScene, Math.max(0, draft.scenes.length-1));
  const scene= draft.scenes[active] ?? {spoken:'',visual:''};
  const script=draft.scenes.map(item=>item.spoken.trim()).filter(Boolean).join('\n\n');
  const words=wordsIn(script);
  const estimated=words ? Math.round(words/140*60) : 0;
  const status=!canEdit ? 'Read-only connection' : busy ? 'Working…' : dirty ? 'Unsaved changes' : saved ? `Saved · revision ${saved.revision}` : 'Not saved yet';

  useEffect(()=>()=>{cache.set(projectId,copy(latest.current));},[projectId]);
  useEffect(()=>{if(!dirty)return; const warn=(event:BeforeUnloadEvent)=>event.preventDefault(); window.addEventListener('beforeunload',warn); return ()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{let mounted=true; request(base).then(data=>{if(!mounted)return;setItems(data.briefs);if(!cached&&data.briefs.length){const latest:Saved=data.briefs[0];setSaved(copy(latest));setDraft(copy(content(latest)));setActiveScene(0);}}).catch(e=>{if(mounted)setError(e.message);}); return ()=>{mounted=false;};},[base]);

  const mayLeave=()=>!dirty||window.confirm('Discard unsaved changes to this brief?');
  const open=(item:Saved|null)=>{setSaved(item?copy(item):null);setDraft(item?copy(content(item)):empty());setActiveScene(0);setError('');setMessage('');setConflict(false);};
  const changeScene=(index:number,patch:Partial<Scene>)=>setDraft(current=>({...current,scenes:current.scenes.map((item,i)=>i===index?{...item,...patch}:item)}));
  const addScene=()=>{if(draft.scenes.length>=6)return;setDraft(current=>({...current,scenes:[...current.scenes,{spoken:'',visual:''}]}));setActiveScene(draft.scenes.length);};
  const removeScene=(index:number)=>{if(draft.scenes.length<=2)return;const item=draft.scenes[index];if((item.spoken||item.visual)&&!window.confirm(`Remove scene ${index+1} and its text?`))return;setDraft(current=>({...current,scenes:current.scenes.filter((_,i)=>i!==index)}));setActiveScene(Math.max(0,Math.min(index,draft.scenes.length-2)));};

  async function save() {
    setBusy(true);setError('');setMessage('');
    try { const data=await request(saved?`${base}/${encodeURIComponent(saved.id)}`:base,saved?'PATCH':'POST',{...content(draft),...(saved?{expectedRevision:saved.revision}:{})});
      const updated:Saved=data.brief; setSaved(copy(updated));setDraft(copy(content(updated)));setItems(current=>[updated,...current.filter(x=>x.id!==updated.id)]);setMessage('Brief saved privately in this studio.');
    } catch(e) { const err=e as Error & {status?:number}; if(err.status===409) { setConflict(true); try { const data=await request(base); setItems(data.briefs); } catch {} setError('This brief changed elsewhere. Your edits are still here. Review the latest saved version before replacing your draft.'); } else setError(err.message); } finally {setBusy(false);}
  }
  const newest=conflict ? items.find(item=>item.id===saved?.id) : null;

  return <section className="song-plans promo-workbench-section" aria-labelledby="promo-brief-title">
    <div className="song-plans-heading"><div><h2 id="promo-brief-title">Plan a spoken promo</h2><p>Write the brief and direct one scene at a time before making sound. This is a private draft, not a recording, timed storyboard or finished film.</p></div><span className={`promo-save-status ${dirty?'run':'ok'}`} role="status">{status}</span></div>
    {error&&<p role="alert" className="notice">{error}</p>}{message&&<p role="status" className="notice calm">{message}</p>}
    {newest && <details className="promo-conflict"><summary>Review latest saved version {newest.revision}</summary><p><strong>{newest.title}</strong> · {newest.targetSeconds}s · {newest.aspect}</p><p>{newest.brief}</p><p>Audience: {newest.audience || '—'} · Call to action: {newest.cta || '—'}</p><ol>{newest.scenes.map((item,index)=><li key={index}><p>Spoken: {item.spoken || '—'}</p><p>Visual: {item.visual || '—'}</p></li>)}</ol><button type="button" className="secondary" onClick={()=>{if(window.confirm('Replace your unsaved draft with this saved version?'))open(newest);}}>Load this version</button></details>}

    <div className="promo-workbench">
      <aside className="promo-rail" aria-label="Saved briefs and scenes">
        <label>Saved brief<select value={saved?.id ?? ''} disabled={busy} onChange={event=>{const item=items.find(x=>x.id===event.target.value)??null;if(!mayLeave()){event.currentTarget.value=saved?.id??'';return;}open(item);}}><option value="">New brief</option>{items.map(item=><option key={item.id} value={item.id}>{item.title} · v{item.revision}</option>)}</select></label>
        <p className="small">A saved brief does not start a provider request. Open the script in Studio Voice, review the words and estimate, then choose the saved audio in the scene planner.</p>

        <nav className="promo-scene-strip" aria-label="Scenes">
          <div className="promo-rail-heading"><strong>Scenes</strong><span className="small">{draft.scenes.length} of 6</span></div>
          <ol>
            {draft.scenes.map((item,index)=><li key={index}><button type="button" className="promo-scene-button" aria-current={index===active?'step':undefined} aria-controls="promo-active-scene" onClick={()=>setActiveScene(index)}><span>Scene {index+1}</span><small>{wordsIn(item.spoken)} words{item.visual?' · visual set':''}</small></button></li>)}
          </ol>
          <button type="button" className="secondary promo-add-scene" disabled={!canEdit||busy||draft.scenes.length>=6} onClick={addScene}>Add scene</button>
        </nav>

        <div className="promo-script">
          <div className="promo-rail-heading"><strong>Script</strong><span className="small">{words} words · ~{estimated}s</span></div>
          <p className="small">Roughly {estimated} seconds at 140 words per minute. Delivery and pauses change the actual duration.</p>
          {script
            ? <><textarea aria-label="Combined spoken script" readOnly value={script} rows={4} onFocus={event=>event.currentTarget.select()}/><div className="promo-script-actions"><button type="button" disabled={!canEdit||busy} onClick={()=>{const problem=onVoiceDraft(script);if(problem)setError(problem);}}>Open in Studio Voice</button><button type="button" className="secondary" onClick={()=>{if(!navigator.clipboard?.writeText){setError('Copy is unavailable here. Select and copy the script above.');return;} void navigator.clipboard.writeText(script).then(()=>setMessage('Script copied. Paste it into the narration field when ready.')).catch(()=>setError('Could not copy automatically. Select and copy the script above.'));}}>Copy script</button></div></>
            : <p className="promo-empty">Add spoken words to a scene and they will collect here as one script.</p>}
        </div>
      </aside>

      <form className="promo-stage" onSubmit={event=>{event.preventDefault();void save();}}>
        <fieldset disabled={!canEdit||busy}>
          <section className="promo-brief-panel" aria-labelledby="promo-brief-fields-title">
            <div className="promo-panel-heading"><div><p className="eyebrow">The job</p><h3 id="promo-brief-fields-title">Brief</h3></div>{!canEdit&&<p className="small">Editing requires project edit access.</p>}</div>
            <div className="promo-brief-grid">
              <label>Title<input value={draft.title} maxLength={80} required onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
              <label>Audience<input value={draft.audience} maxLength={300} onChange={event=>setDraft({...draft,audience:event.target.value})}/></label>
              <label>Frame<select value={draft.aspect} onChange={event=>setDraft({...draft,aspect:event.target.value})}>{['16:9','9:16','1:1'].map(x=><option key={x}>{x}</option>)}</select></label>
              <label>Target length in seconds<input type="number" min={15} max={30} step={1} value={draft.targetSeconds} onChange={event=>setDraft({...draft,targetSeconds:Number(event.target.value)})}/></label>
              <label className="promo-field-wide">What is this about?<textarea value={draft.brief} maxLength={1200} onChange={event=>setDraft({...draft,brief:event.target.value})}/></label>
              <label className="promo-field-wide">Call to action<input value={draft.cta} maxLength={300} onChange={event=>setDraft({...draft,cta:event.target.value})}/></label>
            </div>
          </section>

          <section className="promo-scene-panel" id="promo-active-scene" aria-labelledby="promo-scene-title">
            <div className="promo-panel-heading"><div><p className="eyebrow">Scene {active+1} of {draft.scenes.length}</p><h3 id="promo-scene-title">Direct the active scene</h3></div><div className="promo-scene-controls"><button type="button" className="quiet" disabled={active===0} onClick={()=>setActiveScene(active-1)}>Previous</button><button type="button" className="quiet" disabled={active>=draft.scenes.length-1} onClick={()=>setActiveScene(active+1)}>Next</button>{draft.scenes.length>2&&<button type="button" className="quiet" onClick={()=>removeScene(active)}>Remove scene</button>}</div></div>
            <div className="promo-scene-fields">
              <label>Spoken words<textarea value={scene.spoken} maxLength={600} onChange={event=>changeScene(active,{spoken:event.target.value})} placeholder="What should be said in this scene?"/><span className="small">{wordsIn(scene.spoken)} words · about {wordsIn(scene.spoken)?Math.round(wordsIn(scene.spoken)/140*60):0}s</span></label>
              <label>Visual idea<textarea value={scene.visual} maxLength={600} onChange={event=>changeScene(active,{visual:event.target.value})} placeholder="What should this scene show?"/><span className="small">Direction for the storyboard. Nothing is generated here.</span></label>
            </div>
          </section>

          <div className="promo-save-bar"><p className="small" role="status">{status}{dirty&&saved?' · your saved revision is unchanged until you save':''}</p><div className="row"><button type="button" className="secondary" onClick={()=>{if(window.confirm('Discard unsaved changes and load the saved version?'))open(saved);}} disabled={!dirty||busy}>Discard changes</button><button type="submit" disabled={conflict}>{saved?'Save changes':'Save brief'}</button></div></div>
        </fieldset>
      </form>
    </div>
  </section>;
}
