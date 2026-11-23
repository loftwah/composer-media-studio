// MIT. Browser-local title + thumbnail compare for the image workbench.
// Three manually named pairs, previewed at real feed sizes with real CSS
// truncation and a real cover crop. The same local-file rules as the rest of
// the page and the same local encode/download path. No upload, provider,
// account or server state; the only bytes that leave this tab are the ones an
// explicit download writes to disk.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  imageInputProblem,
  imagePixelProblem,
} from "./image-limits.ts";
import { inspectImage, sniffLocalImage, type ImageMetadataSummary } from "./image-metadata.ts";
import { CROP_ANCHOR_LABELS, type CropAnchorKey } from "./image-ops.ts";
import {
  FEED_SIZES,
  PAIR_IDS,
  PAIR_LABELS,
  TITLE_MAX_LENGTH,
  buildTitlePairManifest,
  bundleFileName,
  coverCropRect,
  exportFileName,
  manifestFileName,
  MANIFEST_VERSION,
  objectPositionFor,
  pairArchiveFileNames,
  preparedPairsBundleFileName,
  type CoverRect,
  type FeedSize,
  type PairId,
} from "./image-title-compare-plan.ts";
import { createZip, ZIP_MIME, type ZipEntryInput } from "./image-zip.ts";
import "./image-title-compare.css";

export type { FeedSizeKey } from "./image-title-compare-plan.ts";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
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
  image: PairImage | null;
  error: string | null;
  busy: boolean;
};

/** A pair captured for the set export: the exact title and local image the
 * run will encode, taken before the first await. */
type PreparedPair = {
  id: PairId;
  title: string;
  image: PairImage;
};

type ExportEntry = {
  kind: "png" | "manifest" | "bundle" | "set";
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
};

const emptyPair = (): Pair => ({ title: "", image: null, error: null, busy: false });

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

