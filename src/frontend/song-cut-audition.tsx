import { useEffect, useRef, useState } from 'react';
import { listenFromCaption } from './caption-listen';
import { songCutWindow } from './song-cut-window';

type Scene = {id:string;startMs:number;endMs:number};
type Song = {id:string;title:string;file:string;durationMs:number|null};
export function SongCutAudition({song,scenes,startMs,endMs,onStart,interruptToken}:{song:Song;scenes:Scene[];startMs:number;endMs:number;onStart:()=>void;interruptToken:number}) {
  const player=useRef<HTMLAudioElement|null>(null), task=useRef<AbortController|null>(null), end=useRef<number|null>(null), start=useRef<number|null>(null), frame=useRef(0), stoppedForChange=useRef(false), ignoredPauses=useRef(0);
  const [status,setStatus]=useState('');
  const signature=JSON.stringify([song.id,song.file,song.durationMs,startMs,endMs,scenes.map(scene=>[scene.id,scene.startMs,scene.endMs])]);
  function stop(message='') {const active=end.current!==null || task.current!==null;end.current=null;start.current=null;task.current?.abort();task.current=null;cancelAnimationFrame(frame.current);if(player.current && !player.current.paused){ignoredPauses.current++;player.current.pause();}if(active)setStatus(message);}
  useEffect(()=>{if(stoppedForChange.current){stoppedForChange.current=false;setStatus('Cut preview stopped because the plan changed.');}const audio=player.current;const hide=()=>{if(document.hidden)stop('Preview stopped when the page was hidden.');};document.addEventListener('visibilitychange',hide);return()=>{stoppedForChange.current=end.current!==null;end.current=null;start.current=null;task.current?.abort();task.current=null;cancelAnimationFrame(frame.current);if(audio && !audio.paused){ignoredPauses.current++;audio.pause();}document.removeEventListener('visibilitychange',hide);};},[signature]);
  useEffect(()=>{stop('Cut preview stopped.');},[interruptToken]);
  function checkEnd(){const audio=player.current;if(audio && end.current!==null && audio.currentTime>=end.current)stop('Cut preview finished.');}
  function tick(){if(end.current===null)return;checkEnd();if(end.current!==null)frame.current=requestAnimationFrame(tick);}
  async function listen(index:number) {
    const audio=player.current, duration=song.durationMs, window=songCutWindow(scenes,index,startMs,endMs,duration);
    if(!audio || !window || !duration) return;
    stop();onStart();const controller=new AbortController();task.current=controller;start.current=window.startMs/1000;end.current=window.endMs/1000;setStatus(`Playing around cut ${index+1}.`);
    try {await listenFromCaption(audio,window.startMs,duration,controller.signal);if(controller.signal.aborted)return;if(!Number.isFinite(audio.duration) || window.endMs/1000>audio.duration+.001)throw new Error('Song duration differs from the saved asset');frame.current=requestAnimationFrame(tick);}
    catch(error){if(!controller.signal.aborted){stop();setStatus('Could not play this cut. Check the song and try again.');}}
  }
  return <div className="song-cut-audition"><h4>Listen around a cut</h4><p className="small">Hear up to two seconds on each side of a draft scene boundary. Browser playback is approximate; listen for words or beats before saving.</p><audio ref={player} controls preload="none" src={song.file} aria-label={`Listen to ${song.title} around a scene cut`} data-song-cut-audition="true" onTimeUpdate={checkEnd} onSeeking={event=>{const at=event.currentTarget.currentTime;if(end.current!==null && start.current!==null && (at<start.current-.05 || at>end.current+.05))stop('Cut preview stopped after seeking outside its range.');}} onEnded={()=>stop('The song ended.')} onPlay={onStart} onPause={()=>{if(ignoredPauses.current){ignoredPauses.current--;return;}if(end.current!==null)stop('Cut preview paused.');}} onError={()=>{stop();setStatus('Could not load this song.');}} /> <div className="row">{scenes.slice(0,-1).map((scene,index)=>{const valid=Boolean(songCutWindow(scenes,index,startMs,endMs,song.durationMs));return <button type="button" className="secondary" key={scene.id} disabled={!valid} onClick={()=>void listen(index)}>Listen around cut {index+1}–{index+2}</button>;})}</div><p className="small" role="status">{status}</p></div>;
}
