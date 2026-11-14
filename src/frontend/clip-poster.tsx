import { clipPosterError } from "./clip-poster-eligibility.mjs";
import { useEffect, useRef, useState } from "react";

/** Capture a still from the finished local MP4; never sends or changes its source. */
export function ClipPoster({ src, filename }: { src: string; filename: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const sequence = useRef(0);
  const [poster, setPoster] = useState("");
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster); }, [poster]);
  useEffect(() => () => { sequence.current++; }, []);
  function capture() {
    const player = video.current;
    const problem = clipPosterError(player);
    if (!player || problem) { setMessage(problem); return; }
    const canvas = document.createElement("canvas"); canvas.width = player.videoWidth; canvas.height = player.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setMessage("This browser cannot capture a frame. You can still save the MP4."); return; }
    const at = player.currentTime, token = ++sequence.current;
    try {
      context.drawImage(player, 0, 0); setPoster(""); setWorking(true); setMessage("Preparing the PNG on this device…");
      canvas.toBlob(blob => {
        if (token !== sequence.current) return;
        setWorking(false);
        if (!blob || blob.type !== "image/png") { setMessage("This browser could not make a PNG. Your MP4 is unchanged."); return; }
        setPoster(URL.createObjectURL(blob)); setTime(at); setMessage("Poster ready. Save it on this device.");
      }, "image/png");
    } catch { setWorking(false); setMessage("This browser could not capture the frame. Your MP4 is unchanged."); }
  }
  return <><video ref={video} className="video-tool-player" src={src} controls playsInline aria-label="Finished video"/>
    <details><summary>Make a poster from this clip</summary><p className="trim-note">Pause the finished clip on the frame you want. Capture makes a separate PNG with the same frame and crop. Choose Save to download it; it stays on this device.</p><button type="button" className="secondary" disabled={working} onClick={capture}>Capture paused frame</button><p role="status" aria-live="polite">{message}</p>{poster && <div><img className="clip-poster-preview" src={poster} alt={`Captured poster at ${time.toFixed(2)} seconds`}/><p className="trim-note">Captured at {time.toFixed(2)} seconds from the finished clip.</p><a className="button secondary" href={poster} download={`${filename}-poster.png`}>Save poster PNG</a></div>}</details></>;
}
