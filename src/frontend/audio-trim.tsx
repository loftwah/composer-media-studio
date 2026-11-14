import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { localAudioFits, trimWavFits, MAX_LOCAL_AUDIO_SECONDS, MAX_LOCAL_PCM_BYTES, MAX_TRIM_SECONDS, DEFAULT_TRIM_SECONDS } from "./local-audio-limits.mjs";
import { LocalImport } from "./local-import";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { encodeWav } from "../../public/wav.js";
import "./audio-trim.css";

const MAX_BYTES = 16 * 1024 * 1024;

function AudioTrim() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [importing, setImporting] = useState(false);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const revision = useRef(0);
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  useEffect(() => () => { if (outputUrl) URL.revokeObjectURL(outputUrl); }, [outputUrl]);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    if (!buffer || !canvas.current) return;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas.current;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--teal").trim();
    const samples = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      let peak = 0;
      for (let j = x * step; j < Math.min(samples.length, (x + 1) * step); j += 16) peak = Math.max(peak, Math.abs(samples[j]));
      ctx.fillRect(x, height / 2 - peak * height / 2, 1, Math.max(1, peak * height));
    }
  }, [buffer]);
  async function choose(next: File | undefined) {
    const current = ++revision.current;
    setFile(null); setBuffer(null); setSourceUrl(""); setOutputUrl(""); setOutputBlob(null); setMessage(""); setBusy(false);
    if (!next) return;
    if (next.size > MAX_BYTES) { setMessage("Choose a file under 16 MB."); return; }
    const url = URL.createObjectURL(next);
    setSourceUrl(url); setBusy(true);
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(next) });
      let info: { seconds: number; channels: number; sourceRate: number };
      try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !await track.canDecode()) throw new Error("This browser cannot decode that audio file.");
        const channels = await track.getNumberOfChannels(), sourceRate = await track.getSampleRate();
        const first = await track.getFirstTimestamp(), end = await track.computeDuration();
        info = { seconds: end - first, channels, sourceRate };
      } finally { input.dispose(); }
      if (current !== revision.current) return;
      const context = new AudioContext();
      let decoded: AudioBuffer;
      try {
        if (!localAudioFits({ ...info, deviceRate: context.sampleRate })) throw new Error("Choose mono or stereo audio up to 5 minutes that decodes to at most 128 MiB on this device.");
        decoded = await context.decodeAudioData(await next.arrayBuffer());
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_LOCAL_AUDIO_SECONDS || decoded.numberOfChannels > 2 || decoded.length * decoded.numberOfChannels * 4 > MAX_LOCAL_PCM_BYTES) throw new Error("The decoded audio exceeds this tool's local limits.");
      } finally { await context.close(); }
      if (current !== revision.current) return;
      setFile(next); setBuffer(decoded); setStart(0); setEnd(decoded.duration > MAX_TRIM_SECONDS ? Math.min(decoded.duration, DEFAULT_TRIM_SECONDS) : decoded.duration); setFadeIn(0); setFadeOut(0);
      setMessage("Ready. Choose a start and end, then make your WAV.");
    } catch (error) { if (current === revision.current) { setSourceUrl(""); setMessage(error instanceof Error ? error.message : "Could not open this file."); } }
    finally { if (current === revision.current) setBusy(false); }
  }
  function makeClip() {
    if (!buffer) return;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || start >= end) { setMessage("Choose an end after the start and within the track."); return; }
    const length = end - start;
    if (length > MAX_TRIM_SECONDS) { setMessage("Choose a clip no longer than 3 minutes."); return; }
    if (!Number.isFinite(fadeIn) || !Number.isFinite(fadeOut) || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > length) { setMessage("Fades must fit inside the selected clip."); return; }
    const first = Math.round(start * buffer.sampleRate);
    const frames = Math.min(buffer.length - first, Math.round(length * buffer.sampleRate));
    if (frames < 1) { setMessage("Select a longer clip."); return; }
    if (!trimWavFits(frames, buffer.numberOfChannels)) { setMessage("This clip exceeds the local output memory limit. Choose a shorter clip."); return; }
    let result: AudioBuffer;
    try {
      const context = new OfflineAudioContext(buffer.numberOfChannels, frames, buffer.sampleRate);
      result = context.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
    } catch {
      setMessage("This browser cannot create the audio clip. Try a shorter file or another browser.");
      return;
    }
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const from = buffer.getChannelData(channel); const to = result.getChannelData(channel);
      for (let i = 0; i < frames; i++) {
        const elapsed = i / buffer.sampleRate;
        const gain = Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (frames - 1 - i) / buffer.sampleRate / fadeOut : 1);
        to[i] = from[first + i] * Math.max(0, gain);
      }
    }
    const wav = encodeWav(result); setOutputBlob(wav); setOutputUrl(URL.createObjectURL(wav)); setMessage("Your WAV is ready to play or save.");
  }
  const change = (setter: (n: number) => void, value: string) => { setter(value === "" ? NaN : Number(value)); setOutputUrl(""); setOutputBlob(null); };
  return <main className="trim-page" id="main">
    <header><a href="/">← Media Studio</a><h1>Trim a song</h1><p>Choose a short audio file, mark the part you want and save a WAV. Your source stays on this device; you can choose to upload the finished clip to Studio.</p></header>
    <section className="trim-work" aria-labelledby="source-heading"><h2 id="source-heading">Your audio</h2>
      <label className="trim-file">Choose audio<input type="file" accept="audio/*,.mp3,.wav,.m4a" disabled={importing || busy} onChange={e => void choose(e.target.files?.[0])} /></label>
      <p className="trim-note">Sources up to 16 MB and 5 minutes, mono or stereo. Make a WAV of up to 3 minutes and 64 MiB; high-rate audio may need a shorter selection. Longer sources start with a 60-second selection. Decoded audio must fit within 128 MiB on this device; browser support varies.</p>
      {file && buffer && <><p><strong>{file.name}</strong> · {buffer.duration.toFixed(2)} seconds</p><canvas ref={canvas} width="800" height="110" className="trim-wave" aria-label="Waveform of the original audio" role="img"/><audio controls src={sourceUrl} aria-label="Original audio" />
        <div className="trim-fields">
          <label>Start (seconds)<input type="number" min="0" max={buffer.duration} step="0.01" disabled={importing} value={Number.isNaN(start) ? "" : start} onChange={e => change(setStart,e.target.value)} /></label>
          <label>End (seconds)<input type="number" min="0" max={buffer.duration} step="0.01" disabled={importing} value={Number.isNaN(end) ? "" : end} onChange={e => change(setEnd,e.target.value)} /></label>
          <label>Fade in (seconds)<input type="number" min="0" step="0.01" disabled={importing} value={Number.isNaN(fadeIn) ? "" : fadeIn} onChange={e => change(setFadeIn,e.target.value)} /></label>
          <label>Fade out (seconds)<input type="number" min="0" step="0.01" disabled={importing} value={Number.isNaN(fadeOut) ? "" : fadeOut} onChange={e => change(setFadeOut,e.target.value)} /></label>
        </div><button type="button" disabled={importing} onClick={makeClip}>Make WAV</button></>}
      <p role="status" aria-live="polite">{busy ? "Reading audio on this device…" : message}</p>
      {outputUrl && <div className="trim-result"><h2>Your clip</h2><audio controls src={outputUrl} aria-label="Trimmed audio"/><a className="button" href={outputUrl} download={`${file?.name.replace(/\.[^.]+$/, "") || "audio"}-trimmed.wav`}>Save WAV</a><p className="trim-note">The original is unchanged.</p>{outputBlob && <LocalImport key={outputUrl} blob={outputBlob} filename={`${file?.name.replace(/\.[^.]+$/, "") || "audio"}-trimmed.wav`} operation="trim audio" format="wav" onBusyChange={setImporting}/>}</div>}
    </section>
  </main>;
}

export function mountAudioTrim(container: HTMLElement) { createRoot(container).render(<AudioTrim />); }
