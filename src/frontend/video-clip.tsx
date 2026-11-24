import { parseCaptionFile, type ImportedCue } from "./caption-import";
import { MAX_SPEAKER_CHARS, removeSpeakerNameCues, renameSpeakerCues } from "./caption-speaker.ts";
import { captionFileFromText } from "./caption-paste";
import { MAX_CAPTION_BYTES, MAX_CAPTION_OFFSET_SECONDS, captionTranscript, clipCaptionCues, clipCaptionSrtVariants, clipTimeStamp, serializeClipCaptions, sourceCaptionCues, sourcePreviewVtt, type CaptionPreviewPlacement, type ClipCaptionTrack } from "./clip-captions";
import { ALL_CUE_SPEAKERS, MAX_CUE_SEARCH_CHARS, UNNAMED_CUE_SPEAKER, cueMergeVisibility, cueSearchQuery, cueSpeakerFilterForDraft, cueSpeakerName, cueSpeakerOptionValue, cueSpeakerOptions, filterCuesByTextAndSpeaker } from "./clip-cue-search";
import { fullSourceCaptionDownload, fullSourceCaptionSrtVariants, fullSourceCaptionTranscript } from "./clip-full-source-captions";
import { MAX_CAPTION_DRAFT_BYTES, captionDraftFileText, parseCaptionDraftFile } from "./clip-caption-draft-file";
import { EMPTY_CUE_HISTORY, cueEditHistory, redoLastCueChange, undoLastCueChange, type CueHistory } from "./clip-cue-history";
import { cueAuditionWindow } from "./clip-cue-audition";
import { appendManualClipCue, canSplitClipDraftCue, clipCueSplitFromPlayhead, clipCueSplitParts, defaultClipCueSplit, manualCaptionSourceName, manualCaptionTrackVtt, mergeClipDraftCues, nudgeManualCueTimes, removeClipDraftCue, replaceClipDraftCue, splitClipDraftCue } from "./clip-manual-cue";
import { ClipReceiptDownload, type CompletedClip } from "./clip-receipt";
import { MAX_RECEIPT_BYTES, parseClipReceipt } from "./clip-receipt-open";
import { clipCropRectangle, cropObjectPosition, type CropAnchor, type CropRectangle } from "./clip-crop";
import { ClipPoster } from "./clip-poster";
import { ClipPosterVerifyPanel } from "./clip-poster-verify-panel";
import { ClipWaveform } from "./clip-waveform";
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
import { useEffect, useMemo, useRef, useState } from "react";
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
type CueAudition = Readonly<{ video: HTMLVideoElement; sourceIndex: number; startMs: number; endMs: number }>;
// Display-only cue look for the original-video preview. It never reaches the
// VTT, track, downloads, receipt or export.
type CaptionPreviewContrast = "default" | "contrast";

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

