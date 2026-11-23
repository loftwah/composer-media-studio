import { parseCaptionFile, type ImportedCue } from "./caption-import";
import { captionFileFromText } from "./caption-paste";
import { MAX_CAPTION_BYTES, MAX_CAPTION_OFFSET_SECONDS, clipCaptionCues, clipTimeStamp, serializeClipCaptions, sourcePreviewVtt, srtForClipVtt, type ClipCaptionTrack } from "./clip-captions";
import { appendManualClipCue, manualCaptionSourceName, manualCaptionTrackVtt, removeClipDraftCue } from "./clip-manual-cue";
import { ClipReceiptDownload, type CompletedClip } from "./clip-receipt";
import { MAX_RECEIPT_BYTES, parseClipReceipt } from "./clip-receipt-open";
import { clipCropRectangle, cropObjectPosition, type CropAnchor, type CropRectangle } from "./clip-crop";
import { ClipPoster } from "./clip-poster";
import { ClipPosterVerifyPanel } from "./clip-poster-verify-panel";
import { sha256Hex } from "../lib/util.mjs";
import { probeMediaTrack } from "./media-probe";
import { LocalImport } from "./local-import";
import {
  MAX_PUBLIC_VIDEO_BYTES as MAX_BYTES,
  MAX_PUBLIC_VIDEO_SOURCE_SECONDS as MAX_SOURCE_SECONDS,
  PUBLIC_VIDEO_TIMEOUT_MS,
  fetchPublicVideo,
  fetchSavedStudioVideo,
  publicVideoFromHash,
  savedStudioVideoFromHash,
} from "./video-clip-source";
import {
  VIDEO_MP4,
  localMixBlobFits, localMixTokenFromHash, localMixToolUrl, newLocalMixToken,
  openLocalMixHandoff, receiveLocalMix,
  type LocalMixHandoff, type LocalMixHandoffStatus,
} from "./local-mix-handoff";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, VideoSampleSink } from "mediabunny";
import "./audio-trim.css";
import "./video-clip.css";

const MAX_CLIP_SECONDS = 60;
const sizes = {
  standard: { portrait: [360, 640], landscape: [640, 360], square: [480, 480] },
  hd: { portrait: [720, 1280], landscape: [1280, 720], square: [720, 720] },
} as const;
type Quality = keyof typeof sizes;
type Shape = keyof typeof sizes.standard;
type Fit = "cover" | "contain";
type CaptionDraft = Readonly<{ name: string; sourceSha256: string; cues: ImportedCue[]; local: boolean }>;

async function editedCaptionDraft(previous: CaptionDraft | null, cues: ImportedCue[]): Promise<CaptionDraft> {
  const source = manualCaptionTrackVtt(cues);
  if (!source) throw new Error("The cue times do not fit this video.");
  return {
    name: manualCaptionSourceName(previous),
    sourceSha256: await sha256Hex(new TextEncoder().encode(source)),
    cues,
    local: true,
  };
}

