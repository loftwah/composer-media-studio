import type { ClipCaptionTrack } from "./clip-captions";
import { clipPosterError } from "./clip-poster-eligibility.ts";
import { useEffect, useRef, useState } from "react";

/** Capture a still from the finished local MP4; never sends or changes its source. */
export function ClipPoster({ src, filename, captionTrack }: { src: string; filename: string; captionTrack: ClipCaptionTrack | null }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const captions = useRef<HTMLTrackElement | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const sequence = useRef(0);
  const [poster, setPoster] = useState<{ url: string; blob: Blob } | null>(null);
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [working, setWorking] = useState(false);
  const copyRequest = useRef(0);
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster.url); }, [poster]);
  useEffect(() => () => { sequence.current++; copyRequest.current++; }, []);
  const canCopyPng =
    typeof window !== "undefined" &&
    typeof window.ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function";
  useEffect(() => {
    const tracks = video.current?.textTracks;
    const track = captions.current?.track;
    if (!tracks || !track) return;
    const sync = () => setShowCaptions(track.mode === "showing");
    tracks.addEventListener("change", sync);
    sync();
    return () => tracks.removeEventListener("change", sync);
  }, [captionTrack]);
  function toggleCaptions(show: boolean) {
    const track = captions.current?.track;
    if (!track) return;
    track.mode = show ? "showing" : "disabled";
    setShowCaptions(show);
  }
  function capture() {
    const player = video.current;
    const problem = clipPosterError(player);
    if (!player || problem) { setMessage(problem); return; }
    const canvas = document.createElement("canvas"); canvas.width = player.videoWidth; canvas.height = player.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setMessage("This browser cannot capture a frame. You can still save the MP4."); return; }
    const at = player.currentTime, token = ++sequence.current;
    // A new capture retires the previous poster and any feedback for its copy.
    copyRequest.current++;
    setCopyMessage("");
    try {
      context.drawImage(player, 0, 0); setWorking(true); setMessage("Preparing the PNG on this device…");
      canvas.toBlob(blob => {
        if (token !== sequence.current) return;
        setWorking(false);
        if (!blob || blob.type !== "image/png") { setMessage(poster ? "This browser could not make a PNG for the new frame. You can still save the previous poster." : "This browser could not make a PNG. Your MP4 is unchanged."); return; }
        setPoster({ url: URL.createObjectURL(blob), blob });
        setTime(at);
        setMessage("Poster ready on this device.");
      }, "image/png");
    } catch { setWorking(false); setMessage("This browser could not capture the frame. Your MP4 is unchanged."); }
  }
  async function copyPosterPng() {
    if (!poster || copying || working || !canCopyPng) return;
    const { blob } = poster;
    const attempt = ++copyRequest.current;
    const report = (text: string) => {
      if (attempt === copyRequest.current) setCopyMessage(text);
    };
    setCopying(true);
    try {
      const png = new window.ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([png]);
      report("Poster PNG copied. Paste it into Image Workbench.");
    } catch {
      report("Could not copy the poster PNG. Save it and choose the file in Image Workbench.");
    } finally {
      setCopying(false);
    }
  }
  return <>
    <video ref={video} className="video-tool-player" src={src} controls playsInline aria-label="Finished video">
      {captionTrack && <track ref={captions} kind="captions" label={captionTrack.english ? "English" : "Imported captions"} srcLang={captionTrack.english ? "en" : undefined} src={captionTrack.url}/>}
    </video>
    {captionTrack && <label className="video-tool-check">
      <input type="checkbox" checked={showCaptions} onChange={event => toggleCaptions(event.currentTarget.checked)}/>
      Show {captionTrack.english ? "English" : "imported"} captions on preview
    </label>}
    <details>
      <summary>Make a poster from this clip</summary>
      <p className="trim-note">Pause the finished clip on the frame you want. Capture makes a separate PNG with the same frame and crop on this device.</p>
      <button type="button" className="secondary" disabled={working} onClick={capture}>Capture paused frame</button>
      <p role="status">{message}</p>
      {poster && <div>
        <img className="clip-poster-preview" src={poster.url} alt={`Captured poster at ${time.toFixed(2)} seconds`} />
        <p className="trim-note">Captured at {time.toFixed(2)} seconds from the finished clip.</p>
        <div className="video-tool-actions">
          <a className="button secondary" href={poster.url} download={`${filename}-poster.png`}>Save poster PNG</a>
          {canCopyPng && <button type="button" className="button secondary" disabled={copying || working} onClick={() => void copyPosterPng()}>
            {copying ? "Copying poster PNG…" : "Copy poster PNG"}
          </button>}
          <a className="button secondary" href="/tools/images" target="_blank" rel="noopener noreferrer">Open Image Workbench</a>
        </div>
        <p className="trim-note" role="status">{copyMessage}</p>
        <p className="trim-note">{canCopyPng ? "Paste the copied poster in Image Workbench, or choose the PNG you saved." : "Choose the saved PNG in Image Workbench."} The workbench opens in another tab.</p>
      </div>}
    </details>
  </>;
}
