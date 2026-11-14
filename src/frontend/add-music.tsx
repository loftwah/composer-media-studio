import { LocalImport } from "./local-import";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from "mediabunny";
import "./audio-trim.css";
import "./video-clip.css";

const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_SECONDS = 60;
const FPS = 30;
function check(signal: AbortSignal) { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); }

async function checkMusicDuration(file: File, signal: AbortSignal) {
  const url = URL.createObjectURL(file); const element = new Audio(); element.preload = "metadata"; element.src = url;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Could not read the audio duration.")), 10000);
      const done = (fn: () => void) => { clearTimeout(timeout); signal.removeEventListener("abort", cancel); fn(); };
      const cancel = () => done(() => reject(new DOMException("Cancelled", "AbortError")));
      signal.addEventListener("abort", cancel, {once:true});
      element.onloadedmetadata = () => done(() => resolve(element.duration));
      element.onerror = () => done(() => reject(new Error("This browser cannot read that audio file.")));
      if (signal.aborted) cancel();
    });
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error("Choose audio no longer than 3 minutes.");
  } finally { element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url); }
}

async function makeFilm(videoFile: File, musicFile: File, offset: number, gain: number, signal: AbortSignal, progress: (s: string) => void) {
  if (!videoFile.size || videoFile.size > MAX_VIDEO_BYTES || !musicFile.size || musicFile.size > MAX_AUDIO_BYTES) throw new Error("Choose video under 128 MB and audio under 16 MB.");
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error("Choose a valid music start and volume.");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  let output: Output | undefined;
  try {
    const track = await input.getPrimaryVideoTrack(); check(signal);
    if (!track || !await track.canDecode()) throw new Error("This browser cannot decode that video.");
    const duration = await track.computeDuration();
    const codedWidth = await track.getCodedWidth(), codedHeight = await track.getCodedHeight();
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("Choose a video no longer than 60 seconds.");
    if (!codedWidth || !codedHeight || codedWidth > 4096 || codedHeight > 4096 || codedWidth * codedHeight > 8294400) throw new Error("Choose a video at or below 4K resolution.");
    const width = codedWidth > codedHeight ? 640 : codedWidth < codedHeight ? 360 : 480;
    const height = codedWidth > codedHeight ? 360 : codedWidth < codedHeight ? 640 : 480;
    if (!await canEncodeVideo("avc", {width,height,bitrate:1200000}) || !await canEncodeAudio("aac", {numberOfChannels:2,sampleRate:44100,bitrate:128000})) throw new Error("This browser cannot encode H.264/AAC MP4. Try a current supported browser.");
    check(signal); progress("Reading your music on this device…");
    await checkMusicDuration(musicFile, signal); check(signal);
    const audioContext = new AudioContext(); let music: AudioBuffer;
    try { music = await audioContext.decodeAudioData(await musicFile.arrayBuffer()); } finally { await audioContext.close(); }
    check(signal);
    if (!Number.isFinite(music.duration) || music.duration > 180 || music.duration <= offset) throw new Error("Choose audio up to 3 minutes and a start within the track.");
    const offline = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
    const source = offline.createBufferSource(); source.buffer = music;
    const volume = offline.createGain(); volume.gain.value = gain; source.connect(volume).connect(offline.destination);
    source.start(0, offset); const mixed = await offline.startRendering(); check(signal);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", {alpha:false}); if (!ctx) throw new Error("This browser cannot create a video canvas.");
    const target = new BufferTarget(); output = new Output({ format: new Mp4OutputFormat({fastStart:"in-memory"}), target });
    const visual = new CanvasSource(canvas, {codec:"avc",bitrate:1200000}); output.addVideoTrack(visual, {frameRate:FPS});
    const soundtrack = new AudioBufferSource({codec:"aac",bitrate:128000}); output.addAudioTrack(soundtrack);
    await output.start(); check(signal);
    const frames = Math.ceil(duration * FPS), first = await track.getFirstTimestamp();
    const times = Array.from({length:frames}, (_,i) => first + i/FPS);
    const sink = new CanvasSink(track, {width,height,fit:"contain",poolSize:2});
    await Promise.all([
      (async () => { await soundtrack.add(mixed); soundtrack.close(); })(),
      (async () => { let frame = 0; for await (const sample of sink.canvasesAtTimestamps(times)) {
        check(signal); if (!sample) throw new Error("The source video has a missing frame.");
        ctx.drawImage(sample.canvas,0,0,width,height);
        await visual.add(frame/FPS, Math.min(1/FPS,duration-frame/FPS), {keyFrame:frame === 0});
        frame++; if (frame % 30 === 0) progress(`Making your film on this device: ${Math.round(frame/frames*100)}%`);
      } if (frame !== frames) throw new Error("The source video ended early."); visual.close(); })()
    ]);
    check(signal); progress("Finishing the MP4…"); await output.finalize(); check(signal);
    if (!target.buffer || !target.buffer.byteLength || target.buffer.byteLength > 64 * 1024 * 1024) throw new Error("The output is empty or exceeds 64 MB.");
    return new Blob([target.buffer], {type:"video/mp4"});
  } catch (error) { if (output) await output.cancel().catch(() => {}); throw error; }
  finally { input.dispose(); }
}
function AddMusic() {
  const [video,setVideo] = useState<File | null>(null), [music,setMusic] = useState<File | null>(null);
  const [videoUrl,setVideoUrl] = useState(""), [musicUrl,setMusicUrl] = useState(""), [result,setResult] = useState("");
  const [offset,setOffset] = useState(0), [volume,setVolume] = useState(80), [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (musicUrl) URL.revokeObjectURL(musicUrl); }, [musicUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => () => controller.current?.abort(), []);
  function choose(file: File | undefined, kind: "video" | "music") {
    setResult(""); setResultBlob(null); setMessage("");
    if (kind === "video") { setVideo(file ?? null); setVideoUrl(file ? URL.createObjectURL(file) : ""); }
    else { setMusic(file ?? null); setMusicUrl(file ? URL.createObjectURL(file) : ""); }
  }
  async function run() {
    if (!video || !music || busy) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setResult(""); setResultBlob(null); setMessage("Checking codecs and files…");
    try { const blob = await makeFilm(video,music,offset,volume/100,abort.signal,setMessage); check(abort.signal); setResultBlob(blob); setResult(URL.createObjectURL(blob)); setMessage("Your film is ready to play and save."); }
    catch (error) { setMessage(error instanceof Error && error.name === "AbortError" ? "Export cancelled. Your originals are unchanged." : error instanceof Error ? error.message : "Could not make the film on this device."); }
    finally { controller.current = null; setBusy(false); }
  }
  return <main className="trim-page" id="main"><header><a href="/">← Media Studio</a><h1>Add music to a video</h1><p>Make a new MP4 from your own video and music. Files stay on this device; no sign-in, upload or paid generation is needed.</p></header>
    <section className="trim-work" aria-labelledby="inputs-title"><h2 id="inputs-title">Choose your files</h2>
      <label className="trim-file">Video<input type="file" accept="video/mp4,video/webm" disabled={busy || importing} onChange={e => choose(e.target.files?.[0],"video")}/></label>
      <p className="trim-note">Up to 60 seconds and 128 MB. The original video soundtrack is replaced by your chosen music.</p>
      {video && <><p><strong>{video.name}</strong></p><video className="video-tool-player" src={videoUrl} controls playsInline aria-label="Original video"/></>}
      <label className="trim-file">Music or spoken audio<input type="file" accept="audio/*,.mp3,.wav,.m4a" disabled={busy || importing} onChange={e => choose(e.target.files?.[0],"music")}/></label>
      <p className="trim-note">Use audio you have permission to use, up to 3 minutes and 16 MB. If the selected audio ends early, the remaining video is silent.</p>
      {music && <><p><strong>{music.name}</strong></p><audio controls src={musicUrl} aria-label="Original music"/></>}
      <div className="trim-fields"><label>Music start (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(offset)?"":offset} disabled={busy || importing} onChange={e=>{setOffset(e.target.value === "" ? NaN : Number(e.target.value));setResult(""); setResultBlob(null);}}/></label><label>Music volume (%)<input type="number" min="0" max="100" step="1" value={Number.isNaN(volume)?"":volume} disabled={busy || importing} onChange={e=>{setVolume(e.target.value === "" ? NaN : Number(e.target.value));setResult(""); setResultBlob(null);}}/></label></div>
      <p className="trim-note">Export uses H.264/AAC MP4 in a compatible browser. Video is fitted within 640 × 360, 360 × 640 or 480 × 480; bars may be added. Preview the finished film before saving.</p>
      {!busy ? <button type="button" disabled={!video || !music || importing} onClick={()=>void run()}>Make MP4</button> : <button type="button" className="secondary" onClick={()=>{controller.current?.abort();setMessage("Cancelling…");}}>Cancel export</button>}
      <p role="status" aria-live="polite">{message}</p>{result && <div className="trim-result"><h2>Your film</h2><video className="video-tool-player" src={result} controls playsInline aria-label="Finished video with music"/><a className="button" href={result} download={`${video?.name.replace(/\.[^.]+$/, "") || "video"}-with-music.mp4`}>Save MP4</a>{resultBlob && <LocalImport key={result} blob={resultBlob} filename={`${video?.name.replace(/\.[^.]+$/, "") || "video"}-with-music.mp4`} operation="add music" onBusyChange={setImporting}/>}</div>}
    </section></main>;
}
export function mountAddMusic(container: HTMLElement) { createRoot(container).render(<AddMusic/>); }
