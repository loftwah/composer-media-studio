import { localAudioFits, MAX_LOCAL_AUDIO_SECONDS, MAX_LOCAL_PCM_BYTES } from "./local-audio-limits.mjs";
import { probeMediaTrack } from "./media-probe";
import { LocalImport } from "./local-import";
import { encodeWav } from "../../public/wav.js";
import { localMixRange } from "./local-mix-range";
import { musicFadeDuration } from "./music-fades";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from "mediabunny";
import "./audio-trim.css";
import "./video-clip.css";

const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_SECONDS = 60;
const FPS = 30;
function check(signal: AbortSignal) { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); }

async function checkMediaDuration(file: File, signal: AbortSignal, kind: "video" | "audio") {
  const url = URL.createObjectURL(file); const element: HTMLMediaElement = kind === "video" ? document.createElement("video") : new Audio(); element.preload = "metadata"; element.src = url;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(kind === "video" ? "Could not read the video duration." : "Could not read the audio duration.")), 10000);
      const done = (fn: () => void) => { clearTimeout(timeout); signal.removeEventListener("abort", cancel); fn(); };
      const cancel = () => done(() => reject(new DOMException("Cancelled", "AbortError")));
      signal.addEventListener("abort", cancel, {once:true});
      element.onloadedmetadata = () => done(() => resolve(element.duration));
      element.onerror = () => done(() => reject(new Error(kind === "video" ? "This browser cannot read that video. Try another MP4 or WebM." : "This browser cannot read that audio file.")));
      if (signal.aborted) cancel();
    });
    const limit = kind === "video" ? MAX_SECONDS : MAX_LOCAL_AUDIO_SECONDS;
    if (!Number.isFinite(duration) || duration <= 0 || duration > limit) throw new Error(kind === "video" ? "Choose a video no longer than 60 seconds." : "Choose audio no longer than 5 minutes.");
  } finally { element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url); }
}