// Accept a decimal-seconds offset only when it is a whole number of
// milliseconds within the advertised +/- bound. Returns null when invalid so
// the field can be flagged and export stopped without mutating the draft.
function parseCaptionOffset(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_CAPTION_OFFSET_SECONDS) return null;
  const ms = value * 1000;
  const whole = Math.round(ms);
  return Number.isSafeInteger(whole) && Math.abs(ms - whole) < 1e-6 ? whole : null;
}

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
  const [completedClip, setCompletedClip] = useState<CompletedClip | null>(null);
  const [captionTrack, setCaptionTrack] = useState<ClipCaptionTrack | null>(null);
  const [captionDraft, setCaptionDraft] = useState<CaptionDraft | null>(null);
  // One-step snapshot of the exact draft before the most recent cue removal.
  // Any later caption change or source change clears it, so Undo cannot replace
  // newer work with stale cues or a stale source name and digest.
  const [captionUndo, setCaptionUndo] = useState<CaptionDraft | null>(null);
  const captionUndoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (captionUndo && document.activeElement === document.body) captionUndoButton.current?.focus();
  }, [captionUndo]);
  const [captionOffsetRaw, setCaptionOffsetRaw] = useState("0");
  const [captionText, setCaptionText] = useState("");
  const [manualCueText, setManualCueText] = useState("");
  const [manualCueStart, setManualCueStart] = useState("");
  const [manualCueEnd, setManualCueEnd] = useState("");
  const [manualCueMessage, setManualCueMessage] = useState("");
  const [captionMessage, setCaptionMessage] = useState("");
  const [captionLoading, setCaptionLoading] = useState(false);
  const [showSourceCaptions, setShowSourceCaptions] = useState(false);
  const [sourceCaptionTrack, setSourceCaptionTrack] = useState<{ vtt: string; url: string } | null>(null);
  const [sourceTrackProblem, setSourceTrackProblem] = useState("");
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const sourceCaptions = useRef<HTMLTrackElement>(null);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const captionRequest = useRef(0);
  const receiptRequest = useRef(0);
  // Settings recorded only when an export succeeds: proof of what the finished
  // file actually contains, not what the controls currently show.
  const [applied, setApplied] = useState<{ settings: string; captions: CaptionDraft | null; captionOffsetMs: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [shape, setShape] = useState<Shape>("portrait");
  const [quality, setQuality] = useState<Quality>("standard");
  const [fit, setFit] = useState<Fit>("contain");
  const [cropAnchor, setCropAnchor] = useState<CropAnchor>("center");
  const [previewFraming, setPreviewFraming] = useState(false);
  const [mute, setMute] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  // A handoff only offers a source; nothing is fetched until the visitor acts.
  const [sourceHandoff] = useState(() => {
    const hash = window.location.hash;
    const saved = savedStudioVideoFromHash(hash);
    if (saved) return { kind: "studio" as const, source: saved };
    const published = publicVideoFromHash(hash);
    return published ? { kind: "published" as const, source: published } : null;
  });
  const publicVideo = sourceHandoff?.kind === "published" ? sourceHandoff.source : null;
  const [localMixToken] = useState(() => localMixTokenFromHash(window.location.hash));
  const [sourceLoading, setSourceLoading] = useState(false);
  const [loadedHandoff, setLoadedHandoff] = useState<"published" | "studio" | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  const current = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  const active = useRef<Conversion | null>(null);
  const cancelRequested = useRef(false);
  const handoff = useRef<LocalMixHandoff | null>(null);
  // Mirrors the committed snapshot so a handoff can tell a stale input from the
  // exact clip that was opened before it replies with the File.
  const completedClipRef = useRef<CompletedClip | null>(null);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => () => {
    if (captionTrack && !captionTrack.english) URL.revokeObjectURL(captionTrack.url);
  }, [captionTrack]);
  useEffect(() => { completedClipRef.current = completedClip; }, [completedClip]);
  useEffect(() => () => {
    current.current++; captionRequest.current++; receiptRequest.current++;
    void active.current?.cancel();
    handoff.current?.close();
  }, []);
  useEffect(() => () => sourceRequest.current?.abort(), []);
  // Consume only the explicit handoff from the opener that launched this tab.
  // A ready is announced once; the first verified delivery from that exact
  // same-origin WindowProxy is the only one accepted, then all listeners go.
  useEffect(() => {
    if (!localMixToken) return;
    const sourceRevision = current.current;
    return receiveLocalMix({
      token: localMixToken,
      origin: window.location.origin,
      opener: window.opener,
      onDeliver: (file) => { if (sourceRevision === current.current) void choose(file); },
      onStatus: (status) => { if (sourceRevision === current.current) setMessage(
        status === "no-opener" ? "Choose the MP4 file on this device to open it in Video Clip."
          : status === "failed" ? "The local mix handoff could not start. Choose the MP4 file yourself."
            : "Video Clip did not receive the mix. Choose the MP4 file on this device."
      ); },
    });
  }, [localMixToken]);
  // A finished MP4 outlives draft edits: only a successful replacement, or a
  // valid new source, clears it. The draft key is compared with the recorded
  // one on every render, so returning to the same settings drops the note.
  const draft = [start, end, shape, quality, fit, fit === "cover" ? cropAnchor : "center", mute].join("|");
  const captionOffsetMs = captionDraft ? parseCaptionOffset(captionOffsetRaw) : 0;
  const validTrim = Number.isFinite(start) && Number.isFinite(end)
    && start >= 0 && end <= duration && end > start && end - start <= MAX_CLIP_SECONDS;
  // The review list, preflight count and serialized VTT all read this one
  // projection, so a cue row can never disagree with the exported timing.
  const trimmedCaptionCues = captionDraft && validTrim && captionOffsetMs !== null
    ? clipCaptionCues(captionDraft.cues, start, end, captionOffsetMs)
    : null;
  const survivingCaptionCount = trimmedCaptionCues?.length ?? null;
  const previous = applied !== null && (
    applied.settings !== draft || applied.captions !== captionDraft || applied.captionOffsetMs !== captionOffsetMs
  );

  // Draft sidecars: the same serializer the MP4 export uses, over the live trim,
  // offset and cue count, so no video has to be encoded. The SRT is derived from
  // that exact VTT over the current trim length in milliseconds; the shared
  // helper decides whether an equivalent plain-text sidecar can be offered at
  // all. An invalid trim or offset, or no surviving cue, yields no download.
  const draftCaptionVtt = captionDraft && validTrim && captionOffsetMs !== null
    && survivingCaptionCount !== null && survivingCaptionCount > 0
    ? serializeClipCaptions(captionDraft.cues, start, end, captionOffsetMs)
    : null;
  const draftCaptionSrt = draftCaptionVtt
    ? srtForClipVtt(draftCaptionVtt, Math.round(end * 1000) - Math.round(start * 1000))
    : null;
  const [draftCaptionFile, setDraftCaptionFile] = useState<{ vtt: string; vttUrl: string; srt: string | null; srtUrl: string | null } | null>(null);
  useEffect(() => {
    if (!draftCaptionVtt) {
      setDraftCaptionFile(null);
      return;
    }
    const vttUrl = URL.createObjectURL(new Blob([draftCaptionVtt], { type: "text/vtt; charset=utf-8" }));
    const srtUrl = draftCaptionSrt
      ? URL.createObjectURL(new Blob([draftCaptionSrt], { type: "application/x-subrip; charset=utf-8" }))
      : null;
    setDraftCaptionFile({ vtt: draftCaptionVtt, vttUrl, srt: draftCaptionSrt, srtUrl });
    return () => {
      URL.revokeObjectURL(vttUrl);
      if (srtUrl) URL.revokeObjectURL(srtUrl);
    };
  }, [draftCaptionVtt, draftCaptionSrt]);
  // Each link stays live only while its URL belongs to the exact serialized
  // content on screen, so a changed trim or offset cannot download a stale file.
  const currentDraftFile = draftCaptionFile?.vtt === draftCaptionVtt && draftCaptionFile.srt === draftCaptionSrt
    ? draftCaptionFile : null;
  const draftCaptionUrl = currentDraftFile?.vttUrl ?? null;
  const draftSrtUrl = currentDraftFile?.srtUrl ?? null;
  const sourceVtt = showSourceCaptions && captionDraft
    ? sourcePreviewVtt(captionDraft.cues, duration, captionOffsetMs)
    : null;
  useEffect(() => {
    if (!sourceVtt) {
      setSourceCaptionTrack(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([sourceVtt], { type: "text/vtt; charset=utf-8" }));
    setSourceCaptionTrack({ vtt: sourceVtt, url });
    return () => URL.revokeObjectURL(url);
  }, [sourceVtt]);
  const sourceCaptionUrl = sourceCaptionTrack?.vtt === sourceVtt ? sourceCaptionTrack.url : null;
  useEffect(() => {
    setSourceTrackProblem("");
    if (!sourceCaptionUrl) return;
    const element = sourceCaptions.current;
    const track = element?.track;
    const tracks = sourceVideo.current?.textTracks;
    if (!track || !tracks) {
      setSourceTrackProblem("This browser cannot preview captions on the original video. You can still download the caption files with your clip.");
      return;
    }
    const failed = () => setSourceTrackProblem("Couldn’t load the caption preview. Turn it off and back on to retry.");
    const sync = () => { if (track.mode !== "showing") setShowSourceCaptions(false); };
    element.addEventListener("error", failed);
    track.mode = "showing";
    tracks.addEventListener("change", sync);
    return () => {
      element.removeEventListener("error", failed);
      tracks.removeEventListener("change", sync);
    };
  }, [sourceCaptionUrl]);
  const sourcePreviewNote = !showSourceCaptions ? ""
    : captionOffsetMs === null ? "Enter a valid timing offset to preview captions."
    : !sourceVtt ? "No caption cues fit the original video at this offset."
    : sourceTrackProblem;
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
  async function choose(next: File | undefined, fromHandoff: "published" | "studio" | null = null) {
    if (busy || importing || receiptLoading) return;
    if (!next) return;
    // A source change supersedes any caption read still in flight, even if this
    // replacement is refused. The current track, typed text and any finished
    // MP4 stay until a replacement actually succeeds.
    captionRequest.current++;
    setCaptionLoading(false);
    if (!fromHandoff && sourceRequest.current) {
      sourceRequest.current.abort();
      sourceRequest.current = null;
      setSourceLoading(false);
    }
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
      setLoadedHandoff(fromHandoff);
      captionRequest.current++; receiptRequest.current++;
      setCaptionDraft(null); setCaptionUndo(null); setCaptionOffsetRaw("0"); setCaptionText(""); setCaptionMessage(""); setCaptionLoading(false);
      setManualCueText(""); setManualCueStart(""); setManualCueEnd(""); setManualCueMessage("");
      setShowSourceCaptions(false);
      setCropAnchor("center");
      setReceiptMessage(""); setReceiptLoading(false);
      setResult(""); setCompletedClip(null); setCaptionTrack(null); setApplied(null); setChecking(false);
      setMessage("Choose your clip and frame, then make an MP4.");
    } catch (error) {
      URL.revokeObjectURL(url);
      if (revision === current.current) refuse(error instanceof Error ? error.message : "Could not open the video.", retained);
    }
    finally { video.removeAttribute("src"); video.load(); }
  }
  async function loadHandoffVideo(): Promise<void> {
    if (!sourceHandoff || sourceLoading || sourceRequest.current || busy || importing || checking || file) return;
    const controller = new AbortController();
    sourceRequest.current = controller;
    setSourceLoading(true);
    const studio = sourceHandoff.kind === "studio";
    setMessage(studio ? "Reading the saved Studio video…" : "Downloading the published video from this Media Studio…");
    const timeout = AbortSignal.timeout(PUBLIC_VIDEO_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    try {
      const read = sourceHandoff.kind === "studio"
        ? await fetchSavedStudioVideo(sourceHandoff.source, signal)
        : await fetchPublicVideo(sourceHandoff.source, signal);
      if (controller.signal.aborted) return;
      if (timeout.aborted) throw timeout.reason;
      if ("reason" in read) { setMessage(read.reason); return; }
      await choose(read.file, sourceHandoff.kind);
    } catch {
      if (!controller.signal.aborted) {
        setMessage(timeout.aborted
          ? `The download took too long. Choose ${studio ? "Load saved Studio video" : "Load published video"} to try again.`
          : studio ? "Could not read the saved Studio video. Reopen it in Studio or choose a local file."
          : "Could not download this published video. Try again or use the video picker.");
      }
    } finally {
      if (sourceRequest.current === controller && !controller.signal.aborted) {
        sourceRequest.current = null;
        setSourceLoading(false);
      }
    }
  }
  async function chooseCaptions(selected: File | undefined) {
    if (!selected || !file || busy || checking || receiptLoading) return;
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setCaptionMessage("Reading captions on this device…");
    try {
      if (!selected.size || selected.size > MAX_CAPTION_BYTES)
        throw new Error("Choose an SRT or WebVTT file up to 64 KB.");
      // One bounded read serves both the digest and the UTF-8 decode: the
      // digest ties any later offset restore to these exact original bytes.
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const sourceSha256 = await sha256Hex(bytes);
      const cues = parseCaptionFile(new TextDecoder().decode(bytes), 0, MAX_SOURCE_SECONDS * 1000);
      if (request !== captionRequest.current) return;
      setCaptionDraft({ name: selected.name, sourceSha256, cues, local: false });
      setCaptionUndo(null);
      setCaptionOffsetRaw("0");
      setManualCueMessage("");
      setCaptionMessage(`Loaded ${cues.length} ${cues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCaptionMessage(error instanceof Error ? error.message : "Could not read captions on this device.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // The paste box is an alternate local source for the same chooser. A File is
  // built from exactly the entered UTF-8 bytes only after an explicit Apply, so
  // the existing bound, digest, parser, preflight, preview and draft download
  // all stay identical. Refused text leaves the loaded track and finished MP4.
  async function applyCaptionText() {
    if (!file || busy || checking || importing || receiptLoading || captionLoading) return;
    const prepared = captionFileFromText(captionText);
    if ("problem" in prepared) { setCaptionMessage(prepared.problem); return; }
    await chooseCaptions(prepared.file);
  }
  // One plain-text cue at original-video seconds. Validation and overlap checks
  // run before any state change, then the accepted cue joins the current draft
  // in time order. The digest covers the actual edited track so a receipt never
  // claims the imported file's bytes were changed.
  async function addManualCue() {
    if (!file || busy || checking || importing || receiptLoading || captionLoading) return;
    const added = appendManualClipCue(captionDraft?.cues ?? [], {
      text: manualCueText, startSeconds: manualCueStart, endSeconds: manualCueEnd,
    }, Math.round(duration * 1000));
    if ("problem" in added) { setManualCueMessage(added.problem); return; }
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setManualCueMessage("Adding the cue to this draft…");
    try {
      const updated = await editedCaptionDraft(captionDraft, added.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionUndo(null);
      setManualCueText("");
      setManualCueStart("");
      setManualCueEnd("");
      setManualCueMessage(`Added one cue. This draft now has ${added.cues.length} ${added.cues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setManualCueMessage(error instanceof Error ? error.message : "Could not add the cue in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Removal follows the same edited-track path as adding: remove the exact
  // draft cue named by the projection, rebuild the canonical full-source VTT,
  // then record the edited name and digest. An offset, trim, native preview and
  // draft sidecar all read the resulting draft, so they update together. The
  // last cue removes the draft and track but keeps the snapshot for Undo.
  async function removeTrimmedCue(sourceIndex: number) {
    if (!captionDraft || busy || checking || importing || receiptLoading || captionLoading) return;
    const previousDraft = captionDraft;
    const nextCues = removeClipDraftCue(previousDraft.cues, sourceIndex);
    if (!nextCues) return;
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setCaptionMessage("Removing the cue from this draft…");
    try {
      if (!nextCues.length) {
        if (request !== captionRequest.current) return;
        setCaptionDraft(null);
        setCaptionUndo(previousDraft);
        setCaptionMessage("Removed the last cue. The caption track is removed; Undo is available below.");
        return;
      }
      const updated = await editedCaptionDraft(previousDraft, nextCues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionUndo(previousDraft);
      setCaptionMessage(`Removed one cue. This draft now has ${nextCues.length} ${nextCues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCaptionMessage(error instanceof Error ? error.message : "Could not remove the cue in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Restore the exact draft, name and digest saved before that removal. Any
  // later add, replacement, clear or source change already dropped the snapshot.
  function undoCaptionRemoval() {
    if (!captionUndo || busy || checking || importing || receiptLoading || captionLoading) return;
    captionRequest.current++;
    setCaptionDraft(captionUndo);
    setCaptionUndo(null);
    setCaptionLoading(false);
    setCaptionMessage("Restored the removed cue and caption track.");
  }
  // Pause on the projected source time and keep keyboard focus on the cue.
  function jumpToOriginalCue(sourceStartMs: number) {
    const video = sourceVideo.current;
    if (!video) return;
    video.pause();
    video.currentTime = Math.min(sourceStartMs / 1000, duration);
  }
  // Copy the original video's current playhead into one cue field only. The
  // native player is read but never paused, seeked or restarted, and no other
  // state (draft, trim, offset, preview, result) is touched.
  function fillCueTimeFromPlayhead(field: "start" | "end") {
    const video = sourceVideo.current;
    if (!video || !file || !Number.isFinite(video.currentTime)) return;
    const ms = Math.min(Math.max(Math.round(video.currentTime * 1000), 0), Math.round(duration * 1000));
    const seconds = (ms / 1000).toFixed(3);
    if (field === "start") setManualCueStart(seconds);
    else setManualCueEnd(seconds);
  }

  // Opening a receipt is an explicit, local-only action. It proves the saved
  // digest against the exact bytes already accepted as the source, then writes
  // only the editable controls. Results and captions stay until a replacement.
  async function openReceipt(selected: File | undefined) {
    if (!selected || !file || busy || importing || checking || captionLoading || receiptLoading) return;
    const selectedSource = file;
    const request = ++receiptRequest.current;
    const stale = () => request !== receiptRequest.current;
    setReceiptLoading(true);
    setReceiptMessage("Checking this receipt against the current video…");
    try {
      if (!selected.size || selected.size > MAX_RECEIPT_BYTES)
        throw new Error(`Choose a Clip receipt JSON file under ${MAX_RECEIPT_BYTES / 1024} KB.`);
      const text = await selected.text();
      if (stale()) return;
      const sourceSha256 = await sha256Hex(new Uint8Array(await selectedSource.arrayBuffer()));
      if (stale()) return;
      const restored = parseClipReceipt(text, {
        duration, maxSeconds: MAX_CLIP_SECONDS, sourceBytes: selectedSource.size, sourceSha256,
      });
      if (stale()) return;
      setStart(restored.edit.startSeconds);
      setEnd(restored.edit.endSeconds);
      setShape(restored.edit.frame);
      setQuality(restored.edit.quality);
      setFit(restored.edit.fit);
      setCropAnchor(restored.edit.cropAnchor ?? "center");
      setMute(restored.edit.muteRequested);
      // A saved offset only moves the controls when the same original caption
      // file is already selected. A zero offset is restored just like any
      // other signed value; a mismatch leaves every caption control as it is.
      if (restored.captions && captionDraft?.sourceSha256 === restored.captions.sourceSha256) {
        setCaptionOffsetRaw(String(restored.captions.offsetMs / 1000));
        setReceiptMessage("Trim, frame and caption timing restored. Make MP4 when ready.");
      } else {
        setReceiptMessage(restored.captions
          ? "Trim and frame settings restored. To restore caption timing, choose the original caption file and reopen this receipt."
          : "Trim and frame settings restored. Make MP4 when ready.");
      }
    } catch (error) {
      if (!stale()) setReceiptMessage(error instanceof Error ? error.message : "Could not read that receipt.");
    } finally {
      if (!stale()) setReceiptLoading(false);
    }
  }

  async function makeClip() {
    if (!file || busy || checking || captionLoading || receiptLoading || captionOffsetMs === null) return;
    if (!validTrim) { setMessage("Choose a valid start and end within the video, up to 60 seconds apart."); return; }
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
      let crop: CropRectangle | null = null;
      if (fit === "cover" && cropAnchor !== "center") {
        const [displayWidth, displayHeight] = await Promise.all([video.getDisplayWidth(), video.getDisplayHeight()]);
        crop = clipCropRectangle({ width: displayWidth, height: displayHeight }, { width, height }, cropAnchor);
        if (!crop) throw new Error("Choose Center for this video. Its display dimensions could not be read.");
      }
      const target = new BufferTarget(); const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
      const conversion = await Conversion.init({ input, output, tracks: "primary", trim: {start,end}, tags: {}, showWarnings: false,
        video: { width, height, fit, ...(crop ? { crop } : {}), codec: "avc", bitrate: quality === "hd" ? 4000000 : 1200000, forceTranscode: true },
        audio: mute ? { discard: true } : { codec: "aac", bitrate: 128000, forceTranscode: true } });
      active.current = conversion;
      if (cancelRequested.current) { await conversion.cancel(); throw new DOMException("Export cancelled. Your original is unchanged.", "AbortError"); }
      if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || (!mute && audio && !conversion.utilizedTracks.includes(audio))) {
        throw new Error("This browser cannot make this H.264/AAC MP4 with the selected audio. Try standard quality, a current supported browser or choose Mute.");
      }
      conversion.onProgress = p => setMessage(`Making MP4 on this device: ${Math.round(p*100)}%`);
      await conversion.execute();
      if (!target.buffer || !target.buffer.byteLength || target.buffer.byteLength > 64 * 1024 * 1024) throw new Error("The result is empty or exceeds the 64 MB output limit.");
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const captions = captionDraft ? {
        name: captionDraft.name,
        sourceSha256: captionDraft.sourceSha256,
        vtt: serializeClipCaptions(captionDraft.cues, start, end, captionOffsetMs),
        ...(captionOffsetMs ? { offsetMs: captionOffsetMs } : {}),
        ...(captionDraft.local ? { local: true as const } : {}),
      } : undefined;
      setCompletedClip({
        source: file,
        watchUrl: loadedHandoff === "published" && publicVideo ? new URL(publicVideo.page, window.location.origin).href : null,
        edit: { startSeconds: start, endSeconds: end, frame: shape, quality, fit, muteRequested: mute,
          ...(fit === "cover" && cropAnchor !== "center" ? { cropAnchor } : {}) },
        output: { blob, width, height },
        captions,
      });
      setCaptionTrack(captions?.vtt ? {
        url: URL.createObjectURL(new Blob([captions.vtt], { type: "text/vtt; charset=utf-8" })),
        english: false,
        ...(captions.local ? { local: true as const } : {}),
      } : null);
      setResult(URL.createObjectURL(blob));
      setApplied({ settings: draft, captions: captionDraft, captionOffsetMs });
      // Imported captions whose cues all sit outside the trim produce a null VTT.
      // Keep the usual success wording unless the creator supplied captions that
      // this clip could not include, then point them at the offset/trim controls.
      setMessage(captionDraft && !captions?.vtt
        ? "Your MP4 is ready to play and save. No caption cues fall inside this clip. Change the caption offset or trim and make the MP4 again to include cues."
        : "Your MP4 is ready to play and save.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Could not make the video on this device.";
      if (error instanceof Error && (error.name === "ConversionCanceledError" || error.name === "AbortError")) {
        setMessage("Export cancelled. Your original is unchanged.");
      } else if (reason === "Color/alpha merge worker error.") {
        setMessage("Video Clip could not process this video’s transparent layer. Try a non-transparent MP4 or WebM.");
      } else {
        setMessage(reason);
      }
    } finally { active.current = null; input.dispose(); setBusy(false); }
  }
  // Explicit, local-only action: hand the exact completed clip to a same-origin
  // Add Music tab through one bounded postMessage, so it becomes the video
  // source before any soundtrack is chosen. Every failure keeps Save MP4 and
  // the normal file chooser available.
  function openInAddMusic() {
    if (!completedClip || handoffBusy || busy || importing || checking || receiptLoading) return;
    const blob = completedClip.output.blob;
    const filename = `${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip.mp4`;
    const fallbackText = "Save MP4 below, then choose that file in Add Music.";
    const fallback = (text: string) => setMessage(`${text} ${fallbackText}`);
    if (!localMixBlobFits(blob)) { fallback("The finished clip is not available for a direct handoff."); return; }
    setHandoffBusy(true);
    const token = newLocalMixToken();
    const url = localMixToolUrl("addMusic", token);
    if (!url) { setHandoffBusy(false); fallback("Could not start the handoff."); return; }
    // Deliberate click: open the target synchronously, before waiting for ready.
    const popup = window.open(url, "_blank");
    const statusMessage = (status: LocalMixHandoffStatus) => status === "sent"
      ? "Sent the finished clip to Add Music."
      : status === "stale"
        ? `The finished clip changed before the handoff completed. ${fallbackText}`
        : status === "failed"
          ? `Could not send the MP4 to Add Music. ${fallbackText}`
          : `Add Music did not respond. ${fallbackText}`;
    const record = openLocalMixHandoff({
      popup, token, origin: window.location.origin,
      file: new File([blob], filename, { type: VIDEO_MP4 }),
      isCurrent: () => completedClipRef.current?.output.blob === blob,
      onStatus: (status) => setMessage(statusMessage(status)),
      onDone: () => { handoff.current = null; setHandoffBusy(false); },
    });
    if (!record) { setHandoffBusy(false); fallback("The Add Music popup was blocked."); return; }
    handoff.current = record;
    setMessage("Waiting for Add Music to open…");
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
    objectPosition: cropObjectPosition(cropAnchor, fit),
    background: "#000",
  };
  const clipFilename = `${file?.name.replace(/\.[^.]+$/, "") || "video"}-clip`;
  return <main className="trim-page" id="main"><header><a href="/">← Media Studio</a><h1>Clip and frame a video</h1><p>Choose a short video, set its in and out points and save a new MP4. Editing happens on this device without sign-in or generation. You can choose to upload the finished MP4 to Studio afterwards.</p></header>
    <section className="trim-work" aria-labelledby="video-source"><h2 id="video-source">Your video</h2>
      <div className="video-tool-actions">
        <label className="trim-file">Choose video<input ref={chooser} type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy || importing || receiptLoading} onChange={e => void choose(e.target.files?.[0])}/></label>
        {sourceHandoff && (!file || loadedHandoff === sourceHandoff.kind) && (
          <button
            type="button"
            className="secondary"
            disabled={busy || importing || receiptLoading}
            aria-disabled={sourceLoading || loadedHandoff === sourceHandoff.kind || checking}
            onClick={() => void loadHandoffVideo()}
          >
            {sourceHandoff.kind === "studio"
              ? loadedHandoff ? "Saved Studio video loaded" : sourceLoading ? "Loading saved Studio video…" : "Load saved Studio video"
              : loadedHandoff ? "Published video loaded" : sourceLoading ? "Loading published video…" : "Load published video"}
          </button>
        )}
      </div>
      {publicVideo && <p className="trim-note"><a href={publicVideo.page}>Published page</a> · The video is downloaded from this Media Studio only when you choose Load published video. It stays on this device.</p>}
      {sourceHandoff?.kind === "studio" && <p className="trim-note">Load the saved video using your Studio project access. The edit stays on this device. <a href="/studio">Open Studio</a></p>}
      <p className="trim-note">MP4 or WebM up to 128 MB and 3 minutes; browser support varies. Export up to 60 seconds.</p>
      <ClipPosterVerifyPanel />
      {file && <><p><strong>{file.name}</strong> · {duration.toFixed(2)} seconds</p>
      <p className="trim-note">Reopen a Clip receipt to load the saved edit settings for this video.</p>
      <div className="video-tool-actions">
        <label className="trim-file">Open clip receipt (JSON)<input type="file" accept="application/json,.json" disabled={busy || importing || checking || captionLoading || receiptLoading} onChange={event => {
          const input = event.currentTarget;
          void openReceipt(input.files?.[0]);
          input.value = "";
        }}/></label>
      </div>
      <p role="status" className="trim-note">{receiptMessage}</p>
      <label className="video-tool-check"><input type="checkbox" checked={previewFraming} onChange={e => setPreviewFraming(e.target.checked)}/> Preview output framing</label>
      <video ref={sourceVideo} className="video-tool-player" src={source} controls playsInline style={previewFraming ? previewStyle : undefined} aria-label={previewFraming ? "Original video, framing preview" : "Original video"}>
        {sourceCaptionUrl && <track ref={sourceCaptions} kind="captions" label="Draft captions · original video" src={sourceCaptionUrl}/>}
      </video>
      <div className="trim-fields"><label>Start (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing || receiptLoading} value={Number.isNaN(start) ? "" : start} onChange={e => {setStart(e.target.value === "" ? NaN : Number(e.target.value));}}/></label><label>End (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing || receiptLoading} value={Number.isNaN(end) ? "" : end} onChange={e => {setEnd(e.target.value === "" ? NaN : Number(e.target.value));}}/></label>
      <label>Frame<select value={shape} disabled={busy || importing || receiptLoading} onChange={e => {setShape(e.target.value as Shape);}}><option value="portrait">9:16 · portrait</option><option value="landscape">16:9 · landscape</option><option value="square">1:1 · square</option></select></label><label>Quality<select value={quality} disabled={busy || importing || receiptLoading} onChange={e => {setQuality(e.target.value as Quality);}}><option value="standard">Standard</option><option value="hd">HD · 720p</option></select></label><label>Fit<select value={fit} disabled={busy || importing || receiptLoading} onChange={e => {setFit(e.target.value as Fit);}}><option value="contain">Fit entire picture (bars)</option><option value="cover">Fill frame (crop)</option></select></label>
      {fit === "cover" && <label>Crop position<select value={cropAnchor} disabled={busy || importing || receiptLoading} onChange={e => {setCropAnchor(e.target.value as CropAnchor);}}><option value="center">Center</option><option value="topLeft">Top left</option><option value="bottomRight">Bottom right</option></select></label>}</div>
      <details>
        <summary>Use your own captions</summary>
        <p className="trim-note">Choose a plain SRT or WebVTT file, paste the text below, or add one plain-text cue. Cue times are relative to the original video. Preview them on the original video or the finished clip, or save the draft trim captions without making the MP4.</p>
        <label className="trim-file">Choose captions<input type="file" accept=".srt,.vtt,text/vtt" disabled={busy || checking || importing || receiptLoading} onChange={event => {
          const input = event.currentTarget;
          void chooseCaptions(input.files?.[0]);
          input.value = "";
        }}/></label>
        <p id="caption-paste-help" className="trim-note">Plain SRT or WebVTT up to 64 KB. Caption text stays in this tab.</p>
        <label className="trim-file">Paste captions<textarea rows={6} spellCheck={false}
          aria-describedby="caption-paste-help"
          placeholder={"WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nYour first caption"}
          value={captionText}
          disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
          onChange={event => setCaptionText(event.currentTarget.value)}
        /></label>
        <button type="button" className="secondary" disabled={!file || !captionText.trim() || busy || checking || importing || receiptLoading || captionLoading} onClick={() => void applyCaptionText()}>Apply captions</button>
        <details>
          <summary>Write a cue</summary>
          <p id="manual-cue-help" className="trim-note">Use seconds from the start of the original video, with up to three decimal places. The timing offset applies to every cue.</p>
          <label>Caption text<input type="text" spellCheck={false} maxLength={300}
            aria-describedby="manual-cue-help"
            value={manualCueText}
            disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
            onChange={event => setManualCueText(event.currentTarget.value)}
          /></label>
          <div className="trim-fields">
            <div>
              <label>Cue start (seconds)<input type="number" min="0" max={duration} step="0.001"
                value={manualCueStart}
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
                onChange={event => setManualCueStart(event.currentTarget.value)}
              /></label>
              <button type="button" className="secondary"
                aria-label="Fill Cue start from the original video playhead"
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
                onClick={() => fillCueTimeFromPlayhead("start")}>Use playhead</button>
            </div>
            <div>
              <label>Cue end (seconds)<input type="number" min="0" max={duration} step="0.001"
                value={manualCueEnd}
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
                onChange={event => setManualCueEnd(event.currentTarget.value)}
              /></label>
              <button type="button" className="secondary"
                aria-label="Fill Cue end from the original video playhead"
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading}
                onClick={() => fillCueTimeFromPlayhead("end")}>Use playhead</button>
            </div>
          </div>
          <button type="button" className="secondary" disabled={!file || !manualCueText.trim() || !manualCueStart.trim() || !manualCueEnd.trim() || busy || checking || importing || receiptLoading || captionLoading} onClick={() => void addManualCue()}>Add cue</button>
          {manualCueMessage && <p role="status" aria-live="polite" className="trim-note">{manualCueMessage}</p>}
        </details>
        {captionDraft && <p><strong>{captionDraft.name}</strong> <button type="button" className="secondary" disabled={busy || checking || importing || receiptLoading} onClick={() => {
          captionRequest.current++;
          setCaptionDraft(null);
          setCaptionUndo(null);
          setCaptionOffsetRaw("0");
          setCaptionText("");
          setManualCueText("");
          setManualCueStart("");
          setManualCueEnd("");
          setManualCueMessage("");
          setCaptionLoading(false);
          setShowSourceCaptions(false);
          setCaptionMessage("Captions cleared.");
        }}>Clear captions</button></p>}
        {captionDraft && <div>
          <div className="trim-fields">
            <label>Timing offset (seconds)
              <input type="number" min={-MAX_CAPTION_OFFSET_SECONDS} max={MAX_CAPTION_OFFSET_SECONDS} step="0.001"
                value={captionOffsetRaw} disabled={busy || checking || importing || receiptLoading}
                aria-invalid={captionOffsetMs === null}
                aria-describedby={captionOffsetMs === null ? "caption-offset-help caption-offset-error" : "caption-offset-help"}
                onChange={event => setCaptionOffsetRaw(event.target.value)}
              />
            </label>
          </div>
          <p id="caption-offset-help" className="trim-note">Positive moves captions later. Negative moves them earlier.</p>
          {captionOffsetMs === null && <p id="caption-offset-error" role="alert" className="trim-note">Enter a value from −{MAX_CAPTION_OFFSET_SECONDS} to {MAX_CAPTION_OFFSET_SECONDS} seconds with up to three decimal places.</p>}
          {survivingCaptionCount !== null && (
            <p className="trim-note">
              {survivingCaptionCount === 0
                ? "No caption cues will fit this trim. Adjust the timing offset or trim to include them."
                : `${survivingCaptionCount} caption ${survivingCaptionCount === 1 ? "cue" : "cues"} inside this trim.`}
            </p>
          )}
          {trimmedCaptionCues && trimmedCaptionCues.length > 0 && (
            <details className="trim-cue-review">
              <summary>Review cues in this trim ({trimmedCaptionCues.length})</summary>
              <p className="trim-note">Times are relative to the trim start. Choose a cue to pause the original video at that source position. Turn on Preview draft captions on original video to see the original caption there.</p>
              <ol className="trim-cue-list" aria-label="Caption cues in this trim">
                {trimmedCaptionCues.map(cue => (
                  <li key={cue.sourceStartMs} className="trim-cue-row">
                    <button type="button" className="secondary trim-cue-jump"
                      aria-label={`Jump to cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cue.text}`}
                      disabled={busy || checking || importing || receiptLoading || captionLoading}
                      onClick={() => jumpToOriginalCue(cue.sourceStartMs)}>
                      <span className="trim-cue-time">{clipTimeStamp(cue.from)}–{clipTimeStamp(cue.to)}</span>
                      <span className="trim-cue-text">{cue.text}</span>
                    </button>
                    <button type="button" className="secondary trim-cue-remove"
                      aria-label={`Remove cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cue.text}`}
                      disabled={busy || checking || importing || receiptLoading || captionLoading}
                      onClick={() => void removeTrimmedCue(cue.sourceIndex)}>Remove</button>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {draftCaptionUrl && <div>
            <p><a className="button secondary" href={draftCaptionUrl} download={`${clipFilename}-draft-captions.vtt`} aria-describedby="draft-captions-note">Save draft trim captions (VTT)</a></p>
            {draftSrtUrl && <p><a className="button secondary" href={draftSrtUrl} download={`${clipFilename}-draft-captions.srt`} aria-describedby="draft-captions-note">Save draft trim captions (SRT)</a></p>}
            <p id="draft-captions-note" className="trim-note">These files use the current trim and timing offset. Finished clips keep their original caption files.</p>
          </div>}
          <label className="video-tool-check">
            <input type="checkbox" checked={showSourceCaptions} disabled={busy || checking || importing || receiptLoading} onChange={event => setShowSourceCaptions(event.currentTarget.checked)}/>
            Preview draft captions on original video
          </label>
          <p className="trim-note">The preview uses the full video and the timing offset above. The cue count applies to the trimmed MP4.</p>
          {sourcePreviewNote && <p className="trim-note" role="status">{sourcePreviewNote}</p>}
        </div>}
        {captionUndo && <p>
          <button ref={captionUndoButton} type="button" className="secondary" disabled={busy || checking || importing || receiptLoading || captionLoading} onClick={undoCaptionRemoval}>Undo last cue removal</button>
        </p>}
        <p role="status" aria-live="polite">{captionMessage}</p>
      </details>
      <label className="video-tool-check"><input type="checkbox" checked={mute} disabled={busy || importing || receiptLoading} onChange={e => {setMute(e.target.checked);}}/> Mute original audio</label><p className="trim-note">H.264/AAC MP4 · {sizes[quality][shape][0]} × {sizes[quality][shape][1]} · {quality === "hd" ? "4 Mbps" : "1.2 Mbps"} video. HD uses more memory and may not work in every browser; try Standard if it cannot export.</p>
      {!busy ? <button type="button" disabled={importing || checking || captionLoading || receiptLoading || (captionOffsetMs === null)} aria-describedby={captionOffsetMs === null ? "caption-offset-error" : undefined} onClick={() => void makeClip()}>Make MP4</button> : <button type="button" className="secondary" onClick={() => { cancelRequested.current = true; setMessage("Cancelling export…"); void active.current?.cancel(); }}>Cancel export</button>}</>}
      <p role="status" aria-live="polite">{message}</p>{result && <div className="trim-result" aria-busy={checking}><h2>{previous ? "Previous export" : "Your clip"}</h2>{previous && <p className="trim-note">Your settings changed after this MP4 was made. Make MP4 updates it; until then this is your last successful export.</p>}<ClipPoster key={`poster:${result}`} src={result} filename={clipFilename} captionTrack={captionTrack} output={completedClip?.output ?? null}/>
        <a className="button" href={result} download={`${clipFilename}.mp4`}>Save MP4</a>
        <button type="button" className="button secondary" disabled={!completedClip || handoffBusy || busy || importing || checking || receiptLoading} aria-disabled={handoffBusy || undefined} onClick={() => void openInAddMusic()}>{handoffBusy ? "Opening Add Music…" : "Open finished clip in Add Music"}</button>
        {completedClip && <>
          <ClipReceiptDownload key={`receipt:${result}`} clip={completedClip} filename={clipFilename} onCaptionReady={setCaptionTrack}/>
          <div inert={checking || busy || undefined}>
            <LocalImport key={`import:${result}`} blob={completedClip.output.blob} filename={`${clipFilename}.mp4`} operation="clip and frame" onBusyChange={setImporting}/>
          </div>
        </>}</div>}
    </section></main>;
}
export function mountVideoClip(container: HTMLElement) { createRoot(container).render(<VideoClip />); }
