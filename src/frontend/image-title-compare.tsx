// MIT. Browser-local title + thumbnail compare for the image workbench.
// Three manually named pairs, previewed at real feed sizes with real CSS
// truncation and a real cover crop. The same local-file rules as the rest of
// the page and the same local encode/download path. No upload, provider,
// account or server state; the only bytes that leave this tab are the ones an
// explicit download writes to disk.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_INPUT_BYTES,
  imageInputProblem,
  imagePixelProblem,
} from "./image-limits.ts";
import { inspectImage, sniffLocalImage, type ImageMetadataSummary } from "./image-metadata.ts";
import { drawSample } from "./image-sample.ts";
import { CROP_ANCHOR_LABELS, type CropAnchorKey } from "./image-ops.ts";
import {
  ALT_MAX_LENGTH,
  FEED_SIZES,
  HYPOTHESIS_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  PAIR_IDS,
  PAIR_LABELS,
  TITLE_MAX_LENGTH,
  buildPreparedReviewNotes,
  buildTitlePairManifest,
  bundleFileName,
  coverCropRect,
  describeExportAnchors,
  duplicateTargetPair,
  exportFileName,
  manifestFileName,
  MANIFEST_VERSION,
  normalizeThumbnailAlt,
  objectPositionFor,
  pairArchiveFileNames,
  pairIsEmpty,
  preferredPairForExport,
  preparedPairsBundleFileName,
  PREPARED_REVIEW_NOTES_FILE_NAME,
  type CoverRect,
  type FeedSize,
  type FeedSizeKey,
  type ManifestSourceFacts,
  type PairId,
  type PairOccupancy,
  type TitlePairManifest,
} from "./image-title-compare-plan.ts";
import {
  MAX_PACKAGING_MANIFEST_BYTES,
  readPackagingTitle,
  verifyPackagingFiles,
  type PackagingOriginalOutcome,
  type PackagingVerifyOutcome,
} from "./image-title-compare-verify.ts";
import { readTitleDraft, saveTitleDraft, titleCompareDraftName } from "./image-title-compare-draft.ts";
import { createZip, ZIP_MIME, type ZipEntryInput } from "./image-zip.ts";
import "./image-title-compare.css";

export type { FeedSizeKey } from "./image-title-compare-plan.ts";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/** One exact discrepancy, using only validated manifest facts and the PNG's
 * own measured facts. No filename, title or note is repeated here. */
function packagingDifferenceMessage(
  outcome: Extract<PackagingVerifyOutcome, { status: "different" }>,
): string {
  if (outcome.reason === "size")
    return `Different. The PNG is ${outcome.actualBytes} bytes; the manifest names ${outcome.facts.pngBytes} bytes.`;
  if (outcome.reason === "dimensions")
    return `Different. The PNG is ${outcome.actualWidth} × ${outcome.actualHeight} px; the manifest names ${outcome.facts.width} × ${outcome.facts.height} px.`;
  return "Different. The PNG's SHA-256 does not match the manifest, so these are not the bytes it describes.";
}

/** The optional original has its own concise result. Neither a match nor a
 * failure changes the verified PNG's independent recovery actions. */
function packagingOriginalMessage(outcome: PackagingOriginalOutcome): string {
  if (outcome.status === "matched") return "Original thumbnail matches the source checksum.";
  if (outcome.status === "different") return "Original thumbnail has different bytes from the file in the manifest.";
  if (outcome.status === "legacy") return "This older manifest has no original thumbnail checksum.";
  return outcome.message;
}

type PairImage = {
  file: File;
  url: string;
  fileName: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
};

type Pair = {
  title: string;
  /** Optional thumbnail alt text. Kept per pair and written only into that
   * pair's manifest; it never reaches the encoded pixels. */
  alt: string;
  /** Optional creator-written testing hypothesis for this exact title and
   * thumbnail. Kept per pair, written only into that pair's manifest, and
   * never treated as a measured result or sent to any provider. */
  hypothesis: string;
  /** Optional browser-local creator note. Written only into the manifest. */
  note: string;
  image: PairImage | null;
  error: string | null;
  busy: boolean;
};

/** A pair captured for the set export: the exact title, thumbnail alt text,
 * testing hypothesis, creator note, crop anchor and local image the run will
 * encode, taken before the first await. */
type PreparedPair = {
  id: PairId;
  title: string;
  alt: string;
  hypothesis: string;
  note: string;
  /** This pair's own crop anchor at capture time. */
  anchor: CropAnchorKey;
  image: PairImage;
};

/** A finished Image Tools result the creator can explicitly use as one pair's
 * thumbnail. The blob is the exact encoded result; the handoff only wraps it
 * in a File with its safe output name, so no canvas or provider step runs. */
export type PreparedTitleImage = {
  blob: Blob;
  /** The safe output/download name of the finished result. */
  filename: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
};

type PackagingVerifyPhase = "idle" | "checking" | "matched" | "different" | "invalid";

type ExportEntry = {
  kind: "png" | "manifest" | "bundle" | "set" | "notes";
  url: string;
  name: string;
  label: string;
  pairLabel: string;
  anchorLabel: string;
  width: number;
  height: number;
  bytes: number;
  /** Set on manifest entries: the digest of the PNG the manifest names. */
  sha256?: string;
  /** Set on a prepared-set entry: the preference captured with that snapshot. */
  preferredPairLabel?: string;
  /** Set on a PNG entry: the exact encoded blob behind its object URL. Copy
   * writes this same blob to the clipboard, so no second encode, fetch or
   * upload runs, and the download link stays available whatever the clipboard
   * decides. */
  pngBlob?: Blob;
  /** Set on a manifest entry: the exact serialized text behind its download
   * blob, captured once during the export. Copy writes this same string, so no
   * second manifest build, encode, fetch or upload runs. */
  manifestText?: string;
};

const emptyPair = (): Pair => ({ title: "", alt: "", hypothesis: "", note: "", image: null, error: null, busy: false });

/** Two deliberately fictional examples over the same local artwork. Top and
 * bottom anchors expose different parts of this taller-than-feed illustration. */
const SAMPLE_PAIRS = [
  { id: "a", title: "The Lantern Keeper — a fictional short", anchor: "top" },
  { id: "b", title: "A Map of Small Escapes — a fictional short", anchor: "bottom" },
] as const;

/** The occupancy facts the duplicate planner reads; the image itself is not
 * needed to know whether a pair is free. */
function pairOccupancy(pair: Pair, anchor: CropAnchorKey): PairOccupancy {
  return {
    title: pair.title,
    alt: pair.alt,
    hypothesis: pair.hypothesis,
    note: pair.note,
    hasImage: pair.image !== null,
    busy: pair.busy,
    anchor,
  };
}

type TitleClipState = Record<string, boolean>;

/** Title fit is a fact about the rendered box: a two-line clamp that hides
 * scrollable content. A hidden or unlaid-out box reports 0 and is not a cut. */
function measureTitleClips(section: HTMLElement): TitleClipState {
  const clipped: TitleClipState = {};
  for (const id of PAIR_IDS) {
    const figure = section.querySelector(`[data-title-compare-preview="${id}"]`);
    if (!figure) continue;
    for (const size of FEED_SIZES) {
      const title = figure.querySelector(`[data-title-compare-title="${id}-${size.key}"]`);
      if (!(title instanceof HTMLElement) || title.clientHeight === 0) continue;
      clipped[`${id}-${size.key}`] = title.scrollHeight - title.clientHeight > 1;
    }
  }
  return clipped;
}

function sameTitleClips(current: TitleClipState, next: TitleClipState): boolean {
  return PAIR_IDS.every((id) =>
    FEED_SIZES.every((size) => current[`${id}-${size.key}`] === next[`${id}-${size.key}`]),
  );
}

async function validateTitleThumbnail(file: File): Promise<Omit<PairImage, "url">> {
  const declared = imageInputProblem({ name: file.name, type: file.type, size: file.size });
  if (declared) throw new Error(declared);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffLocalImage(bytes);
  if (!sniffed.supported) throw new Error(sniffed.reason ?? "This is not a JPEG, PNG or WebP image.");
  let source: ImageMetadataSummary;
  try {
    source = inspectImage(bytes);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `This file did not read as a valid ${sniffed.format?.toUpperCase()}: ${error.message}`
        : "This file did not read as a valid image.",
    );
  }
  const pixelProblem = imagePixelProblem(source.orientedWidth, source.orientedHeight);
  if (pixelProblem) throw new Error(pixelProblem);
  // A valid header still proves nothing about pixels: probe the same
  // decoder the export path uses, then close the bitmap immediately.
  try {
    const probe = await createImageBitmap(file);
    probe.close();
  } catch {
    throw new Error(
      `This ${sniffed.format?.toUpperCase() ?? "image"} has a valid header but no decodable pixels: the decoder refused the file.`,
    );
  }
  return {
    file,
    fileName: file.name,
    mime: sniffed.mime ?? file.type,
    bytes: file.size,
    width: source.orientedWidth,
    height: source.orientedHeight,
  };
}

