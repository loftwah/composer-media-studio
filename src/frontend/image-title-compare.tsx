// MIT. Browser-local title + thumbnail compare for the image workbench.
// Three manually named pairs, previewed at real feed sizes with real CSS
// truncation and a real cover crop. The same local-file rules as the rest of
// the page and the same local encode/download path. No upload, provider,
// account or server state; the only bytes that leave this tab are the ones an
// explicit download writes to disk.

import { useEffect, useRef, useState } from "react";
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
  coverCropRect,
  exportFileName,
  objectPositionFor,
  type FeedSize,
  type PairId,
} from "./image-title-compare-plan.ts";
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

type ExportEntry = {
  url: string;
  name: string;
  label: string;
  pairLabel: string;
  anchorLabel: string;
  width: number;
  height: number;
  bytes: number;
};

const emptyPair = (): Pair => ({ title: "", image: null, error: null, busy: false });

export function TitleCompare() {
  const [pairs, setPairs] = useState<Pair[]>(() => PAIR_IDS.map(emptyPair));
  const [selectedId, setSelectedId] = useState<PairId>("a");
  const [anchor, setAnchor] = useState<CropAnchorKey>("centre");
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [draggingPair, setDraggingPair] = useState<PairId | null>(null);
  const urls = useRef(new Set<string>());
  const exportsRef = useRef<ExportEntry[]>([]);
  const mounted = useRef(true);
  /** One run per pair, so a slow decode cannot replace a later pick. */
  const loadRuns = useRef<number[]>(PAIR_IDS.map(() => 0));
  /** One run per export, so unmount or a newer encode cannot mint a stale URL. */
  const exportRun = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const held = urls.current;
    return () => {
      // No blob URL may be minted after this: an in-flight decode or encode
      // checks `mounted` before it tracks its result, and the URLs this run
      // already made are revoked here even if a callback resolves later.
      mounted.current = false;
      exportRun.current += 1;
      for (const url of held) URL.revokeObjectURL(url);
      held.clear();
      exportsRef.current = [];
    };
  }, []);

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
      const bitmap = await createImageBitmap(image.file);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      // The finally covers the crop plan and the context lookup too, so every
      // decoded bitmap is closed even when the export fails before drawing.
      try {
        const rect = coverCropRect(bitmap.width, bitmap.height, size.width, size.height, forAnchor);
        if (!rect) throw new Error("The crop could not be planned from this thumbnail.");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not prepare the crop canvas.");
        context.drawImage(bitmap, rect.left, rect.top, rect.width, rect.height, 0, 0, size.width, size.height);
      } finally {
        bitmap.close();
      }
      const blob = await canvasToBlob(canvas, "image/png");
      const encoded = inspectImage(new Uint8Array(await blob.arrayBuffer()));
      if (encoded.width !== size.width || encoded.height !== size.height)
        throw new Error(`The encoded file is ${encoded.width} × ${encoded.height}, not the planned ${size.width} × ${size.height}.`);
      // Unmounted or superseded: do not create a blob URL or publish a result.
      if (!current()) return;
      const name = exportFileName(title || image.fileName, image.fileName, size);
      replaceExports([
        {
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

  const selectedIndex = PAIR_IDS.indexOf(selectedId);
  const selected = pairs[selectedIndex];
  const selectedLabel = `Pair ${PAIR_LABELS[selectedId]}`;

  return (
    <section className="trim-work image-title-compare" aria-labelledby="image-title-compare-heading">
      <div className="image-section-head">
        <h2 id="image-title-compare-heading">Title + thumbnail compare</h2>
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
                    onChange={() => setSelectedId(id)}
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
                    onChange={(event) => setPair(index, { title: event.target.value })}
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
                  <span className="title-compare-title title-compare-title-row">
                    {pair.title || <em>Untitled {PAIR_LABELS[id]}</em>}
                  </span>
                </div>
                <div className="title-compare-card">
                  {thumb(FEED_SIZES[1], "title-compare-thumb-card")}
                  <span className="title-compare-title title-compare-title-card">
                    {pair.title || <em>Untitled {PAIR_LABELS[id]}</em>}
                  </span>
                </div>
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
      <div className="image-control-actions" role="group" aria-label={`Export ${selectedLabel}`}>
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
      </div>
      <p className="trim-note" role="status" aria-live="polite">
        {exportMessage ||
          "Exports use the workbench's local encode and download path. The file contains the cropped thumbnail pixels only; the title stays text you paste yourself."}
      </p>
      {exports.map((entry) => (
        <p className="title-compare-export" key={entry.url}>
          <a href={entry.url} download={entry.name}>
            Download {entry.label} PNG
          </a>
          {` · Pair ${entry.pairLabel} · ${entry.anchorLabel} crop · ${entry.width} × ${entry.height} px · ${formatBytes(entry.bytes)} · ${entry.name}`}
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