export function TitleCompare() {
  const [pairs, setPairs] = useState<Pair[]>(() => PAIR_IDS.map(emptyPair));
  const [selectedId, setSelectedId] = useState<PairId>("a");
  const [anchor, setAnchor] = useState<CropAnchorKey>("centre");
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [titleFallback, setTitleFallback] = useState<string | null>(null);
  const [draggingPair, setDraggingPair] = useState<PairId | null>(null);
  const [titleClips, setTitleClips] = useState<TitleClipState>({});
  const sectionRef = useRef<HTMLElement | null>(null);
  const urls = useRef(new Set<string>());
  const exportsRef = useRef<ExportEntry[]>([]);
  const mounted = useRef(true);
  /** One run per pair, so a slow decode cannot replace a later pick. */
  const loadRuns = useRef<number[]>(PAIR_IDS.map(() => 0));
  /** One run per export, so unmount or a newer encode cannot mint a stale URL. */
  const exportRun = useRef(0);
  /** One run per title copy, so a slow write cannot report a title the user has
   * already left or edited. */
  const copyRun = useRef(0);

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
    setPairs((current) => current.map((pair, at) => (at === index ? { ...pair, ...patch } : pair)));
  }

  /** The snapshot a set export may bundle: a real title and a local thumbnail
   * that is not mid-replacement, with the exact pair id and image object the
   * run captures before its first await. */
  function readyPairs(): PreparedPair[] {
    return PAIR_IDS.flatMap((id, index) => {
      const pair = pairs[index];
      if (pair.busy || !pair.image || pair.title.trim() === "") return [];
      return [{ id, title: pair.title, image: pair.image }];
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
    clearCopyFeedback();
    setSelectedId(id);
  }

  function updateTitle(index: number, title: string): void {
    if (index === PAIR_IDS.indexOf(selectedId)) clearCopyFeedback();
    setPair(index, { title });
  }

  /** Replace the export list outside the state updater: revoking URLs inside
   * `setExports` would make the updater impure and can run more than once. */
  function replaceExports(next: ExportEntry[]): void {
    const previous = exportsRef.current;
    exportsRef.current = next;
    setExports(next);
    for (const entry of previous) releaseUrl(entry.url);
  }

  function discardExports(): void {
    replaceExports([]);
  }

  /** Intake follows the workbench's addFiles sequence: declared facts, byte
   * sniff, header inspect, pixel limits, then a real decoder probe. */
  async function chooseImage(index: number, file: File | undefined): Promise<void> {
    if (!file) return;
    // A second pick, a drop or Remove for this pair makes this run stale: a
    // slower decode must never overwrite the image the user chose last.
    const run = ++loadRuns.current[index];
    const current = () => mounted.current && loadRuns.current[index] === run;
    setPair(index, { error: null, busy: true });
    const fail = (reason: string) => {
      if (current()) setPair(index, { error: reason, busy: false });
    };
    const declared = imageInputProblem({ name: file.name, type: file.type, size: file.size });
    if (declared) {
      fail(declared);
      return;
    }
    try {
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
      if (!current()) return;
      discardExports();
      const previous = pairs[index].image;
      releaseUrl(previous?.url);
      const url = trackUrl(file);
      setPair(index, {
        image: {
          file,
          url,
          fileName: file.name,
          mime: sniffed.mime ?? file.type,
          bytes: file.size,
          width: source.orientedWidth,
          height: source.orientedHeight,
        },
        error: null,
        busy: false,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not read this image.");
    }
  }

  function removeImage(index: number): void {
    // Removing is also a newer choice for this pair: any decode still in
    // flight for it must not put an image back.
    loadRuns.current[index] += 1;
    discardExports();
    releaseUrl(pairs[index].image?.url);
    setPair(index, { image: null, error: null, busy: false });
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
    const forAnchor = anchor;
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
   * the exact title and the crop plan. The manifest is built from the bytes
   * the encode produced, so the hash always describes the PNG it ships with.
   * No work, rights or performance value is claimed: the manifest carries only
   * what this tab actually captured. */
  async function exportSelectedPairManifest(size: FeedSize): Promise<void> {
    const index = PAIR_IDS.indexOf(selectedId);
    const pair = pairs[index];
    const image = pair.image;
    if (!image) return;
    const run = ++exportRun.current;
    const forPair = selectedId;
    const forAnchor = anchor;
    const title = pair.title;
    const current = () => mounted.current && exportRun.current === run;
    setExportBusy(true);
    setExportMessage("");
    try {
      const { rect, blob, pngBytes } = await encodeCropPng(image, size, forAnchor);
      // Unmounted or superseded: do not hash, let alone publish.
      if (!current()) return;
      const name = exportFileName(title || image.fileName, image.fileName, size);
      const sha256 = await sha256Hex(pngBytes);
      const manifest = buildTitlePairManifest({
        generatedAt: new Date().toISOString(),
        pairId: forPair,
        title,
        source: {
          fileName: image.fileName,
          mime: image.mime,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
        },
        anchor: forAnchor,
        size,
        sourceRect: rect,
        png: { fileName: name, bytes: blob.size, sha256 },
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
   * three this section holds — in one flat ZIP. The titles, image facts and
   * crop anchor are captured before the first encode, so a later edit cannot
   * relabel the package. Each pair reuses the single-pair card encode, manifest
   * builder, SHA-256 and store-only ZIP writer; its prefixed entry names keep
   * same-title pairs distinct, and each manifest names and hashes the exact
   * PNG bytes the archive stores. */
  async function exportPreparedPairs(): Promise<void> {
    const size = FEED_SIZES[1];
    const forAnchor = anchor;
    const generatedAt = new Date().toISOString();
    const captured = readyPairs();
    if (captured.length < 2) return;
    const run = ++exportRun.current;
    const current = () => mounted.current && exportRun.current === run;
    setExportBusy(true);
    setExportMessage("");
    try {
      const zipEntries: ZipEntryInput[] = [];
      const pairLabels: string[] = [];
      for (const prepared of captured) {
        const image = prepared.image;
        const { rect, pngBytes } = await encodeCropPng(image, size, forAnchor);
        // Unmounted or superseded: no hash, no ZIP and no URL.
        if (!current()) return;
        const sha256 = await sha256Hex(pngBytes);
        if (!current()) return;
        const names = pairArchiveFileNames(prepared.id, size);
        const manifest = buildTitlePairManifest({
          generatedAt,
          pairId: prepared.id,
          title: prepared.title,
          source: {
            fileName: image.fileName,
            mime: image.mime,
            bytes: image.bytes,
            width: image.width,
            height: image.height,
          },
          anchor: forAnchor,
          size,
          sourceRect: rect,
          // The name and digest describe the exact PNG bytes added below.
          png: { fileName: names.png, bytes: pngBytes.byteLength, sha256 },
        });
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
      replaceExports([
        {
          kind: "set",
          url: trackUrl(bundleBlob),
          name,
          label: `${captured.length} pairs, ${zipEntries.length} files`,
          pairLabel: pairLabels.join(", "),
          anchorLabel: CROP_ANCHOR_LABELS[forAnchor],
          width: size.width,
          height: size.height,
          bytes: bundleBlob.size,
        },
      ]);
      setExportMessage(
        `ZIP ready for pairs ${pairLabels.join(", ")}. It contains ${captured.length} thumbnails and their manifests.`,
      );
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

  const selectedIndex = PAIR_IDS.indexOf(selectedId);
  const selected = pairs[selectedIndex];
  const selectedLabel = `Pair ${PAIR_LABELS[selectedId]}`;
  const preparedCount = readyPairs().length;

  return (
    <section ref={sectionRef} className="trim-work image-title-compare" aria-labelledby="image-title-compare-heading">
      <div className="image-section-head">
        <h2 id="image-title-compare-heading" tabIndex={-1}>Title + thumbnail compare</h2>
        <span>{selectedLabel} selected</span>
      </div>
      <p className="trim-note" id="image-title-compare-note">
        Name up to three title and thumbnail combinations from files on this device and
        see each one at two real feed sizes. Titles truncate the way feeds truncate
        them, and thumbnails show the real cover crop at the chosen position.
        Nothing is uploaded, and the arrow keys switch the compared pair.
      </p>
      <div className="title-compare-grid">
        <fieldset className="image-controls title-compare-controls">
          <legend>Combinations</legend>
          <label className="title-compare-anchor">
            Preview crop position
            <select
              value={anchor}
              onChange={(event) => setAnchor(event.target.value as CropAnchorKey)}
              aria-describedby="image-title-compare-note"
            >
              {Object.entries(CROP_ANCHOR_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {PAIR_IDS.map((id) => {
            const index = PAIR_IDS.indexOf(id);
            const pair = pairs[index];
            const isSelected = id === selectedId;
            return (
              <div
                className={`title-compare-pair${isSelected ? " is-selected" : ""}`}
                data-title-compare-pair={id}
                key={id}
              >
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
                {pair.image && (
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove thumbnail ${PAIR_LABELS[id]}`}
                    onClick={() => removeImage(index)}
                  >
                    Remove thumbnail
                  </button>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="title-compare-previews" aria-label="Feed previews">
          {PAIR_IDS.map((id) => {
            const pair = pairs[PAIR_IDS.indexOf(id)];
            const isSelected = id === selectedId;
            const position = objectPositionFor(anchor);
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
                className={`title-compare-preview${isSelected ? " is-selected" : ""}`}
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
          : `${preparedCount} pairs ready. The ZIP includes each 640 × 360 PNG and its manifest.`}
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
          "Exports use the workbench's local encode and download path. The PNG contains the cropped thumbnail pixels only; the manifest names the exact PNG it was encoded with — file name, pixel size and SHA-256 — plus the title and crop. The manifest export also offers one ZIP of that same PNG and JSON. Nothing is uploaded."}
      </p>
      {exports.map((entry) => (
        <p className="title-compare-export" key={entry.url}>
          <a
            href={entry.url}
            download={entry.name}
            aria-label={
              entry.kind === "bundle"
                ? `Download the Pair ${entry.pairLabel} PNG and manifest package (ZIP)`
                : entry.kind === "set"
                  ? `Download the prepared pairs package (ZIP) with ${entry.label}`
                  : undefined
            }
          >
            {entry.kind === "manifest"
              ? `Download ${entry.label} (JSON v${MANIFEST_VERSION})`
              : entry.kind === "bundle"
                ? "Download pair package (ZIP)"
                : entry.kind === "set"
                  ? "Download prepared pairs package (ZIP)"
                  : `Download ${entry.label} PNG`}
          </a>
          {entry.kind === "set"
            ? ` · Pairs ${entry.pairLabel} · ${entry.anchorLabel} crop · ${entry.width} × ${entry.height} px PNGs with per-pair manifests · ${formatBytes(entry.bytes)} · ${entry.name}`
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
        </p>
      ))}
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

/** SHA-256 over the exact PNG bytes, through the browser's own Web Crypto. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot hash the export: Web Crypto is unavailable in this context.");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
