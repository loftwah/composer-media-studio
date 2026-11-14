import { useEffect, useRef, useState } from 'react';
import { previewPromoScenes, type PromoSceneEdit } from './promo-scene-preview';

type Brief = { id: string; revision: number; title: string; scenes: { visual: string }[] };
type Scene = { id: string; direction: string; startMs: number; endMs: number; referenceAssetId: string | null; selectedTakeId: string | null };
type Preview = { edits: PromoSceneEdit[]; key: string; sourceRevision: number };
async function list(projectId: string): Promise<Brief[]> {
  const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/promo-briefs`,{credentials:'same-origin'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error?.message ?? 'Could not load saved promo briefs.');
  return body.briefs;
}
export function PromoSceneBridge({projectId,planId,revision,scenes,canEdit,conflict,onApply}:{projectId:string;planId:string;revision:number;scenes:Scene[];canEdit:boolean;conflict:boolean;onApply:(edits:PromoSceneEdit[],targetKey:string)=>boolean}) {
  const [briefs,setBriefs]=useState<Brief[]>([]); const [briefId,setBriefId]=useState(''); const [mode,setMode]=useState<'append'|'replace'>('append');
  const [preview,setPreview]=useState<Preview|null>(null); const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const alive=useRef(true); useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[projectId]);
  useEffect(()=>{let active=true;list(projectId).then(items=>{if(active)setBriefs(items);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[projectId]);
  const chosen=briefs.find(item=>item.id===briefId);
  const targetKey=JSON.stringify({id:planId,revision,scenes});
  const checkKey=JSON.stringify({targetKey,briefId,sourceRevision:chosen?.revision,mode,conflict});
  const latest=useRef(checkKey);latest.current=checkKey;
  async function refresh() {setBusy(true);setError('');setPreview(null);try{const items=await list(projectId);if(alive.current){setBriefs(items);setBriefId('');setMessage('Saved briefs refreshed. Choose one to review.');}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  async function check():Promise<{edits:PromoSceneEdit[];sourceRevision:number}> {
    if(!chosen)throw new Error('Choose a saved promo brief.');
    const items=await list(projectId);const source=items.find(item=>item.id===chosen.id);
    if(!source || source.revision!==chosen.revision)throw new Error('The saved brief changed. Refresh briefs and review it again.');
    const result=previewPromoScenes(scenes,source.scenes,mode);if(result.error)throw new Error(result.error);
    return {edits:result.edits,sourceRevision:source.revision};
  }
  async function review() {const key=checkKey;setBusy(true);setError('');setMessage('');try{const result=await check();if(!alive.current)return;if(latest.current!==key)throw new Error('The plan or selection changed. Preview again.');setPreview({...result,key});}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  async function apply() {if(!preview)return;const key=checkKey;setBusy(true);setError('');try{if(preview.key!==key)throw new Error('The plan or selection changed. Preview again.');const result=await check();if(!alive.current)return;if(latest.current!==key || result.sourceRevision!==preview.sourceRevision || JSON.stringify(result.edits)!==JSON.stringify(preview.edits))throw new Error('The brief or plan changed. Preview again.');if(!onApply(result.edits,targetKey))throw new Error('The plan changed. Preview again.');setPreview(null);setMessage('Visual ideas applied to this draft. Save the scene plan when ready.');}catch(e){if(alive.current){setPreview(null);setError((e as Error).message);}}finally{if(alive.current)setBusy(false);}}
  return <div className="scene-direction-editor"><h4>Use visual ideas from a promo brief</h4><p className="small">Choose a saved brief with the same number of scenes. Review each change before applying it to this draft. Spoken words, timing, captions, references and takes stay unchanged. The plan copies the text; it does not retain a link to the brief.</p>
    {error&&<p className="notice" role="alert">{error}</p>}{message&&<p className="notice calm" role="status">{message}</p>}
    <label>Saved promo brief<select value={briefId} disabled={busy} onChange={event=>{setBriefId(event.target.value);setPreview(null);setError('');}}><option value="">Choose a saved brief</option>{briefs.map(brief=><option key={brief.id} value={brief.id}>{brief.title} · v{brief.revision}</option>)}</select></label>
    <button type="button" className="quiet" disabled={busy} onClick={()=>void refresh()}>Refresh briefs</button>
    <label>How to apply<select value={mode} disabled={busy} onChange={event=>{setMode(event.target.value as 'append'|'replace');setPreview(null);}}><option value="append">Add to current directions</option><option value="replace">Replace current directions</option></select></label>
    <button type="button" className="secondary" disabled={!canEdit||busy||conflict||!chosen} onClick={()=>void review()}>Preview visual ideas</button>
    {preview&&preview.key===checkKey&&<div className="scene-direction-preview" aria-live="polite"><p>Only the visual directions shown below will change. Blank ideas leave their scene alone.</p><ol>{preview.edits.map(edit=><li key={edit.id}><strong>Scene {edit.index+1}</strong><dl><dt>Before</dt><dd>{edit.before||'No direction yet'}</dd><dt>After</dt><dd>{edit.after}</dd></dl></li>)}</ol><button type="button" disabled={!canEdit||busy||conflict} onClick={()=>void apply()}>Apply to scene draft</button></div>}
  </div>;
}
