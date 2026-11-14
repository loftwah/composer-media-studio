import {useEffect,useRef,useState} from 'react';
import {parseCaptionFile,type ImportedCue} from './caption-import';
type Cue = ImportedCue & {id:string};
type Preview = {cues:ImportedCue[];target:string;name:string};
const maxBytes=65536;
export function CaptionImport({planId,revision,startMs,endMs,cues,canEdit,onReplace}:{planId:string;revision:number;startMs:number;endMs:number;cues:Cue[];canEdit:boolean;onReplace:(target:string,cues:Cue[])=>boolean}) {
  const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[reading,setReading]=useState(false),[replaceConfirmed,setReplaceConfirmed]=useState(false);
  const target=JSON.stringify({planId,revision,startMs,endMs,cues}),latest=useRef(target),sequence=useRef(0);latest.current=target;
  useEffect(()=>()=>{sequence.current++;},[]);
  async function read(file:File) {
    const request=++sequence.current, captured=latest.current;setError('');setPreview(null);setReplaceConfirmed(false);
    if(file.size===0 || file.size>maxBytes){setError('Choose a caption file up to 64 KiB.');return;}
    setReading(true);
    try {const text=await file.text();const parsed=parseCaptionFile(text,startMs,endMs);if(sequence.current!==request)return;if(latest.current!==captured)throw new Error('The plan or caption draft changed. Choose the file again.');setPreview({cues:parsed,target:captured,name:file.name});}
    catch(error){if(sequence.current===request)setError(error instanceof Error?error.message:'Could not read that caption file.');}
    finally{if(sequence.current===request)setReading(false);}
  }
  const stale=Boolean(preview && preview.target!==target);
  function apply(){if(!preview || stale || (cues.length>0 && !replaceConfirmed))return;const imported=preview.cues.map(cue=>({...cue,id:`cue_${crypto.randomUUID().replaceAll('-','')}`}));if(!onReplace(preview.target,imported)){setError('The caption draft changed. Choose the file again.');return;}setPreview(null);setReplaceConfirmed(false);setError('');}
  return <details><summary>Import timed captions</summary><p className="small">Choose a plain SRT or WebVTT file timed from the start of this saved song segment. The file stays on this device. Multi-line cues become one line; speaker labels remain part of the text. Files with markup, styling or cue settings need to be simplified first.</p><label>Caption file<input type="file" accept=".srt,.vtt,text/plain,text/vtt" disabled={!canEdit || reading} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void read(file);}} /></label>{reading && <p role="status">Reading captions…</p>}{error && <p role="alert">{error}</p>}{preview && <div className="scene-direction-preview"><p>Preview: {preview.name} · {preview.cues.length} caption{preview.cues.length === 1 ? '' : 's'}, mapped to source-song time. Check the words and timing before applying.</p><ol>{preview.cues.map((cue,index)=><li key={index}><span className="small">{(cue.startMs/1000).toFixed(3)}–{(cue.endMs/1000).toFixed(3)}s</span> {cue.text}</li>)}</ol>{stale && <p role="alert">The plan or caption draft changed. Choose the file again.</p>}{cues.length>0 && <label className="song-check"><input type="checkbox" checked={replaceConfirmed} onChange={event=>setReplaceConfirmed(event.target.checked)} /> Replace the {cues.length} caption{cues.length === 1 ? '' : 's'} currently in this draft.</label>}<button type="button" disabled={!canEdit || stale || (cues.length>0 && !replaceConfirmed)} onClick={apply}>{cues.length?'Replace caption draft':'Add captions to draft'}</button><button type="button" className="quiet" onClick={()=>{setPreview(null);setReplaceConfirmed(false);}}>Discard preview</button></div>}</details>;
}
