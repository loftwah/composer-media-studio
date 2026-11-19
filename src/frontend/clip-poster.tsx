import { clipPosterError } from "./clip-poster-eligibility.ts";
import { useEffect, useRef, useState } from "react";

/** Capture a still from the finished local MP4; never sends or changes its source. */
export function ClipPoster({ src, filename, captionUrl }: { src: string; filename: string; captionUrl: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const captions = useRef<HTMLTrackElement | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const sequence = useRef(0);
  const [poster, setPoster] = useState("");
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster); }, [poster]);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    const tracks = video.current?.textTracks;
    const track = captions.current?.track;
    if (!tracks || !track) return;
    const sync = () => setShowCaptions(track.mode === "showing");
    tracks.addEventListener("change", sync);
    sync();
    return () => tracks.removeEventListener("change", sync);
  }, [captionUrl]);
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
    try {
      context.drawImage(player, 0, 0); setWorking(true); setMessage("Preparing the PNG on this device…");
      canvas.toBlob(blob => {
        if (token !== sequence.current) return;
        setWorking(false);
        if (!blob || blob.type !== "image/png") { setMessage(poster ? "This browser could not make a PNG for the new frame. You can still save the previous poster." : "This browser could not make a PNG. Your MP4 is unchanged."); return; }
        setPoster(URL.createObjectURL(blob)); setTime(at); setMessage("Poster ready. Save it on this device.");
      }, "image/png");
    } catch { setWorking(false); setMessage("This browser could not capture the frame. Your MP4 is unchanged."); }
  }
  return <>
    <video ref={video} className="video-tool-player" src={src} controls playsInline aria-label="Finished video">
      {captionUrl && <track ref={captions} kind="captions" label="English" srcLang="en" src={captionUrl}/>}
    </video>
    {captionUrl && <label className="video-tool-check">
      <input type="checkbox" checked={showCaptions} onChange={event => toggleCaptions(event.currentTarget.checked)}/>
      Show English captions on preview
    </label>}
    <details><summary>Make a poster from this clip</summary><p className="trim-note">Pause the finished clip on the frame you want. Capture makes a separate PNG with the same frame and crop. Choose Save to download it; it stays on this device.</p><button type="button" className="secondary" disabled={working} onClick={capture}>Capture paused frame</button><p role="status" aria-live="polite">{message}</p>{poster && <div><img className="clip-poster-preview" src={poster} alt={`Captured poster at ${time.toFixed(2)} seconds`}/><p className="trim-note">Captured at {time.toFixed(2)} seconds from the finished clip.</p><a className="button secondary" href={poster} download={`${filename}-poster.png`}>Save poster PNG</a></div>}</details></>;
}
