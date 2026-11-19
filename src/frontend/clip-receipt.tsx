import { useEffect, useRef, useState } from "react";
import { clippedCaptionFor } from "../lib/public-captions";
import { sha256Hex } from "../lib/util.mjs";

export type CompletedClip = Readonly<{
  source: File;
  watchUrl: string | null;
  edit: Readonly<{
    startSeconds: number;
    endSeconds: number;
    frame: "portrait" | "landscape" | "square";
    quality: "standard" | "hd";
    fit: "cover" | "contain";
    muteRequested: boolean;
  }>;
  output: Readonly<{ blob: Blob; width: number; height: number }>;
}>;

export function ClipReceiptDownload({ clip, filename }: { clip: CompletedClip; filename: string }) {
  const [url, setUrl] = useState("");
  const [vttUrl, setVttUrl] = useState("");
  const [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (vttUrl) URL.revokeObjectURL(vttUrl); }, [vttUrl]);

  async function prepare() {
    if (preparing || url) return;
    setPreparing(true);
    setMessage("Checking the original and finished MP4 on this device…");
    const { source, watchUrl, edit, output } = clip;
    try {
      const sourceSha = await sha256Hex(new Uint8Array(await source.arrayBuffer()));
      if (!mounted.current) return;
      const outputSha = await sha256Hex(new Uint8Array(await output.blob.arrayBuffer()));
      if (!mounted.current) return;
      const receipt = {
        schema: "media-studio/video-clip-receipt",
        version: 1,
        source: { name: source.name, bytes: source.size, watchUrl, sha256: sourceSha },
        edit,
        output: { width: output.width, height: output.height, mime: output.blob.type, bytes: output.blob.size, sha256: outputSha },
      };
      setUrl(URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2) + "\n"], { type: "application/json" })));
      // The sidecar is a sibling of the receipt, never a burn-in. It is only
      // offered once this deliberate calculation has proved the original is
      // the exact registered public film and the edit ties to the finished MP4.
      const vtt = clippedCaptionFor({
        sha256: sourceSha,
        watchUrl,
        startSeconds: edit.startSeconds,
        endSeconds: edit.endSeconds,
      });
      if (vtt) setVttUrl(URL.createObjectURL(new Blob([vtt], { type: "text/vtt; charset=utf-8" })));
      setMessage("Receipt ready to save.");
    } catch {
      if (mounted.current) setMessage("Could not prepare the receipt. You can try again or save the MP4.");
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }

  return <details>
    <summary>Clip receipt</summary>
    <p className="trim-note">Save the settings and SHA-256 digests of this export and its source. The receipt includes the original filename and stays on this device until you share it.</p>
    <button type="button" className="secondary" aria-disabled={preparing || Boolean(url)} onClick={() => void prepare()}>Prepare receipt</button>
    <p role="status" aria-live="polite">{message}</p>
    {url && <a className="button secondary" href={url} download={`${filename}-receipt.json`}>Save receipt JSON</a>}
    {vttUrl && <p><a className="button secondary" href={vttUrl} download={`${filename}-en.vtt`}>Save English captions (VTT)</a></p>}
  </details>;
}
