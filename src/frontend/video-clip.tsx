import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from "mediabunny";
import "./audio-trim.css";
import "./video-clip.css";

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_SECONDS = 180;
const MAX_CLIP_SECONDS = 60;
const sizes = { portrait: [360, 640], landscape: [640, 360], square: [480, 480] } as const;
type Shape = keyof typeof sizes;
type Fit = "cover" | "contain";

function VideoClip() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [shape, setShape] = useState<Shape>("portrait");
  const [fit, setFit] = useState<Fit>("contain");
  const [mute, setMute] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(0);
  const active = useRef<Conversion | null>(null);
  const cancelRequested = useRef(false);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => () => { current.current++; void active.current?.cancel(); }, []);
  function change() { setResult(""); }
  async function choose(next: File | undefined) {
    const revision = ++current.current;
    setFile(null); setSource(""); setResult(""); setDuration(0); setMessage("");
    if (!next) return;
    if (!next.size || next.size > MAX_BYTES) { setMessage("Choose a video under 128 MB."); return; }
    const url = URL.createObjectURL(next);
    const video = document.createElement("video"); video.preload = "metadata"; video.src = url;
    try {
      const length = await new Promise<number>((resolve, reject) => {
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error("This browser cannot read that video. Try another MP4 or WebM."));
      });
      if (!Number.isFinite(length) || length <= 0 || length > MAX_SOURCE_SECONDS) throw new Error("Choose a video no longer than 3 minutes.");
      if (revision !== current.current) { URL.revokeObjectURL(url); return; }
      setSource(url); setFile(next); setDuration(length); setStart(0); setEnd(Math.min(length, MAX_CLIP_SECONDS));
      setMessage("Choose your clip and frame, then make an MP4.");
    } catch (error) { URL.revokeObjectURL(url); if (revision === current.current) setMessage(error instanceof Error ? error.message : "Could not open the video."); }
    finally { video.removeAttribute("src"); video.load(); }
  }
  async function makeClip() {
    if (!file || busy) return;
    if (![start,end].every(Number.isFinite) || start < 0 || end > duration || end <= start || end - start > MAX_CLIP_SECONDS) { setMessage("Choose a valid start and end within the video, up to 60 seconds apart."); return; }
    cancelRequested.current = false; setBusy(true); setResult(""); setMessage("Checking this browser’s video and audio codecs…");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const video = await input.getPrimaryVideoTrack(); const audio = await input.getPrimaryAudioTrack();
      if (!video || !await video.canDecode()) throw new Error("This browser cannot decode that video. Try another browser or source file.");
      const w = await video.getCodedWidth(), h = await video.getCodedHeight();
      if (!w || !h || w > 4096 || h > 4096 || w*h > 8294400) throw new Error("Choose a video at or below 4K resolution.");
      const [width,height] = sizes[shape];
      const target = new BufferTarget(); const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
      const conversion = await Conversion.init({ input, output, tracks: "primary", trim: {start,end}, tags: {}, showWarnings: false,
        video: { width, height, fit, codec: "avc", bitrate: 1200000, forceTranscode: true },
        audio: mute ? { discard: true } : { codec: "aac", bitrate: 128000, forceTranscode: true } });
      active.current = conversion;
      if (cancelRequested.current) { await conversion.cancel(); throw new DOMException("Export cancelled. Your original is unchanged.", "AbortError"); }
      if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (!mute && audio && !conversion.utilizedTracks.includes(audio))) {
        throw new Error("This browser cannot make this H.264/AAC MP4 with the selected audio. Try a current supported browser or choose Mute.");
      }
      conversion.onProgress = p => setMessage(`Making MP4 on this device: ${Math.round(p*100)}%`);
      await conversion.execute();
      if (!target.buffer || !target.buffer.byteLength || target.buffer.byteLength > 64 * 1024 * 1024) throw new Error("The result is empty or exceeds the 64 MB output limit.");
      setResult(URL.createObjectURL(new Blob([target.buffer], {type:"video/mp4"}))); setMessage("Your MP4 is ready to play and save.");
    } catch (error) { setMessage(error instanceof Error && (error.name === "ConversionCanceledError" || error.name === "AbortError") ? "Export cancelled. Your original is unchanged." : error instanceof Error ? error.message : "Could not make the video on this device."); }
    finally { active.current = null; input.dispose(); setBusy(false); }
  }
  return <main className="trim-page" id="main"><header><a href="/">← Media Studio</a><h1>Clip and frame a video</h1><p>Choose a short video, set its in and out points and save a new MP4. Everything stays on this device; no upload, sign-in or generation is needed.</p></header>
    <section className="trim-work" aria-labelledby="video-source"><h2 id="video-source">Your video</h2><label className="trim-file">Choose video<input type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy} onChange={e => void choose(e.target.files?.[0])}/></label><p className="trim-note">MP4 or WebM up to 128 MB and 3 minutes; browser support varies. Export up to 60 seconds.</p>
      {file && <><p><strong>{file.name}</strong> · {duration.toFixed(2)} seconds</p><video className="video-tool-player" src={source} controls playsInline aria-label="Original video"/>
      <div className="trim-fields"><label>Start (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy} value={Number.isNaN(start) ? "" : start} onChange={e => {setStart(e.target.value === "" ? NaN : Number(e.target.value));change();}}/></label><label>End (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy} value={Number.isNaN(end) ? "" : end} onChange={e => {setEnd(e.target.value === "" ? NaN : Number(e.target.value));change();}}/></label>
      <label>Frame<select value={shape} disabled={busy} onChange={e => {setShape(e.target.value as Shape);change();}}><option value="portrait">9:16 · 360 × 640</option><option value="landscape">16:9 · 640 × 360</option><option value="square">1:1 · 480 × 480</option></select></label><label>Fit<select value={fit} disabled={busy} onChange={e => {setFit(e.target.value as Fit);change();}}><option value="contain">Fit entire picture (bars)</option><option value="cover">Fill frame (centre crop)</option></select></label></div>
      <label className="video-tool-check"><input type="checkbox" checked={mute} disabled={busy} onChange={e => {setMute(e.target.checked);change();}}/> Mute original audio</label><p className="trim-note">H.264/AAC MP4 · 1.2 Mbps video. Export requires compatible browser codecs. Crop is centred; preview the result before saving.</p>
      {!busy ? <button type="button" onClick={() => void makeClip()}>Make MP4</button> : <button type="button" className="secondary" onClick={() => { cancelRequested.current = true; setMessage("Cancelling export…"); void active.current?.cancel(); }}>Cancel export</button>}</>}
      <p role="status" aria-live="polite">{message}</p>{result && <div className="trim-result"><h2>Your clip</h2><video className="video-tool-player" src={result} controls playsInline aria-label="Finished video"/><a className="button" href={result} download={`${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip.mp4`}>Save MP4</a><p className="trim-note">The original is unchanged. To use this clip in a project, save it here, then upload it from your <a href="/studio">Studio library</a>.</p></div>}
    </section></main>;
}
export function mountVideoClip(container: HTMLElement) { createRoot(container).render(<VideoClip />); }