export function TitleCompare({
  preparedImage = null,
  sourceFile = null,
  onEditVerifiedPng,
  verifiedPngEditUnavailable = "",
}: {
  preparedImage?: PreparedTitleImage | null;
  /** The exact loaded original File, offered only when no prepared result exists. */
  sourceFile?: File | null;
  onEditVerifiedPng?: (file: File, trigger: HTMLButtonElement) => void;
  verifiedPngEditUnavailable?: string;
}) {
  const [pairs, setPairs] = useState<Pair[]>(() => PAIR_IDS.map(emptyPair));
  const [selectedId, setSelectedId] = useState<PairId>("a");
  /** The package preference is deliberately separate from the preview
   * selection: it names one complete pair for the set manifest without
   * changing which pair is being compared or exported. */
  const [preferredId, setPreferredId] = useState<PairId | null>(null);
  /** Every pair keeps its own crop anchor. The select edits the pair it names,
   * and each preview, export and manifest reads only that pair's value. Centre
   * stays the default, so untouched pairs keep the legacy manifest and PNG. */
  const [anchors, setAnchors] = useState<Record<PairId, CropAnchorKey>>(() => ({
    a: "centre",
    b: "centre",
    c: "centre",
  }));
  /** The active pair's anchor: what the select shows and the full view uses. */
  const anchor = anchors[selectedId];
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [draftSaveMessage, setDraftSaveMessage] = useState("");
  const [draftOpenMessage, setDraftOpenMessage] = useState("");
  const [draftReading, setDraftReading] = useState(false);
  const draftFile = useRef<HTMLInputElement | null>(null);
  const draftRun = useRef(0);
  const draftReadingRef = useRef(false);
  const draftChoices = useRef(0);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleMessage, setSampleMessage] = useState("");
  const sampleBusyRef = useRef(false);
  const sampleRun = useRef(0);
  const [copyMessage, setCopyMessage] = useState("");
  /** Prepared-export copy feedback belongs to one exact download: its key is
   * that export's object URL, so a replacement can never inherit an older
   * message. Both the prepared PNG and manifest-text copies use this path. */
  const [pngCopy, setPngCopy] = useState<{ key: string; message: string; ok: boolean } | null>(null);
  /** The separate packaging check. Its required PNG mode and optional original
   * checksum are browser-local, display-only, and never edit a pair, note, crop,
   * preference or prepared download. */
  const [verifyManifestFile, setVerifyManifestFile] = useState<File | null>(null);
  const [verifyPngFile, setVerifyPngFile] = useState<File | null>(null);
  const [verifyOriginalFile, setVerifyOriginalFile] = useState<File | null>(null);
  const [verifyPhase, setVerifyPhase] = useState<PackagingVerifyPhase>("idle");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyOutcome, setVerifyOutcome] = useState<PackagingVerifyOutcome | null>(null);
  /** Feedback for the one deliberate reuse action, never pair or manifest data. */
  const [verifyReuseMessage, setVerifyReuseMessage] = useState("");
  /** The last duplicate confirmation. A status message, not pair state: the
   * copied title, note, crop and URL live in the pairs themselves. */
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [titleFallback, setTitleFallback] = useState<string | null>(null);
  const [draggingPair, setDraggingPair] = useState<PairId | null>(null);
  const [titleClips, setTitleClips] = useState<TitleClipState>({});
  /** Feed size for the full-size framing inspection only. It is display state:
   * it never touches the crop anchor, the preference or any export. */
  const [fullViewSizeKey, setFullViewSizeKey] = useState<FeedSizeKey>("card");
  const sectionRef = useRef<HTMLElement | null>(null);
  const previewsRef = useRef<HTMLDivElement | null>(null);
  const urls = useRef(new Set<string>());
  const exportsRef = useRef<ExportEntry[]>([]);
  const mounted = useRef(true);
  /** One run per pair, so a slow decode cannot replace a later pick. */
  const loadRuns = useRef<number[]>(PAIR_IDS.map(() => 0));
  /** One occupancy revision per pair. The empty-only reuse path captures this
   * after marking its target busy; any later title, text, crop or image edit
   * retires that claim before the async intake can commit. */
  const pairEdits = useRef<number[]>(PAIR_IDS.map(() => 0));
  /** One run per export, so unmount or a newer encode cannot mint a stale URL. */
  const exportRun = useRef(0);
  /** One run per title copy, so a slow write cannot report a title the user has
   * already left or edited. */
  const copyRun = useRef(0);
  /** One run per prepared-export copy (PNG or manifest text). Replacing or
   * clearing the exports retires a write that started against a download that
   * is no longer prepared. */
  const pngCopyRun = useRef(0);
  /** One run per packaging check, so changing any selection or unmounting
   * retires a slow response, including a late original hash, before it can
   * report on other files. */
  const verifyRun = useRef(0);
  /** The exact Files behind a current match. Refs make selection changes and
   * stale click events refuse either recovery action synchronously, before
   * React rerenders. */
  const verifiedPngRef = useRef<File | null>(null);
  const verifiedManifestRef = useRef<File | null>(null);

  // A hash link into this section lands on a page whose heading only exists
  // after React mounts, so the browser's native fragment scroll misses it
  // (checked live: the page stays at the top with no focus). Scroll and focus
  // the heading once on mount instead, for this exact hash only.
  useEffect(() => {
    if (window.location.hash !== "#image-title-compare-heading") return;
    const heading = document.getElementById("image-title-compare-heading");
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const held = urls.current;
    return () => {
      // No blob URL may be minted after this: an in-flight decode or encode
      // checks `mounted` before it tracks its result, and the URLs this run
      // already made are revoked here even if a callback resolves later.
      mounted.current = false;
      exportRun.current += 1;
      copyRun.current += 1;
      pngCopyRun.current += 1;
      verifyRun.current += 1;
      draftRun.current += 1;
      draftReadingRef.current = false;
      sampleRun.current += 1;
      sampleBusyRef.current = false;
      verifiedPngRef.current = null;
      verifiedManifestRef.current = null;
      for (const url of held) URL.revokeObjectURL(url);
      held.clear();
      exportsRef.current = [];
    };
  }, []);

  const updateTitleClips = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    const next = measureTitleClips(section);
    setTitleClips((current) => (sameTitleClips(current, next) ? current : next));
  }, []);

  // Edits can change hidden text without changing the visible clamped height.
  useEffect(updateTitleClips, [pairs, updateTitleClips]);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateTitleClips);
    section.querySelectorAll("[data-title-compare-title]").forEach((element) => resize?.observe(element));
    if (!resize) window.addEventListener("resize", updateTitleClips);
    document.fonts?.addEventListener("loadingdone", updateTitleClips);
    return () => {
      resize?.disconnect();
      if (!resize) window.removeEventListener("resize", updateTitleClips);
      document.fonts?.removeEventListener("loadingdone", updateTitleClips);
    };
  }, [updateTitleClips]);

  function trackUrl(source: Blob): string {
    const url = URL.createObjectURL(source);
    urls.current.add(url);
    return url;
  }

  function releaseUrl(url: string | undefined): void {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
  }

  function setPair(index: number, patch: Partial<Pair>): void {
    pairEdits.current[index] += 1;
    setPairs((current) => current.map((pair, at) => (at === index ? { ...pair, ...patch } : pair)));
  }

  /** A preferred pair must be complete: a non-empty title and a valid local
   * thumbnail that is not mid-replacement. */
  function completePair(pair: Pair): boolean {
    return !pair.busy && pair.image !== null && pair.title.trim() !== "";
  }

  /** Clear only the preference at this index, checked at update time so a slow
   * decode cannot remove a preference the user has since moved elsewhere. */
  function clearPreferenceFor(index: number): void {
    setPreferredId((current) =>
      current !== null && PAIR_IDS.indexOf(current) === index ? null : current,
    );
  }

  function togglePreference(id: PairId): void {
    if (preferredId === id) {
      draftChoices.current += 1;
      setPreferredId(null);
      return;
    }
    if (!completePair(pairs[PAIR_IDS.indexOf(id)])) return;
    draftChoices.current += 1;
    setPreferredId(id);
  }

  /** The snapshot a set export may bundle: a real title and a local thumbnail
   * that is not mid-replacement, with the exact pair id and image object the
   * run captures before its first await. */
  function readyPairs(): PreparedPair[] {
    return PAIR_IDS.flatMap((id, index) => {
      const pair = pairs[index];
      if (pair.busy || !pair.image || pair.title.trim() === "") return [];
      return [{ id, title: pair.title, note: pair.note, anchor: anchors[id], image: pair.image, alt: pair.alt, hypothesis: pair.hypothesis }];
    });
  }

  /** A copy result belongs to the selection it was made for. Selecting another
   * pair or editing its title retires both the message and any recovery field. */
  function clearCopyFeedback(): void {
    copyRun.current += 1;
    setCopyMessage("");
    setTitleFallback(null);
  }

  function selectPair(id: PairId): void {
    if (id === selectedId) return;
    draftChoices.current += 1;
    clearCopyFeedback();
    setSelectedId(id);
  }

  function updateTitle(index: number, title: string): void {
    if (pairs[index]?.title === title) return;
    if (index === PAIR_IDS.indexOf(selectedId)) clearCopyFeedback();
    setPair(index, { title });
    clearPreferenceFor(index);
    retirePreparedOutput();
  }

  /** Alt text describes the thumbnail, not the crop or the encoded pixels. An
   * edit therefore leaves this pair's image, anchor, title, note and human
   * preference alone. Prepared JSON/ZIP files and any in-flight encode were
   * built from the previous text, so this retires them through the existing
   * export state rather than letting them look current. */
  function updateAlt(index: number, next: string): void {
    if (pairs[index]?.alt === next) return;
    setPair(index, { alt: next });
    retirePreparedOutput();
  }

  /** A testing hypothesis is one pair's own written expectation. Editing or
   * clearing it leaves this pair's image, anchor, title, alt text, note and
   * human preference alone, but any prepared JSON/ZIP was built from the old
   * text, so the same export-retiring rule an alt edit uses applies here. */
  function updateHypothesis(index: number, next: string): void {
    if (pairs[index]?.hypothesis === next) return;
    setPair(index, { hypothesis: next });
    retirePreparedOutput();
  }

  /** A crop change is a material edit for that pair only. It writes that
   * pair's anchor and retires that pair's packaging preference through the
   * same rule a title or thumbnail edit uses; other pairs are untouched. */
  function updateAnchor(index: number, next: CropAnchorKey): void {
    const id = PAIR_IDS[index];
    if (anchors[id] === next) return;
    pairEdits.current[index] += 1;
    setAnchors((current) => ({ ...current, [id]: next }));
    clearPreferenceFor(index);
  }

  /** Replace the export list outside the state updater: revoking URLs inside
   * `setExports` would make the updater impure and can run more than once. */
  function replaceExports(next: ExportEntry[]): void {
    const previous = exportsRef.current;
    exportsRef.current = next;
    // A new or cleared export list retires feedback for an older PNG; a pending
    // clipboard write checks this run before it reports anything at all.
    pngCopyRun.current += 1;
    setPngCopy(null);
    setExports(next);
    for (const entry of previous) releaseUrl(entry.url);
  }

  function discardExports(): void {
    replaceExports([]);
  }

  /** Retire prepared downloads and any encode still running for the text they
   * captured. The export run guard makes a pending encode return before it
   * publishes; clearing the busy flag here is the step that abandoned run no
   * longer performs for itself. */
  function retirePreparedOutput(): void {
    exportRun.current += 1;
    setExportBusy(false);
    setExportMessage("");
    discardExports();
  }

  /** Intake follows the workbench's addFiles sequence: declared facts, byte
   * sniff, header inspect, pixel limits, then a real decoder probe. */
  async function chooseImage(
    index: number,
    file: File | undefined,
    options: { emptyRevision?: number; canCommit?: () => boolean; title?: string } = {},
  ): Promise<boolean> {
    if (!file) return false;
    // A stale empty-pair click must not even mark a now-occupied pair busy.
    if (options.emptyRevision !== undefined && pairEdits.current[index] !== options.emptyRevision)
      return false;
    // A second pick, a drop or Remove for this pair makes this run stale: a
    // slower decode must never overwrite the image the user chose last.
    const run = ++loadRuns.current[index];
    const current = () => mounted.current && loadRuns.current[index] === run;
    setPair(index, { error: null, busy: true });
    const revision = pairEdits.current[index];
    const unchanged = () =>
      options.emptyRevision === undefined || pairEdits.current[index] === revision;
    const accepted = () => unchanged() && (options.canCommit?.() ?? true);
    const fail = (reason: string) => {
      if (!current()) return;
      // Preserve any edit made while this empty-only intake was validating.
      setPair(index, unchanged() ? { error: reason, busy: false } : { busy: false });
    };
    try {
      const image = await validateTitleThumbnail(file);
      if (!current()) return false;
      // Reuse is an empty-only claim, and its verification must still name this
      // exact File. Neither a pair edit nor a new source event may be overwritten.
      if (!accepted()) {
        setPair(index, { busy: false });
        return false;
      }
      // A new thumbnail needs its own preference decision.
      clearPreferenceFor(index);
      retirePreparedOutput();
      const previous = pairs[index].image;
      releaseUrl(previous?.url);
      const url = trackUrl(file);
      setPair(index, {
        // Only an explicit verified restore supplies a title, committed in the
        // same accepted patch as the processed image. React renders it as text.
        ...(options.title !== undefined ? { title: options.title } : {}),
        // An alt description and a hypothesis belong to the exact thumbnail
        // they were written for. Replacing that media clears both, while the
        // pair's title, creator note and crop stay as the creator left them.
        ...(previous ? { alt: "", hypothesis: "" } : {}),
        image: { ...image, url },
        error: null,
        busy: false,
      });
      return true;
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not read this image.");
      return false;
    }
  }

  function downloadEditableDraft(): void {
    if (draftReading || pairs.some(pair => pair.busy)) return;
    const file = saveTitleDraft({
      selectedId,
      preferredId,
      pairs: pairs.map(({ title, alt, hypothesis, note, image }, index) => ({
        title, alt, hypothesis, note, anchor: anchors[PAIR_IDS[index]], file: image?.file ?? null,
      })),
    });
    const url = trackUrl(file);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = titleCompareDraftName;
      link.click();
      setDraftSaveMessage("Draft download started. Keep the file to reopen your pairs.");
    } finally {
      setTimeout(() => releaseUrl(url), 1000);
    }
  }

  async function openEditableDraft(file: File): Promise<void> {
    if (pairs.some(pair => pair.busy)) return;
    const run = ++draftRun.current;
    const revisions = [...pairEdits.current];
    const choices = draftChoices.current;
    const current = () => mounted.current && draftRun.current === run;
    const edited = () => draftChoices.current !== choices
      || revisions.some((revision, index) => pairEdits.current[index] !== revision);
    const stillApplicable = () => {
      if (!current()) return false;
      if (!edited()) return true;
      setDraftOpenMessage("Your newer edits were kept. Open the draft again if you want to replace them.");
      return false;
    };
    setDraftReading(true);
    draftReadingRef.current = true;
    setDraftOpenMessage("Reading the draft on this device…");
    try {
      const draft = await readTitleDraft(file);
      if (!stillApplicable()) return;
      if (!draft) throw new Error("This file is not a supported Studio editable draft.");
      const images: (Omit<PairImage, "url"> | null)[] = [];
      for (const pair of draft.pairs) {
        images.push(pair.file ? await validateTitleThumbnail(pair.file) : null);
        if (!stillApplicable()) return;
      }
      const occupied = pairs.some((pair, index) => pair.image || pair.title || pair.alt
        || pair.hypothesis || pair.note || anchors[PAIR_IDS[index]] !== "centre");
      if (occupied && !window.confirm("Replace the current three pairs with this draft?")) {
        setDraftOpenMessage("Draft opening canceled. Your current pairs are still here.");
        return;
      }

      const next: Pair[] = [];
      const nextAnchors = { ...anchors };
      try {
        for (const [index, pair] of draft.pairs.entries()) {
          const { title, alt, hypothesis, note, anchor } = pair;
          const image = images[index];
          nextAnchors[PAIR_IDS[index]] = anchor;
          next.push({
            title, alt, hypothesis, note,
            image: image ? { ...image, url: trackUrl(image.file) } : null,
            error: null, busy: false,
          });
        }
      } catch (error) {
        for (const pair of next) releaseUrl(pair.image?.url);
        throw error;
      }

      for (const index of PAIR_IDS.keys()) pairEdits.current[index] += 1;
      clearCopyFeedback();
      retirePreparedOutput();
      for (const pair of pairs) releaseUrl(pair.image?.url);
      setPairs(next);
      setAnchors(nextAnchors);
      setSelectedId(draft.selectedId);
      setPreferredId(draft.preferredId);
      setDuplicateMessage("");
      setDraftOpenMessage("Editable draft opened. All three pairs are available.");
    } catch (error) {
      if (stillApplicable()) setDraftOpenMessage(error instanceof Error ? error.message : "Could not read the draft.");
    } finally {
      if (current()) {
        draftReadingRef.current = false;
        setDraftReading(false);
      }
    }
  }

  /** Fill only the two empty example targets. The shared artwork is encoded and
   * decoded once, then each pair receives the same validated File under its own
   * tracked object URL. Any pair edit or draft import retires the pending claim. */
  async function trySamplePairs(): Promise<void> {
    if (sampleBusyRef.current || draftReadingRef.current) return;
    if (!SAMPLE_PAIRS.every(({ id }) => pairIsEmpty(pairOccupancy(pairs[PAIR_IDS.indexOf(id)], anchors[id]))))
      return;

    sampleBusyRef.current = true;
    const run = ++sampleRun.current;
    const revisions = [...pairEdits.current];
    const draftAttempt = draftRun.current;
    const current = () => mounted.current && sampleRun.current === run;
    const unchanged = () =>
      draftRun.current === draftAttempt &&
      !draftReadingRef.current &&
      revisions.every((revision, index) => pairEdits.current[index] === revision);
    setSampleBusy(true);
    setSampleMessage("Making sample pairs on this device…");
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    try {
      drawSample(canvas);
      const blob = await canvasToBlob(canvas, "image/png");
      if (!current()) return;
      const file = new File([blob], "studio-title-compare-sample.png", { type: "image/png" });
      const image = await validateTitleThumbnail(file);
      if (!current()) return;
      if (
        !unchanged() ||
        !SAMPLE_PAIRS.every(({ id }) => pairIsEmpty(pairOccupancy(pairs[PAIR_IDS.indexOf(id)], anchors[id])))
      ) {
        setSampleMessage("Your newer edits were kept. Try sample pairs again when Pairs A and B are empty.");
        return;
      }

      const firstUrl = trackUrl(file);
      const secondUrl = trackUrl(file);
      setPairs((current) =>
        current.map((pair, index) => {
          if (index === 0)
            return { ...pair, title: SAMPLE_PAIRS[0].title, image: { ...image, url: firstUrl }, error: null, busy: false };
          if (index === 1)
            return { ...pair, title: SAMPLE_PAIRS[1].title, image: { ...image, url: secondUrl }, error: null, busy: false };
          return pair;
        }),
      );
      pairEdits.current[0] += 1;
      pairEdits.current[1] += 1;
      setAnchors((current) => ({ ...current, a: SAMPLE_PAIRS[0].anchor, b: SAMPLE_PAIRS[1].anchor }));
      setSampleMessage("Sample pairs are ready. Edit either title or crop.");
    } catch {
      if (current())
        setSampleMessage("Could not prepare the sample pairs. Try again.");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (current()) {
        sampleBusyRef.current = false;
        setSampleBusy(false);
      }
    }
  }

  /** Use the finished Image Tools result as this pair's thumbnail through the
   * same intake a picked file uses: declared facts, byte sniff, header
   * inspect, pixel limits, decoder probe, run guard and URL ownership all stay
   * in chooseImage. The File carries the exact blob bytes and its safe output
   * name; nothing here re-encodes, uploads or saves. */
  function usePreparedImage(index: number): void {
    if (!preparedImage || preparedImage.bytes > MAX_IMAGE_INPUT_BYTES) return;
    const file = new File([preparedImage.blob], preparedImage.filename, {
      type: preparedImage.mime || preparedImage.blob.type,
    });
    void chooseImage(index, file);
  }

  /** Reuse the exact loaded original through the same validator and run guard;
   * a prepared result always wins over this fallback offer. */
  function useSourceImage(index: number): void {
    if (preparedImage || !sourceFile) return;
    void chooseImage(index, sourceFile);
  }

  function removeImage(index: number): void {
    // Removing is also a newer choice for this pair: any decode still in
    // flight for it must not put an image back.
    loadRuns.current[index] += 1;
    clearPreferenceFor(index);
    retirePreparedOutput();
    releaseUrl(pairs[index].image?.url);
    setPair(index, { image: null, alt: "", hypothesis: "", error: null, busy: false });
  }

  /** Copy the selected complete pair into the first empty pair, then select
   * it. The source keeps its title, note, preference, thumbnail and crop. The
   * copy carries the same validated File bytes under its own object URL, the
   * same crop anchor, title, alt text and testing hypothesis — the expectation
   * still describes the same combination — but starts with an empty note. The
   * target must be empty at click time, so a named, imaged, noted, hypothesised
   * or pending pair is never overwritten. */
  function duplicateSelectedPair(): void {
    const source = pairs[PAIR_IDS.indexOf(selectedId)];
    if (!source || !completePair(source)) return;
    const sourceImage = source.image;
    if (!sourceImage) return;
    const sourceAnchor = anchors[selectedId];
    const target = duplicateTarget;
    if (!target) return;
    const targetIndex = PAIR_IDS.indexOf(target);
    // A fresh URL over the same immutable File bytes gives each pair its own
    // URL, so removing or replacing either pair revokes only that pair's
    // thumbnail and never the other's.
    const url = trackUrl(sourceImage.file);
    setPairs((current) =>
      current.map((pair, at) =>
        at === targetIndex
          ? {
              title: source.title,
              alt: source.alt,
              hypothesis: source.hypothesis,
              note: "",
              image: { ...sourceImage, url },
              error: null,
              busy: false,
            }
          : pair,
      ),
    );
    pairEdits.current[targetIndex] += 1;
    setAnchors((current) => ({ ...current, [target]: sourceAnchor }));
    clearCopyFeedback();
    setSelectedId(target);
    setDuplicateMessage(
      `Duplicated Pair ${PAIR_LABELS[selectedId]} into Pair ${PAIR_LABELS[target]}. Pair ${PAIR_LABELS[target]} is selected; its note starts empty.`,
    );
  }

  /** The selected pair's thumbnail, baked to one feed size as PNG by the same
   * canvas encode the workbench results use. The title stays text. The pair,
   * anchor and image are captured at the start, so output stays labelled with
   * what was actually exported even if the user switches while it runs. */
  async function exportSelectedPair(size: FeedSize): Promise<void> {
    const index = PAIR_IDS.indexOf(selectedId);
    const pair = pairs[index];
    const image = pair.image;
    if (!image) return;
    const run = ++exportRun.current;
    const forPair = selectedId;
    const forAnchor = anchors[forPair];
    const title = pair.title;
    const current = () => mounted.current && exportRun.current === run;
    setExportBusy(true);
    setExportMessage("");
    try {
      const { blob, pngBytes } = await encodeCropPng(image, size, forAnchor);
      // Unmounted or superseded: do not create a blob URL or publish a result.
      if (!current()) return;
      const name = exportFileName(title || image.fileName, image.fileName, size);
      replaceExports([
        {
          kind: "png",
          url: trackUrl(blob),
          name,
          label: size.label,
          pairLabel: PAIR_LABELS[forPair],
          anchorLabel: CROP_ANCHOR_LABELS[forAnchor],
          width: size.width,
          height: size.height,
          bytes: blob.size,
          pngBlob: blob,
        },
      ]);
      setExportMessage(
        `${size.label === "row" ? "Row" : "Card"} export ready for Pair ${PAIR_LABELS[forPair]} · ${CROP_ANCHOR_LABELS[forAnchor].toLowerCase()} crop: ${formatBytes(blob.size)} of real PNG.`,
      );
    } catch (error) {
      if (current()) setExportMessage(error instanceof Error ? error.message : "The export could not be prepared.");
    } finally {
      if (current()) setExportBusy(false);
    }
  }

  /** The selected pair as a versioned JSON manifest naming the exact cropped
   * PNG this same run encodes — its file name, pixel size and SHA-256 — plus
   * the exact title, the crop plan and (when present) the creator note,
   * thumbnail alt text and testing hypothesis. The manifest is built from the
   * bytes the encode produced, so the hash always describes the PNG it ships
   * with. Title, note, alt text and hypothesis are captured with the pair
   * before the first await, so a later edit cannot change this prepared file.
   * No work, rights or performance value is claimed: the manifest carries only
   * what this tab actually captured. */
  async function exportSelectedPairManifest(size: FeedSize): Promise<void> {
    const index = PAIR_IDS.indexOf(selectedId);
    const pair = pairs[index];
    const image = pair.image;
    if (!image) return;
    const run = ++exportRun.current;
    const forPair = selectedId;
    const forAnchor = anchors[forPair];
    const title = pair.title;
    const note = pair.note;
    const alt = pair.alt;
    const hypothesis = pair.hypothesis;
    const current = () => mounted.current && exportRun.current === run;
    setExportBusy(true);
    setExportMessage("");
    try {
      const { rect, blob, pngBytes } = await encodeCropPng(image, size, forAnchor);
      // Unmounted or superseded: do not hash, let alone publish.
      if (!current()) return;
      const name = exportFileName(title || image.fileName, image.fileName, size);
      const sha256 = await sha256Hex(pngBytes);
      if (!current()) return;
      const sourceFacts = await manifestSourceFacts(image);
      if (!current()) return;
      const manifest = buildTitlePairManifest({
        generatedAt: new Date().toISOString(),
        pairId: forPair,
        title,
        note,
        source: sourceFacts,
        anchor: forAnchor,
        size,
        sourceRect: rect,
        png: { fileName: name, bytes: blob.size, sha256 },
        alt,
        hypothesis,
      });
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      const manifestBlob = new Blob([manifestText], {
        type: "application/json",
      });
      // The hash may have taken a moment; a superseded run mints no URL.
      if (!current()) return;
      const manifestName = manifestFileName(title || image.fileName, image.fileName, size);
      // The package reuses the exact bytes this run already made: no second
      // PNG encode, and the same JSON text the individual download serves, so
      // the archive matches the manifest's own digest.
      const bundle = createZip([
        { name, data: pngBytes },
        { name: manifestName, data: manifestText },
      ]);
      const entries: ExportEntry[] = [
        {
          kind: "png",
          url: trackUrl(blob),
          name,
          label: size.label,
          pairLabel: PAIR_LABELS[forPair],
          anchorLabel: CROP_ANCHOR_LABELS[forAnchor],
          width: size.width,
          height: size.height,
          bytes: blob.size,
          pngBlob: blob,
        },
        {
          kind: "manifest",
          url: trackUrl(manifestBlob),
          name: manifestName,
          label: `${size.label} manifest`,
          pairLabel: PAIR_LABELS[forPair],
          anchorLabel: CROP_ANCHOR_LABELS[forAnchor],
          width: size.width,
          height: size.height,
          bytes: manifestBlob.size,
          sha256,
          manifestText,
        },
      ];
      if (bundle.ok) {
        const bundleBlob = new Blob([bundle.bytes.buffer as ArrayBuffer], { type: ZIP_MIME });
        entries.push({
          kind: "bundle",
          url: trackUrl(bundleBlob),
          name: bundleFileName(title || image.fileName, image.fileName, size),
          label: "pair package",
          pairLabel: PAIR_LABELS[forPair],
          anchorLabel: CROP_ANCHOR_LABELS[forAnchor],
          width: size.width,
          height: size.height,
          bytes: bundleBlob.size,
        });
      }
      replaceExports(entries);
      setExportMessage(
        `${bundle.ok ? "Manifest and package ready" : "Manifest ready"} for Pair ${PAIR_LABELS[forPair]} · ${CROP_ANCHOR_LABELS[forAnchor].toLowerCase()} crop: the JSON names ${name} at ${size.width} × ${size.height} px, SHA-256 ${sha256.slice(0, 16)}… (full digest inside the JSON).${bundle.ok ? " The ZIP carries that PNG and JSON unchanged." : ""}`,
      );
    } catch (error) {
      if (current()) setExportMessage(error instanceof Error ? error.message : "The export could not be prepared.");
    } finally {
      if (current()) setExportBusy(false);
    }
  }

  /** Every titled pair with a local thumbnail — at least two, at most the
   * three this section holds — in one flat ZIP. The titles, thumbnail alt
   * text, testing hypotheses, creator notes, image facts and each pair's own
   * crop anchor are captured before the first encode, so a later edit cannot
   * relabel the package. Each pair reuses the single-pair card encode, manifest
   * builder, SHA-256 and store-only ZIP writer; its prefixed entry names keep
   * same-title pairs distinct, and each manifest names and hashes the exact
   * PNG bytes the archive stores, carries that pair's own anchor and only that
   * pair's note, alt text and hypothesis. The preference is captured with the
   * same snapshot and written only if that pair is actually in this archive. */
  async function exportPreparedPairs(): Promise<void> {
    const size = FEED_SIZES[1];
    const forPreferred = preferredId;
    const generatedAt = new Date().toISOString();
    const captured = readyPairs();
    if (captured.length < 2) return;
    const setAnchorLabel = describeExportAnchors(captured.map((pair) => pair.anchor));
    const preferredForExport = preferredPairForExport(
      forPreferred,
      captured.map((pair) => pair.id),
    );
    const run = ++exportRun.current;
    const current = () => mounted.current && exportRun.current === run;
    setExportBusy(true);
    setExportMessage("");
    try {
      const zipEntries: ZipEntryInput[] = [];
      const manifests: TitlePairManifest[] = [];
      const pairLabels: string[] = [];
      for (const prepared of captured) {
        const image = prepared.image;
        const forAnchor = prepared.anchor;
        const { rect, pngBytes } = await encodeCropPng(image, size, forAnchor);
        // Unmounted or superseded: no hash, no ZIP and no URL.
        if (!current()) return;
        const sha256 = await sha256Hex(pngBytes);
        if (!current()) return;
        const sourceFacts = await manifestSourceFacts(image);
        if (!current()) return;
        const names = pairArchiveFileNames(prepared.id, size);
        const manifest = buildTitlePairManifest({
          generatedAt,
          pairId: prepared.id,
          title: prepared.title,
          note: prepared.note,
          source: sourceFacts,
          anchor: forAnchor,
          size,
          sourceRect: rect,
          // The name and digest describe the exact PNG bytes added below.
          png: { fileName: names.png, bytes: pngBytes.byteLength, sha256 },
          preferredPairId: preferredForExport,
          alt: prepared.alt,
          hypothesis: prepared.hypothesis,
        });
        manifests.push(manifest);
        zipEntries.push(
          { name: names.png, data: pngBytes },
          { name: names.manifest, data: `${JSON.stringify(manifest, null, 2)}\n` },
        );
        pairLabels.push(PAIR_LABELS[prepared.id]);
      }
      if (!current()) return;
      const bundle = createZip(zipEntries);
      if (!bundle.ok) throw new Error(bundle.error);
      // A renamed entry would leave its manifest naming a file the ZIP does
      // not carry. The pair prefixes prevent that; fail loudly if it happens.
      const expectedNames = zipEntries.map((entry) => entry.name);
      if (
        bundle.entries.length !== expectedNames.length ||
        expectedNames.some((name, index) => bundle.entries[index] !== name)
      )
        throw new Error("The archive renamed a pair file, so its manifest could not name the exact PNG.");
      if (!current()) return;
      const bundleBlob = new Blob([bundle.bytes.buffer as ArrayBuffer], { type: ZIP_MIME });
      const name = preparedPairsBundleFileName(size, captured.length);
      // The feedback sheet reads the exact manifests finalized above, so it
      // stays beside the ZIP without a second encode, fetch or mutable read.
      const notesText = buildPreparedReviewNotes(manifests);
      const notesBlob = new Blob([notesText], { type: "text/plain;charset=utf-8" });
      replaceExports([
        {
          kind: "set",
          url: trackUrl(bundleBlob),
          name,
          label: `${captured.length} pairs, ${zipEntries.length} files`,
          pairLabel: pairLabels.join(", "),
          anchorLabel: setAnchorLabel,
          width: size.width,
          height: size.height,
          bytes: bundleBlob.size,
          ...(preferredForExport ? { preferredPairLabel: PAIR_LABELS[preferredForExport] } : {}),
        },
        {
          kind: "notes",
          url: trackUrl(notesBlob),
          name: PREPARED_REVIEW_NOTES_FILE_NAME,
          label: "review notes",
          pairLabel: pairLabels.join(", "),
          anchorLabel: setAnchorLabel,
          width: size.width,
          height: size.height,
          bytes: notesBlob.size,
        },
      ]);
      setExportMessage(`ZIP and review notes ready for pairs ${pairLabels.join(", ")}.`);
    } catch (error) {
      if (current())
        setExportMessage(
          error instanceof Error ? error.message : "The prepared pairs package could not be prepared.",
        );
    } finally {
      if (current()) setExportBusy(false);
    }
  }

  /** The selected pair's title as plain text, through the browser Clipboard.
   * The pair and title are captured for the same reason the export captures
   * them: a slow write must not report a title the user has already left. */
  async function copySelectedTitle(): Promise<void> {
    const forPair = selectedId;
    const title = pairs[PAIR_IDS.indexOf(forPair)].title;
    if (!title.trim()) return;
    const label = `Pair ${PAIR_LABELS[forPair]}`;
    const run = ++copyRun.current;
    const current = () => mounted.current && copyRun.current === run;
    try {
      await navigator.clipboard.writeText(title);
      if (!current()) return;
      setTitleFallback(null);
      setCopyMessage(`Copied the ${label} title to the clipboard.`);
    } catch {
      if (!current()) return;
      setTitleFallback(title);
      setCopyMessage(
        `Could not copy the ${label} title automatically. Select the title in the field below and copy it.`,
      );
    }
  }

  const canCopyPng =
    typeof window !== "undefined" &&
    typeof window.ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function";
  const canCopyManifest =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function";

  /** One copy result belongs to one exact prepared download, PNG or manifest
   * text. The run retires when the export list changes, and the URL key keeps a
   * stale write from posting its message onto a different prepared download. */
  function copyAttemptFor(key: string) {
    const attempt = ++pngCopyRun.current;
    const stillCurrent = () =>
      mounted.current &&
      attempt === pngCopyRun.current &&
      exportsRef.current.some((entry) => entry.url === key);
    const report = (message: string, ok: boolean) => {
      if (stillCurrent()) setPngCopy({ key, message, ok });
    };
    return { report };
  }

  /** The exact encoded PNG behind this download goes to the clipboard: the
   * same blob the object URL was minted from, so no encode, fetch or upload
   * runs here. A denied permission or missing ClipboardItem changes only the
   * status — the download link beside it stays exactly as it was. */
  async function copyEntryPng(entry: ExportEntry): Promise<void> {
    if (entry.kind !== "png" || !entry.pngBlob || !canCopyPng) return;
    const { report } = copyAttemptFor(entry.url);
    try {
      const png = new window.ClipboardItem({ "image/png": entry.pngBlob });
      await navigator.clipboard.write([png]);
      report("PNG copied.", true);
    } catch {
      report("Could not copy the PNG. Download it instead.", false);
    }
  }

  /** The exact JSON text behind this manifest download goes to the clipboard.
   * The string was captured once for the download blob, so no second manifest
   * build, encode, fetch or upload runs. The same stale guard used by the PNG
   * copy retires a write once its prepared download is replaced or cleared; a
   * denied permission changes only the status, leaving the download intact. */
  async function copyEntryManifest(entry: ExportEntry): Promise<void> {
    if (entry.kind !== "manifest" || !entry.manifestText || !canCopyManifest) return;
    const { report } = copyAttemptFor(entry.url);
    try {
      await navigator.clipboard.writeText(entry.manifestText);
      report(`Manifest JSON copied for Pair ${entry.pairLabel}.`, true);
    } catch {
      report(`Could not copy the manifest JSON for Pair ${entry.pairLabel}. Download it instead.`, false);
    }
  }

  /** Any new selection retires an in-flight check and any result that
   * described the files selected before it. */
  function clearVerify(): void {
    verifyRun.current += 1;
    verifiedPngRef.current = null;
    verifiedManifestRef.current = null;
    setVerifyPhase("idle");
    setVerifyMessage("");
    setVerifyOutcome(null);
    setVerifyReuseMessage("");
  }

  /** The explicit check reads the required files and, only after a PNG match,
   * the optional original. A response is published only when it still belongs
   * to all current selections and this tab; the verifyRun guard also retires a
   * late original hash before it can replace a newer check. Nothing reaches
   * pair, crop, note, preference or export state. */
  async function checkPackagingPair(): Promise<void> {
    const manifestFile = verifyManifestFile;
    const pngFile = verifyPngFile;
    const originalFile = verifyOriginalFile;
    if (!manifestFile || !pngFile) {
      clearVerify();
      setVerifyPhase("invalid");
      setVerifyMessage("Choose the packaging manifest JSON and the exported PNG before verifying.");
      return;
    }
    const attempt = ++verifyRun.current;
    const current = () => mounted.current && verifyRun.current === attempt;
    // A new check retires reuse immediately, even before its first await.
    verifiedPngRef.current = null;
    verifiedManifestRef.current = null;
    setVerifyReuseMessage("");
    setVerifyPhase("checking");
    setVerifyMessage("Checking the selected manifest and PNG on this device…");
    setVerifyOutcome(null);
    try {
      const outcome = await (originalFile
        ? verifyPackagingFiles(manifestFile, pngFile, originalFile)
        : verifyPackagingFiles(manifestFile, pngFile));
      if (!current()) return;
      setVerifyOutcome(outcome);
      if (outcome.status === "matched") {
        verifiedPngRef.current = pngFile;
        verifiedManifestRef.current = manifestFile;
        setVerifyPhase("matched");
        setVerifyMessage("Matched. The PNG's type, byte size, dimensions and SHA-256 agree with the manifest.");
      } else if (outcome.status === "invalid") {
        setVerifyPhase("invalid");
        setVerifyMessage(outcome.message);
      } else {
        setVerifyPhase("different");
        setVerifyMessage(packagingDifferenceMessage(outcome));
      }
    } catch {
      if (!current()) return;
      verifiedPngRef.current = null;
      verifiedManifestRef.current = null;
      setVerifyOutcome(null);
      setVerifyPhase("invalid");
      setVerifyMessage("The selected files could not be checked.");
    }
  }

  /** The one reuse action passes the exact currently verified File through the
   * normal local intake. It claims only a completely empty, nonbusy pair, then
   * selects that pair. No manifest text, description, crop or preference moves. */
  async function reuseVerifiedPng(target: PairId, emptyRevision: number): Promise<void> {
    const file = verifiedPngRef.current;
    const attempt = verifyRun.current;
    if (verifyPhase !== "matched" || verifyOutcome?.status !== "matched" || !file || file !== verifyPngFile)
      return;
    const targetIndex = PAIR_IDS.indexOf(target);
    if (
      pairEdits.current[targetIndex] !== emptyRevision ||
      !pairIsEmpty(pairOccupancy(pairs[targetIndex], anchors[target]))
    )
      return;
    selectPair(target);
    setVerifyReuseMessage(`Adding the verified PNG to Pair ${PAIR_LABELS[target]}…`);
    const used = await chooseImage(targetIndex, file, {
      emptyRevision,
      canCommit: () => verifyRun.current === attempt && verifiedPngRef.current === file,
    });
    if (!mounted.current || verifyRun.current !== attempt || verifiedPngRef.current !== file) return;
    setVerifyReuseMessage(used
      ? `Added the verified PNG to Pair ${PAIR_LABELS[target]}.`
      : `Pair ${PAIR_LABELS[target]} changed. Choose an empty pair and try again.`);
  }

  /** The distinct recovery action reads the same currently matched, bounded
   * manifest only after its exact PNG matched and an empty pair was identified.
   * The validated title reaches the pair in chooseImage's one accepted patch;
   * no old crop, creator note, alt text, hypothesis or preference is imported. */
  async function restoreVerifiedTitleAndPng(target: PairId, emptyRevision: number): Promise<void> {
    const file = verifiedPngRef.current;
    const manifestFile = verifiedManifestRef.current;
    const attempt = verifyRun.current;
    if (
      verifyPhase !== "matched" ||
      verifyOutcome?.status !== "matched" ||
      !file ||
      file !== verifyPngFile ||
      !manifestFile ||
      manifestFile !== verifyManifestFile
    )
      return;
    const targetIndex = PAIR_IDS.indexOf(target);
    if (
      pairEdits.current[targetIndex] !== emptyRevision ||
      !pairIsEmpty(pairOccupancy(pairs[targetIndex], anchors[target]))
    )
      return;
    const current = () =>
      mounted.current &&
      verifyRun.current === attempt &&
      verifiedPngRef.current === file &&
      verifiedManifestRef.current === manifestFile;
    setVerifyReuseMessage(`Restoring the verified title and PNG to Pair ${PAIR_LABELS[target]}…`);
    let title: string;
    try {
      title = await readPackagingTitle(manifestFile);
    } catch (error) {
      if (!current()) return;
      setVerifyReuseMessage(
        error instanceof Error ? error.message : "Choose a readable packaging manifest.",
      );
      return;
    }
    if (!current()) return;
    if (pairEdits.current[targetIndex] === emptyRevision) selectPair(target);
    const used = await chooseImage(targetIndex, file, {
      emptyRevision,
      title,
      canCommit: current,
    });
    if (!current()) return;
    setVerifyReuseMessage(used
      ? `Restored the title and verified PNG to Pair ${PAIR_LABELS[target]}. You can edit the title.`
      : `Pair ${PAIR_LABELS[target]} changed. Choose an empty pair and try again.`);
  }

  /** The explicit handoff re-checks the current match at dispatch and passes
   * that exact File unchanged. Once the creator clicks, the chosen file is
   * allowed to finish opening like a native file picker; a later verification
   * change neither swaps nor implicitly adds a file. */
  function editVerifiedPngInImageTools(trigger: HTMLButtonElement): void {
    const file = verifiedPngRef.current;
    if (
      verifyPhase !== "matched" ||
      verifyOutcome?.status !== "matched" ||
      !file ||
      file !== verifyPngFile ||
      verifiedPngEditUnavailable
    )
      return;
    onEditVerifiedPng?.(file, trigger);
  }

  const selectedIndex = PAIR_IDS.indexOf(selectedId);
  const selected = pairs[selectedIndex];
  const selectedLabel = `Pair ${PAIR_LABELS[selectedId]}`;
  /** The supplied description when it normalises to text, so the full-size
   * source image keeps its useful labelled fallback when the field is blank. */
  const selectedAlt = normalizeThumbnailAlt(selected.alt);
  // The duplicate action names the exact empty pair it would create. It stays
  // inactive — with visible copy saying why — when the source is incomplete or
  // every other pair holds work.
  const duplicateTarget = duplicateTargetPair(
    pairs.map((pair, index) => pairOccupancy(pair, anchors[PAIR_IDS[index]])), selectedId,
  );
  const duplicateSourceComplete = completePair(selected);
  const canDuplicatePair = duplicateSourceComplete && duplicateTarget !== null;
  const canTrySamplePairs =
    !sampleBusy &&
    !draftReading &&
    SAMPLE_PAIRS.every(({ id }) => pairIsEmpty(pairOccupancy(pairs[PAIR_IDS.indexOf(id)], anchors[id])));
  const duplicateNote = !duplicateSourceComplete
    ? `Add a title and thumbnail to ${selectedLabel} to duplicate it.`
    : duplicateTarget
      ? "Copies the title, thumbnail, alt text, testing hypothesis and crop. The new pair starts with an empty note."
      : "To free a pair, clear its title, alt text, hypothesis, note and thumbnail and set its crop to Centre.";
  /** Reuse is offered only for the exact File behind the current match, and
   * only the first pair satisfying the same complete emptiness rule as copy. */
  const hasCurrentVerifiedPng =
    verifyPhase === "matched" &&
    verifyOutcome?.status === "matched" &&
    verifyPngFile !== null &&
    verifiedPngRef.current === verifyPngFile;
  const verifiedReuseTarget = hasCurrentVerifiedPng
    ? PAIR_IDS.find((id, index) => pairIsEmpty(pairOccupancy(pairs[index], anchors[id]))) ?? null
    : null;
  const verifiedReuseTargetIndex = verifiedReuseTarget ? PAIR_IDS.indexOf(verifiedReuseTarget) : -1;
  // Capture the rendered revision in the click closure too, so even a stale
  // source event cannot claim a pair edited after this option appeared.
  const verifiedReuseRevision = verifiedReuseTarget ? pairEdits.current[verifiedReuseTargetIndex] : null;
  const verifiedReuseNote = verifiedReuseTarget
    ? `Adds the verified PNG as the thumbnail for Pair ${PAIR_LABELS[verifiedReuseTarget]}.`
    : "All pairs are occupied. Clear one pair completely to make room.";
  const prepared = readyPairs();
  const preparedCount = prepared.length;
  const preparedImageTooLarge =
    preparedImage !== null && preparedImage.bytes > MAX_IMAGE_INPUT_BYTES;
  const preferredForSet = preferredPairForExport(
    preferredId,
    prepared.map((pair) => pair.id),
  );
  // The full-size inspection is derived from the live selection and the same
  // cover plan the package encodes. It decodes nothing and owns no bytes.
  const selectedImage = selected.image;
  const fullViewSize = FEED_SIZES.find((size) => size.key === fullViewSizeKey) ?? FEED_SIZES[1];
  const fullRect = selectedImage
    ? coverCropRect(selectedImage.width, selectedImage.height, fullViewSize.width, fullViewSize.height, anchor)
    : null;

  return (
    <section ref={sectionRef} className="trim-work image-title-compare" aria-labelledby="image-title-compare-heading">
      <div className="image-section-head">
        <h2 id="image-title-compare-heading" tabIndex={-1}>Title + thumbnail compare</h2>
        <span>
          {selectedLabel} selected · {CROP_ANCHOR_LABELS[anchor]} crop
          {preferredId ? ` · Pair ${PAIR_LABELS[preferredId]} preferred` : ""}
        </span>
      </div>
      <div className="title-compare-intro">
        <div className="title-compare-intro-row">
          <p className="trim-note" id="image-title-compare-note">
            Add a title and thumbnail to each pair. Compare them at two feed sizes.
          </p>
          <button
            type="button"
            className="secondary title-compare-sample"
            data-title-compare-sample
            data-title-compare-sample-state={canTrySamplePairs ? "ready" : "unavailable"}
            aria-disabled={!canTrySamplePairs}
            aria-busy={sampleBusy}
            aria-describedby="image-title-compare-note image-title-compare-sample-status"
            onClick={() => void trySamplePairs()}
          >
            Try sample pairs
          </button>
          <button type="button" className="secondary title-compare-open-draft" disabled={draftReading || pairs.some(pair => pair.busy)}
            onClick={() => draftFile.current?.click()}>Open editable draft</button>
          <input ref={draftFile} hidden type="file" accept=".studio-draft" aria-label="Open editable draft file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void openEditableDraft(file);
            }} />
          {pairs.some(pair => pair.image !== null) && (
            <button
              type="button"
              className="secondary title-compare-preview-jump"
              onClick={() => {
                const previews = previewsRef.current;
                previews?.focus({ preventScroll: true });
                previews?.scrollIntoView({ block: "start", behavior: "instant" });
              }}
            >
              View previews
            </button>
          )}
        </div>
        <p
          className="trim-note title-compare-sample-status"
          id="image-title-compare-sample-status"
          role="status"
          aria-live="polite"
        >
          {sampleMessage || (canTrySamplePairs ? "" : "Sample pairs need empty Pairs A and B.")}
        </p>
        <p className="trim-note title-compare-draft-status" role="status">{draftOpenMessage}</p>
      </div>
      <div className="title-compare-grid">
        <fieldset className="image-controls title-compare-controls">
          <legend>Combinations</legend>
          {preparedImage && (
            <p
              className="trim-note title-compare-prepared-offer"
              id="title-compare-prepared-offer"
              data-title-compare-prepared-offer
            >
              {`Prepared image: ${preparedImage.filename} · ${preparedImage.width} × ${preparedImage.height} px · ${formatBytes(preparedImage.bytes)}`}
            </p>
          )}
          {!preparedImage && sourceFile && (
            <p
              className="trim-note title-compare-source-offer"
              id="title-compare-source-offer"
              data-title-compare-source-offer
            >
              {`Source image: ${sourceFile.name} · ${formatBytes(sourceFile.size)}`}
            </p>
          )}
          <details className="title-compare-details">
            <summary>{`Crop and details for ${selectedLabel}`}</summary>
            <div className="title-compare-details-body">
              <label className="title-compare-anchor">
                {`Preview crop position for ${selectedLabel}`}
                <select
                  value={anchor}
                  data-title-compare-anchor
                  data-title-compare-anchor-pair={selectedId}
                  onChange={(event) => updateAnchor(selectedIndex, event.target.value as CropAnchorKey)}
                  aria-describedby="image-title-compare-note"
                >
                  {Object.entries(CROP_ANCHOR_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="title-compare-alt">
                {`Thumbnail alt text for ${selectedLabel} (optional, up to ${ALT_MAX_LENGTH} characters)`}
                <input
                  type="text"
                  value={selected.alt}
                  maxLength={ALT_MAX_LENGTH}
                  placeholder="Describe the thumbnail for screen readers"
                  spellCheck={false}
                  disabled={selected.busy}
                  data-title-compare-alt
                  data-title-compare-alt-pair={selectedId}
                  aria-describedby="image-title-compare-alt-note"
                  onChange={(event) => updateAlt(selectedIndex, event.target.value)}
                />
              </label>
              <p className="trim-note title-compare-alt-note" id="image-title-compare-alt-note">
                {`${selected.alt.length} of ${ALT_MAX_LENGTH} characters · blank keeps the default description. Saved only in ${selectedLabel}’s manifest when nonblank.`}
              </p>
              <label className="title-compare-hypothesis">
                {`Testing hypothesis for ${selectedLabel} (optional)`}
                <input
                  type="text"
                  value={selected.hypothesis}
                  maxLength={HYPOTHESIS_MAX_LENGTH}
                  placeholder="What do you expect this pair to do?"
                  spellCheck={false}
                  disabled={selected.busy}
                  data-title-compare-hypothesis
                  data-title-compare-hypothesis-pair={selectedId}
                  aria-describedby="image-title-compare-hypothesis-note"
                  onChange={(event) => updateHypothesis(selectedIndex, event.target.value)}
                />
              </label>
              <p className="trim-note title-compare-hypothesis-note" id="image-title-compare-hypothesis-note">
                {`${selected.hypothesis.length} of ${HYPOTHESIS_MAX_LENGTH} characters. The hypothesis goes in ${selectedLabel}’s manifest.`}
              </p>
            </div>
          </details>
          {PAIR_IDS.map((id) => {
            const index = PAIR_IDS.indexOf(id);
            const pair = pairs[index];
            const isSelected = id === selectedId;
            const isPreferred = id === preferredId;
            const isComplete = completePair(pair);
            return (
              <div
                className={`title-compare-pair${isSelected ? " is-selected" : ""}${isPreferred ? " is-preferred" : ""}`}
                data-title-compare-pair={id}
                key={id}
              >
                <div className="title-compare-pick-row">
                  <label className="title-compare-pick">
                    <input
                      type="radio"
                      name="image-title-compare-pair"
                      value={id}
                      checked={isSelected}
                      onChange={() => selectPair(id)}
                    />
                    <strong>Pair {PAIR_LABELS[id]}</strong>
                  </label>
                  {isPreferred && (
                    <span className="title-compare-preferred-badge">Preferred</span>
                  )}
                </div>
                <label>
                  Title {PAIR_LABELS[id]}
                  <input
                    type="text"
                    value={pair.title}
                    maxLength={TITLE_MAX_LENGTH}
                    placeholder={`Title for combination ${PAIR_LABELS[id]}`}
                    onChange={(event) => updateTitle(index, event.target.value)}
                  />
                </label>
                <label
                  className={`image-drop title-compare-drop${pair.busy ? " is-busy" : ""}${draggingPair === id ? " is-dragging" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDraggingPair(id);
                  }}
                  onDragLeave={() => setDraggingPair((current) => (current === id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDraggingPair(null);
                    void chooseImage(index, event.dataTransfer.files[0]);
                  }}
                >
                  <span>{pair.image ? pair.image.fileName : "Choose a thumbnail"}</span>
                  <span className="title-compare-file-meta">
                    {pair.image
                      ? `${pair.image.width} × ${pair.image.height} px · ${formatBytes(pair.image.bytes)}`
                      : "JPEG, PNG or WebP from this device"}
                  </span>
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT_ATTRIBUTE}
                    aria-label={`Thumbnail ${PAIR_LABELS[id]}`}
                    disabled={pair.busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void chooseImage(index, file);
                    }}
                  />
                </label>
                {pair.error && (
                  <p className="notice warn" role="alert">{pair.error}</p>
                )}
                {isSelected && preparedImage && (
                  <div className="title-compare-prepared" data-title-compare-prepared-pair={id}>
                    <button
                      type="button"
                      className="secondary"
                      data-title-compare-prepared-use={id}
                      disabled={pair.busy || preparedImageTooLarge}
                      aria-disabled={pair.busy || preparedImageTooLarge}
                      aria-describedby={[
                        "title-compare-prepared-offer",
                        ...(pair.image ? [`title-compare-prepared-replace-${id}`] : []),
                        ...(preparedImageTooLarge ? [`title-compare-prepared-too-large-${id}`] : []),
                      ].join(" ")}
                      onClick={() => usePreparedImage(index)}
                    >
                      {pair.image
                        ? `Use prepared image for Pair ${PAIR_LABELS[id]} (replaces current thumbnail)`
                        : `Use prepared image for Pair ${PAIR_LABELS[id]}`}
                    </button>
                    {pair.image && (
                      <p
                        className="trim-note title-compare-prepared-replace"
                        id={`title-compare-prepared-replace-${id}`}
                      >
                        {`Replaces ${pair.image.fileName}.${isPreferred ? " Replacing the thumbnail clears this pair’s preference." : ""}`}
                      </p>
                    )}
                    {preparedImageTooLarge && (
                      <p
                        className="notice warn"
                        id={`title-compare-prepared-too-large-${id}`}
                        role="alert"
                      >
                        {`This finished result is ${formatBytes(preparedImage.bytes)}. A thumbnail input must be ${formatBytes(MAX_IMAGE_INPUT_BYTES)} or smaller.`}
                      </p>
                    )}
                  </div>
                )}
                {isSelected && !preparedImage && sourceFile && (
                  <div className="title-compare-prepared" data-title-compare-source-pair={id}>
                    <button
                      type="button"
                      className="secondary"
                      data-title-compare-source-use={id}
                      disabled={pair.busy}
                      aria-disabled={pair.busy}
                      aria-describedby={[
                        "title-compare-source-offer",
                        ...(pair.image ? [`title-compare-source-replace-${id}`] : []),
                      ].join(" ")}
                      onClick={() => useSourceImage(index)}
                    >
                      {pair.image
                        ? `Use source image for Pair ${PAIR_LABELS[id]} (replaces current thumbnail)`
                        : `Use source image for Pair ${PAIR_LABELS[id]}`}
                    </button>
                    {pair.image && (
                      <p
                        className="trim-note title-compare-prepared-replace"
                        id={`title-compare-source-replace-${id}`}
                      >
                        {`Replaces ${pair.image.fileName}.${isPreferred ? " Replacing the thumbnail clears this pair’s preference." : ""}`}
                      </p>
                    )}
                  </div>
                )}
                {pair.image && (
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove thumbnail ${PAIR_LABELS[id]}`}
                    onClick={(event) => {
                      // Removing unmounts this trigger; keep keyboard replacement
                      // in the same pair instead of dropping focus to BODY.
                      if (document.activeElement === event.currentTarget) {
                        const pair = event.currentTarget.closest<HTMLElement>("[data-title-compare-pair]");
                        const fileInput = pair?.querySelector<HTMLInputElement>('input[type="file"]');
                        const titleInput = pair?.querySelector<HTMLInputElement>('input[type="text"]');
                        (fileInput && !fileInput.disabled ? fileInput : titleInput)?.focus();
                      }
                      removeImage(index);
                    }}
                  >
                    Remove thumbnail
                  </button>
                )}
                <label className="title-compare-note">
                  Creator note {PAIR_LABELS[id]} (optional)
                  <textarea
                    value={pair.note}
                    maxLength={NOTE_MAX_LENGTH}
                    rows={2}
                    spellCheck={false}
                    onChange={(event) => setPair(index, { note: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="quiet"
                  aria-pressed={isPreferred}
                  aria-label={
                    isPreferred
                      ? `Clear Pair ${PAIR_LABELS[id]} as the preferred packaging pair`
                      : `Mark complete Pair ${PAIR_LABELS[id]} as the preferred packaging pair`
                  }
                  disabled={!isPreferred && !isComplete}
                  onClick={() => togglePreference(id)}
                  data-title-compare-preference={id}
                >
                  {isPreferred ? "Clear preferred pair" : "Mark preferred pair"}
                </button>
              </div>
            );
          })}
          <div className="title-compare-duplicate" data-title-compare-duplicate-group>
            <button
              type="button"
              className="secondary"
              data-title-compare-duplicate
              data-title-compare-duplicate-state={
                canDuplicatePair ? "ready" : duplicateSourceComplete ? "no-empty" : "incomplete"
              }
              data-title-compare-duplicate-target={duplicateTarget ?? undefined}
              disabled={!canDuplicatePair}
              aria-disabled={!canDuplicatePair}
              aria-describedby="image-title-compare-duplicate-note"
              onClick={duplicateSelectedPair}
            >
              {duplicateTarget
                ? `Duplicate ${selectedLabel} into Pair ${PAIR_LABELS[duplicateTarget]}`
                : `Duplicate ${selectedLabel}`}
            </button>
            <p
              className="trim-note"
              id="image-title-compare-duplicate-note"
              data-title-compare-duplicate-note
            >
              {duplicateNote}
            </p>
            <p className="trim-note" role="status" aria-live="polite">
              {duplicateMessage}
            </p>
          </div>
        </fieldset>
        <div ref={previewsRef} className="title-compare-previews" role="region" aria-label="Feed previews" tabIndex={-1}>
          {PAIR_IDS.map((id) => {
            const pair = pairs[PAIR_IDS.indexOf(id)];
            const isSelected = id === selectedId;
            const isPreferred = id === preferredId;
            const position = objectPositionFor(anchors[id]);
            const hasTitle = pair.title.trim() !== "";
            const rowClipped = hasTitle && titleClips[`${id}-${FEED_SIZES[0].key}`];
            const cardClipped = hasTitle && titleClips[`${id}-${FEED_SIZES[1].key}`];
            const clipNote = rowClipped && cardClipped
              ? "Compact row and Large card cut this title short."
              : rowClipped
                ? "Compact row cuts this title short."
                : cardClipped
                  ? "Large card cuts this title short."
                  : "";
            const thumb = (box: FeedSize, extra: string) => (
              <span
                className={`title-compare-thumb${extra ? ` ${extra}` : ""}`}
                style={box.key === "row" ? { width: box.width, height: box.height } : undefined}
                data-title-compare-thumb={`${id}-${box.key}`}
              >
                {pair.image ? (
                  <img
                    src={pair.image.url}
                    alt=""
                    style={{ objectPosition: position }}
                  />
                ) : (
                  <span className="title-compare-empty">No thumbnail</span>
                )}
              </span>
            );
            return (
              <figure
                className={`title-compare-preview${isSelected ? " is-selected" : ""}${isPreferred ? " is-preferred" : ""}`}
                data-title-compare-preview={id}
                key={id}
              >
                <div className="title-compare-row">
                  {thumb(FEED_SIZES[0], "title-compare-thumb-row")}
                  <span
                    className="title-compare-title title-compare-title-row"
                    data-title-compare-title={`${id}-${FEED_SIZES[0].key}`}
                  >
                    {pair.title || <em>Untitled {PAIR_LABELS[id]}</em>}
                  </span>
                </div>
                <div className="title-compare-card">
                  {thumb(FEED_SIZES[1], "title-compare-thumb-card")}
                  <span
                    className="title-compare-title title-compare-title-card"
                    data-title-compare-title={`${id}-${FEED_SIZES[1].key}`}
                  >
                    {pair.title || <em>Untitled {PAIR_LABELS[id]}</em>}
                  </span>
                </div>
                {isPreferred && (
                  <p className="title-compare-preferred-note">Preferred packaging pair</p>
                )}
                {clipNote && <p className="title-compare-fit-note">{clipNote}</p>}
                <figcaption>
                  {`Pair ${PAIR_LABELS[id]} · row 168 × 94 · card up to 640 × 360 · ${
                    pair.image ? `${pair.image.width} × ${pair.image.height} source` : "no thumbnail yet"
                  }`}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
      <details
        className="title-compare-full"
        data-title-compare-full
        data-title-compare-full-pair={selectedId}
      >
        <summary>{`Inspect full-size framing — ${selectedLabel}`}</summary>
        {selectedImage && fullRect ? (
          <div className="title-compare-full-body">
            <div className="title-compare-full-bar">
              <label className="title-compare-full-size">
                Feed size
                <select
                  value={fullViewSize.key}
                  aria-label="Full-size preview feed size"
                  data-title-compare-full-size
                  onChange={(event) => setFullViewSizeKey(event.target.value as FeedSizeKey)}
                >
                  {FEED_SIZES.map((size) => (
                    <option value={size.key} key={size.key}>
                      {`${size.label} — ${size.width} × ${size.height} px`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="title-compare-full-facts" data-title-compare-full-facts>
                {`Simulated framing · source ${selectedImage.width} × ${selectedImage.height} px · ${CROP_ANCHOR_LABELS[anchor].toLowerCase()} crop · ${fullViewSize.width} × ${fullViewSize.height} feed`}
              </p>
            </div>
            <p className="title-compare-full-note">
              Scroll to inspect the source at full size. The outline shows the crop used in the PNG export.
            </p>
            <div
              className="title-compare-full-viewport"
              role="region"
              aria-label="Scrollable full-size thumbnail"
              tabIndex={0}
              data-title-compare-full-viewport
            >
              <div
                className="title-compare-full-stage"
                style={{ width: selectedImage.width, height: selectedImage.height }}
              >
                <img
                  src={selectedImage.url}
                  alt={selectedAlt ?? `Full-size source thumbnail for ${selectedLabel}`}
                  width={selectedImage.width}
                  height={selectedImage.height}
                  data-title-compare-full-image
                />
                <span
                  className="title-compare-full-crop"
                  style={{
                    left: fullRect.left,
                    top: fullRect.top,
                    width: fullRect.width,
                    height: fullRect.height,
                    boxShadow: `0 0 0 ${Math.max(selectedImage.width, selectedImage.height)}px rgb(23 24 27 / 55%)`,
                  }}
                  data-title-compare-full-crop
                  aria-hidden="true"
                />
              </div>
            </div>
            <p className="title-compare-full-caption" data-title-compare-full-caption>
              {`Crop area ${fullRect.width} × ${fullRect.height} px · PNG ${fullViewSize.width} × ${fullViewSize.height} px`}
            </p>
          </div>
        ) : (
          <p className="title-compare-full-empty" data-title-compare-full-empty>
            {`Choose a thumbnail for ${selectedLabel} to inspect its full-size framing.`}
          </p>
        )}
      </details>
      <div className="image-control-actions" role="group" aria-label={`Actions for ${selectedLabel}`}>
        <button
          type="button"
          className="secondary"
          disabled={!selected.image || exportBusy}
          aria-disabled={!selected.image || exportBusy}
          onClick={() => void exportSelectedPair(FEED_SIZES[0])}
        >
          {exportBusy ? "Encoding…" : `Export ${selectedLabel} row thumbnail (168 × 94)`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selected.image || exportBusy}
          aria-disabled={!selected.image || exportBusy}
          onClick={() => void exportSelectedPair(FEED_SIZES[1])}
        >
          {exportBusy ? "Encoding…" : `Export ${selectedLabel} card thumbnail (640 × 360)`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selected.image || exportBusy}
          aria-disabled={!selected.image || exportBusy}
          aria-label={`Export the ${selectedLabel} packaging manifest (JSON) with the exact card PNG's hash`}
          onClick={() => void exportSelectedPairManifest(FEED_SIZES[1])}
        >
          {exportBusy ? "Encoding…" : `Export ${selectedLabel} manifest (JSON, card 640 × 360)`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selected.title.trim()}
          aria-disabled={!selected.title.trim()}
          aria-label={`Copy selected title from ${selectedLabel}`}
          onClick={() => void copySelectedTitle()}
        >
          Copy selected title
        </button>
      </div>
      <div className="image-control-actions title-compare-draft" role="group" aria-label="Editable packaging draft">
        <button type="button" className="secondary" disabled={draftReading || pairs.some(pair => pair.busy)}
          onClick={downloadEditableDraft}>Save editable draft</button>
      </div>
      <p className="trim-note">The draft file contains all three pairs and their original thumbnails. It stays on your device.</p>
      <p className="trim-note" role="status">{draftSaveMessage}</p>
      <div className="image-control-actions" role="group" aria-label="Prepared pairs">
        <button
          type="button"
          className="secondary"
          disabled={preparedCount < 2 || exportBusy}
          aria-disabled={preparedCount < 2 || exportBusy}
          aria-describedby="image-title-compare-set-note"
          onClick={() => void exportPreparedPairs()}
        >
          {exportBusy ? "Encoding…" : "Export prepared pairs (ZIP)"}
        </button>
      </div>
      <p className="trim-note" id="image-title-compare-set-note">
        {preparedCount < 2
          ? `Add a title and thumbnail to at least two pairs. ${preparedCount} of ${PAIR_IDS.length} ready.`
          : `${preparedCount} pairs ready.${preferredForSet ? ` Pair ${PAIR_LABELS[preferredForSet]} will be marked preferred in the manifests.` : ""} The ZIP includes each 640 × 360 PNG and its manifest; review notes download beside it.`}
      </p>
      <p className="trim-note" role="status" aria-live="polite">{copyMessage}</p>
      {titleFallback !== null && (
        <label className="image-copy-fallback">
          {selectedLabel} title — select and copy
          <input
            readOnly
            value={titleFallback}
            spellCheck={false}
            aria-label={`Exact ${selectedLabel} title to copy`}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      <p className="trim-note" role="status" aria-live="polite">
        {exportMessage ||
          "Exports use the workbench's local encode and download path. The PNG contains the cropped thumbnail pixels only; the manifest names the exact PNG it was encoded with — file name, pixel size and SHA-256 — plus the title, crop, any creator note and any thumbnail alt text. The manifest export also offers one ZIP of that same PNG and JSON. Nothing is uploaded."}
      </p>
      {exports.map((entry) => (
        <p className="title-compare-export" key={entry.url}>
          <a
            href={entry.url}
            download={entry.name}
            aria-label={
              entry.kind === "notes"
                ? `Download review notes (.txt) for prepared pairs ${entry.pairLabel}`
                : entry.kind === "bundle"
                  ? `Download the Pair ${entry.pairLabel} PNG and manifest package (ZIP)`
                  : entry.kind === "set"
                    ? `Download the prepared pairs package (ZIP) with ${entry.label}`
                    : undefined
            }
          >
            {entry.kind === "notes"
              ? "Download review notes (.txt)"
              : entry.kind === "manifest"
                ? `Download ${entry.label} (JSON v${MANIFEST_VERSION})`
                : entry.kind === "bundle"
                  ? "Download pair package (ZIP)"
                  : entry.kind === "set"
                    ? "Download prepared pairs package (ZIP)"
                    : `Download ${entry.label} PNG`}
          </a>
          {entry.kind === "notes"
            ? ` · Pairs ${entry.pairLabel} · plain text for independent review · ${formatBytes(entry.bytes)} · ${entry.name}`
            : entry.kind === "set"
              ? ` · Pairs ${entry.pairLabel}${entry.preferredPairLabel ? ` · Pair ${entry.preferredPairLabel} preferred` : ""} · ${entry.anchorLabel} crop · ${entry.width} × ${entry.height} px PNGs with per-pair manifests · ${formatBytes(entry.bytes)} · ${entry.name}`
              : ` · Pair ${entry.pairLabel} · ${entry.anchorLabel} crop · ${
                  entry.kind === "manifest"
                    ? `names a ${entry.width} × ${entry.height} px PNG`
                    : entry.kind === "bundle"
                      ? `exact PNG + JSON v${MANIFEST_VERSION}, unchanged`
                      : `${entry.width} × ${entry.height} px`
                } · ${formatBytes(entry.bytes)} · ${entry.name}`}
          {entry.sha256 && (
            <>
              {` · SHA-256 ${entry.sha256.slice(0, 16)}…`}
              <span className="title-compare-export-hash-note"> (full digest inside the manifest)</span>
            </>
          )}
          {entry.kind === "manifest" && entry.manifestText && canCopyManifest && (
            <button
              type="button"
              className="quiet"
              data-title-compare-copy-manifest={entry.url}
              data-title-compare-copy-pair={entry.pairLabel}
              data-title-compare-copy-size={entry.label}
              aria-label={`Copy the ${entry.label} JSON v${MANIFEST_VERSION} for Pair ${entry.pairLabel}: ${entry.name} to the clipboard`}
              onClick={() => void copyEntryManifest(entry)}
            >
              {`Copy Pair ${entry.pairLabel} manifest JSON`}
            </button>
          )}
          {entry.kind === "png" && entry.pngBlob && canCopyPng && (
            <button
              type="button"
              className="quiet"
              data-title-compare-copy-png={entry.url}
              data-title-compare-copy-pair={entry.pairLabel}
              data-title-compare-copy-size={entry.label}
              aria-label={`Copy the ${entry.label} PNG for Pair ${entry.pairLabel}: ${entry.name} (${entry.width} × ${entry.height} px) to the clipboard`}
              onClick={() => void copyEntryPng(entry)}
            >
              {`Copy Pair ${entry.pairLabel} ${entry.label} PNG`}
            </button>
          )}
          {pngCopy?.key === entry.url && (
            <span
              className={`title-compare-export-copy-status${pngCopy.ok ? "" : " is-error"}`}
              role="status"
              aria-live="polite"
            >
              {` ${pngCopy.message}`}
            </span>
          )}
        </p>
      ))}
      <details className="title-compare-verify" data-title-compare-verify>
        <summary>Verify a packaging PNG</summary>
        <p className="trim-note" id="image-title-compare-verify-note">
          Compare the exported PNG’s dimensions, byte size and SHA-256 with its manifest.
          Optionally compare an original thumbnail with the manifest’s source SHA-256.
          Selected files stay on this device.
        </p>
        <div className="trim-fields title-compare-verify-fields">
          <label className="trim-file">
            {`Packaging manifest (JSON, up to ${MAX_PACKAGING_MANIFEST_BYTES / 1024} KiB)`}
            <input
              type="file"
              accept="application/json,.json"
              data-title-compare-verify-manifest
              onChange={(event) => {
                setVerifyManifestFile(event.currentTarget.files?.[0] ?? null);
                clearVerify();
              }}
            />
          </label>
          <label className="trim-file">
            {`Exported PNG (up to ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB)`}
            <input
              type="file"
              accept="image/png,.png"
              data-title-compare-verify-png
              onChange={(event) => {
                setVerifyPngFile(event.currentTarget.files?.[0] ?? null);
                clearVerify();
              }}
            />
          </label>
          <label className="trim-file">
            {`Original thumbnail (optional, up to ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB)`}
            <input
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              data-title-compare-verify-original
              onChange={(event) => {
                setVerifyOriginalFile(event.currentTarget.files?.[0] ?? null);
                clearVerify();
              }}
            />
          </label>
        </div>
        <p className="title-compare-verify-actions">
          <button
            type="button"
            className="secondary"
            disabled={verifyPhase === "checking"}
            aria-busy={verifyPhase === "checking"}
            aria-describedby="image-title-compare-verify-note"
            data-title-compare-verify-check
            onClick={() => void checkPackagingPair()}
          >
            {verifyPhase === "checking" ? "Verifying…" : "Verify PNG against manifest"}
          </button>
          {hasCurrentVerifiedPng && onEditVerifiedPng && (
            <button
              type="button"
              className="secondary"
              data-title-compare-verify-edit
              aria-describedby="image-title-compare-verify-edit-note"
              disabled={Boolean(verifiedPngEditUnavailable)}
              onClick={(event) => editVerifiedPngInImageTools(event.currentTarget)}
            >
              Edit verified PNG in Image Tools
            </button>
          )}
        </p>
        {hasCurrentVerifiedPng && onEditVerifiedPng && (
          <p className="trim-note" id="image-title-compare-verify-edit-note" role="status">
            {verifiedPngEditUnavailable || "Adds this exact PNG to the batch as a local source for editing."}
          </p>
        )}
        <p
          className={`trim-note title-compare-verify-status${
            verifyPhase === "matched"
              ? " is-matched"
              : verifyPhase === "different"
                ? " is-different"
                : verifyPhase === "invalid"
                  ? " is-invalid"
                  : ""
          }`}
          role={verifyPhase === "invalid" ? "alert" : "status"}
          aria-live="polite"
          data-title-compare-verify-status={verifyPhase}
        >
          {verifyMessage}
        </p>
        {verifyPhase === "matched" && verifyOutcome?.status === "matched" && (
          <p className="trim-note title-compare-verify-facts" data-title-compare-verify-facts>
            {`${verifyOutcome.facts.width} × ${verifyOutcome.facts.height} px · ${formatBytes(verifyOutcome.facts.pngBytes)} · SHA-256 ${verifyOutcome.facts.sha256.slice(0, 16)}…`}
          </p>
        )}
        {verifyPhase === "matched" && verifyOutcome?.status === "matched" && verifyOutcome.original && (
          <p
            className={`trim-note title-compare-verify-status title-compare-verify-original${
              verifyOutcome.original.status === "matched"
                ? " is-matched"
                : verifyOutcome.original.status === "different" || verifyOutcome.original.status === "invalid"
                  ? " is-invalid"
                  : ""
            }`}
            role="status"
            aria-live="polite"
            data-title-compare-verify-original-status={verifyOutcome.original.status}
          >
            {packagingOriginalMessage(verifyOutcome.original)}
          </p>
        )}
        {hasCurrentVerifiedPng && (
          <div className="title-compare-verify-reuse" data-title-compare-verify-reuse>
            <div
              className="image-control-actions title-compare-verify-reuse-actions"
              role="group"
              aria-label="Verified packaging recovery"
            >
              <button
                type="button"
                className="secondary"
                data-title-compare-verify-reuse-use
                data-title-compare-verify-reuse-target={verifiedReuseTarget ?? undefined}
                data-title-compare-verify-reuse-state={verifiedReuseTarget ? "ready" : "no-empty"}
                disabled={!verifiedReuseTarget}
                aria-disabled={!verifiedReuseTarget}
                aria-describedby="image-title-compare-verify-reuse-note"
                onClick={() => {
                  if (verifiedReuseTarget && verifiedReuseRevision !== null)
                    void reuseVerifiedPng(verifiedReuseTarget, verifiedReuseRevision);
                }}
              >
                Use verified PNG in an empty pair
              </button>
              <button
                type="button"
                className="secondary"
                data-title-compare-verify-restore-use
                data-title-compare-verify-restore-target={verifiedReuseTarget ?? undefined}
                data-title-compare-verify-restore-state={verifiedReuseTarget ? "ready" : "no-empty"}
                disabled={!verifiedReuseTarget}
                aria-disabled={!verifiedReuseTarget}
                aria-describedby="image-title-compare-verify-reuse-note image-title-compare-verify-restore-note"
                onClick={() => {
                  if (verifiedReuseTarget && verifiedReuseRevision !== null)
                    void restoreVerifiedTitleAndPng(verifiedReuseTarget, verifiedReuseRevision);
                }}
              >
                Restore title and PNG in an empty pair
              </button>
            </div>
            <p
              className="trim-note"
              id="image-title-compare-verify-reuse-note"
              data-title-compare-verify-reuse-note
            >
              {verifiedReuseNote}
            </p>
            <p
              className="trim-note"
              id="image-title-compare-verify-restore-note"
              data-title-compare-verify-restore-note
            >
              {verifiedReuseTarget
                ? "Restore the editable title from the manifest. The PNG uses its original exported crop."
                : "Both recovery actions need the same completely empty pair."}
            </p>
            <p className="trim-note" role="status" aria-live="polite" data-title-compare-verify-reuse-status>
              {verifyReuseMessage}
            </p>
          </div>
        )}
      </details>
    </section>
  );
}

/** Same contract as the workbench's canvasToBlob: a real error instead of a
 * silent null when the browser refuses the encode. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("This browser could not encode the crop."));
        else resolve(blob);
      }, type);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("This browser could not encode the crop."));
    }
  });
}

/** The one encode both the PNG download and the manifest use: decode the
 * chosen file, cover-crop it to the feed size, encode PNG, and verify the
 * encoded header against the planned size. Returns the exact bytes the
 * manifest then hashes, so the digest describes the shipped pixels. */
async function encodeCropPng(
  image: PairImage,
  size: FeedSize,
  anchor: CropAnchorKey,
): Promise<{ rect: CoverRect; blob: Blob; pngBytes: Uint8Array<ArrayBuffer> }> {
  const bitmap = await createImageBitmap(image.file);
  // The finally covers the crop plan and the context lookup too, so every
  // decoded bitmap is closed even when the export fails before drawing.
  let rect: CoverRect;
  let canvas: HTMLCanvasElement;
  try {
    const plan = coverCropRect(bitmap.width, bitmap.height, size.width, size.height, anchor);
    if (!plan) throw new Error("The crop could not be planned from this thumbnail.");
    rect = plan;
    canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the crop canvas.");
    context.drawImage(bitmap, plan.left, plan.top, plan.width, plan.height, 0, 0, size.width, size.height);
  } finally {
    bitmap.close();
  }
  const blob = await canvasToBlob(canvas, "image/png");
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  const encoded = inspectImage(pngBytes);
  if (encoded.width !== size.width || encoded.height !== size.height)
    throw new Error(`The encoded file is ${encoded.width} × ${encoded.height}, not the planned ${size.width} × ${size.height}.`);
  return { rect, blob, pngBytes };
}

/** SHA-256 over exact bytes, through the browser's own Web Crypto. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot hash the export: Web Crypto is unavailable in this context.");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Source facts shared by the two explicit manifest/package paths. Hash the
 * already selected File itself, never the crop, so ordinary intake, preview,
 * PNG-only export and draft save do no source digest work. */
async function manifestSourceFacts(image: PairImage): Promise<ManifestSourceFacts> {
  const bytes = new Uint8Array(await image.file.arrayBuffer());
  return {
    fileName: image.fileName,
    mime: image.mime,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    sha256: await sha256Hex(bytes),
  };
}
