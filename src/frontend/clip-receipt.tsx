import { captionReceiptFields, srtForClipVtt, type ClipCaptionTrack } from "./clip-captions";
import type { CropAnchor } from "./clip-crop";
import { useEffect, useRef, useState } from "react";
import { clippedCaptionFor } from "../lib/public-captions";
import { sha256Hex } from "../lib/util.mjs";

export const MAX_CLIP_KIT_BYTES = 32 * 1024 * 1024;

export type CompletedClip = Readonly<{
  source: File;
  watchUrl: string | null;
  edit: Readonly<{
    startSeconds: number;
    endSeconds: number;
    frame: "portrait" | "landscape" | "square";
    quality: "standard" | "hd";
    fit: "cover" | "contain";
    // Absent for centre (and for contain), so v1 receipts stay byte-identical.
    cropAnchor?: Exclude<CropAnchor, "center">;
    muteRequested: boolean;
  }>;
  output: Readonly<{ blob: Blob; width: number; height: number }>;
  captions?: Readonly<{ name: string; sourceSha256: string; vtt: string | null; offsetMs?: number }>;
}>;

// One snapshot keeps the offered bytes and their URLs in step: the ZIP reuses
// the very strings and MP4 blob behind the individual downloads, and a new
// result replaces this whole object rather than leaving stale URLs behind.
type Prepared = Readonly<{
  receiptText: string;
  receiptUrl: string;
  vttText: string | null;
  vttUrl: string | null;
  srtUrl: string | null;
  kitInputBytes: number;
}>;

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function ClipReceiptDownload({ clip, filename, onCaptionReady }: {
  clip: CompletedClip;
  filename: string;
  onCaptionReady: (track: ClipCaptionTrack) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [kitPreparing, setKitPreparing] = useState(false);
  const [kitUrl, setKitUrl] = useState("");
  const mounted = useRef(false);
  const captionFile = `${filename}-${clip.captions ? "captions" : "en"}.vtt`;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Key each cleanup to the URL itself: adding the kit URL must not revoke the
  // receipt/VTT URLs that the individual links still point at.
  useEffect(() => () => { if (prepared?.receiptUrl) URL.revokeObjectURL(prepared.receiptUrl); }, [prepared?.receiptUrl]);
  useEffect(() => () => { if (prepared?.vttUrl) URL.revokeObjectURL(prepared.vttUrl); }, [prepared?.vttUrl]);
  useEffect(() => () => { if (prepared?.srtUrl) URL.revokeObjectURL(prepared.srtUrl); }, [prepared?.srtUrl]);
  useEffect(() => () => { if (kitUrl) URL.revokeObjectURL(kitUrl); }, [kitUrl]);

  async function prepare() {
    if (preparing || prepared) return;
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
        ...(clip.captions ? { captions: captionReceiptFields(clip.captions, clip.captions.offsetMs ?? 0) } : {}),
        output: { width: output.width, height: output.height, mime: output.blob.type, bytes: output.blob.size, sha256: outputSha },
      };
      const receiptText = JSON.stringify(receipt, null, 2) + "\n";
      // The sidecar is a sibling of the receipt, never a burn-in. It is only
      // offered once this deliberate calculation has proved the original is
      // the exact registered public film and the edit ties to the finished MP4.
      const vtt = clip.captions ? clip.captions.vtt : edit.muteRequested ? null : clippedCaptionFor({
        sha256: sourceSha,
        watchUrl,
        startSeconds: edit.startSeconds,
        endSeconds: edit.endSeconds,
      });
      // The SRT is derived from this same prepared VTT at zero offset, so it
      // shares its exact trimmed cue set and timeline. The shared parser decides
      // whether an equivalent plain-text SRT can be produced at all.
      const durationMs = Math.round(edit.endSeconds * 1000) - Math.round(edit.startSeconds * 1000);
      const srt = srtForClipVtt(vtt, durationMs);
      const receiptUrl = URL.createObjectURL(new Blob([receiptText], { type: "application/json" }));
      const vttUrl = vtt ? URL.createObjectURL(new Blob([vtt], { type: "text/vtt; charset=utf-8" })) : null;
      const srtUrl = srt ? URL.createObjectURL(new Blob([srt], { type: "application/x-subrip; charset=utf-8" })) : null;
      setPrepared({
        receiptText,
        receiptUrl,
        vttText: vtt,
        vttUrl,
        srtUrl,
        kitInputBytes: output.blob.size + utf8Bytes(receiptText) + (vtt ? utf8Bytes(vtt) : 0),
      });
      if (vttUrl && !clip.captions) onCaptionReady({ url: vttUrl, english: true });
      setMessage(clip.captions && !vtt ? "Receipt ready. No imported cues fall inside this clip." : "Receipt ready to save.");
    } catch {
      if (mounted.current) setMessage("Could not prepare the receipt. You can try again or save the MP4.");
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }

  async function prepareKit() {
    if (!prepared || kitPreparing || kitUrl || prepared.kitInputBytes > MAX_CLIP_KIT_BYTES) return;
    const snapshot = prepared;
    setKitPreparing(true);
    setMessage("Preparing the clip kit on this device…");
    try {
      // Read the retained MP4 for packaging only after the explicit kit action.
      const mp4 = new Uint8Array(await clip.output.blob.arrayBuffer());
      if (!mounted.current) return;
      const { createZip, ZIP_MIME } = await import("./image-zip.ts");
      if (!mounted.current) return;
      const entries = [
        { name: `${filename}.mp4`, data: mp4 },
        { name: `${filename}-receipt.json`, data: snapshot.receiptText },
        ...(snapshot.vttText ? [{ name: captionFile, data: snapshot.vttText }] : []),
      ];
      const zip = createZip(entries, { maxTotalBytes: MAX_CLIP_KIT_BYTES });
      if (!zip.ok) throw new Error("Could not package the clip. Its individual files are ready to save.");
      const archive = new Blob([zip.bytes.buffer as ArrayBuffer], { type: ZIP_MIME });
      setKitUrl(URL.createObjectURL(archive));
      setMessage("Clip kit ready to save.");
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : "Could not prepare the clip kit.");
    } finally {
      if (mounted.current) setKitPreparing(false);
    }
  }

  const kitAvailable = Boolean(prepared && prepared.kitInputBytes <= MAX_CLIP_KIT_BYTES);
  return <details>
    <summary>Clip receipt</summary>
    <p className="trim-note">Save the settings and SHA-256 digests of this export and its source. The receipt includes the original filename and stays on this device until you share it.</p>
    <button type="button" className="secondary" aria-disabled={preparing || Boolean(prepared)} onClick={() => void prepare()}>Prepare receipt</button>
    <p role="status" aria-live="polite">{message}</p>
    {prepared && <>
      <a className="button secondary" href={prepared.receiptUrl} download={`${filename}-receipt.json`}>Save receipt JSON</a>
      {prepared.vttUrl && <p><a className="button secondary" href={prepared.vttUrl} download={captionFile}>Save {clip.captions ? "imported" : "English"} captions (VTT)</a></p>}
      {prepared.srtUrl && <p><a className="button secondary" href={prepared.srtUrl} download={`${filename}-${clip.captions ? "captions" : "en"}.srt`}>Save {clip.captions ? "imported" : "English"} captions (SRT)</a></p>}
      {kitAvailable ? <>
        <button
          type="button"
          className="secondary"
          aria-disabled={kitPreparing || Boolean(kitUrl)}
          onClick={() => void prepareKit()}
        >
          {kitPreparing ? "Preparing clip kit…" : "Prepare clip kit"}
        </button>
        {kitUrl && <p><a className="button secondary" href={kitUrl} download={`${filename}-kit.zip`}>Save clip kit (ZIP)</a></p>}
      </> : <p className="trim-note">The clip kit supports up to 32 MiB. Save the individual files for larger clips.</p>}
    </>}
  </details>;
}
