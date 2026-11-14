import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { encodeWav } from "../../public/wav.js";
import "./audio-trim.css";

const MAX_SECONDS = 180;
const MAX_BYTES = 16 * 1024 * 1024;

function AudioTrim() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
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
    setFile(null); setBuffer(null); setSourceUrl(""); setOutputUrl(""); setMessage(""); setBusy(false);
    if (!next) return;
    if (next.size > MAX_BYTES) { setMessage("Choose a file under 16 MB."); return; }
    const url = URL.createObjectURL(next);
    setSourceUrl(url); setBusy(true);
    try {
      const audio = new Audio(); audio.preload = "metadata"; audio.src = url;
      const duration = await new Promise<number>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error("This browser cannot read that audio file."));
      });
      audio.removeAttribute("src"); audio.load();
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("Choose audio no longer than 3 minutes.");
      const context = new AudioContext();
      let decoded: AudioBuffer;
      try { decoded = await context.decodeAudioData(await next.arrayBuffer()); } finally { await context.close(); }
      if (decoded.duration > MAX_SECONDS) throw new Error("Choose audio no longer than 3 minutes.");
      if (decoded.numberOfChannels > 2) throw new Error("Choose mono or stereo audio.");
      if (current !== revision.current) return;
      setFile(next); setBuffer(decoded); setStart(0); setEnd(decoded.duration); setFadeIn(0); setFadeOut(0);
      setMessage("Ready. Choose a start and end, then make your WAV.");
    } catch (error) { if (current === revision.current) { setSourceUrl(""); setMessage(error instanceof Error ? error.message : "Could not open this file."); } }
    finally { if (current === revision.current) setBusy(false); }
  }
  function makeClip() {
    if (!buffer) return;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || start >= end) { setMessage("Choose an end after the start and within the track."); return; }
    const length = end - start;
    if (!Number.isFinite(fadeIn) || !Number.isFinite(fadeOut) || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > length) { setMessage("Fades must fit inside the selected clip."); return; }
    const first = Math.round(start * buffer.sampleRate);
    const frames = Math.min(buffer.length - first, Math.round(length * buffer.sampleRate));
    if (frames < 1) { setMessage("Select a longer clip."); return; }
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
    setOutputUrl(URL.createObjectURL(encodeWav(result))); setMessage("Your WAV is ready to play or save.");
  }
  const change = (setter: (n: number) => void, value: string) => { setter(value === "" ? NaN : Number(value)); setOutputUrl(""); };
  return <main className="trim-page" id="main">
    <header><a href="/">← Media Studio</a><h1>Trim a song</h1><p>Choose a short audio file, mark the part you want and save a WAV. Your file stays on this device; nothing is uploaded.</p></header>
    <section className="trim-work" aria-labelledby="source-heading"><h2 id="source-heading">Your audio</h2>
      <label className="trim-file">Choose audio<input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={e => void choose(e.target.files?.[0])} /></label>
      <p className="trim-note">Up to 16 MB and 3 minutes, mono or stereo. Supported formats depend on your browser.</p>
      {file && buffer && <><p><strong>{file.name}</strong> · {buffer.duration.toFixed(2)} seconds</p><canvas ref={canvas} width="800" height="110" className="trim-wave" aria-label="Waveform of the original audio" role="img"/><audio controls src={sourceUrl} aria-label="Original audio" />
        <div className="trim-fields">
          <label>Start (seconds)<input type="number" min="0" max={buffer.duration} step="0.01" value={Number.isNaN(start) ? "" : start} onChange={e => change(setStart,e.target.value)} /></label>
          <label>End (seconds)<input type="number" min="0" max={buffer.duration} step="0.01" value={Number.isNaN(end) ? "" : end} onChange={e => change(setEnd,e.target.value)} /></label>
          <label>Fade in (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(fadeIn) ? "" : fadeIn} onChange={e => change(setFadeIn,e.target.value)} /></label>
          <label>Fade out (seconds)<input type="number" min="0" step="0.01" value={Number.isNaN(fadeOut) ? "" : fadeOut} onChange={e => change(setFadeOut,e.target.value)} /></label>
        </div><button type="button" onClick={makeClip}>Make WAV</button></>}
      <p role="status" aria-live="polite">{busy ? "Reading audio on this device…" : message}</p>
      {outputUrl && <div className="trim-result"><h2>Your clip</h2><audio controls src={outputUrl} aria-label="Trimmed audio"/><a className="button" href={outputUrl} download={`${file?.name.replace(/\.[^.]+$/, "") || "audio"}-trimmed.wav`}>Save WAV</a><p className="trim-note">The original is unchanged. To add this clip to a project, save it here and upload it from your Studio library.</p></div>}
    </section>
  </main>;
}

export function mountAudioTrim(container: HTMLElement) { createRoot(container).render(<AudioTrim />); }