async function makeFilm(videoFile: File, musicFile: File, offset: number, gain: number, originalGain: number, fadeIn: number, fadeOut: number, previewOnly: boolean, quality: "standard" | "hd", signal: AbortSignal, progress: (s: string) => void) {
  if (!videoFile.size || videoFile.size > MAX_VIDEO_BYTES || !musicFile.size || musicFile.size > MAX_AUDIO_BYTES) throw new Error("Choose video under 128 MB and audio under 16 MB.");
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isFinite(originalGain) || originalGain < 0 || originalGain > 1) throw new Error("Choose a valid music start and volume.");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  let output: Output | undefined;
  try {
    const track = await probeMediaTrack(() => input.getPrimaryVideoTrack(), "video"); check(signal);
    if (!track || !await track.canDecode()) throw new Error("This browser cannot decode that video.");
    const first = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const duration = end - first;
    const codedWidth = await track.getCodedWidth(), codedHeight = await track.getCodedHeight();
    if (!Number.isFinite(first) || !Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("Choose a video no longer than 60 seconds.");
    if (!codedWidth || !codedHeight || codedWidth > 4096 || codedHeight > 4096 || codedWidth * codedHeight > 8294400) throw new Error("Choose a video at or below 4K resolution.");
    const width = quality === "hd" ? (codedWidth > codedHeight ? 1280 : codedWidth < codedHeight ? 720 : 720) : (codedWidth > codedHeight ? 640 : codedWidth < codedHeight ? 360 : 480);
    const height = quality === "hd" ? (codedWidth > codedHeight ? 720 : codedWidth < codedHeight ? 1280 : 720) : (codedWidth > codedHeight ? 360 : codedWidth < codedHeight ? 640 : 480);
    const bitrate = quality === "hd" ? 4000000 : 1200000;
    check(signal); progress("Reading your music on this device…");
    await checkMediaDuration(musicFile, signal, "audio"); check(signal);
    const musicInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(musicFile) });
    let musicInfo: { channels: number; rate: number; seconds: number };
    try {
      const musicTrack = await probeMediaTrack(() => musicInput.getPrimaryAudioTrack(), "audio"); check(signal);
      if (!musicTrack || !await musicTrack.canDecode()) throw new Error("This browser cannot decode that audio file.");
      const musicChannels = await musicTrack.getNumberOfChannels(), musicRate = await musicTrack.getSampleRate();
      const musicStart = await musicTrack.getFirstTimestamp(), musicEnd = await musicTrack.computeDuration();
      const musicSeconds = musicEnd - musicStart;
      if (!Number.isInteger(musicChannels) || musicChannels < 1 || musicChannels > 2 || !Number.isFinite(musicRate) || musicRate <= 0 || musicRate > 96000 || !Number.isFinite(musicSeconds) || musicSeconds <= 0 || musicSeconds > MAX_LOCAL_AUDIO_SECONDS) throw new Error("Choose supported mono or stereo audio up to 5 minutes.");
      musicInfo = {channels:musicChannels, rate:musicRate, seconds:musicSeconds};
    } finally { musicInput.dispose(); }
    check(signal);
    const audioContext = new AudioContext(); let music: AudioBuffer;
    try {
      if (!localAudioFits({seconds:musicInfo.seconds,channels:musicInfo.channels,sourceRate:musicInfo.rate,deviceRate:audioContext.sampleRate})) throw new Error("Choose audio that decodes to at most 128 MiB on this device.");
      const bytes = await musicFile.arrayBuffer(); check(signal);
      music = await audioContext.decodeAudioData(bytes);
      if (music.length * music.numberOfChannels * 4 > MAX_LOCAL_PCM_BYTES || music.numberOfChannels > 2) throw new Error("The decoded audio exceeds this tool's local memory limit.");
    } finally { await audioContext.close(); }
    check(signal);
    if (!Number.isFinite(music.duration) || music.duration > MAX_LOCAL_AUDIO_SECONDS || music.duration <= offset) throw new Error("Choose audio up to 5 minutes and a start within the track.");
    const audible = musicFadeDuration(duration, music.duration, offset, fadeIn, fadeOut);
    const offline = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
    const source = offline.createBufferSource(); source.buffer = music;
    const volume = offline.createGain();
    volume.gain.setValueAtTime(fadeIn ? 0 : gain, 0);
    if (fadeIn) volume.gain.linearRampToValueAtTime(gain, fadeIn);
    if (fadeOut) { volume.gain.setValueAtTime(gain, audible - fadeOut); volume.gain.linearRampToValueAtTime(0, audible); }
    source.connect(volume).connect(offline.destination);
    source.start(0, offset);
    if (originalGain > 0) {
      progress("Reading the original soundtrack on this device…");
      const original = await probeMediaTrack(() => input.getPrimaryAudioTrack(), "audio"); check(signal);
      if (original) {
        if (!await original.canDecode()) throw new Error("This browser cannot decode the original soundtrack. Set original sound to 0% or try another browser.");
        const channels = await original.getNumberOfChannels(), rate = await original.getSampleRate();
        if (!Number.isFinite(rate) || rate <= 0 || rate > 96000 || !Number.isInteger(channels) || channels < 1 || channels > 2) throw new Error("The original soundtrack exceeds this tool's local audio limits. Set original sound to 0% or use a supported source.");
        const originalVolume = offline.createGain(); originalVolume.gain.value = originalGain; originalVolume.connect(offline.destination);
        const sink = new AudioBufferSink(original);
        let decodedBytes = 0, chunks = 0, precedingTimestamp: number | undefined;
        const addChunk = (sample: Awaited<ReturnType<AudioBufferSink["getBuffer"]>>) => {
          if (!sample) return;
          const {buffer, timestamp} = sample;
          if (!Number.isFinite(timestamp) || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.numberOfChannels > 2 || buffer.sampleRate > 96000) throw new Error("The original soundtrack has unsupported timing or format.");
          decodedBytes += buffer.length * buffer.numberOfChannels * 4; chunks++;
          if (decodedBytes > 64 * 1024 * 1024 || chunks > 5000) throw new Error("The original soundtrack exceeds this tool's local memory limit.");
          const range = localMixRange(timestamp, buffer.duration, first, duration);
          if (!range) return;
          const part = offline.createBufferSource(); part.buffer = buffer; part.connect(originalVolume); part.start(range.start, range.skip, range.duration);
        };
        const preceding = await sink.getBuffer(first); check(signal);
        if (preceding) { precedingTimestamp = preceding.timestamp; addChunk(preceding); }
        for await (const sample of sink.buffers(first, end)) { check(signal); if (sample.timestamp !== precedingTimestamp) addChunk(sample); }
      }
    }
    check(signal); const mixed = await offline.startRendering(); check(signal);
    if (previewOnly) { progress("Preparing your audio-only preview…"); return encodeWav(mixed); }
    if (!await canEncodeVideo("avc", {width,height,bitrate}) || !await canEncodeAudio("aac", {numberOfChannels:2,sampleRate:44100,bitrate:128000})) throw new Error("This browser cannot encode H.264/AAC MP4. Try a current supported browser.");
    check(signal);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", {alpha:false}); if (!ctx) throw new Error("This browser cannot create a video canvas.");
    const target = new BufferTarget(); output = new Output({ format: new Mp4OutputFormat({fastStart:"in-memory"}), target });
    const visual = new CanvasSource(canvas, {codec:"avc",bitrate}); output.addVideoTrack(visual, {frameRate:FPS});
    const soundtrack = new AudioBufferSource({codec:"aac",bitrate:128000}); output.addAudioTrack(soundtrack);
    await output.start(); check(signal);
    const frames = Math.ceil(duration * FPS);
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
  const [offset,setOffset] = useState(0), [volume,setVolume] = useState(80), [originalVolume,setOriginalVolume] = useState(0), [fadeIn,setFadeIn] = useState(0), [fadeOut,setFadeOut] = useState(0), [busy,setBusy] = useState<"preview" | "export" | null>(null), [message,setMessage] = useState("");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [importing, setImporting] = useState(false);
  const [checkingMusic, setCheckingMusic] = useState(false);
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const sourceVideo = useRef<HTMLVideoElement>(null), sourceMusic = useRef<HTMLAudioElement>(null), previewPlayer = useRef<HTMLAudioElement>(null), resultPlayer = useRef<HTMLVideoElement>(null);
  const previewAction = useRef<HTMLButtonElement>(null);
  const exportAction = useRef<HTMLButtonElement>(null);
  const musicChooser = useRef<HTMLInputElement>(null);
  const videoChooser = useRef<HTMLInputElement>(null);
  function pauseOthers(active?: HTMLMediaElement | null) { for (const player of [sourceVideo.current, sourceMusic.current, previewPlayer.current, resultPlayer.current]) if (player && player !== active) player.pause(); }
  function clearOutputs() { pauseOthers(); setPreview(""); setResult(""); setResultBlob(null); }
  const controller = useRef<AbortController | null>(null);
  const musicAbort = useRef<AbortController | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (musicUrl) URL.revokeObjectURL(musicUrl); }, [musicUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { musicAbort.current?.abort(); videoAbort.current?.abort(); controller.current?.abort(); }, []);
  async function choose(file: File | undefined, kind: "video" | "audio") {
    if (!file || controller.current || importing) return;
    const isVideo = kind === "video";
    const pending = isVideo ? videoAbort : musicAbort;
    const chooser = isVideo ? videoChooser : musicChooser;
    const setChecking = isVideo ? setCheckingVideo : setCheckingMusic;
    const previous = isVideo ? video : music;
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    setChecking(true);
    setMessage(`Checking the selected ${kind} on this device…`);
    try {
      if (!file.size || file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES))
        throw new Error(isVideo ? "Choose a video under 128 MB." : "Choose audio under 16 MB.");
      await checkMediaDuration(file, abort.signal, kind);
      if (pending.current !== abort || abort.signal.aborted) return;
      const url = URL.createObjectURL(file);
      clearOutputs();
      if (isVideo) { setVideo(file); setVideoUrl(url); }
      else { setMusic(file); setMusicUrl(url); }
      setMessage("");
    } catch (error) {
      if (pending.current !== abort || abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : `Could not open this ${kind}.`;
      setMessage(previous ? `${message} Your current sources, settings and completed outputs are unchanged.` : message);
      const input = chooser.current;
      if (input) {
        input.value = "";
        if (document.activeElement === document.body || document.activeElement === input)
          input.focus();
      }
    } finally {
      if (pending.current === abort) {
        pending.current = null;
        setChecking(false);
      }
    }
  }
  async function run(mode: "preview" | "export") {
    if (!video || !music || busy || controller.current || musicAbort.current || videoAbort.current || importing) return;
    // A finished mix stays committed until a repeat actually succeeds, so a
    // cancelled or failed repeat leaves the previous preview, film and exact download intact.
    const abort = new AbortController(); controller.current = abort; pauseOthers(); setBusy(mode);
    setMessage("Checking files on this device…");
    try {
      const blob = await makeFilm(video,music,offset,volume/100,originalVolume/100,fadeIn,fadeOut,mode === "preview",quality,abort.signal,setMessage); check(abort.signal);
      if (mode === "preview") { setPreview(URL.createObjectURL(blob)); setMessage("Audio-only mix preview ready. No video has been exported."); }
      else { setResultBlob(blob); setResult(URL.createObjectURL(blob)); setMessage("Your film is ready to play and save."); }
    } catch (error) { setMessage(error instanceof Error && error.name === "AbortError" ? "Cancelled. Your originals are unchanged." : error instanceof Error ? error.message : "Could not prepare this on your device."); }
    finally { controller.current = null; setBusy(null); }
  }
  function cancelRun(trigger: HTMLButtonElement) {
    if (!controller.current) return;
    controller.current.abort();
    setMessage("Cancelling…");
    if (document.activeElement === trigger) {
      (busy === "preview" ? previewAction : exportAction).current?.focus();
    }
  }
  const canRun = Boolean(video && music && !importing && !checkingMusic && !checkingVideo);
  return <main className="trim-page" id="main"><header><a href="/">← Media Studio</a><h1>Add music to a video</h1><p>Make a new MP4 from your own video and music on this device, without sign-in or paid generation. You can choose to upload the finished MP4 to Studio afterwards.</p></header>
    <section className="trim-work" aria-labelledby="inputs-title"><h2 id="inputs-title">Choose your files</h2>
      <label className="trim-file">Video<input ref={videoChooser} type="file" accept="video/mp4,video/webm" disabled={busy !== null || importing} aria-busy={checkingVideo || undefined} onChange={e => void choose(e.target.files?.[0],"video")}/></label>
      <p className="trim-note">Up to 60 seconds and 128 MB. Original sound is off by default. Raise its volume below to keep it under your music.</p>
      {video && <><p><strong>{video.name}</strong></p><video ref={sourceVideo} onPlay={()=>pauseOthers(sourceVideo.current)} className="video-tool-player" src={videoUrl} controls playsInline aria-label="Original video"/></>}
      <label className="trim-file">Music or spoken audio<input ref={musicChooser} type="file" accept="audio/*,.mp3,.wav,.m4a" disabled={busy !== null || importing} aria-busy={checkingMusic || undefined} onChange={e => void choose(e.target.files?.[0],"audio")}/></label>
      <p className="trim-note">Use audio you have permission to use, up to 5 minutes and 16 MB; decoded audio must fit within 128 MiB on this device. If the selected audio ends early, any enabled original sound continues.</p>
      {music && <><p><strong>{music.name}</strong></p><audio ref={sourceMusic} onPlay={()=>pauseOthers(sourceMusic.current)} controls src={musicUrl} aria-label="Original music"/></>}
      <div className="trim-fields"><label>Music start (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(offset)?"":offset} disabled={busy !== null || importing} onChange={e=>{setOffset(e.target.value === "" ? NaN : Number(e.target.value));clearOutputs();}}/></label><label>Music volume (%)<input type="number" min="0" max="100" step="1" value={Number.isNaN(volume)?"":volume} disabled={busy !== null || importing} onChange={e=>{setVolume(e.target.value === "" ? NaN : Number(e.target.value));clearOutputs();}}/></label><label>Original video sound (%)<input type="number" min="0" max="100" step="1" value={Number.isNaN(originalVolume)?"":originalVolume} disabled={busy !== null || importing} onChange={e=>{setOriginalVolume(e.target.value === "" ? NaN : Number(e.target.value));clearOutputs();}}/></label><label>Music fade in (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(fadeIn)?"":fadeIn} disabled={busy !== null || importing} onChange={e=>{setFadeIn(e.target.value === "" ? NaN : Number(e.target.value));clearOutputs();}}/></label><label>Music fade out (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(fadeOut)?"":fadeOut} disabled={busy !== null || importing} onChange={e=>{setFadeOut(e.target.value === "" ? NaN : Number(e.target.value));clearOutputs();}}/></label></div>
      <p className="trim-note">Fades apply to the added music only and must fit within the part used in the video.</p>
      <p className="trim-note">If your video has no original sound, only the chosen audio is added. Combining loud tracks can distort; lower the volumes and listen before saving.</p>
      <label>Export quality<select value={quality} disabled={busy !== null || importing} onChange={e=>{setQuality(e.target.value as "standard" | "hd");clearOutputs();}}><option value="standard">Standard · smaller file</option><option value="hd">HD · 720p</option></select></label>
      <p className="trim-note">HD takes longer and uses more memory. The original frame is fitted to your chosen size; bars may be added. Export uses H.264/AAC MP4 in a compatible browser.</p>
      <div className="video-tool-actions">
        <button type="button" className="secondary" ref={previewAction} disabled={!canRun || busy === "export"} aria-disabled={busy === "preview"} onClick={() => void run("preview")}>Preview mix (audio only)</button>
        <button type="button" ref={exportAction} disabled={!canRun || busy === "preview"} aria-disabled={busy === "export"} onClick={() => void run("export")}>Make MP4</button>
        {busy && <button type="button" className="secondary" onClick={event => cancelRun(event.currentTarget)}>Cancel {busy === "preview" ? "preview" : "export"}</button>}
      </div>
      {preview && <div className="trim-result"><h2>Audio-only mix preview</h2><p className="trim-note">This is the sound mix, without video. Play the original video above to compare. The MP4 uses AAC encoding, so it may sound slightly different.</p><audio ref={previewPlayer} onPlay={()=>pauseOthers(previewPlayer.current)} src={preview} controls aria-label="Audio-only mix preview"/></div>}
      <p role="status" aria-live="polite">{message}</p>{result && <div className="trim-result"><h2>Your film</h2><video ref={resultPlayer} onPlay={()=>pauseOthers(resultPlayer.current)} className="video-tool-player" src={result} controls playsInline aria-label="Finished video with music"/><a className="button" href={result} download={`${video?.name.replace(/\.[^.]+$/, "") || "video"}-with-music.mp4`}>Save MP4</a>{resultBlob && <div inert={busy !== null || checkingMusic || checkingVideo || undefined}><LocalImport key={result} blob={resultBlob} filename={`${video?.name.replace(/\.[^.]+$/, "") || "video"}-with-music.mp4`} operation="add music" onBusyChange={setImporting}/></div>}</div>}
    </section></main>;
}
export function mountAddMusic(container: HTMLElement) { createRoot(container).render(<AddMusic/>); }
