// Versioned portable plan. Authored text remains private and is not scrubbed.
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(n)=>Number.isSafeInteger(n)&&n>=0;
const canonical=(s)=>s===s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,'').trim();
export function readSongPlanPack(value) {
 const fail=()=>{throw new Error('This is not a supported portable song plan.');};
 if (!exact(value,['format','version','songSha256','plan'])||value.format!=='media-studio-song-plan'||value.version!==1||typeof value.songSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.songSha256)) fail();
 const p=value.plan;
 if(!exact(p,['title','treatment','aspect','startMs','endMs','scenes','captions'])||typeof p.title!=='string'||!p.title.trim()||!canonical(p.title)||p.title.length>80||typeof p.treatment!=='string'||!canonical(p.treatment)||p.treatment.length>1200||!['16:9','9:16','1:1'].includes(p.aspect)||!integer(p.startMs)||!integer(p.endMs)||p.endMs-p.startMs<2000||p.endMs-p.startMs>60000||!Array.isArray(p.scenes)||p.scenes.length<2||p.scenes.length>6||!Array.isArray(p.captions)||p.captions.length>100) fail();
 let cursor=p.startMs;
 for(const s of p.scenes){if(!exact(s,['startMs','endMs','direction'])||!integer(s.startMs)||!integer(s.endMs)||s.startMs!==cursor||s.endMs<=s.startMs||s.endMs>p.endMs||typeof s.direction!=='string'||!canonical(s.direction)||s.direction.length>1200)fail();cursor=s.endMs;} if(cursor!==p.endMs)fail();
 let priorStart=-1,priorEnd=-1;
 for(const c of p.captions){if(!exact(c,['startMs','endMs','text','speaker'])||!integer(c.startMs)||!integer(c.endMs)||c.startMs<p.startMs||c.endMs>p.endMs||c.endMs<=c.startMs||typeof c.text!=='string'||!c.text.trim()||c.text!==c.text.trim()||c.text.length>300||/[\u0000-\u001f\u007f]/.test(c.text)||typeof c.speaker!=='string'||c.speaker!==c.speaker.trim()||c.speaker.length>80||/[\u0000-\u001f\u007f]/.test(c.speaker)||c.startMs<priorStart||(c.startMs===priorStart&&c.endMs<priorEnd))fail();priorStart=c.startMs;priorEnd=c.endMs;}
 return value;
}
export function createSongPlanPack(plan) {
 return readSongPlanPack({format:'media-studio-song-plan',version:1,songSha256:plan.songSha256,plan:{title:plan.title,treatment:plan.treatment,aspect:plan.aspect,startMs:plan.startMs,endMs:plan.endMs,scenes:plan.scenes.map(s=>({startMs:s.startMs,endMs:s.endMs,direction:s.direction})),captions:(plan.captions?.cues??[]).map(c=>({startMs:c.startMs,endMs:c.endMs,text:c.text,speaker:c.speaker??''}))}});
}
