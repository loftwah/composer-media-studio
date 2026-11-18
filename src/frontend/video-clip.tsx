import { ClipPoster } from "./clip-poster";
import { probeMediaTrack } from "./media-probe";
import { LocalImport } from "./local-import";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, VideoSampleSink } from "mediabunny";
import "./audio-trim.css";
import "./video-clip.css";

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_SECONDS = 180;
const MAX_CLIP_SECONDS = 60;
const sizes = {
  standard: { portrait: [360, 640], landscape: [640, 360], square: [480, 480] },
  hd: { portrait: [720, 1280], landscape: [1280, 720], square: [720, 720] },
} as const;
type Quality = keyof typeof sizes;
type Shape = keyof typeof sizes.standard;
type Fit = "cover" | "contain";

// A playable container header does not prove that the file has any video
// frames. The same decoder used for export can distinguish a missing frame
// from a real transparent frame. An unsupported decoder keeps the native
// preview path so it does not narrow the formats a browser can open.
async function hasVideoFrame(file: File): Promise<boolean> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) return true;
    const frame = await new VideoSampleSink(track).getSample(await track.getFirstTimestamp());
    frame?.close();
    return frame !== null;
  } catch {
    // Some browsers can preview formats their export decoder cannot inspect.
    return true;
  } finally {
    input.dispose();
  }
}