// The review row's visible and accessible line. A supplied WebVTT voice
// annotation stays separate from the cue words; unnamed cues keep plain text.
function cueLine(cue: Readonly<{ speaker: string; text: string }>) {
  return cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
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
  // One-step Undo plus the matching Redo for the exact draft before/after the
  // most recent cue edit. A successful new edit, import, clear, reload or source
  // change discards the branch, so old cues can never be replayed over newer
  // work or a different source name and digest.
  const [captionHistory, setCaptionHistory] = useState<CueHistory<CaptionDraft>>(EMPTY_CUE_HISTORY);
  const captionUndo = captionHistory.undo;
  const captionRedo = captionHistory.redo;
  const captionUndoButton = useRef<HTMLButtonElement>(null);
  const captionRedoButton = useRef<HTMLButtonElement>(null);
  // When an edit removes the focused row (or Undo/Redo removes its own button),
  // focus falls to the body. Move it to the control that is now available.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    if (captionUndo) captionUndoButton.current?.focus();
    else if (captionRedo) captionRedoButton.current?.focus();
  }, [captionUndo, captionRedo]);
  const [captionOffsetRaw, setCaptionOffsetRaw] = useState("0");
  const [captionText, setCaptionText] = useState("");
  const [manualCueText, setManualCueText] = useState("");
  // Optional plain speaker label. Blank means unnamed, and the shared normaliser
  // in replace/add is the only place the value is bounded and trimmed.
  const [manualCueSpeaker, setManualCueSpeaker] = useState("");
  const [manualCueStart, setManualCueStart] = useState("");
  const [manualCueEnd, setManualCueEnd] = useState("");
  const [manualCueMessage, setManualCueMessage] = useState("");
  // Split is an optional part of the open edit. The midpoint time and nearest
  // word boundary are only editable starting points; the entered values are
  // not applied until the creator chooses Split cue.
  const [cueSplitAt, setCueSplitAt] = useState("");
  const [cueSplitWord, setCueSplitWord] = useState(1);
  // The exact draft the edit was opened against. Any import, removal, undo,
  // replacement or source change replaces that draft (or clears it), so a
  // stale edit can never overwrite newer cues with an old index.
  const [cueEditing, setCueEditing] = useState<{ sourceIndex: number; draft: CaptionDraft } | null>(null);
  // Display-only filters for the Review cues rows. They never feed an edit, the
  // offset, the preview track, the export or any download. A new caption source
  // clears them; an edit or removal keeps an exact speaker choice only while
  // that name remains in the current draft.
  const [cueSearchText, setCueSearchText] = useState("");
  const [cueSpeakerSelection, setCueSpeakerSelection] = useState(ALL_CUE_SPEAKERS);
  const [cueSpeakerRenameText, setCueSpeakerRenameText] = useState("");
  const [cueSpeakerRenameMessage, setCueSpeakerRenameMessage] = useState("");
  const cueSpeaker = cueSpeakerFilterForDraft(cueSpeakerSelection, captionDraft?.cues ?? []);
  useEffect(() => {
    if (cueSpeakerSelection !== cueSpeaker) setCueSpeakerSelection(cueSpeaker);
  }, [cueSpeaker, cueSpeakerSelection]);
  // Which list the caption reviewer shows. The default in-trim rows stay the
  // primary view; All source cues exists so a stored cue outside the trim (or
  // any cue when the trim or offset is invalid) can still be reviewed, edited
  // and removed without changing the trim, offset or export. It is display
  // state only and a new caption source starts back on the in-trim view.
  const [cueView, setCueView] = useState<"trim" | "source">("trim");
  const [cuePlayheadStatus, setCuePlayheadStatus] = useState("");
  const cueReview = useRef<HTMLDetailsElement>(null);
  const cueSearchInput = useRef<HTMLInputElement>(null);
  const cueSpeakerRenameInput = useRef<HTMLInputElement>(null);
  const cueSpeakerRemoveButton = useRef<HTMLButtonElement>(null);
  const cueSpeakerSelect = useRef<HTMLSelectElement>(null);
  const manualCueTextInput = useRef<HTMLInputElement>(null);
  const manualCueDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (cueEditing) manualCueTextInput.current?.focus();
  }, [cueEditing]);
  const [captionMessage, setCaptionMessage] = useState("");
  const [captionLoading, setCaptionLoading] = useState(false);
  // Caption draft JSON is a separate local-file action. It never participates
  // in trim, crop, export or the receipt, and a source change always drops its
  // in-flight read and any prepared download.
  const [captionFileLoading, setCaptionFileLoading] = useState(false);
  const [captionFileMessage, setCaptionFileMessage] = useState("");
  const [preparedCaptionFile, setPreparedCaptionFile] = useState<{
    file: File;
    draft: CaptionDraft;
    offsetMs: number;
    text: string;
    url: string;
  } | null>(null);
  const [showSourceCaptions, setShowSourceCaptions] = useState(false);
  // Display-only preview option. It changes cue settings on the native track
  // over the original video, never the draft, sidecars, receipt or export.
  const [sourceCaptionPlacement, setSourceCaptionPlacement] = useState<CaptionPreviewPlacement>("default");
  const [sourceCaptionContrast, setSourceCaptionContrast] = useState<CaptionPreviewContrast>("default");
  const [sourceCaptionTrack, setSourceCaptionTrack] = useState<{ vtt: string; url: string } | null>(null);
  const [sourceTrackProblem, setSourceTrackProblem] = useState("");
  // A cue audition is a short, explicitly started play of the existing source
  // video over exactly one reviewed cue's clipped window. The ref is the live
  // truth for native media events and frame ticks; state only paints the button
  // and status. No effect starts playback.
  const [cueAudition, setCueAudition] = useState<CueAudition | null>(null);
  const [cueAuditionStatus, setCueAuditionStatus] = useState("");
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const sourceCaptions = useRef<HTMLTrackElement>(null);
  const cueAuditionRef = useRef<CueAudition | null>(null);
  const cueAuditionRequest = useRef(0);
  const cueAuditionFrame = useRef(0);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const captionRequest = useRef(0);
  const captionFileRequest = useRef(0);
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
  useEffect(() => () => {
    if (preparedCaptionFile?.url) URL.revokeObjectURL(preparedCaptionFile.url);
  }, [preparedCaptionFile?.url]);
  // Drop a prepared JSON download as soon as the cues or offset it described
  // change, so no earlier link can survive into newer work.
  useEffect(() => { setPreparedCaptionFile(null); }, [captionDraft, captionOffsetRaw]);
  useEffect(() => { completedClipRef.current = completedClip; }, [completedClip]);
  useEffect(() => () => {
    current.current++; captionRequest.current++; captionFileRequest.current++; receiptRequest.current++;
    void active.current?.cancel();
    handoff.current?.close();
  }, []);
  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) stopCueAudition("Cue playback stopped when this tab was hidden.");
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      const active = cueAuditionRef.current;
      cueAuditionRef.current = null;
      cueAuditionRequest.current++;
      cancelAnimationFrame(cueAuditionFrame.current);
      active?.video.pause();
    };
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
  // A prepared JSON download stays offered only for the exact source file,
  // draft object and offset it was built from. Any cue, offset or source change
  // hides the stale link immediately.
  const currentPreparedCaptionFile = preparedCaptionFile
    && preparedCaptionFile.file === file
    && preparedCaptionFile.draft === captionDraft
    && preparedCaptionFile.offsetMs === captionOffsetMs
    ? preparedCaptionFile : null;
  const validTrim = Number.isFinite(start) && Number.isFinite(end)
    && start >= 0 && end <= duration && end > start && end - start <= MAX_CLIP_SECONDS;
  // The review list, preflight count and serialized VTT all read this one
  // projection, so a cue row can never disagree with the exported timing.
  const trimmedCaptionCues = captionDraft && validTrim && captionOffsetMs !== null
    ? clipCaptionCues(captionDraft.cues, start, end, captionOffsetMs)
    : null;
  const survivingCaptionCount = trimmedCaptionCues?.length ?? null;
  // Only these display rows depend on the text and speaker filters. The full
  // projection above stays the single source for counts, previews, MP4 captions
  // and both sidecars; filtering never changes a cue's identity or timing.
  const cueQuery = cueSearchQuery(cueSearchText);
  const visibleCues = trimmedCaptionCues
    ? filterCuesByTextAndSpeaker(trimmedCaptionCues, cueSearchText, cueSpeaker)
    : [];
  // Every stored cue at its unshifted original-video time, keyed by the same
  // source index the trimmed projection carries. Choices come from the FULL
  // draft, including names outside this trim, and the same combined filter
  // applies to whichever list is shown. These rows never feed the count, the
  // preview track, the offset, the receipt or either export.
  const allSourceCues = captionDraft ? sourceCaptionCues(captionDraft.cues) : [];
  const cueSpeakerChoices = cueSpeakerOptions(captionDraft?.cues ?? []);
  const visibleSourceCues = captionDraft
    ? filterCuesByTextAndSpeaker(allSourceCues, cueSearchText, cueSpeaker)
    : [];
  useEffect(() => {
    setCuePlayheadStatus("");
  }, [captionDraft, source, start, end, captionOffsetMs, cueView, cueSearchText, cueSpeaker]);
  const cueSpeakerFilterName = cueSpeakerName(cueSpeaker);
  const namedCueSpeaker = cueSpeakerFilterName ? cueSpeakerFilterName : null;
  const captionActionsBusy = busy || checking || importing || receiptLoading || captionLoading || captionFileLoading || sourceLoading || handoffBusy;
  const cueSpeakerRenameDisabled = namedCueSpeaker === null || cueEditing !== null || captionActionsBusy;
  const cueFilterDescription = [
    cueQuery ? `text “${cueQuery}”` : "",
    cueSpeakerFilterName !== null
      ? cueSpeakerFilterName === "" ? "the Unnamed speaker" : `speaker “${cueSpeakerFilterName}”`
      : "",
  ].filter(Boolean).join(" and ");
  const hasCueFilters = cueFilterDescription !== "";
  const reviewCueTotal = cueView === "trim" ? trimmedCaptionCues?.length ?? null : allSourceCues.length;
  const reviewVisibleCueCount = cueView === "trim" ? visibleCues.length : visibleSourceCues.length;
  const reviewCueNoun = reviewCueTotal === 1 ? "cue" : "cues";
  const reviewCueLabel = cueView === "trim" ? `${reviewCueNoun} in this trim` : `source ${reviewCueNoun}`;
  const reviewCueVerb = reviewVisibleCueCount === 1 ? "matches" : "match";
  const cueReviewStatus = reviewCueTotal === null
    ? "No in-trim cue list while the trim or timing offset is invalid."
    : reviewCueTotal === 0 && !hasCueFilters
      ? cueView === "trim"
        ? "No cues in this trim. Adjust the trim or timing offset, or review All source cues."
        : "No source cues in this draft."
      : !hasCueFilters
        ? `Showing all ${reviewCueTotal} ${reviewCueLabel}.`
        : reviewVisibleCueCount === 0
          ? `No ${reviewCueLabel} ${reviewCueVerb} ${cueFilterDescription}. Clear both to show all ${reviewCueTotal}.`
          : `${reviewVisibleCueCount} of ${reviewCueTotal} ${reviewCueLabel} ${reviewCueVerb} ${cueFilterDescription}.`;
  // A running audition belongs to one exact source, draft, trim and offset. If
  // any of those change it is no longer the same cue window, so stop and say so
  // rather than leave the old seconds playing over newer work.
  const cueAuditionKey = JSON.stringify([
    source,
    captionDraft?.sourceSha256 ?? null,
    captionDraft?.cues.length ?? 0,
    Number.isFinite(start) ? start : null,
    Number.isFinite(end) ? end : null,
    captionOffsetMs,
  ]);
  const cueAuditionKeyRef = useRef(cueAuditionKey);
  useEffect(() => {
    if (cueAuditionKeyRef.current === cueAuditionKey) return;
    cueAuditionKeyRef.current = cueAuditionKey;
    stopCueAudition("Cue audition stopped because the trim, captions or video changed.");
  }, [cueAuditionKey]);
  // Split reads the saved draft cue, not the unsaved edit fields, so its Undo
  // and digest describe exactly the cue the review row opened. The chosen
  // boundary is clamped for display if a different cue or text replaced it.
  const editingCue = cueEditing && captionDraft && cueEditing.draft === captionDraft
    ? captionDraft.cues[cueEditing.sourceIndex] ?? null
    : null;
  const editingCueWords = editingCue ? editingCue.text.trim().split(/\s+/u) : [];
  const cueSplitBoundary = Math.min(Math.max(cueSplitWord, 1), Math.max(1, editingCueWords.length - 1));
  const cueSplitPreview = editingCue ? clipCueSplitParts(editingCue.text, cueSplitBoundary) : null;
  const canSplitEditingCue = canSplitClipDraftCue(editingCue);
  const previous = applied !== null && (
    applied.settings !== draft || applied.captions !== captionDraft || applied.captionOffsetMs !== captionOffsetMs
  );

  // Draft sidecars: the same serializer the MP4 export uses, over the live trim,
  // offset and cue count, so no video has to be encoded. The SRT variants and
  // trim-relative TXT derive from that exact VTT. An invalid trim or offset, or
  // no surviving cue, yields no download.
  const draftCaptionVtt = captionDraft && validTrim && captionOffsetMs !== null
    && survivingCaptionCount !== null && survivingCaptionCount > 0
    ? serializeClipCaptions(captionDraft.cues, start, end, captionOffsetMs, "default", { voices: true })
    : null;
  const draftCaptionDurationMs = Math.round(end * 1000) - Math.round(start * 1000);
  const draftCaptionSrt = draftCaptionVtt
    ? clipCaptionSrtVariants(draftCaptionVtt, draftCaptionDurationMs)
    : null;
  const draftCaptionSrtText = draftCaptionSrt?.plain ?? null;
  const draftCaptionSpeakerSrtText = draftCaptionSrt?.speakerText ?? null;
  const draftCaptionTranscriptText = useMemo(
    () => captionTranscript(draftCaptionVtt, draftCaptionDurationMs),
    [draftCaptionVtt, draftCaptionDurationMs],
  );
  // This is the named state of this trim's canonical VTT, not the whole draft:
  // a trim that excludes every named cue still gets the unchanged plain SRT.
  const draftCaptionHasSpeakers = draftCaptionSrt?.named === true;
  const [draftCaptionFile, setDraftCaptionFile] = useState<{ vtt: string; vttUrl: string; srt: string | null; srtUrl: string | null; speakerSrt: string | null; speakerSrtUrl: string | null; transcript: string | null; transcriptUrl: string | null } | null>(null);
  useEffect(() => {
    if (!draftCaptionVtt) {
      setDraftCaptionFile(null);
      return;
    }
    const vttUrl = URL.createObjectURL(new Blob([draftCaptionVtt], { type: "text/vtt; charset=utf-8" }));
    const srtUrl = draftCaptionSrtText
      ? URL.createObjectURL(new Blob([draftCaptionSrtText], { type: "application/x-subrip; charset=utf-8" }))
      : null;
    const speakerSrtUrl = draftCaptionSpeakerSrtText
      ? URL.createObjectURL(new Blob([draftCaptionSpeakerSrtText], { type: "application/x-subrip; charset=utf-8" }))
      : null;
    const transcriptUrl = draftCaptionTranscriptText
      ? URL.createObjectURL(new Blob([draftCaptionTranscriptText], { type: "text/plain;charset=utf-8" }))
      : null;
    setDraftCaptionFile({ vtt: draftCaptionVtt, vttUrl, srt: draftCaptionSrtText, srtUrl, speakerSrt: draftCaptionSpeakerSrtText, speakerSrtUrl, transcript: draftCaptionTranscriptText, transcriptUrl });
    return () => {
      URL.revokeObjectURL(vttUrl);
      if (srtUrl) URL.revokeObjectURL(srtUrl);
      if (speakerSrtUrl) URL.revokeObjectURL(speakerSrtUrl);
      if (transcriptUrl) URL.revokeObjectURL(transcriptUrl);
    };
  }, [draftCaptionVtt, draftCaptionSrtText, draftCaptionSpeakerSrtText, draftCaptionTranscriptText]);
  // Each link stays live only while its URL belongs to the exact serialized
  // content on screen, so a changed trim or offset cannot download a stale file.
  const currentDraftFile = draftCaptionFile?.vtt === draftCaptionVtt
    && draftCaptionFile.srt === draftCaptionSrtText
    && draftCaptionFile.speakerSrt === draftCaptionSpeakerSrtText
    && draftCaptionFile.transcript === draftCaptionTranscriptText
    ? draftCaptionFile : null;
  const draftCaptionUrl = currentDraftFile?.vttUrl ?? null;
  const draftSrtUrl = currentDraftFile?.srtUrl ?? null;
  const draftSpeakerSrtUrl = currentDraftFile?.speakerSrtUrl ?? null;
  const draftCaptionTranscriptUrl = currentDraftFile?.transcriptUrl ?? null;
  // The full-source draft is the canonical VTT for every cue, with its original
  // times and text. It is independent of the trim and the timing offset, so a
  // creator can save and re-import it before encoding. The same content-match
  // guard and revoke-on-change lifecycle as the trim sidecar keeps a stale link
  // from downloading an older draft.
  const fullSourceCaption = useMemo(
    () => captionDraft ? fullSourceCaptionDownload(captionDraft.cues) : null,
    [captionDraft],
  );
  const fullSourceCaptionVtt = fullSourceCaption && "vtt" in fullSourceCaption ? fullSourceCaption.vtt : null;
  const fullSourceCaptionProblem = fullSourceCaption && "problem" in fullSourceCaption ? fullSourceCaption.problem : "";
  // The optional SRTs reuse the exact full-source VTT, so they carry every
  // original-time cue and no trim, offset or preview setting. One parse yields
  // the unchanged unnamed-only SRT and the speaker-name-as-text SRT. A real cue
  // edit replaces the draft, which recomputes both strings and retires all three
  // URLs in the same effect cleanup below.
  const fullSourceCaptionSrt = useMemo(
    () => fullSourceCaptionSrtVariants(fullSourceCaptionVtt),
    [fullSourceCaptionVtt],
  );
  const fullSourceCaptionSrtText = fullSourceCaptionSrt?.plain ?? null;
  const fullSourceCaptionSpeakerSrtText = fullSourceCaptionSrt?.speakerText ?? null;
  const fullSourceCaptionHasSpeakers = fullSourceCaptionSrt?.named === true;
  // TXT is another view of the exact same bounded full-source VTT. It never
  // reads the video source, trim, timing offset or display-only cue filters.
  const fullSourceCaptionTranscriptText = useMemo(
    () => fullSourceCaptionTranscript(fullSourceCaptionVtt),
    [fullSourceCaptionVtt],
  );
  const [fullSourceCaptionFile, setFullSourceCaptionFile] = useState<{ vtt: string; srt: string | null; url: string; srtUrl: string | null; speakerSrt: string | null; speakerSrtUrl: string | null; transcript: string | null; transcriptUrl: string | null } | null>(null);
  useEffect(() => {
    if (!fullSourceCaptionVtt) {
      setFullSourceCaptionFile(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([fullSourceCaptionVtt], { type: "text/vtt; charset=utf-8" }));
    const srtUrl = fullSourceCaptionSrtText
      ? URL.createObjectURL(new Blob([fullSourceCaptionSrtText], { type: "application/x-subrip; charset=utf-8" }))
      : null;
    const speakerSrtUrl = fullSourceCaptionSpeakerSrtText
      ? URL.createObjectURL(new Blob([fullSourceCaptionSpeakerSrtText], { type: "application/x-subrip; charset=utf-8" }))
      : null;
    const transcriptUrl = fullSourceCaptionTranscriptText
      ? URL.createObjectURL(new Blob([fullSourceCaptionTranscriptText], { type: "text/plain;charset=utf-8" }))
      : null;
    setFullSourceCaptionFile({ vtt: fullSourceCaptionVtt, srt: fullSourceCaptionSrtText, url, srtUrl, speakerSrt: fullSourceCaptionSpeakerSrtText, speakerSrtUrl, transcript: fullSourceCaptionTranscriptText, transcriptUrl });
    return () => {
      URL.revokeObjectURL(url);
      if (srtUrl) URL.revokeObjectURL(srtUrl);
      if (speakerSrtUrl) URL.revokeObjectURL(speakerSrtUrl);
      if (transcriptUrl) URL.revokeObjectURL(transcriptUrl);
    };
  }, [fullSourceCaptionVtt, fullSourceCaptionSrtText, fullSourceCaptionSpeakerSrtText, fullSourceCaptionTranscriptText]);
  const currentFullSourceCaptionFile = fullSourceCaptionFile?.vtt === fullSourceCaptionVtt
    && fullSourceCaptionFile.srt === fullSourceCaptionSrtText
    && fullSourceCaptionFile.speakerSrt === fullSourceCaptionSpeakerSrtText
    && fullSourceCaptionFile.transcript === fullSourceCaptionTranscriptText
    ? fullSourceCaptionFile : null;
  const fullSourceCaptionUrl = currentFullSourceCaptionFile?.url ?? null;
  const fullSourceCaptionSrtUrl = currentFullSourceCaptionFile?.srtUrl ?? null;
  const fullSourceCaptionSpeakerSrtUrl = currentFullSourceCaptionFile?.speakerSrtUrl ?? null;
  const fullSourceCaptionTranscriptUrl = currentFullSourceCaptionFile?.transcriptUrl ?? null;
  const [fullSourceTranscriptCopyStatus, setFullSourceTranscriptCopyStatus] = useState<{ file: typeof currentFullSourceCaptionFile; message: string } | null>(null);
  const fullSourceTranscriptCopyAttempt = useRef(0);
  async function copyFullSourceTranscript() {
    const prepared = currentFullSourceCaptionFile;
    if (!prepared || prepared.transcript === null) return;
    const attempt = ++fullSourceTranscriptCopyAttempt.current;
    setFullSourceTranscriptCopyStatus({ file: prepared, message: "Copying transcript…" });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prepared.transcript);
      if (attempt !== fullSourceTranscriptCopyAttempt.current) return;
      setFullSourceTranscriptCopyStatus({ file: prepared, message: "Transcript copied." });
    } catch {
      if (attempt !== fullSourceTranscriptCopyAttempt.current) return;
      setFullSourceTranscriptCopyStatus({ file: prepared, message: "Clipboard unavailable or denied. Use Save full-source transcript (TXT)." });
    }
  }
  const sourceVtt = showSourceCaptions && captionDraft
    ? sourcePreviewVtt(captionDraft.cues, duration, captionOffsetMs, sourceCaptionPlacement, { voices: true })
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
    // A track retired during a placement switch can emit a late change. Only a
    // still-mounted track may switch the preview off through native controls.
    const sync = () => { if (element.isConnected && track.mode !== "showing") setShowSourceCaptions(false); };
    element.addEventListener("error", failed);
    track.mode = "showing";
    tracks.addEventListener("change", sync);
    return () => {
      element.removeEventListener("error", failed);
      tracks.removeEventListener("change", sync);
      // Retire this native track and its loaded cues without reloading,
      // seeking or pausing the video. The blob URL/content guards above then
      // mount the replacement track for the new placement.
      if (track.mode !== "disabled") track.mode = "disabled";
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
    captionFileRequest.current++;
    setCaptionFileLoading(false);
    setCaptionFileMessage("");
    setPreparedCaptionFile(null);
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
      setCaptionDraft(null); setCaptionHistory(EMPTY_CUE_HISTORY); setCaptionOffsetRaw("0"); setCaptionText(""); setCaptionMessage(""); setCaptionLoading(false);
      setCueSearchText("");
      setCueSpeakerSelection(ALL_CUE_SPEAKERS);
      setCueView("trim");
      resetCueEditor(); setManualCueMessage("");
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
    if (!selected || !file || busy || checking || receiptLoading || captionFileLoading) return;
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
      const cues = parseCaptionFile(new TextDecoder().decode(bytes), 0, MAX_SOURCE_SECONDS * 1000, { voices: true });
      if (request !== captionRequest.current) return;
      setCaptionDraft({ name: selected.name, sourceSha256, cues, local: false });
      setCaptionHistory(EMPTY_CUE_HISTORY);
      setCaptionOffsetRaw("0");
      setCueSearchText("");
      setCueSpeakerSelection(ALL_CUE_SPEAKERS);
      setCueView("trim");
      resetCueEditor();
      setManualCueMessage("");
      setCaptionMessage(`Loaded ${cues.length} ${cues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCaptionMessage(error instanceof Error ? error.message : "Could not read captions on this device.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Save the editable caption draft as one small local JSON file. The video is
  // read only for its exact SHA-256 and byte length; the cues use the canonical
  // full-source formatter at their unshifted times. The download link is tied
  // to this exact file object, draft and offset, so a later edit hides it.
  async function prepareCaptionDraftFile() {
    if (!file || !captionDraft || captionOffsetMs === null || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const selectedSource = file;
    const draft = captionDraft;
    const offsetMs = captionOffsetMs;
    const request = ++captionFileRequest.current;
    setPreparedCaptionFile(null);
    setCaptionFileLoading(true);
    setCaptionFileMessage("Checking the video fingerprint and caption cues on this device…");
    try {
      const sourceSha256 = await sha256Hex(new Uint8Array(await selectedSource.arrayBuffer()));
      if (request !== captionFileRequest.current) return;
      const prepared = captionDraftFileText({ bytes: selectedSource.size, sha256: sourceSha256 }, draft.cues, offsetMs);
      if (request !== captionFileRequest.current) return;
      if ("problem" in prepared) { setCaptionFileMessage(prepared.problem); return; }
      const url = URL.createObjectURL(new Blob([prepared.text], { type: "application/json" }));
      setPreparedCaptionFile({ file: selectedSource, draft, offsetMs, text: prepared.text, url });
      setCaptionFileMessage("Caption draft ready to save. It keeps every cue at its original video time and the timing offset above.");
    } catch {
      if (request === captionFileRequest.current)
        setCaptionFileMessage("Could not prepare the caption draft on this device. Your caption cues and timing offset are unchanged.");
    } finally {
      if (request === captionFileRequest.current) setCaptionFileLoading(false);
    }
  }
  // Open a caption draft only after proving it belongs to the exact video file
  // already chosen here. A schema, version, size, field, fingerprint or WebVTT
  // failure leaves the working cues and offset exactly as they were. The trim,
  // framing, finished MP4 and receipt are never touched.
  async function openCaptionDraftFile(selected: File | undefined) {
    if (!selected || !file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const selectedSource = file;
    const request = ++captionFileRequest.current;
    setCaptionFileLoading(true);
    setCaptionFileMessage("Checking this caption draft against the current video…");
    try {
      if (!selected.size || selected.size > MAX_CAPTION_DRAFT_BYTES)
        throw new Error(`Choose a Video Clip caption draft JSON file under ${MAX_CAPTION_DRAFT_BYTES / 1024} KB.`);
      const text = await selected.text();
      if (request !== captionFileRequest.current) return;
      const sourceSha256 = await sha256Hex(new Uint8Array(await selectedSource.arrayBuffer()));
      if (request !== captionFileRequest.current) return;
      const restored = parseCaptionDraftFile(text, { bytes: selectedSource.size, sha256: sourceSha256 });
      const source = manualCaptionTrackVtt(restored.cues);
      if (!source) throw new Error("This caption draft has no cues to restore.");
      const draftSha256 = await sha256Hex(new TextEncoder().encode(source));
      if (request !== captionFileRequest.current) return;
      setCaptionDraft({ name: selected.name, sourceSha256: draftSha256, cues: restored.cues, local: true });
      setCaptionHistory(EMPTY_CUE_HISTORY);
      setCaptionOffsetRaw(String(restored.offsetMs / 1000));
      setCaptionText("");
      setCueSearchText("");
      setCueSpeakerSelection(ALL_CUE_SPEAKERS);
      setCueView("trim");
      resetCueEditor();
      setManualCueMessage("");
      setShowSourceCaptions(false);
      setPreparedCaptionFile(null);
      const count = restored.cues.length;
      const offset = restored.offsetMs === 0
        ? "no timing offset"
        : `a ${restored.offsetMs > 0 ? "+" : "−"}${Math.abs(restored.offsetMs) / 1000}s timing offset`;
      setCaptionFileMessage(`Restored ${count} ${count === 1 ? "cue" : "cues"} and ${offset} from ${selected.name}. Trim, frame and any finished MP4 are unchanged.`);
    } catch (error) {
      if (request === captionFileRequest.current)
        setCaptionFileMessage(`${error instanceof Error ? error.message : "Could not read that caption draft."} Your current caption cues and timing offset are unchanged.`);
    } finally {
      if (request === captionFileRequest.current) setCaptionFileLoading(false);
    }
  }
  // The paste box is an alternate local source for the same chooser. A File is
  // built from exactly the entered UTF-8 bytes only after an explicit Apply, so
  // the existing bound, digest, parser, preflight, preview and draft download
  // all stay identical. Refused text leaves the loaded track and finished MP4.
  async function applyCaptionText() {
    if (!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const prepared = captionFileFromText(captionText);
    if ("problem" in prepared) { setCaptionMessage(prepared.problem); return; }
    await chooseCaptions(prepared.file);
  }
  // Leave the shared manual-cue form in add mode with no stale text. The trim,
  // offset, loaded track and any finished MP4 are not touched.
  function resetCueEditor() {
    setCueEditing(null);
    setManualCueText("");
    setManualCueSpeaker("");
    setManualCueStart("");
    setManualCueEnd("");
    setCueSplitAt("");
    setCueSplitWord(1);
  }
  // Clearing display filters is not a draft edit. Returning focus to the text
  // field keeps the main and merge-recovery Clear buttons keyboard friendly.
  function clearCueFilters() {
    setCueSearchText("");
    setCueSpeakerSelection(ALL_CUE_SPEAKERS);
    setCueSpeakerRenameText("");
    setCueSpeakerRenameMessage("");
    cueSearchInput.current?.focus();
  }
  // Switching which cue rows are shown never edits the draft, trim or offset.
  // A cue audition belongs to an in-trim row that may no longer be listed, so
  // stop it and say why rather than leave audio over a hidden row.
  function showCueView(view: "trim" | "source") {
    if (view === cueView) return;
    if (view === "source") stopCueAudition("Cue audition stopped because the cue view changed.");
    setCueView(view);
  }
  // One plain-text cue at original-video seconds. Validation and overlap checks
  // run before any state change, then the accepted cue joins the current draft
  // in time order. The digest covers the actual edited track so a receipt never
  // claims the imported file's bytes were changed.
  async function addManualCue() {
    if (!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const added = appendManualClipCue(captionDraft?.cues ?? [], {
      text: manualCueText, startSeconds: manualCueStart, endSeconds: manualCueEnd,
      speaker: manualCueSpeaker,
    }, Math.round(duration * 1000));
    if ("problem" in added) { setManualCueMessage(added.problem); return; }
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setManualCueMessage("Adding the cue to this draft…");
    try {
      const updated = await editedCaptionDraft(captionDraft, added.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(EMPTY_CUE_HISTORY);
      resetCueEditor();
      setManualCueMessage(`Added one cue. This draft now has ${added.cues.length} ${added.cues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setManualCueMessage(error instanceof Error ? error.message : "Could not add the cue in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Load one reviewed cue into the same manual form, using its original-video
  // seconds rather than the clipped, offset review times. The draft itself is
  // not changed until Update cue, so Cancel and invalid values stay harmless.
  function beginCueEdit(sourceIndex: number) {
    if (!captionDraft || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const cue = captionDraft.cues[sourceIndex];
    if (!cue) return;
    if (manualCueDetails.current) manualCueDetails.current.open = true;
    setCueEditing({ sourceIndex, draft: captionDraft });
    setManualCueText(cue.text);
    // Load the imported or previously saved label so Update cue can keep it,
    // clear it, or give an unnamed cue a name.
    setManualCueSpeaker(cue.speaker);
    setManualCueStart((cue.startMs / 1000).toFixed(3));
    setManualCueEnd((cue.endMs / 1000).toFixed(3));
    const split = defaultClipCueSplit(cue);
    setCueSplitAt(split?.atSeconds ?? "");
    setCueSplitWord(split?.wordBoundary ?? 1);
    setManualCueMessage(`Editing the cue at ${clipTimeStamp(cue.startMs)}–${clipTimeStamp(cue.endMs)} in the original video.`);
  }
  function cancelCueEdit() {
    if (!cueEditing || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    resetCueEditor();
    setManualCueMessage("Edit cancelled. Write a new cue or choose another cue to edit.");
    manualCueTextInput.current?.focus();
  }
  // Replace the exact draft cue the editor opened against. Validation, overlap,
  // range and size checks run before any state change. The digest covers the
  // actual edited track, and the untouched prior draft is saved for Undo.
  async function saveEditedCue() {
    if (!captionDraft || !cueEditing || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    if (cueEditing.draft !== captionDraft || !captionDraft.cues[cueEditing.sourceIndex]) {
      resetCueEditor();
      setManualCueMessage("The caption draft changed. Choose Edit again.");
      return;
    }
    const previousDraft = captionDraft;
    const replaced = replaceClipDraftCue(previousDraft.cues, cueEditing.sourceIndex, {
      text: manualCueText, startSeconds: manualCueStart, endSeconds: manualCueEnd,
      speaker: manualCueSpeaker,
    }, Math.round(duration * 1000));
    if ("problem" in replaced) { setManualCueMessage(replaced.problem); return; }
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setManualCueMessage("Updating the cue in this draft…");
    try {
      const updated = await editedCaptionDraft(previousDraft, replaced.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(cueEditHistory(previousDraft));
      resetCueEditor();
      setManualCueMessage(`Updated one cue. This draft now has ${replaced.cues.length} ${replaced.cues.length === 1 ? "cue" : "cues"}. Undo is available below.`);
    } catch (error) {
      if (request === captionRequest.current)
        setManualCueMessage(error instanceof Error ? error.message : "Could not update the cue in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Split the saved cue the editor opened against. The entered original-video
  // time becomes the exact shared edge; the chosen word boundary names the two
  // text parts. Validation runs before any draft change, then the same edited
  // track digest and exact prior-draft Undo as Update cue apply.
  async function splitEditedCue() {
    if (!captionDraft || !cueEditing || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const sourceCue = captionDraft.cues[cueEditing.sourceIndex];
    if (cueEditing.draft !== captionDraft || !sourceCue) {
      resetCueEditor();
      setManualCueMessage("The caption draft changed. Choose Edit again.");
      return;
    }
    if (manualCueText !== sourceCue.text ||
      manualCueSpeaker !== sourceCue.speaker ||
      Number(manualCueStart) !== sourceCue.startMs / 1000 ||
      Number(manualCueEnd) !== sourceCue.endMs / 1000) {
      setManualCueMessage("Save your cue edits with Update cue before splitting.");
      return;
    }
    const previousDraft = captionDraft;
    const split = splitClipDraftCue(previousDraft.cues, cueEditing.sourceIndex, {
      atSeconds: cueSplitAt, wordBoundary: cueSplitBoundary,
    }, Math.round(duration * 1000));
    if ("problem" in split) { setManualCueMessage(split.problem); return; }
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setManualCueMessage("Splitting the cue in this draft…");
    try {
      const updated = await editedCaptionDraft(previousDraft, split.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(cueEditHistory(previousDraft));
      resetCueEditor();
      setManualCueMessage(`Split one cue into two. This draft now has ${split.cues.length} ${split.cues.length === 1 ? "cue" : "cues"}. Undo is available below.`);
    } catch (error) {
      if (request === captionRequest.current)
        setManualCueMessage(error instanceof Error ? error.message : "Could not split the cue in this browser.");
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
    if (!captionDraft || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
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
        setCaptionHistory(cueEditHistory(previousDraft));
        if (cueEditing) resetCueEditor();
        setCaptionMessage("Removed the last cue. The caption track is removed; Undo is available below.");
        return;
      }
      const updated = await editedCaptionDraft(previousDraft, nextCues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(cueEditHistory(previousDraft));
      if (cueEditing) resetCueEditor();
      setCaptionMessage(`Removed one cue. This draft now has ${nextCues.length} ${nextCues.length === 1 ? "cue" : "cues"}.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCaptionMessage(error instanceof Error ? error.message : "Could not remove the cue in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Merge the two visible adjacent cues named by the review projection. The
  // first original start and next original end are kept, and the exact texts
  // join with one space. Validation runs before any draft change, then the same
  // edited-track digest and exact prior-draft Undo as removal and editing apply.
  async function mergeCaptionCues(firstSourceIndex: number, nextSourceIndex: number) {
    if (!captionDraft || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const previousDraft = captionDraft;
    const merged = mergeClipDraftCues(previousDraft.cues, firstSourceIndex, nextSourceIndex, Math.round(duration * 1000));
    if ("problem" in merged) {
      setCaptionMessage(merged.problem);
      return;
    }
    const request = ++captionRequest.current;
    setCaptionLoading(true);
    setCaptionMessage("Merging the two cues in this draft…");
    try {
      const updated = await editedCaptionDraft(previousDraft, merged.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(cueEditHistory(previousDraft));
      if (cueEditing) resetCueEditor();
      setCaptionMessage(`Merged two cues. This draft now has ${merged.cues.length} ${merged.cues.length === 1 ? "cue" : "cues"}. Undo is available below.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCaptionMessage(error instanceof Error ? error.message : "Could not merge the cues in this browser.");
    } finally {
      if (request === captionRequest.current) setCaptionLoading(false);
    }
  }
  // Both speaker edits work on the complete source draft and share its
  // validation, digest, request guard and one-step history.
  async function changeSelectedCueSpeaker(removeName = false) {
    if (!captionDraft || !namedCueSpeaker || cueEditing || captionActionsBusy) return;
    const previousDraft = captionDraft;
    const from = namedCueSpeaker;
    const change = removeName
      ? removeSpeakerNameCues(previousDraft.cues, from)
      : renameSpeakerCues(previousDraft.cues, from, cueSpeakerRenameText);
    if ("problem" in change) {
      setCueSpeakerRenameMessage(change.problem);
      if (!removeName) cueSpeakerRenameInput.current?.focus();
      return;
    }
    const track = manualCaptionTrackVtt(change.cues);
    if (!track) {
      setCueSpeakerRenameMessage("This caption draft could not be changed. Check its cue times and try again.");
      return;
    }
    if (new TextEncoder().encode(track).byteLength > MAX_CAPTION_BYTES) {
      setCueSpeakerRenameMessage(removeName
        ? "That change would put the full-source caption track over 64 KB."
        : "That name would put the full-source caption track over 64 KB. Choose a shorter name.");
      if (!removeName) cueSpeakerRenameInput.current?.focus();
      return;
    }
    const request = ++captionRequest.current;
    const focused = document.activeElement;
    const returnToSpeaker = removeName && focused === cueSpeakerRemoveButton.current;
    setCaptionLoading(true);
    setCueSpeakerRenameMessage(removeName
      ? `Removing “${from}” from every full-source cue…`
      : `Renaming “${from}” on every full-source cue…`);
    try {
      const updated = await editedCaptionDraft(previousDraft, change.cues);
      if (request !== captionRequest.current) return;
      setCaptionDraft(updated);
      setCaptionHistory(cueEditHistory(previousDraft));
      setCueSpeakerSelection(removeName ? UNNAMED_CUE_SPEAKER : cueSpeakerOptionValue(change.speaker));
      setCueSpeakerRenameText("");
      const count = "changed" in change ? change.changed : change.renamed;
      const cues = `${count} full-source ${count === 1 ? "cue" : "cues"}`;
      setCueSpeakerRenameMessage(removeName
        ? `Removed “${from}” from ${cues}. Undo is available below.`
        : `Renamed ${cues} from “${from}” to “${change.speaker}”. Undo is available below.`);
    } catch (error) {
      if (request === captionRequest.current)
        setCueSpeakerRenameMessage(error instanceof Error ? error.message : "Could not change the speaker name in this browser.");
    } finally {
      if (request === captionRequest.current) {
        setCaptionLoading(false);
        requestAnimationFrame(() => {
          if (request !== captionRequest.current || document.activeElement !== document.body) return;
          if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
          else if (returnToSpeaker) cueSpeakerSelect.current?.focus({ preventScroll: true });
        });
      }
    }
  }
  // Move between the exact drafts on either side of the last cue edit. Both
  // directions reuse the same request guard, clear the editor (if any), and
  // leave the timing offset, trim, preview, result and source untouched.
  function undoCaptionRemoval() {
    if (busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const next = undoLastCueChange(captionHistory, captionDraft);
    if (!next) return;
    captionRequest.current++;
    setCaptionHistory(next.history);
    setCaptionDraft(next.draft);
    if (cueEditing) resetCueEditor();
    setCaptionLoading(false);
    setCaptionMessage("Restored the previous cue draft. Redo is available below.");
  }
  function redoCaptionChange() {
    if (busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const next = redoLastCueChange(captionHistory, captionDraft);
    if (!next) return;
    captionRequest.current++;
    setCaptionHistory(next.history);
    setCaptionDraft(next.draft);
    if (cueEditing) resetCueEditor();
    setCaptionLoading(false);
    setCaptionMessage(next.draft
      ? "Reapplied the last cue change. Undo is available below."
      : "Reapplied the removal of the last cue. Undo is available below.");
  }
  // Clear the short cue play, if one is running. This never touches the draft,
  // trim, offset, preview, result or native controls. A reason is announced
  // only when something was actually playing, so an ordinary Jump stays quiet.
  function stopCueAudition(status = "") {
    const active = cueAuditionRef.current;
    if (!active) return;
    cueAuditionRef.current = null;
    cueAuditionRequest.current++;
    cancelAnimationFrame(cueAuditionFrame.current);
    cueAuditionFrame.current = 0;
    active.video.pause();
    setCueAudition(null);
    setCueAuditionStatus(status);
  }
  // The cue window has played through: pause and land exactly on its end so the
  // next native play starts where the cue really ends, not a frame past it.
  function finishCueAudition() {
    const active = cueAuditionRef.current;
    if (!active) return;
    stopCueAudition("Cue playback stopped at the cue end.");
    try { active.video.currentTime = active.endMs / 1000; } catch { /* keep the reached frame */ }
  }
  // Play only the selected cue's real source intersection on the existing
  // source element. The request token makes an older play promise harmless when
  // a new cue, jump, edit or pause has taken over while it was pending.
  async function playOriginalCue(cue: { sourceIndex: number; from: number; to: number; sourceStartMs: number }) {
    if (busy || checking || importing || receiptLoading || captionLoading || captionFileLoading) return;
    const video = sourceVideo.current;
    const range = cueAuditionWindow(cue, Math.round(duration * 1000));
    if (!video || !range) {
      setCueAuditionStatus("This cue cannot be played from the original video. Check the trim and timing offset.");
      return;
    }
    stopCueAudition();
    const request = ++cueAuditionRequest.current;
    const active: CueAudition = { video, sourceIndex: cue.sourceIndex, ...range };
    cueAuditionRef.current = active;
    setCueAudition(active);
    setCueAuditionStatus(`Playing cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)} from the original video.`);
    video.pause();
    try {
      video.currentTime = range.startMs / 1000;
    } catch {
      stopCueAudition("Could not move the original video to this cue. Use the original video controls instead.");
      return;
    }
    try {
      await video.play();
    } catch {
      if (request !== cueAuditionRequest.current) return;
      stopCueAudition("Could not play this cue in this browser. Use the original video controls instead.");
      return;
    }
    if (request !== cueAuditionRequest.current || cueAuditionRef.current !== active) return;
    const endSeconds = range.endMs / 1000;
    const tick = () => {
      if (request !== cueAuditionRequest.current || cueAuditionRef.current !== active) return;
      if (!Number.isFinite(video.currentTime)) {
        stopCueAudition("Could not read the original video playhead. Use the original video controls instead.");
        return;
      }
      if (video.currentTime >= endSeconds - 0.004) {
        finishCueAudition();
        return;
      }
      cueAuditionFrame.current = requestAnimationFrame(tick);
    };
    cueAuditionFrame.current = requestAnimationFrame(tick);
  }
  function pauseSourceVideo(video: HTMLVideoElement) {
    if (video.paused && cueAuditionRef.current?.video === video)
      stopCueAudition("Cue playback paused.");
  }
  // A native-control or waveform seek outside the playing cue clears it instead
  // of silently playing unrelated seconds. The start seek is inside the window.
  function checkSourceSeek(video: HTMLVideoElement) {
    const active = cueAuditionRef.current;
    if (active?.video !== video || !Number.isFinite(video.currentTime)) return;
    const atMs = Math.round(video.currentTime * 1000);
    if (atMs < active.startMs - 50 || atMs > active.endMs + 50)
      stopCueAudition("Cue audition stopped because the playhead moved outside the cue.");
  }
  function endSourceVideo(video: HTMLVideoElement) {
    if (cueAuditionRef.current?.video === video) stopCueAudition("The original video ended.");
  }
  function failSourceVideo(video: HTMLVideoElement) {
    if (cueAuditionRef.current?.video === video)
      stopCueAudition("Could not play this cue in this browser. Use the original video controls instead.");
  }
  // One source-seek path for the caption review and the waveform range: pause
  // the existing preview player and move its own clock, never a second decoder.
  function seekOriginalVideo(sourceSeconds: number) {
    const video = sourceVideo.current;
    if (!video || !Number.isFinite(sourceSeconds)) return;
    stopCueAudition("Cue audition stopped because the playhead moved.");
    video.pause();
    video.currentTime = Math.min(Math.max(sourceSeconds, 0), duration);
  }
  // Pause on the projected source time and keep keyboard focus on the cue.
  function jumpToOriginalCue(sourceStartMs: number) {
    seekOriginalVideo(sourceStartMs / 1000);
  }
  // Read the existing player without moving it, then focus the first visible
  // review row whose half-open source window contains that millisecond. This
  // only changes feedback and focus, never the video, draft, trim or export.
  function findCueAtPlayhead() {
    const video = sourceVideo.current;
    if (!video || !Number.isFinite(video.currentTime)) {
      setCuePlayheadStatus("The original video playhead is unavailable.");
      return;
    }
    const atMs = Math.round(video.currentTime * 1000);
    const trimStartMs = Math.round(start * 1000);
    const cue = cueView === "source"
      ? visibleSourceCues.find(cue => cue.startMs <= atMs && atMs < cue.endMs)
      : visibleCues.find(cue => cue.sourceStartMs <= atMs && atMs < trimStartMs + cue.to);
    if (!cue) {
      const filterHint = hasCueFilters ? " Clear the filters to check other cues." : "";
      setCuePlayheadStatus(`No visible cue at ${clipTimeStamp(atMs)}.${filterHint}`);
      return;
    }
    const jump = cueReview.current?.querySelector<HTMLButtonElement>(
      `.trim-cue-row[data-source-index="${cue.sourceIndex}"] .trim-cue-jump`,
    );
    if (!jump) {
      setCuePlayheadStatus(`The cue at ${clipTimeStamp(atMs)} is unavailable.`);
      return;
    }
    setCuePlayheadStatus(`Focused the cue at ${clipTimeStamp(atMs)}.`);
    jump.focus();
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
  // Stage a split time from the existing player without moving it. The exact
  // saved cue supplies the bounds, and only the existing Split cue action writes
  // the draft; a refusal leaves the manually entered split time untouched.
  function fillCueSplitFromPlayhead() {
    const split = clipCueSplitFromPlayhead(editingCue, sourceVideo.current?.currentTime);
    if ("problem" in split) { setManualCueMessage(split.problem); return; }
    setCueSplitAt(split.atSeconds);
    setManualCueMessage(`Staged ${split.atSeconds} seconds from the original video playhead. Choose Split cue to save.`);
  }
  // Nudge only the two entered source times, together and by exactly one step,
  // through the same whole-millisecond parser and video bound as Add cue / Update
  // cue. The saved draft, its Undo, the offset, trim, other cues, preview and any
  // finished export are untouched; Add cue / Update cue still applies the edit.
  function nudgeCueTimes(deltaMs: number) {
    const nudged = nudgeManualCueTimes(
      { startSeconds: manualCueStart, endSeconds: manualCueEnd },
      deltaMs,
      Math.round(duration * 1000),
    );
    if ("problem" in nudged) { setManualCueMessage(nudged.problem); return; }
    setManualCueStart(nudged.startSeconds);
    setManualCueEnd(nudged.endSeconds);
    setManualCueMessage(`Moved both cue times ${Math.abs(deltaMs)} ms ${deltaMs < 0 ? "earlier" : "later"}. Choose ${cueEditing ? "Update cue" : "Add cue"} to save this edit.`);
  }

  // Opening a receipt is an explicit, local-only action. It proves the saved
  // digest against the exact bytes already accepted as the source, then writes
  // only the editable controls. Results and captions stay until a replacement.
  async function openReceipt(selected: File | undefined) {
    if (!selected || !file || busy || importing || checking || captionLoading || receiptLoading || captionFileLoading) return;
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
    if (!file || busy || checking || captionLoading || receiptLoading || captionFileLoading || captionOffsetMs === null) return;
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
        vtt: serializeClipCaptions(captionDraft.cues, start, end, captionOffsetMs, "default", { voices: true }),
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
        <label className="trim-file">Open clip receipt (JSON)<input type="file" accept="application/json,.json" disabled={busy || importing || checking || captionLoading || receiptLoading || captionFileLoading} onChange={event => {
          const input = event.currentTarget;
          void openReceipt(input.files?.[0]);
          input.value = "";
        }}/></label>
      </div>
      <p role="status" className="trim-note">{receiptMessage}</p>
      <label className="video-tool-check"><input type="checkbox" checked={previewFraming} onChange={e => setPreviewFraming(e.target.checked)}/> Preview output framing</label>
      <video ref={sourceVideo} className="video-tool-player" data-caption-contrast={sourceCaptionContrast} src={source} controls playsInline style={previewFraming ? previewStyle : undefined} aria-label={previewFraming ? "Original video, framing preview" : "Original video"}
        onPause={event => pauseSourceVideo(event.currentTarget)} onSeeking={event => checkSourceSeek(event.currentTarget)}
        onEnded={event => endSourceVideo(event.currentTarget)} onError={event => failSourceVideo(event.currentTarget)}>
        {sourceCaptionUrl && <track ref={sourceCaptions} kind="captions" label="Draft captions · original video" src={sourceCaptionUrl}/>}
      </video>
      {file && validTrim && <ClipWaveform file={file} startSeconds={start} endSeconds={end} video={sourceVideo} onSeek={seekOriginalVideo}/>}
      <div className="trim-fields"><label>Start (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing || receiptLoading} value={Number.isNaN(start) ? "" : start} onChange={e => {setStart(e.target.value === "" ? NaN : Number(e.target.value));}}/></label><label>End (seconds)<input type="number" min="0" max={duration} step="0.01" disabled={busy || importing || receiptLoading} value={Number.isNaN(end) ? "" : end} onChange={e => {setEnd(e.target.value === "" ? NaN : Number(e.target.value));}}/></label>
      <label>Frame<select value={shape} disabled={busy || importing || receiptLoading} onChange={e => {setShape(e.target.value as Shape);}}><option value="portrait">9:16 · portrait</option><option value="landscape">16:9 · landscape</option><option value="square">1:1 · square</option></select></label><label>Quality<select value={quality} disabled={busy || importing || receiptLoading} onChange={e => {setQuality(e.target.value as Quality);}}><option value="standard">Standard</option><option value="hd">HD · 720p</option></select></label><label>Fit<select value={fit} disabled={busy || importing || receiptLoading} onChange={e => {setFit(e.target.value as Fit);}}><option value="contain">Fit entire picture (bars)</option><option value="cover">Fill frame (crop)</option></select></label>
      {fit === "cover" && <label>Crop position<select value={cropAnchor} disabled={busy || importing || receiptLoading} onChange={e => {setCropAnchor(e.target.value as CropAnchor);}}><option value="center">Center</option><option value="topLeft">Top left</option><option value="bottomRight">Bottom right</option></select></label>}</div>
      <details>
        <summary>Use your own captions</summary>
        <p className="trim-note">Choose a plain SRT or WebVTT file, paste the text below, or add one plain-text cue. Cue times are relative to the original video. Preview them on the original video or the finished clip, or save the draft trim captions without making the MP4. A caption draft JSON also saves the editable cues and timing offset so you can reopen them later.</p>
        <label className="trim-file">Choose captions<input type="file" accept=".srt,.vtt,text/vtt" disabled={busy || checking || importing || receiptLoading || captionFileLoading} onChange={event => {
          const input = event.currentTarget;
          void chooseCaptions(input.files?.[0]);
          input.value = "";
        }}/></label>
        <p id="caption-paste-help" className="trim-note">Plain SRT or WebVTT up to 64 KB. A WebVTT voice annotation like &lt;v Alex&gt;words&lt;/v&gt; keeps the speaker; other markup and styling are refused. Caption text stays in this tab.</p>
        <label className="trim-file">Paste captions<textarea rows={6} spellCheck={false}
          aria-describedby="caption-paste-help"
          placeholder={"WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nYour first caption"}
          value={captionText}
          disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
          onChange={event => setCaptionText(event.currentTarget.value)}
        /></label>
        <button type="button" className="secondary" disabled={!file || !captionText.trim() || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={() => void applyCaptionText()}>Apply captions</button>
        <details ref={manualCueDetails}>
          <summary>{cueEditing ? "Edit cue" : "Write a cue"}</summary>
          <p id="manual-cue-help" className="trim-note">Use seconds from the start of the original video, with up to three decimal places. The timing offset applies to every cue. Move earlier / later shifts both entered times together without changing the cue’s length, only while it stays inside the video; choose Add cue or Update cue to save.</p>
          <label>Caption text<input ref={manualCueTextInput} type="text" spellCheck={false} maxLength={300}
            aria-describedby="manual-cue-help"
            value={manualCueText}
            disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
            onChange={event => setManualCueText(event.currentTarget.value)}
          /></label>
          <label>Speaker (optional)<input type="text" spellCheck={false} maxLength={MAX_SPEAKER_CHARS}
            aria-describedby="manual-cue-speaker-help"
            value={manualCueSpeaker}
            disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
            onChange={event => setManualCueSpeaker(event.currentTarget.value)}
          /></label>
          <p id="manual-cue-speaker-help" className="trim-note">Use one line of up to {MAX_SPEAKER_CHARS} characters. WebVTT keeps the name.</p>
          <div className="trim-fields">
            <div>
              <label>Cue start (seconds)<input type="number" min="0" max={duration} step="0.001"
                value={manualCueStart}
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                onChange={event => setManualCueStart(event.currentTarget.value)}
              /></label>
              <button type="button" className="secondary"
                aria-label="Fill Cue start from the original video playhead"
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                onClick={() => fillCueTimeFromPlayhead("start")}>Use playhead</button>
            </div>
            <div>
              <label>Cue end (seconds)<input type="number" min="0" max={duration} step="0.001"
                value={manualCueEnd}
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                onChange={event => setManualCueEnd(event.currentTarget.value)}
              /></label>
              <button type="button" className="secondary"
                aria-label="Fill Cue end from the original video playhead"
                disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                onClick={() => fillCueTimeFromPlayhead("end")}>Use playhead</button>
            </div>
          </div>
          <div className="video-tool-actions" role="group" aria-label="Nudge both cue times">
            <button type="button" className="secondary"
              aria-label="Move both the entered cue start and end 100 ms earlier together"
              disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
              onClick={() => nudgeCueTimes(-100)}>−100 ms earlier</button>
            <button type="button" className="secondary"
              aria-label="Move both the entered cue start and end 100 ms later together"
              disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
              onClick={() => nudgeCueTimes(100)}>+100 ms later</button>
          </div>
          <div className="video-tool-actions">
            {cueEditing ? <>
              <button type="button" className="secondary" disabled={!file || !manualCueText.trim() || !manualCueStart.trim() || !manualCueEnd.trim() || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={() => void saveEditedCue()}>Update cue</button>
              <button type="button" className="secondary" disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={cancelCueEdit}>Cancel</button>
            </> : <button type="button" className="secondary" disabled={!file || !manualCueText.trim() || !manualCueStart.trim() || !manualCueEnd.trim() || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={() => void addManualCue()}>Add cue</button>}
          </div>
          {canSplitEditingCue && editingCue && (
            <details className="trim-cue-split">
              <summary>Split this cue</summary>
              <p id="cue-split-help" className="trim-note">Original-video seconds, before the timing offset.</p>
              <div className="trim-fields">
                <div>
                  <label>Split at (seconds)<input type="number" min={editingCue.startMs / 1000} max={editingCue.endMs / 1000} step="0.001"
                    aria-describedby="cue-split-help"
                    value={cueSplitAt}
                    disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                    onChange={event => setCueSplitAt(event.currentTarget.value)}
                  /></label>
                  <button type="button" className="secondary"
                    aria-label="Fill split seconds from the original video playhead"
                    aria-describedby="cue-split-help"
                    disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                    onClick={fillCueSplitFromPlayhead}>Use playhead</button>
                </div>
                <label>Word boundary<select value={cueSplitBoundary}
                  aria-describedby="cue-split-help"
                  disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                  onChange={event => setCueSplitWord(Number(event.currentTarget.value))}>
                  {editingCueWords.slice(1).map((_, index) => {
                    const boundary = index + 1;
                    return <option key={boundary} value={boundary}>After “{editingCueWords[boundary - 1]}”</option>;
                  })}
                </select></label>
              </div>
              {cueSplitPreview && <p className="trim-note trim-cue-split-preview" aria-live="polite">{cueSplitPreview.first} | {cueSplitPreview.second}</p>}
              <button type="button" className="secondary"
                disabled={!file || !cueSplitAt.trim() || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                onClick={() => void splitEditedCue()}>Split cue</button>
            </details>
          )}
          {manualCueMessage && <p role="status" aria-live="polite" className="trim-note">{manualCueMessage}</p>}
        </details>
        {captionDraft && <p><strong>{captionDraft.name}</strong> <button type="button" className="secondary" disabled={busy || checking || importing || receiptLoading || captionFileLoading} onClick={() => {
          captionRequest.current++;
          captionFileRequest.current++;
          setPreparedCaptionFile(null);
          setCaptionFileLoading(false);
          setCaptionFileMessage("");
          setCaptionDraft(null);
          setCaptionHistory(EMPTY_CUE_HISTORY);
          setCaptionOffsetRaw("0");
          setCaptionText("");
          setCueSearchText("");
          setCueSpeakerSelection(ALL_CUE_SPEAKERS);
          setCueView("trim");
          resetCueEditor();
          setManualCueMessage("");
          setCaptionLoading(false);
          setShowSourceCaptions(false);
          setCaptionMessage("Captions cleared.");
        }}>Clear captions</button></p>}
        {captionDraft && <div>
          <div className="trim-fields">
            <label>Timing offset (seconds)
              <input type="number" min={-MAX_CAPTION_OFFSET_SECONDS} max={MAX_CAPTION_OFFSET_SECONDS} step="0.001"
                value={captionOffsetRaw} disabled={busy || checking || importing || receiptLoading || captionFileLoading}
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
                ? "No caption cues will fit this trim. Adjust the timing offset or trim to include them, or review and edit every stored cue in All source cues."
                : `${survivingCaptionCount} caption ${survivingCaptionCount === 1 ? "cue" : "cues"} inside this trim.`}
            </p>
          )}
          {captionDraft && (
            <details ref={cueReview} className="trim-cue-review">
              <summary>{trimmedCaptionCues
                ? `Review cues in this trim (${trimmedCaptionCues.length})`
                : `Review caption cues (${captionDraft.cues.length} stored)`}</summary>
              <p className="trim-note">{cueView === "source"
                ? "Review every cue at its original video time, including cues outside this trim. Choose a cue to seek to it. Use Edit to change its text or timing, Merge with next to join two visible adjacent cues, or Remove to delete one cue."
                : "Times are relative to the trim start. Choose a cue to pause the original video at that source position, or select Play cue to run that section within the current trim and timing offset. Edit writes the cue's original-video text and times into the form above; Merge with next joins it with the next adjacent cue, only when both are shown; Remove deletes just that cue. Turn on Preview draft captions on original video to see the original caption there."}</p>
              <div className="trim-cue-views" role="group" aria-label="Which caption cues to review">
                <button type="button" className="secondary trim-cue-view-trim"
                  aria-pressed={cueView === "trim"}
                  onClick={() => showCueView("trim")}>
                  In this trim{trimmedCaptionCues ? ` (${trimmedCaptionCues.length})` : ""}
                </button>
                <button type="button" className="secondary trim-cue-view-source"
                  aria-pressed={cueView === "source"}
                  onClick={() => showCueView("source")}>
                  All source cues ({captionDraft.cues.length})
                </button>
              </div>
              <div className="trim-cue-playhead-find">
                <button type="button" className="secondary"
                  aria-describedby="trim-cue-playhead-status"
                  disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                  onClick={findCueAtPlayhead}>Find cue at playhead</button>
                <p id="trim-cue-playhead-status" className="trim-note" role="status" aria-live="polite">{cuePlayheadStatus}</p>
              </div>
              {cueView === "trim" && !trimmedCaptionCues && (
                <p className="notice trim-cue-view-unknown">The trim or timing offset is not valid, so there is no in-trim cue list. All source cues still lists every stored cue at its original video time.</p>
              )}
              <div className="trim-cue-search">
                <div className="trim-cue-search-controls">
                  <label className="trim-cue-text-filter" htmlFor="trim-cue-search">Find a caption by its text
                    <input id="trim-cue-search" ref={cueSearchInput} type="search"
                      value={cueSearchText} maxLength={MAX_CUE_SEARCH_CHARS} placeholder="Search cue text" autoComplete="off"
                      aria-describedby="trim-cue-search-help trim-cue-search-count"
                      disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                      onChange={event => setCueSearchText(event.currentTarget.value)} />
                  </label>
                  <label className="trim-cue-speaker-filter" htmlFor="trim-cue-speaker">Speaker
                    <select id="trim-cue-speaker" ref={cueSpeakerSelect} value={cueSpeaker}
                      aria-describedby="trim-cue-search-help trim-cue-search-count"
                      disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                      onChange={event => {
                        setCueSpeakerSelection(event.currentTarget.value);
                        setCueSpeakerRenameText("");
                        setCueSpeakerRenameMessage("");
                      }}>
                      <option value={ALL_CUE_SPEAKERS}>All speakers</option>
                      <option value={UNNAMED_CUE_SPEAKER}>No speaker</option>
                      {cueSpeakerChoices.length > 0 && (
                        <optgroup label="Named speakers">
                          {cueSpeakerChoices.map(option => <option key={option} value={option}>{cueSpeakerName(option)}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </label>
                  <button type="button" className="secondary trim-cue-search-clear"
                    disabled={(!cueSearchText && cueSpeaker === ALL_CUE_SPEAKERS) || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                    onClick={clearCueFilters}>Clear</button>
                </div>
                {namedCueSpeaker !== null && (
                  <form className="trim-cue-search-controls trim-cue-speaker-rename"
                    aria-label={`Rename speaker ${namedCueSpeaker}`}
                    aria-busy={captionLoading || undefined}
                    onSubmit={event => {
                      event.preventDefault();
                      void changeSelectedCueSpeaker();
                    }}>
                    <label className="trim-cue-text-filter trim-cue-text" htmlFor="trim-cue-speaker-rename">New speaker name
                      <input id="trim-cue-speaker-rename" ref={cueSpeakerRenameInput} type="text"
                        value={cueSpeakerRenameText} maxLength={MAX_SPEAKER_CHARS}
                        spellCheck={false} autoComplete="off"
                        aria-describedby="trim-cue-speaker-rename-help trim-cue-speaker-rename-status"
                        disabled={cueSpeakerRenameDisabled}
                        onChange={event => setCueSpeakerRenameText(event.currentTarget.value)}
                      />
                    </label>
                    <button type="submit" className="secondary trim-cue-search-clear"
                      disabled={cueSpeakerRenameDisabled}>Rename speaker</button>
                    <button type="button" ref={cueSpeakerRemoveButton}
                      className="secondary trim-cue-search-clear"
                      aria-describedby="trim-cue-speaker-rename-help trim-cue-speaker-rename-status"
                      disabled={cueSpeakerRenameDisabled}
                      onClick={() => { void changeSelectedCueSpeaker(true); }}>Remove speaker name</button>
                  </form>
                )}
                {namedCueSpeaker !== null && (
                  <p id="trim-cue-speaker-rename-help" className="trim-note trim-cue-text">{cueEditing
                    ? `Finish or cancel the open cue edit before changing or removing “${namedCueSpeaker}”.`
                    : `Applies to every cue named “${namedCueSpeaker}”, including cues outside the trim or search.`}</p>
                )}
                <p id="trim-cue-speaker-rename-status" className="trim-note" role="status">{(namedCueSpeaker !== null || cueSpeaker === UNNAMED_CUE_SPEAKER) && cueSpeakerRenameMessage}</p>
                <p id="trim-cue-search-help" className="trim-note">The filters change the rows shown below. The saved draft, preview, offset and downloads include every cue.</p>
                <p id="trim-cue-search-count" className="trim-note" role="status" aria-live="polite"
                  data-empty={hasCueFilters && reviewVisibleCueCount === 0 ? "true" : undefined}>
                  {cueReviewStatus}
                </p>
              </div>
              {cueView === "trim" && trimmedCaptionCues && trimmedCaptionCues.length > 0 && (
                <ol className="trim-cue-list" aria-label="Caption cues in this trim">
                  {visibleCues.map(cue => {
                    const { mergeWith, hiddenMergeWith } = cueMergeVisibility(trimmedCaptionCues, cue, visibleCues, captionDraft.cues);
                    const thisCuePlaying = cueAudition?.sourceIndex === cue.sourceIndex;
                    return (
                      <li key={cue.sourceIndex} className="trim-cue-row" data-source-index={cue.sourceIndex}>
                        <button type="button" className="secondary trim-cue-jump"
                          aria-label={`Jump to cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cueLine(cue)}`}
                          disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                          onClick={() => jumpToOriginalCue(cue.sourceStartMs)}>
                          <span className="trim-cue-time">{clipTimeStamp(cue.from)}–{clipTimeStamp(cue.to)}</span>
                          <span className="trim-cue-text">{cue.speaker && <span className="trim-cue-speaker">{cue.speaker}: </span>}{cue.text}</span>
                        </button>
                        <div className="trim-cue-actions">
                          <button type="button" className="secondary trim-cue-play"
                            aria-label={thisCuePlaying
                              ? `Pause cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cueLine(cue)}`
                              : `Play cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)} from the original video. ${cueLine(cue)}`}
                            aria-pressed={thisCuePlaying}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => {
                              if (thisCuePlaying) stopCueAudition("Cue audition paused.");
                              else void playOriginalCue(cue);
                            }}>{thisCuePlaying ? "Pause cue" : "Play cue"}</button>
                          <button type="button" className="secondary trim-cue-edit"
                            aria-label={`Edit cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cueLine(cue)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => beginCueEdit(cue.sourceIndex)}>Edit</button>
                          {mergeWith && <button type="button" className="secondary trim-cue-merge"
                            aria-label={`Merge cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cueLine(cue)} with the next cue ${clipTimeStamp(mergeWith.from)}–${clipTimeStamp(mergeWith.to)}. ${cueLine(mergeWith)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => void mergeCaptionCues(cue.sourceIndex, mergeWith.sourceIndex)}>Merge with next</button>}
                          <button type="button" className="secondary trim-cue-remove"
                            aria-label={`Remove cue ${clipTimeStamp(cue.from)}–${clipTimeStamp(cue.to)}. ${cueLine(cue)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => void removeTrimmedCue(cue.sourceIndex)}>Remove</button>
                        </div>
                        {hiddenMergeWith && (
                          <p className="trim-note trim-cue-hidden-merge">
                            Merge is hidden by the current filters: cue {clipTimeStamp(hiddenMergeWith.from)}–{clipTimeStamp(hiddenMergeWith.to)} (“{cueLine(hiddenMergeWith)}”) is the next adjacent cue in the draft. <button type="button" className="quiet trim-cue-search-reveal" onClick={clearCueFilters}>Clear filters</button> to show it here.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {cueView === "source" && (
                <ol className="trim-cue-list" aria-label="All caption source cues at their original video times">
                  {visibleSourceCues.map(cue => {
                    const { mergeWith, hiddenMergeWith } = cueMergeVisibility(allSourceCues, cue, visibleSourceCues, captionDraft.cues);
                    return (
                      <li key={cue.sourceIndex} className="trim-cue-row trim-cue-source-row" data-source-index={cue.sourceIndex}>
                        <button type="button" className="secondary trim-cue-jump"
                          aria-label={`Jump to source cue ${clipTimeStamp(cue.startMs)}–${clipTimeStamp(cue.endMs)} in the original video. ${cueLine(cue)}`}
                          disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                          onClick={() => jumpToOriginalCue(cue.startMs)}>
                          <span className="trim-cue-time trim-cue-source-time">Original {clipTimeStamp(cue.startMs)}–{clipTimeStamp(cue.endMs)}</span>
                          <span className="trim-cue-text">{cue.speaker && <span className="trim-cue-speaker">{cue.speaker}: </span>}{cue.text}</span>
                        </button>
                        <div className="trim-cue-actions">
                          <button type="button" className="secondary trim-cue-edit"
                            aria-label={`Edit source cue ${clipTimeStamp(cue.startMs)}–${clipTimeStamp(cue.endMs)} at its original video time. ${cueLine(cue)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => beginCueEdit(cue.sourceIndex)}>Edit</button>
                          {mergeWith && <button type="button" className="secondary trim-cue-merge"
                            aria-label={`Merge source cue ${clipTimeStamp(cue.startMs)}–${clipTimeStamp(cue.endMs)} at its original video time. ${cueLine(cue)} with the next cue ${clipTimeStamp(mergeWith.startMs)}–${clipTimeStamp(mergeWith.endMs)}. ${cueLine(mergeWith)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => void mergeCaptionCues(cue.sourceIndex, mergeWith.sourceIndex)}>Merge with next</button>}
                          <button type="button" className="secondary trim-cue-remove"
                            aria-label={`Remove source cue ${clipTimeStamp(cue.startMs)}–${clipTimeStamp(cue.endMs)} at its original video time. ${cueLine(cue)}`}
                            disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
                            onClick={() => void removeTrimmedCue(cue.sourceIndex)}>Remove</button>
                        </div>
                        {hiddenMergeWith && (
                          <p className="trim-note trim-cue-hidden-merge">
                            Merge is hidden by the current filters: cue {clipTimeStamp(hiddenMergeWith.startMs)}–{clipTimeStamp(hiddenMergeWith.endMs)} (“{cueLine(hiddenMergeWith)}”) is the next adjacent cue in the draft. <button type="button" className="quiet trim-cue-search-reveal" onClick={clearCueFilters}>Clear filters</button> to show it here.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              <p className="trim-note trim-cue-audition-status" role="status" aria-live="polite">{cueAuditionStatus}</p>
            </details>
          )}
          {fullSourceCaptionUrl && (
            <div>
              <p><a className="button secondary" href={fullSourceCaptionUrl} download={`${clipFilename}-full-source-captions.vtt`} aria-describedby="full-source-captions-note">Save full-source caption draft (VTT)</a></p>
              {fullSourceCaptionSrtUrl && <p><a className="button secondary" href={fullSourceCaptionSrtUrl} download={`${clipFilename}-full-source-captions.srt`} aria-describedby="full-source-captions-note">Save full-source caption draft (SRT)</a></p>}
              {fullSourceCaptionSpeakerSrtUrl && <p><a className="button secondary" href={fullSourceCaptionSpeakerSrtUrl} download={`${clipFilename}-full-source-captions-speakers.srt`} aria-describedby="full-source-captions-note">Save full-source caption draft (SRT, speaker names as text)</a></p>}
              {fullSourceCaptionTranscriptUrl && <p><a className="button secondary" href={fullSourceCaptionTranscriptUrl} download={`${clipFilename}-full-source-transcript.txt`} aria-describedby="full-source-captions-note">Save full-source transcript (TXT)</a>{" "}<button type="button" className="button secondary" aria-describedby="full-source-captions-note" onClick={() => void copyFullSourceTranscript()}>Copy full-source transcript</button></p>}
              {fullSourceTranscriptCopyStatus?.file === currentFullSourceCaptionFile && <p className="trim-note" role="status">{fullSourceTranscriptCopyStatus.message}</p>}
              <p id="full-source-captions-note" className="trim-note">Includes every current source cue at its original video time, even while filtering or trimming. TXT is plain Unicode text with each supplied speaker name; it does not apply the timing offset. To edit cues again, open a saved VTT or SRT with Choose captions.</p>
            </div>
          )}
          {fullSourceCaptionProblem && <p className="trim-note" role="status">{fullSourceCaptionProblem}</p>}
          {fullSourceCaptionHasSpeakers && !fullSourceCaptionSpeakerSrtText && <p className="trim-note" role="status">This draft names speakers that an SRT cannot represent exactly. Save the WebVTT to keep them.</p>}
          {(fullSourceCaptionSpeakerSrtUrl || draftSpeakerSrtUrl) && <p className="trim-note">Use WebVTT to keep editable speaker names. SRT includes them in the caption text.</p>}
          {draftCaptionHasSpeakers && !draftCaptionSpeakerSrtText && <p className="trim-note">This trim names speakers that an SRT cannot represent exactly. Save the WebVTT to keep them.</p>}
          {draftCaptionUrl && <div>
            <p><a className="button secondary" href={draftCaptionUrl} download={`${clipFilename}-draft-captions.vtt`} aria-describedby="draft-captions-note">Save draft trim captions (VTT)</a></p>
            {draftSrtUrl && <p><a className="button secondary" href={draftSrtUrl} download={`${clipFilename}-draft-captions.srt`} aria-describedby="draft-captions-note">Save draft trim captions (SRT)</a></p>}
            {draftSpeakerSrtUrl && <p><a className="button secondary" href={draftSpeakerSrtUrl} download={`${clipFilename}-draft-captions-speakers.srt`} aria-describedby="draft-captions-note">Save draft trim captions (SRT, speaker names as text)</a></p>}
            {draftCaptionTranscriptUrl && <p><a className="button secondary" href={draftCaptionTranscriptUrl} download={`${clipFilename}-draft-trim-transcript.txt`} aria-describedby="draft-captions-note">Save draft trim transcript (TXT)</a></p>}
            <p id="draft-captions-note" className="trim-note">These files use the current trim and timing offset. TXT uses trim-relative times and supplied speaker names. Finished clips keep their original caption files.</p>
          </div>}
          <label className="video-tool-check">
            <input type="checkbox" checked={showSourceCaptions} disabled={busy || checking || importing || receiptLoading || captionFileLoading} onChange={event => setShowSourceCaptions(event.currentTarget.checked)}/>
            Preview draft captions on original video
          </label>
          {showSourceCaptions && <div className="trim-fields">
            <label>Preview caption placement<select
              aria-describedby="source-caption-note"
              value={sourceCaptionPlacement}
              disabled={busy || checking || importing || receiptLoading || captionFileLoading}
              onChange={event => setSourceCaptionPlacement(event.currentTarget.value === "top" ? "top" : "default")}>
              <option value="default">Default</option>
              <option value="top">Top</option>
            </select></label>
            <label>Preview caption contrast<select
              aria-describedby="source-caption-note"
              value={sourceCaptionContrast}
              disabled={busy || checking || importing || receiptLoading || captionFileLoading}
              onChange={event => setSourceCaptionContrast(event.currentTarget.value === "contrast" ? "contrast" : "default")}>
              <option value="default">Default</option>
              <option value="contrast">High contrast</option>
            </select></label>
          </div>}
          <p id="source-caption-note" className="trim-note">The preview uses the full video and the timing offset above. Choose Top to clear the lower part of the preview, or High contrast for pale yellow captions on near-black. The cue count applies to the trimmed MP4.</p>
          {sourcePreviewNote && <p className="trim-note" role="status">{sourcePreviewNote}</p>}
        </div>}
        <div>
          <p className="trim-note"><strong>Caption draft file (JSON)</strong></p>
          <div className="video-tool-actions">
            <button type="button" className="secondary"
              disabled={!captionDraft || captionOffsetMs === null || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
              aria-busy={captionFileLoading || undefined}
              aria-describedby="caption-draft-file-note"
              onClick={() => void prepareCaptionDraftFile()}>
              Prepare caption draft (JSON)
            </button>
            <label className="trim-file">Open caption draft (JSON)<input type="file" accept="application/json,.json"
              disabled={!file || busy || checking || importing || receiptLoading || captionLoading || captionFileLoading}
              aria-describedby="caption-draft-file-note"
              onChange={event => {
                const input = event.currentTarget;
                void openCaptionDraftFile(input.files?.[0]);
                input.value = "";
              }}/></label>
          </div>
          {currentPreparedCaptionFile && <p><a className="button secondary" href={currentPreparedCaptionFile.url} download={`${clipFilename}-caption-draft.json`} aria-describedby="caption-draft-file-note">Save caption draft (JSON)</a></p>}
          <p id="caption-draft-file-note" className="trim-note">This local JSON keeps every cue at its original video time and the timing offset above, tied to this video’s SHA-256 and byte length. Open it after choosing the same original video to restore those cues and offset for further edits. Trim, frame and any finished MP4 stay out of this file.</p>
          <p role="status" aria-live="polite" className="trim-note">{captionFileMessage}</p>
        </div>
        {captionUndo && <p>
          <button ref={captionUndoButton} data-caption-undo type="button" className="secondary" disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={undoCaptionRemoval}>Undo last cue change</button>
        </p>}
        {captionRedo && <p>
          <button ref={captionRedoButton} data-caption-redo type="button" className="secondary" disabled={busy || checking || importing || receiptLoading || captionLoading || captionFileLoading} onClick={redoCaptionChange}>Redo last cue change</button>
        </p>}
        <p role="status" aria-live="polite">{captionMessage}</p>
      </details>
      <label className="video-tool-check"><input type="checkbox" checked={mute} disabled={busy || importing || receiptLoading} onChange={e => {setMute(e.target.checked);}}/> Mute original audio</label><p className="trim-note">H.264/AAC MP4 · {sizes[quality][shape][0]} × {sizes[quality][shape][1]} · {quality === "hd" ? "4 Mbps" : "1.2 Mbps"} video. HD uses more memory and may not work in every browser; try Standard if it cannot export.</p>
      {!busy ? <button type="button" disabled={importing || checking || captionLoading || receiptLoading || captionFileLoading || (captionOffsetMs === null)} aria-describedby={captionOffsetMs === null ? "caption-offset-error" : undefined} onClick={() => void makeClip()}>Make MP4</button> : <button type="button" className="secondary" onClick={() => { cancelRequested.current = true; setMessage("Cancelling export…"); void active.current?.cancel(); }}>Cancel export</button>}</>}
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
