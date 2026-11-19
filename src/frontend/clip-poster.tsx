import type { ClipCaptionTrack } from "./clip-captions";
import { clipPosterError } from "./clip-poster-eligibility.ts";
import { MAX_CLIP_KIT_BYTES, type CompletedClip } from "./clip-receipt";
import { sha256Hex } from "../lib/util.mjs";
import { useEffect, useRef, useState } from "react";

// One snapshot holds the retained PNG and the frame facts that belong to it.
type Poster = Readonly<{ url: string; blob: Blob; time: number; width: number; height: number }>;

/** Capture a still from the finished local MP4; never sends or changes its source. */
export function ClipPoster({ src, filename, captionTrack, output }: {
  src: string;
  filename: string;
  captionTrack: ClipCaptionTrack | null;
  output: CompletedClip["output"] | null;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const captions = useRef<HTMLTrackElement | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const sequence = useRef(0);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [working, setWorking] = useState(false);
  const [kitUrl, setKitUrl] = useState("");
  const [kitMessage, setKitMessage] = useState("");
  const [kitPreparing, setKitPreparing] = useState(false);
  const copyRequest = useRef(0);
  const kitRequest = useRef(0);
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster.url); }, [poster]);
  useEffect(() => () => { if (kitUrl) URL.revokeObjectURL(kitUrl); }, [kitUrl]);
  useEffect(() => () => { sequence.current++; copyRequest.current++; kitRequest.current++; }, []);
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
    if (kitPreparing) return;
    const player = video.current;
    const problem = clipPosterError(player);
    if (!player || problem) { setMessage(problem); return; }
    const canvas = document.createElement("canvas"); canvas.width = player.videoWidth; canvas.height = player.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setMessage("This browser cannot capture a frame. You can still save the MP4."); return; }
    // Time, size and blob all come from this one paused frame and are held as a
    // single snapshot, so a later capture can never pair a stale PNG/time.
    const at = player.currentTime, width = canvas.width, height = canvas.height, token = ++sequence.current;
    // A new capture retires the previous poster and any feedback for its copy/kit.
    copyRequest.current++;
    setCopyMessage("");
    try {
      context.drawImage(player, 0, 0); setWorking(true); setMessage("Preparing the PNG on this device…");
      canvas.toBlob(blob => {
        if (token !== sequence.current) return;
        setWorking(false);
        if (!blob || blob.type !== "image/png") { setMessage(poster ? "This browser could not make a PNG for the new frame. You can still save the previous poster." : "This browser could not make a PNG. Your MP4 is unchanged."); return; }
        setPoster({ url: URL.createObjectURL(blob), blob, time: at, width, height });
        // Only a successfully retained frame retires a prepared/in-flight kit.
        kitRequest.current++;
        setKitUrl(""); setKitMessage(""); setKitPreparing(false);
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
  async function prepareKit() {
    if (!poster || !output || working || kitPreparing || kitUrl) return;
    const token = kitRequest.current;
    const snapshot = poster;
    setKitPreparing(true);
    setKitMessage("Preparing the poster kit on this device…");
    try {
      // Hash only after this explicit action: never on capture, load or
      // background. The MP4 is read solely to prove the finished result that
      // this exact PNG came from; it is not sent or otherwise changed.
      const [mp4, png] = await Promise.all([output.blob.arrayBuffer(), snapshot.blob.arrayBuffer()]);
      if (token !== sequence.current) return;
      const [clipSha256, pngSha256] = await Promise.all([
        sha256Hex(new Uint8Array(mp4)),
        sha256Hex(new Uint8Array(png)),
      ]);
      if (token !== sequence.current) return;
      const receiptText = JSON.stringify({
        schema: "media-studio/clip-poster-receipt",
        version: 1,
        clip: { bytes: output.blob.size, sha256: clipSha256 },
        capturedSeconds: snapshot.time,
        poster: { width: snapshot.width, height: snapshot.height, bytes: snapshot.blob.size, sha256: pngSha256 },
      }, null, 2) + "\n";
      const { createZip, ZIP_MIME } = await import("./image-zip.ts");
      if (token !== sequence.current) return;
      const zip = createZip([
        { name: `${filename}-poster.png`, data: new Uint8Array(png) },
        { name: `${filename}-poster-receipt.json`, data: receiptText },
      ], { maxTotalBytes: MAX_CLIP_KIT_BYTES });
      if (!zip.ok) throw new Error(zip.error);
      if (token !== sequence.current) return;
      setKitUrl(URL.createObjectURL(new Blob([zip.bytes.buffer as ArrayBuffer], { type: ZIP_MIME })));
      setKitMessage("Poster kit ready to save.");
    } catch {
      if (token === sequence.current) setKitMessage("Could not prepare the poster kit. You can still save the PNG and clip receipt.");
    } finally {
      if (token === sequence.current) setKitPreparing(false);
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
      <button type="button" className="secondary" disabled={working || kitPreparing} onClick={capture}>Capture paused frame</button>
      <p role="status">{message}</p>
      {poster && <div>
        <img className="clip-poster-preview" src={poster.url} alt={`Captured poster at ${poster.time.toFixed(2)} seconds`} />
        <p className="trim-note">Captured at {poster.time.toFixed(2)} seconds from the finished clip.</p>
        <div className="video-tool-actions">
          <a className="button secondary" href={poster.url} download={`${filename}-poster.png`}>Save poster PNG</a>
          {canCopyPng && <button type="button" className="button secondary" disabled={copying || working} onClick={() => void copyPosterPng()}>
            {copying ? "Copying poster PNG…" : "Copy poster PNG"}
          </button>}
          <a className="button secondary" href="/tools/images" target="_blank" rel="noopener noreferrer">Open Image Workbench</a>
        </div>
        <p className="trim-note" role="status">{copyMessage}</p>
        <p className="trim-note">{canCopyPng ? "Paste the copied poster in Image Workbench, or choose the PNG you saved." : "Choose the saved PNG in Image Workbench."} The workbench opens in another tab.</p>
        {output && <div>
          <p className="trim-note">Keep the PNG and a receipt that identifies the finished clip and the captured time. The ZIP is made on this device.</p>
          <button type="button" className="button secondary" disabled={working || kitPreparing || Boolean(kitUrl)} onClick={() => void prepareKit()}>
            {kitPreparing ? "Preparing poster kit…" : "Prepare poster kit"}
          </button>
          <p className="trim-note" role="status">{kitMessage}</p>
          {kitUrl && <a className="button secondary" href={kitUrl} download={`${filename}-poster-kit.zip`}>Save poster kit (ZIP)</a>}
        </div>}
      </div>}
    </details>
  </>;
}