function VideoClip() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  // Settings recorded only when an export succeeds: proof of what the finished
  // file actually contains, not what the controls currently show.
  const [applied, setApplied] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [shape, setShape] = useState<Shape>("portrait");
  const [quality, setQuality] = useState<Quality>("standard");
  const [fit, setFit] = useState<Fit>("contain");
  const [previewFraming, setPreviewFraming] = useState(false);
  const [mute, setMute] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const current = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  const active = useRef<Conversion | null>(null);
  const cancelRequested = useRef(false);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => () => { current.current++; void active.current?.cancel(); }, []);
  // A finished MP4 outlives draft edits: only a successful replacement, or a
  // valid new source, clears it. The draft key is compared with the recorded
  // one on every render, so returning to the same settings drops the note.
  const draft = [start, end, shape, quality, fit, mute].join("|");
  const previous = applied !== null && applied !== draft;
  // A replacement only replaces the current video after it proves readable.
  // Returning focus to the chooser keeps the refusal next to the control that
  // caused it without stealing focus from somewhere the user has moved to.
  function refuse(text: string, retained: boolean) {
    setChecking(false);
    setMessage(retained ? `${text} Your current video, settings and any finished clip are unchanged.` : text);
    const element = chooser.current;
    if (element) element.value = "";
    const activeElement = document.activeElement;
    if (element && (!activeElement || activeElement === document.body || activeElement === element)) element.focus();
  }
  async function choose(next: File | undefined) {
    if (busy || importing) return;
    if (!next) return;
    const revision = ++current.current;
    const retained = file !== null;
    if (!next.size || next.size > MAX_BYTES) { refuse("Choose a video under 128 MB.", retained); return; }
    setChecking(true); setMessage("Checking that video on this device…");
    const url = URL.createObjectURL(next);
    const video = document.createElement("video"); video.preload = "metadata"; video.src = url;
    try {
      const length = await new Promise<number>((resolve, reject) => {
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error("This browser cannot read that video. Try another MP4 or WebM."));
      });
      if (!Number.isFinite(length) || length <= 0 || length > MAX_SOURCE_SECONDS) throw new Error("Choose a video no longer than 3 minutes.");
      if (revision !== current.current) { URL.revokeObjectURL(url); return; }
      // Metadata alone cannot prove there is a frame. Refuse before resetting
      // the source, settings or any finished MP4 when the decoder finds none.
      if (!await hasVideoFrame(next)) throw new Error("No video frame could be read. Choose another MP4 or WebM.");
      if (revision !== current.current) { URL.revokeObjectURL(url); return; }
      setSource(url); setFile(next); setDuration(length); setStart(0); setEnd(Math.min(length, MAX_CLIP_SECONDS));
      setResult(""); setResultBlob(null); setApplied(null); setChecking(false);
      setMessage("Choose your clip and frame, then make an MP4.");
    } catch (error) {
      URL.revokeObjectURL(url);
      if (revision === current.current) refuse(error instanceof Error ? error.message : "Could not open the video.", retained);
    }
    finally { video.removeAttribute("src"); video.load(); }
  }
  async function makeClip() {
    if (!file || busy || checking) return;
    if (![start,end].every(Number.isFinite) || start < 0 || end > duration || end <= start || end - start > MAX_CLIP_SECONDS) { setMessage("Choose a valid start and end within the video, up to 60 seconds apart."); return; }
    // A finished clip stays committed until a replacement actually succeeds, so a
    // cancelled or failed repeat leaves the previous poster and exact download intact.
    cancelRequested.current = false; setBusy(true); setMessage("Checking this browser’s video and audio codecs…");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const video = await probeMediaTrack(() => input.getPrimaryVideoTrack(), "video");
      const audio = await probeMediaTrack(() => input.getPrimaryAudioTrack(), "audio");
      if (!video || !await video.canDecode()) throw new Error("This browser cannot decode that video. Try another browser or source file.");
      const w = await video.getCodedWidth(), h = await video.getCodedHeight();
      if (!w || !h || w > 4096 || h > 4096 || w*h > 8294400) throw new Error("Choose a video at or below 4K resolution.");
      const [width,height] = sizes[quality][shape];
      const target = new BufferTarget(); const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
      const conversion = await Conversion.init({ input, output, tracks: "primary", trim: {start,end}, tags: {}, showWarnings: false,
        video: { width, height, fit, codec: "avc", bitrate: quality === "hd" ? 4000000 : 1200000, forceTranscode: true },
        audio: mute ? { discard: true } : { codec: "aac", bitrate: 128000, forceTranscode: true } });
      active.current = conversion;
      if (cancelRequested.current) { await conversion.cancel(); throw new DOMException("Export cancelled. Your original is unchanged.", "AbortError"); }
      if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (!mute && audio && !conversion.utilizedTracks.includes(audio))) {
        throw new Error("This browser cannot make this H.264/AAC MP4 with the selected audio. Try standard quality, a current supported browser or choose Mute.");
      }
      conversion.onProgress = p => setMessage(`Making MP4 on this device: ${Math.round(p*100)}%`);
      await conversion.execute();
      if (!target.buffer || !target.buffer.byteLength || target.buffer.byteLength > 64 * 1024 * 1024) throw new Error("The result is empty or exceeds the 64 MB output limit.");
      const blob = new Blob([target.buffer], {type:"video/mp4"}); setResultBlob(blob); setResult(URL.createObjectURL(blob)); setApplied(draft); setMessage("Your MP4 is ready to play and save.");
    } catch (error) { setMessage(error instanceof Error && (error.name === "ConversionCanceledError" || error.name === "AbortError") ? "Export cancelled. Your original is unchanged." : error instanceof Error ? error.message : "Could not make the video on this device."); }
    finally { active.current = null; input.dispose(); setBusy(false); }
  }
  // The preview sizes this same native player to the encoded frame: the actual
  // output pixels where they fit, scaled down only for the existing 42rem width
  // and 32rem height bounds. Toggling only changes element attributes, so the
  // source, controls and playback position stay exactly as they are.
  const [outWidth, outHeight] = sizes[quality][shape];
  const previewStyle = {
    width: `min(${outWidth}px, 100%, ${Math.min(42, (32 * outWidth) / outHeight)}rem)`,
    maxHeight: "32rem",
    aspectRatio: `${outWidth} / ${outHeight}`,
    objectFit: fit,
    background: "#000",
  };
  return <main className="trim-page" id="main"><header><a href="/">← Media Studio</a><h1>Clip and frame a video</h1><p>Choose a short video, set its in and out points and save a new MP4. Editing happens on this device without sign-in or generation. You can choose to upload the finished MP4 to Studio afterwards.</p></header>
    <section className="trim-work" aria-labelledby="video-source"><h2 id="video-source">Your video</h2><label className="trim-file">Choose video<input ref={chooser} type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy || importing} onChange={e => void choose(e.target.files?.[0])}/></label><p className="trim-note">MP4 or WebM up to 128 MB and 3 minutes; browser support varies. Export up to 60 seconds.</p>
      {file && <><p><strong>{file.name}</strong> · {duration.toFixed(2)} seconds</p>
      <label className="video-tool-check"><input type="checkbox" checked={previewFraming} onChange={e => setPreviewFraming(e.target.checked)}/> Preview output framing</label>
      <video className="video-tool-player" src={source} controls playsInline style={previewFraming ? previewStyle : undefined} aria-label={previewFraming ? "Original video, framing preview" : "Original video"}/>
      <div className="trim-fields"><label>Start (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing} value={Number.isNaN(start) ? "" : start} onChange={e => {setStart(e.target.value === "" ? NaN : Number(e.target.value));}}/></label><label>End (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing} value={Number.isNaN(end) ? "" : end} onChange={e => {setEnd(e.target.value === "" ? NaN : Number(e.target.value));}}/></label>
      <label>Frame<select value={shape} disabled={busy || importing} onChange={e => {setShape(e.target.value as Shape);}}><option value="portrait">9:16 · portrait</option><option value="landscape">16:9 · landscape</option><option value="square">1:1 · square</option></select></label><label>Quality<select value={quality} disabled={busy || importing} onChange={e => {setQuality(e.target.value as Quality);}}><option value="standard">Standard</option><option value="hd">HD · 720p</option></select></label><label>Fit<select value={fit} disabled={busy || importing} onChange={e => {setFit(e.target.value as Fit);}}><option value="contain">Fit entire picture (bars)</option><option value="cover">Fill frame (centre crop)</option></select></label></div>
      <label className="video-tool-check"><input type="checkbox" checked={mute} disabled={busy || importing} onChange={e => {setMute(e.target.checked);}}/> Mute original audio</label><p className="trim-note">H.264/AAC MP4 · {sizes[quality][shape][0]} × {sizes[quality][shape][1]} · {quality === "hd" ? "4 Mbps" : "1.2 Mbps"} video. HD uses more memory and may not work in every browser; try Standard if it cannot export. Crop is centred.</p>
      {!busy ? <button type="button" disabled={importing || checking} onClick={() => void makeClip()}>Make MP4</button> : <button type="button" className="secondary" onClick={() => { cancelRequested.current = true; setMessage("Cancelling export…"); void active.current?.cancel(); }}>Cancel export</button>}</>}
      <p role="status" aria-live="polite">{message}</p>{result && <div className="trim-result" aria-busy={checking}><h2>{previous ? "Previous export" : "Your clip"}</h2>{previous && <p className="trim-note">Your settings changed after this MP4 was made. Make MP4 updates it; until then this is your last successful export.</p>}<ClipPoster key={`poster:${result}`} src={result} filename={`${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip`}/><a className="button" href={result} download={`${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip.mp4`}>Save MP4</a>{resultBlob && <div inert={checking || busy || undefined}><LocalImport key={`import:${result}`} blob={resultBlob} filename={`${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip.mp4`} operation="clip and frame" onBusyChange={setImporting}/></div>}</div>}
    </section></main>;
}
export function mountVideoClip(container: HTMLElement) { createRoot(container).render(<VideoClip />); }
