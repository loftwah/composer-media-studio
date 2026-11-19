import { useRef, useState } from "react";
import { verifyClipPosterFiles } from "./clip-poster-verify";

type VerifiedPoster = Awaited<ReturnType<typeof verifyClipPosterFiles>>;
type Phase = "idle" | "loading" | "verified" | "refused";

/**
 * Local-only reopen check for a poster kit saved earlier. The visitor supplies
 * the receipt JSON and PNG extracted from the kit ZIP, plus the finished MP4
 * saved separately. Nothing is read until the explicit button, and nothing is
 * sent or changed on this device.
 */
export function ClipPosterVerifyPanel() {
  const [receipt, setReceipt] = useState<File | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState<VerifiedPoster | null>(null);
  const request = useRef(0);

  // Changing any of the three selections retires an in-flight check and clears
  // a previous result, so a success (or refusal) can never describe files that
  // are no longer selected.
  function clearResult() {
    request.current++;
    setPhase("idle");
    setVerified(null);
    setMessage("");
  }

  async function check() {
    if (phase === "loading") return;
    if (!receipt || !poster || !clip) {
      clearResult();
      setPhase("refused");
      setMessage("Choose the receipt JSON, the poster PNG and the finished MP4 before verifying.");
      return;
    }
    const attempt = ++request.current;
    setPhase("loading");
    setVerified(null);
    setMessage("Checking this poster kit on this device…");
    try {
      const result = await verifyClipPosterFiles(receipt, clip, poster);
      if (attempt !== request.current) return;
      setVerified(result);
      setPhase("verified");
      setMessage("The PNG and MP4 match this receipt.");
    } catch (error) {
      if (attempt !== request.current) return;
      setPhase("refused");
      setMessage(error instanceof Error ? error.message : "This poster kit could not be verified.");
    }
  }

  return <details className="clip-poster-verify">
    <summary>Verify a saved poster kit</summary>
    <p className="trim-note">Extract the JSON and PNG from your poster kit. Select both and the finished MP4 you saved separately. The files stay on this device.</p>
    <div className="trim-fields">
      <label className="trim-file">Poster receipt (JSON from the kit ZIP)
        <input type="file" accept="application/json,.json" onChange={event => {
          setReceipt(event.currentTarget.files?.[0] ?? null);
          clearResult();
        }}/>
      </label>
      <label className="trim-file">Poster image (PNG from the kit ZIP)
        <input type="file" accept="image/png,.png" onChange={event => {
          setPoster(event.currentTarget.files?.[0] ?? null);
          clearResult();
        }}/>
      </label>
      <label className="trim-file">Finished clip (MP4 saved separately)
        <input type="file" accept="video/mp4,.mp4" onChange={event => {
          setClip(event.currentTarget.files?.[0] ?? null);
          clearResult();
        }}/>
      </label>
    </div>
    <p><button type="button" className="secondary" disabled={phase === "loading"} aria-busy={phase === "loading"} onClick={() => void check()}>
      {phase === "loading" ? "Verifying…" : "Verify poster kit"}
    </button></p>
    <p className="trim-note" role={phase === "refused" ? "alert" : "status"} aria-live="polite">{message}</p>
    {phase === "verified" && verified && <p className="trim-note" role="status">
      Receipt time {verified.capturedSeconds.toFixed(2)} seconds · {verified.width} × {verified.height} PNG
    </p>}
  </details>;
}
