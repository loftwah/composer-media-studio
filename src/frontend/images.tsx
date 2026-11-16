import {
  DEFAULT_RESIZE_LONG_EDGE,
  CROP_ASPECTS,
  CROP_ASPECT_LABELS,
  defaultLongEdge,
  describeTransform,
  extensionForImageMime,
  mimeForExport,
  planImageTransform,
  rotatedDimensions,
  type CropAspectKey,
  type ImageCrop,
  type ResizePlan,
  type TransformPlan,
} from "./image-ops.mjs";
import {
  MAX_BATCH_IMAGES,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES,
  MAX_ZIP_BYTES,
  imageInputProblem,
  imagePixelProblem,
} from "./image-limits.mjs";
import {
  inspectImage,
  sniffLocalImage,
  stripImageMetadata,
  type ImageMetadataSummary,
  type StripResult,
} from "./image-metadata.mjs";
import { createZip, ZIP_MIME } from "./image-zip.mjs";
import { LocalImport } from "./local-import";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./audio-trim.css";
import "./images.css";

type ExportFormat = "png" | "jpeg" | "webp";
type ResizeMode = "long-edge" | "exact";
type ItemStatus = "ready" | "working" | "done" | "error" | "cancelled";

type Settings = {
  resizeMode: ResizeMode;
  longEdge: number;
  exactWidth: number;
  exactHeight: number;
  cropAspect: CropAspectKey;
  rotate: 0 | 1 | 2 | 3;
  flipH: boolean;
  flipV: boolean;
  format: ExportFormat;
  quality: number;
  matte: string;
};

type TransformResult = Extract<TransformPlan, { ok: true }>;

type RenderedImage = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  sha256: string;
  plan: TransformResult;
  settingsKey: string;
  settings: Settings;
  sourceWidth: number;
  sourceHeight: number;
};

type StrippedImage = {
  blob: Blob;
  url: string;
  bytes: number;
  mime: string;
  removed: string[];
  warning: string | null;
  keptOrientation: boolean;
  changed: boolean;
  verified: StripResult["verified"];
  after: ImageMetadataSummary;
};

type WorkItem = {
  id: string;
  file: File;
  url: string;
  source: ImageMetadataSummary;
  sourceHash: string;
  status: ItemStatus;
  result?: RenderedImage;
  stripped?: StrippedImage;
  error?: string;
};

type Rejection = { name: string; message: string };

const DEFAULT_SETTINGS: Settings = {
  resizeMode: "long-edge",
  longEdge: DEFAULT_RESIZE_LONG_EDGE,
  exactWidth: 1600,
  exactHeight: 1200,
  cropAspect: "original",
  rotate: 0,
  flipH: false,
  flipV: false,
  format: "png",
  quality: 0.9,
  matte: "#ffffff",
};

const FORMATS: Array<{ value: ExportFormat; label: string; mime: string }> = [
  { value: "png", label: "PNG · lossless", mime: "image/png" },
  { value: "jpeg", label: "JPEG · smaller", mime: "image/jpeg" },
  { value: "webp", label: "WebP · smaller", mime: "image/webp" },
];

const ORIENTATION_LABELS: Record<number, string> = {
  1: "normal",
  2: "mirror horizontal",
  3: "rotate 180°",
  4: "mirror vertical",
  5: "transpose",
  6: "rotate 90° clockwise",
  7: "transverse",
  8: "rotate 270° clockwise",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 12)}…` : "—";
}

function safeStem(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "image"
  );
}

function settingsKey(settings: Settings): string {
  return JSON.stringify(settings);
}

function resizeFor(settings: Settings): ResizePlan {
  if (settings.resizeMode === "exact")
    return { mode: "exact", width: settings.exactWidth, height: settings.exactHeight };
  return { mode: "long-edge", longEdge: settings.longEdge };
}

function makePlan(source: ImageMetadataSummary, settings: Settings): TransformPlan {
  return planImageTransform({
    sourceWidth: source.orientedWidth,
    sourceHeight: source.orientedHeight,
    rotate: settings.rotate,
    flipH: settings.flipH,
    flipV: settings.flipV,
    cropAspect: CROP_ASPECTS[settings.cropAspect],
    resize: resizeFor(settings),
  });
}

function abortError(): DOMException {
  return new DOMException("Cancelled. Completed downloads are unchanged.", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("This browser could not encode the result. Try a smaller image or another format."));
          else resolve(blob);
        },
        type,
        quality,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error("This browser could not encode the result."));
    }
  });
}

/**
 * Apply the EXIF orientation to a raw bitmap. `imageOrientation: "none"` keeps
 * browser behaviour deterministic, so the same matrix is used here and tested
 * by the metadata parser's orientation facts.
 */
function drawOriented(bitmap: ImageBitmap, orientation: number): HTMLCanvasElement {
  const swap = orientation >= 5 && orientation <= 8;
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? sourceHeight : sourceWidth;
  canvas.height = swap ? sourceWidth : sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a drawing surface.");
  switch (orientation) {
    case 2:
      context.setTransform(-1, 0, 0, 1, sourceWidth, 0);
      break;
    case 3:
      context.setTransform(-1, 0, 0, -1, sourceWidth, sourceHeight);
      break;
    case 4:
      context.setTransform(1, 0, 0, -1, 0, sourceHeight);
      break;
    case 5:
      context.setTransform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.setTransform(0, 1, -1, 0, sourceHeight, 0);
      break;
    case 7:
      context.setTransform(0, -1, -1, 0, sourceHeight, sourceWidth);
      break;
    case 8:
      context.setTransform(0, -1, 1, 0, 0, sourceWidth);
      break;
    default:
      context.setTransform(1, 0, 0, 1, 0, 0);
  }
  context.drawImage(bitmap, 0, 0);
  return canvas;
}

function drawUserTransform(
  source: HTMLCanvasElement,
  rotate: number,
  flipH: boolean,
  flipV: boolean,
): HTMLCanvasElement {
  const dimensions = rotatedDimensions(source.width, source.height, rotate);
  if (!dimensions) throw new Error("The rotation is invalid.");
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a drawing surface.");
  if (flipH) {
    context.translate(dimensions.width, 0);
    context.scale(-1, 1);
  }
  if (flipV) {
    context.translate(0, dimensions.height);
    context.scale(1, -1);
  }
  if (rotate === 1) {
    context.translate(dimensions.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotate === 2) {
    context.translate(dimensions.width, dimensions.height);
    context.rotate(Math.PI);
  } else if (rotate === 3) {
    context.translate(0, dimensions.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, 0, 0);
  return canvas;
}

async function renderImage(item: WorkItem, settings: Settings, signal: AbortSignal): Promise<RenderedImage> {
  if (signal.aborted) throw abortError();
  let bitmap: ImageBitmap | null = null;
  let oriented: HTMLCanvasElement | null = null;
  let transformed: HTMLCanvasElement | null = null;
  let output: HTMLCanvasElement | null = null;
  try {
    let explicitNone = false;
    try {
      bitmap = await createImageBitmap(item.file, { imageOrientation: "none" });
      explicitNone = true;
    } catch {
      bitmap = await createImageBitmap(item.file);
    }
    if (signal.aborted) throw abortError();
    if (!bitmap || bitmap.width < 1 || bitmap.height < 1)
      throw new Error("This browser could not decode that image.");
    const swapped =
      item.source.width !== item.source.height &&
      bitmap.width === item.source.height &&
      bitmap.height === item.source.width;
    const browserAppliedOrientation = explicitNone
      ? item.source.orientation >= 5 && swapped
      : true;
    if (
      explicitNone &&
      !browserAppliedOrientation &&
      (bitmap.width !== item.source.width || bitmap.height !== item.source.height)
    )
      throw new Error("The decoded image size did not match its header. Try exporting a standard JPEG, PNG or WebP.");
    const orientation = browserAppliedOrientation ? 1 : item.source.orientation;
    oriented = drawOriented(bitmap, orientation);
    bitmap.close();
    bitmap = null;
    if (signal.aborted) throw abortError();

    let plan = makePlan(
      {
        ...item.source,
        orientedWidth: oriented.width,
        orientedHeight: oriented.height,
        width: browserAppliedOrientation ? oriented.width : item.source.width,
        height: browserAppliedOrientation ? oriented.height : item.source.height,
        orientation,
      },
      settings,
    );
    if (!plan.ok) throw new Error(plan.error);
    let stage = oriented;
    if (settings.rotate !== 0 || settings.flipH || settings.flipV) {
      transformed = drawUserTransform(stage, settings.rotate, settings.flipH, settings.flipV);
      stage.width = 0;
      stage.height = 0;
      stage = transformed;
      const actual = planImageTransform({
        sourceWidth: stage.width,
        sourceHeight: stage.height,
        cropAspect: CROP_ASPECTS[settings.cropAspect],
        resize: resizeFor(settings),
      });
      if (!actual.ok) throw new Error(actual.error);
      plan = {
        ...actual,
        sourceWidth: oriented.width,
        sourceHeight: oriented.height,
        rotate: settings.rotate,
        flipH: settings.flipH,
        flipV: settings.flipV,
        rotatedWidth: stage.width,
        rotatedHeight: stage.height,
      };
    }
    if (stage.width !== plan.rotatedWidth || stage.height !== plan.rotatedHeight)
      throw new Error("The transform plan did not match the decoded image.");
    const crop: ImageCrop = plan.crop;
    if (
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width < 1 ||
      crop.height < 1 ||
      crop.x + crop.width > stage.width ||
      crop.y + crop.height > stage.height
    )
      throw new Error("The crop did not fit inside the decoded image.");

    output = document.createElement("canvas");
    output.width = plan.outputWidth;
    output.height = plan.outputHeight;
    const context = output.getContext("2d");
    if (!context) throw new Error("This browser could not create a drawing surface.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (settings.format === "jpeg") {
      context.fillStyle = settings.matte;
      context.fillRect(0, 0, output.width, output.height);
    }
    context.drawImage(
      stage,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      plan.outputWidth,
      plan.outputHeight,
    );
    if (signal.aborted) throw abortError();
    const mime = mimeForExport(settings.format);
    const blob = await canvasToBlob(
      output,
      mime,
      settings.format === "png" ? undefined : settings.quality,
    );
    if (signal.aborted) throw abortError();
    if (blob.type !== mime)
      throw new Error(
        `This browser encoded ${blob.type || "another format"} instead of ${mime}. Choose PNG or use a current browser.`,
      );
    if (!blob.size) throw new Error("The result was empty.");
    if (blob.size > MAX_IMAGE_OUTPUT_BYTES)
      throw new Error(`The result is larger than ${MAX_IMAGE_OUTPUT_BYTES / 1024 / 1024} MiB. Try a smaller size or less quality.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sniffed = sniffLocalImage(bytes);
    if (!sniffed.supported || sniffed.mime !== mime)
      throw new Error("The browser wrote a file that did not verify as the chosen image format.");
    const digest = await sha256Hex(bytes);
    return {
      blob,
      url: "",
      width: output.width,
      height: output.height,
      bytes: blob.size,
      mime,
      sha256: digest,
      plan,
      settingsKey: settingsKey(settings),
      settings: { ...settings },
      sourceWidth: oriented.width,
      sourceHeight: oriented.height,
    };
  } finally {
    bitmap?.close();
    if (oriented) {
      oriented.width = 0;
      oriented.height = 0;
    }
    if (transformed) {
      transformed.width = 0;
      transformed.height = 0;
    }
    if (output) {
      output.width = 0;
      output.height = 0;
    }
  }
}

function drawSample(canvas: HTMLCanvasElement): void {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0f3f3b");
  gradient.addColorStop(0.55, "#1f5c58");
  gradient.addColorStop(1, "#d9b26f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 0.22;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  for (let x = -height; x < width; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
  context.globalAlpha = 1;
  const shapes = [
    { x: width * 0.18, y: height * 0.6, r: height * 0.26, color: "#f0b35b" },
    { x: width * 0.42, y: height * 0.36, r: height * 0.18, color: "#f7f1e6" },
    { x: width * 0.7, y: height * 0.58, r: height * 0.32, color: "#8adeb0" },
  ];
  for (const shape of shapes) {
    context.globalAlpha = 0.82;
    context.fillStyle = shape.color;
    context.beginPath();
    context.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.fillStyle = "#f7f1e6";
  context.font = `700 ${Math.round(height * 0.1)}px system-ui, sans-serif`;
  context.fillText("LOCAL IMAGE", width * 0.07, height * 0.24);
  context.font = `500 ${Math.round(height * 0.042)}px system-ui, sans-serif`;
  context.fillText("A sample made in this tab. Drag it, crop it, export it.", width * 0.07, height * 0.32);
  context.fillStyle = "rgba(0,0,0,0.32)";
  context.fillRect(0, height - Math.round(height * 0.13), width, Math.round(height * 0.13));
  context.fillStyle = "#f7f1e6";
  context.font = `500 ${Math.round(height * 0.035)}px system-ui, sans-serif`;
  context.fillText("Media Studio · signed-out local workbench", width * 0.07, height - Math.round(height * 0.052));
}

function Images() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState("");
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState({ total: 0, completed: 0, current: "" });
  const [zipUrl, setZipUrl] = useState("");
  const [zipBytes, setZipBytes] = useState(0);
  const [zipBusy, setZipBusy] = useState(false);
  const [stripBusy, setStripBusy] = useState(false);
  const [removeIcc, setRemoveIcc] = useState(false);
  const [importing, setImporting] = useState(false);
  const urls = useRef(new Set<string>());
  const revision = useRef(0);
  const batchController = useRef<AbortController | null>(null);
  const stripRevision = useRef(0);
  const didInitSettings = useRef(false);
  const addFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const addingRef = useRef(false);
  const runningRef = useRef(false);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const plan = selected ? makePlan(selected.source, settings) : null;
  const currentSettingsKey = settingsKey(settings);
  const freshResult = selected?.result?.settingsKey === currentSettingsKey;
  const doneItems = items.filter((item) => item.result);
  const importBlob = selected?.result?.blob ?? selected?.stripped?.blob ?? null;
  const importFormat: "png" | "jpeg" | "webp" | null = selected?.result
    ? selected.result.mime === "image/jpeg"
      ? "jpeg"
      : selected.result.mime === "image/webp"
        ? "webp"
        : "png"
    : selected?.stripped
      ? selected.stripped.mime === "image/jpeg"
        ? "jpeg"
        : selected.stripped.mime === "image/webp"
          ? "webp"
          : "png"
      : null;
  const importFilename = selected?.result
    ? `${safeStem(selected.file.name)}-${selected.result.width}x${selected.result.height}.${extensionForImageMime(selected.result.mime)}`
    : selected?.stripped
      ? `${safeStem(selected.file.name)}-metadata-stripped.${extensionForImageMime(selected.stripped.mime)}`
      : "";
  const importCaption =
    selected && (selected.result || selected.stripped)
      ? selected.result
        ? `Local image transform. Source: ${selected.file.name.slice(0, 80)} (sha256 ${selected.sourceHash}). ${describeTransform({
            rotate: selected.result.settings.rotate,
            flipH: selected.result.settings.flipH,
            flipV: selected.result.settings.flipV,
            cropAspect: selected.result.settings.cropAspect === "original" ? null : CROP_ASPECTS[selected.result.settings.cropAspect],
            resize: resizeFor(selected.result.settings),
            format: selected.result.settings.format,
            quality: selected.result.settings.format === "png" ? null : selected.result.settings.quality,
            metadata: "canvas re-encode",
          })}.`
        : `Local metadata-only pass. Source: ${selected.file.name.slice(0, 80)} (sha256 ${selected.sourceHash}). Pixels copied without re-encoding; removable metadata was stripped.`
      : "";

  function trackUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }

  function releaseUrl(url: string | undefined): void {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
  }

  function releaseItem(item: WorkItem): void {
    releaseUrl(item.url);
    releaseUrl(item.result?.url);
    releaseUrl(item.stripped?.url);
  }

  function clearZip(): void {
    if (!zipUrl) return;
    releaseUrl(zipUrl);
    setZipUrl("");
    setZipBytes(0);
  }

  useEffect(() => {
    return () => {
      revision.current += 1;
      stripRevision.current += 1;
      batchController.current?.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith("image/") || /\.(?:jpe?g|png|webp)$/i.test(file.name),
      );
      if (!files.length) return;
      event.preventDefault();
      void addFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function addFiles(files: File[]): Promise<void> {
    if (!files.length || addingRef.current || runningRef.current) return;
    addingRef.current = true;
    const currentRevision = ++revision.current;
    setAdding(true);
    setRejections([]);
    clearZip();
    const available = Math.max(0, MAX_BATCH_IMAGES - items.length);
    if (!available) {
      setMessage(`This batch already has ${MAX_BATCH_IMAGES} images. Remove one before adding another.`);
      setAdding(false);
      addingRef.current = false;
      return;
    }
    const candidates = files.slice(0, available);
    if (files.length > available)
      setMessage(`Only ${available} more image${available === 1 ? "" : "s"} can join this ${MAX_BATCH_IMAGES}-image batch.`);
    const localRejections: Rejection[] = [];
    let added = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (currentRevision !== revision.current) break;
      const file = candidates[index];
      const problem = imageInputProblem({ name: file.name, type: file.type, size: file.size });
      if (problem) {
        localRejections.push({ name: file.name, message: problem });
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        if (currentRevision !== revision.current) break;
        if (buffer.byteLength > MAX_IMAGE_INPUT_BYTES) throw new Error(`Keep image files at or below ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB.`);
        const bytes = new Uint8Array(buffer);
        const sniffed = sniffLocalImage(bytes);
        if (!sniffed.supported)
          throw new Error(sniffed.reason ?? "This is not a JPEG, PNG or WebP image.");
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
        const sourceHash = await sha256Hex(bytes);
        if (currentRevision !== revision.current) break;
        const url = trackUrl(file);
        const item: WorkItem = {
          id: crypto.randomUUID(),
          file,
          url,
          source,
          sourceHash,
          status: "ready",
        };
        setItems((previous) => [...previous, item]);
        setSelectedId((previous) => previous || item.id);
        added += 1;
        if (!didInitSettings.current) {
          didInitSettings.current = true;
          setSettings((previous) => ({
            ...previous,
            longEdge: defaultLongEdge(source.orientedWidth, source.orientedHeight),
            exactWidth: source.orientedWidth,
            exactHeight: source.orientedHeight,
          }));
        }
        setMessage(`Checked ${index + 1} of ${candidates.length} on this device.`);
      } catch (error) {
        localRejections.push({
          name: file.name,
          message: error instanceof Error ? error.message : "Could not read this image.",
        });
      }
    }
    if (currentRevision === revision.current) {
      setRejections(localRejections);
      setAdding(false);
      addingRef.current = false;
      setMessage(
        localRejections.length
          ? `${added} image${added === 1 ? "" : "s"} added. ${localRejections.length} file${localRejections.length === 1 ? " was" : "s were"} refused; read the reason below.`
          : `${added} image${added === 1 ? "" : "s"} added locally. Nothing was uploaded.`,
      );
    }
  }
  addFilesRef.current = addFiles;

  async function addSample(): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    drawSample(canvas);
    try {
      const blob = await canvasToBlob(canvas, "image/png");
      await addFiles([new File([blob], "studio-image-sample.png", { type: "image/png" })]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make the sample.");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function removeItem(item: WorkItem): void {
    if (running) return;
    clearZip();
    releaseItem(item);
    setItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
    if (selectedId === item.id) {
      const next = items.find((candidate) => candidate.id !== item.id);
      setSelectedId(next?.id ?? "");
    }
  }

  function resetAll(): void {
    revision.current += 1;
    stripRevision.current += 1;
    batchController.current?.abort();
    addingRef.current = false;
    runningRef.current = false;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setItems([]);
    setSelectedId("");
    setSettings(DEFAULT_SETTINGS);
    setMessage("Cleared. Nothing remains in this tab.");
    setRejections([]);
    setBatch({ total: 0, completed: 0, current: "" });
    setZipUrl("");
    setZipBytes(0);
    didInitSettings.current = false;
  }

  async function runItems(list: WorkItem[]): Promise<void> {
    if (!list.length || runningRef.current) return;
    runningRef.current = true;
    const snapshot = { ...settings };
    const controller = new AbortController();
    batchController.current = controller;
    setRunning(true);
    clearZip();
    setBatch({ total: list.length, completed: 0, current: list[0]?.file.name ?? "" });
    let completed = 0;
    let processed = 0;
    let failed = 0;
    let cancelled = false;
    for (const item of list) {
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      setBatch({ total: list.length, completed: processed, current: item.file.name });
      setItems((previous) =>
        previous.map((candidate) =>
          candidate.id === item.id ? { ...candidate, status: "working", error: undefined } : candidate,
        ),
      );
      try {
        const rendered = await renderImage(item, snapshot, controller.signal);
        if (controller.signal.aborted) {
          cancelled = true;
          setItems((previous) =>
            previous.map((candidate) =>
              candidate.id === item.id ? { ...candidate, status: "cancelled" } : candidate,
            ),
          );
          break;
        }
        const url = trackUrl(rendered.blob);
        releaseUrl(item.result?.url);
        setItems((previous) =>
          previous.map((candidate) => {
            if (candidate.id !== item.id) return candidate;
            return { ...candidate, status: "done", result: { ...rendered, url }, error: undefined };
          }),
        );
        completed += 1;
      } catch (error) {
        if (isAbort(error)) {
          cancelled = true;
          setItems((previous) =>
            previous.map((candidate) =>
              candidate.id === item.id ? { ...candidate, status: "cancelled" } : candidate,
            ),
          );
          break;
        }
        failed += 1;
        setItems((previous) =>
          previous.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "error",
                  error: error instanceof Error ? error.message : "This image could not be processed.",
                }
              : candidate,
          ),
        );
      }
      processed += 1;
      setBatch({ total: list.length, completed: processed, current: item.file.name });
    }
    if (controller.signal.aborted) cancelled = true;
    batchController.current = null;
    runningRef.current = false;
    setRunning(false);
    const stopped = cancelled ? " Batch stopped; completed downloads are kept." : "";
    setMessage(
      `${completed} image${completed === 1 ? "" : "s"} processed${failed ? `, ${failed} failed` : ""}.${stopped} Nothing was uploaded.`,
    );
    setBatch({ total: list.length, completed: processed, current: "" });
  }

  function cancelBatch(): void {
    if (!batchController.current) return;
    batchController.current.abort();
    setMessage("Stopping after the image currently being encoded. Completed results will remain available.");
  }

  async function stripSelected(): Promise<void> {
    if (!selected || stripBusy) return;
    const item = selected;
    const token = ++stripRevision.current;
    setStripBusy(true);
    setMessage("Reading metadata and copying pixels without re-encoding…");
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const result = stripImageMetadata(bytes, { keepColorProfile: !removeIcc });
      if (token !== stripRevision.current) return;
      const blob = blobFromBytes(result.bytes, result.mime);
      const url = trackUrl(blob);
      const stripped: StrippedImage = {
        blob,
        url,
        bytes: blob.size,
        mime: result.mime,
        removed: result.removed,
        warning: result.warning,
        keptOrientation: result.keptOrientation,
        changed: result.changed,
        verified: result.verified,
        after: result.after,
      };
      releaseUrl(item.stripped?.url);
      setItems((previous) =>
        previous.map((candidate) => {
          if (candidate.id !== item.id) return candidate;
          return { ...candidate, stripped };
        }),
      );
      setMessage(
        result.verified.all
          ? result.changed
            ? "Metadata-only copy verified: pixels are byte-identical and the declared metadata was removed."
            : "No removable metadata was found. The verified copy is byte-for-byte unchanged."
          : "The metadata copy did not pass every check. Do not rely on it; the original is unchanged.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not inspect or strip this image.");
    } finally {
      if (token === stripRevision.current) setStripBusy(false);
    }
  }

  async function makeZip(): Promise<void> {
    if (!doneItems.length || zipBusy) return;
    setZipBusy(true);
    setMessage("Building the ZIP on this device…");
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      let total = 0;
      for (const item of doneItems) {
        if (!item.result) continue;
        const bytes = new Uint8Array(await item.result.blob.arrayBuffer());
        total += bytes.length;
        if (total > MAX_ZIP_BYTES)
          throw new Error(`ZIP export stays under ${MAX_ZIP_BYTES / 1024 / 1024} MiB. Download images separately instead.`);
        entries.push({
          name: `${safeStem(item.file.name)}-${item.result.width}x${item.result.height}.${extensionForImageMime(item.result.mime)}`,
          data: bytes,
        });
      }
      const zip = createZip(entries, { date: new Date() });
      if (!zip.ok) throw new Error(zip.error);
      const blob = blobFromBytes(zip.bytes, ZIP_MIME);
      const url = trackUrl(blob);
      if (zipUrl) releaseUrl(zipUrl);
      setZipUrl(url);
      setZipBytes(blob.size);
      setMessage(`ZIP ready: ${entries.length} image${entries.length === 1 ? "" : "s"}, ${formatBytes(blob.size)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not build the ZIP.");
    } finally {
      setZipBusy(false);
    }
  }

  function setNextFormat(format: ExportFormat): void {
    setSettings((previous) => ({ ...previous, format }));
  }

  return (
    <main className="trim-page image-page" id="main">
      <header>
        <a href="/">← Media Studio</a>
        <p className="eyebrow">Signed-out · browser-local</p>
        <h1>Image workbench</h1>
        <p>
          Resize, crop, rotate, convert and inspect images on this device. There is no
          sign-in, no provider, no upload and no external image request. Your original
          File stays unchanged in this tab.
        </p>
      </header>

      <section className="trim-work image-source" aria-labelledby="image-source-heading">
        <div className="image-section-head">
          <h2 id="image-source-heading">Add images</h2>
          <span>{items.length} of {MAX_BATCH_IMAGES}</span>
        </div>
        <label
          className={`image-drop${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles([...event.dataTransfer.files]);
          }}
        >
          <strong>Drop images here</strong>
          <span>or choose files · paste anywhere on this page</span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={adding || running || items.length >= MAX_BATCH_IMAGES}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void addFiles(files);
            }}
          />
        </label>
        <div className="image-source-actions">
          <button type="button" className="secondary" onClick={() => void addSample()} disabled={adding || running || items.length >= MAX_BATCH_IMAGES}>
            Try the sample
          </button>
          {items.length > 0 && (
            <button type="button" className="quiet" onClick={resetAll} disabled={running || adding}>
              Clear all
            </button>
          )}
        </div>
        <p className="trim-note">
          JPEG, PNG or WebP up to {MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB and 40
          megapixels each. Up to {MAX_BATCH_IMAGES} images, processed one at a time.
          SVG, HTML, HEIC/HEIF, AVIF, GIF and other formats are refused honestly in
          this slice; they are not silently decoded.
        </p>
        <p className="trim-note">
          JPEG EXIF orientation is applied before editing. The source facts and the
          sample are read from the actual bytes and pixels, not from the filename.
        </p>
        <p role="status" aria-live="polite" className="image-status">
          {adding ? "Checking files on this device…" : message}
        </p>
        {rejections.length > 0 && (
          <details className="image-rejections" open>
            <summary>{rejections.length} refused file{rejections.length === 1 ? "" : "s"}</summary>
            <ul>
              {rejections.map((rejection) => (
                <li key={`${rejection.name}:${rejection.message}`}>
                  <strong>{rejection.name}</strong> — {rejection.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {selected && (
        <section className="trim-work" aria-labelledby="image-edit-heading">
          <div className="image-section-head">
            <h2 id="image-edit-heading">Edit {selected.file.name}</h2>
            <span>{selected.source.orientation === 1 ? "no EXIF rotation" : `EXIF ${ORIENTATION_LABELS[selected.source.orientation] ?? selected.source.orientation}`}</span>
          </div>
          <dl className="image-facts">
            <div><dt>Source</dt><dd>{selected.source.width} × {selected.source.height} px</dd></div>
            <div><dt>Displayed</dt><dd>{selected.source.orientedWidth} × {selected.source.orientedHeight} px</dd></div>
            <div><dt>Type</dt><dd>{selected.source.mime}</dd></div>
            <div><dt>Bytes</dt><dd>{formatBytes(selected.file.size)}</dd></div>
            <div><dt>Alpha channel</dt><dd>{selected.source.alpha ? "yes" : "no"}</dd></div>
            <div><dt>SHA-256</dt><dd title={selected.sourceHash}><code>{shortHash(selected.sourceHash)}</code></dd></div>
          </dl>

          <fieldset className="image-controls">
            <legend>Resize and crop</legend>
            <label>Resize by
              <select value={settings.resizeMode} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, resizeMode: event.target.value as ResizeMode }))}>
                <option value="long-edge">Long edge</option>
                <option value="exact">Exact width and height</option>
              </select>
            </label>
            {settings.resizeMode === "long-edge" ? (
              <label>Long edge (px)
                <input type="number" min="1" max="8192" step="1" value={Number.isFinite(settings.longEdge) ? settings.longEdge : ""} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, longEdge: event.target.value === "" ? Number.NaN : Number(event.target.value) }))} />
              </label>
            ) : (
              <>
                <label>Width (px)
                  <input type="number" min="1" max="8192" step="1" value={Number.isFinite(settings.exactWidth) ? settings.exactWidth : ""} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, exactWidth: event.target.value === "" ? Number.NaN : Number(event.target.value) }))} />
                </label>
                <label>Height (px)
                  <input type="number" min="1" max="8192" step="1" value={Number.isFinite(settings.exactHeight) ? settings.exactHeight : ""} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, exactHeight: event.target.value === "" ? Number.NaN : Number(event.target.value) }))} />
                </label>
              </>
            )}
            <label>Centre crop
              <select value={settings.cropAspect} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, cropAspect: event.target.value as CropAspectKey }))}>
                {Object.entries(CROP_ASPECT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <div className="image-control-actions">
              <button type="button" className="secondary" disabled={running || !selected} onClick={() => setSettings((previous) => ({ ...previous, resizeMode: "exact", exactWidth: selected.source.orientedWidth, exactHeight: selected.source.orientedHeight }))}>Use displayed size</button>
              <button type="button" className="secondary" disabled={running} onClick={() => setSettings((previous) => ({ ...previous, resizeMode: "long-edge", longEdge: defaultLongEdge(selected.source.orientedWidth, selected.source.orientedHeight) }))}>Use 2048 max</button>
            </div>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Rotate and flip</legend>
            <div className="image-control-actions">
              <button type="button" className="secondary" disabled={running} onClick={() => setSettings((previous) => ({ ...previous, rotate: ((previous.rotate + 3) % 4) as Settings["rotate"] }))}>Rotate left</button>
              <button type="button" className="secondary" disabled={running} onClick={() => setSettings((previous) => ({ ...previous, rotate: ((previous.rotate + 1) % 4) as Settings["rotate"] }))}>Rotate right</button>
              <button type="button" className="secondary" disabled={running} onClick={() => setSettings((previous) => ({ ...previous, rotate: 0 }))}>Reset rotation</button>
            </div>
            <label className="image-check"><input type="checkbox" checked={settings.flipH} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, flipH: event.target.checked }))} /> Flip horizontal</label>
            <label className="image-check"><input type="checkbox" checked={settings.flipV} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, flipV: event.target.checked }))} /> Flip vertical</label>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Export</legend>
            <label>Format
              <select value={settings.format} disabled={running} onChange={(event) => setNextFormat(event.target.value as ExportFormat)}>
                {FORMATS.map((format) => <option value={format.value} key={format.value}>{format.label}</option>)}
              </select>
            </label>
            <label>Quality {settings.format === "png" ? "(PNG is lossless)" : `${Math.round(settings.quality * 100)}%`}
              <input type="range" min="0.5" max="1" step="0.01" value={settings.quality} disabled={running || settings.format === "png"} onChange={(event) => setSettings((previous) => ({ ...previous, quality: Number(event.target.value) }))} />
            </label>
            {settings.format === "jpeg" && (
              <label>Matte colour for transparency
                <input type="color" value={settings.matte} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, matte: event.target.value }))} />
              </label>
            )}
          </fieldset>

          <p className={`image-plan${plan && !plan.ok ? " is-error" : ""}`}>
            {plan?.ok
              ? `Planned result: ${plan.outputWidth} × ${plan.outputHeight} px${plan.aspectDistorted ? " · exact dimensions change the aspect" : ""}${plan.upscaled ? " · enlarged by resampling; no detail is invented" : ""}.`
              : plan?.error ?? "Choose a usable size."}
          </p>
          <div className="image-control-actions">
            <button type="button" disabled={running || adding || !plan?.ok} onClick={() => void runItems([selected])}>
              {selected.status === "working" ? "Processing…" : "Make this image"}
            </button>
            {selected.status === "error" && (
              <button type="button" className="secondary" disabled={running} onClick={() => void runItems([selected])}>Retry</button>
            )}
          </div>

          <div className="image-compare">
            <figure>
              <figcaption>Before · {selected.source.orientedWidth} × {selected.source.orientedHeight} · {formatBytes(selected.file.size)}</figcaption>
              <img src={selected.url} alt={`Original ${selected.file.name}`} />
            </figure>
            {selected.result && (
              <figure>
                <figcaption>
                  After · {selected.result.width} × {selected.result.height} · {formatBytes(selected.result.bytes)} · {selected.result.mime}
                </figcaption>
                <img src={selected.result.url} alt={`Processed ${selected.file.name}`} />
              </figure>
            )}
          </div>
          {selected.result && (
            <div className="image-result">
              <p>
                <strong>Your result</strong> · SHA-256 <code title={selected.result.sha256}>{shortHash(selected.result.sha256)}</code> · original unchanged.
              </p>
              {!freshResult && <p className="notice calm">The settings changed since this result. Make the image again to match the current controls; the existing download is still valid for the earlier settings.</p>}
              <a
                className="button"
                href={selected.result.url}
                download={`${safeStem(selected.file.name)}-${selected.result.width}x${selected.result.height}.${extensionForImageMime(selected.result.mime)}`}
              >
                Download {selected.result.mime.replace("image/", "").toUpperCase()}
              </a>
            </div>
          )}
          {selected.error && <p className="notice warn" role="alert">{selected.error}</p>}
        </section>
      )}

      {selected && (
        <section className="trim-work image-metadata" aria-labelledby="image-metadata-heading">
          <div className="image-section-head">
            <h2 id="image-metadata-heading">Inspect metadata</h2>
            <span>{selected.source.hasMetadata ? "metadata found" : "no declared metadata"}</span>
          </div>
          <dl className="image-facts">
            <div><dt>Camera</dt><dd>{selected.source.camera ? [selected.source.camera.make, selected.source.camera.model].filter(Boolean).join(" ") : "none read"}</dd></div>
            <div><dt>Orientation</dt><dd>{ORIENTATION_LABELS[selected.source.orientation] ?? `tag ${selected.source.orientation}`}</dd></div>
            <div><dt>GPS</dt><dd className={selected.source.gps ? "image-danger" : ""}>{selected.source.gps ? "present" : "none read"}</dd></div>
            <div><dt>EXIF</dt><dd>{selected.source.exif.present ? `${selected.source.exif.entries} tag${selected.source.exif.entries === 1 ? "" : "s"}${selected.source.exif.error ? " · structure unreadable" : ""}` : "none"}</dd></div>
            <div><dt>ICC colour profile</dt><dd>{selected.source.icc.present ? formatBytes(selected.source.icc.bytes) : "none"}</dd></div>
            <div><dt>XMP</dt><dd>{selected.source.xmp.present ? formatBytes(selected.source.xmp.bytes) : "none"}</dd></div>
            <div><dt>Text / comments</dt><dd>{selected.source.text.present ? `${selected.source.text.count} block${selected.source.text.count === 1 ? "" : "s"}` : "none"}</dd></div>
            <div><dt>Other</dt><dd>{selected.source.other.present ? selected.source.other.labels.map((entry) => `${entry.label}${entry.count > 1 ? ` ×${entry.count}` : ""}`).join(", ") : "none"}</dd></div>
          </dl>
          <p className="trim-note">
            Metadata is only part of privacy. Removing tags does not remove faces, places,
            reflections, documents or other clues in the pixels, and it cannot guarantee
            anonymity. This tool does not claim that it does.
          </p>
          <label className="image-check">
            <input type="checkbox" checked={removeIcc} disabled={stripBusy || running} onChange={(event) => setRemoveIcc(event.target.checked)} />
            Also remove the ICC colour profile — this can change how colours appear in other apps
          </label>
          <div className="image-control-actions">
            <button type="button" className="secondary" disabled={stripBusy || running || !selected} onClick={() => void stripSelected()}>
              {stripBusy ? "Stripping and verifying…" : "Strip metadata and verify"}
            </button>
          </div>
          {selected.stripped && (
            <div className="image-strip-result">
              <p>
                <strong>{selected.stripped.changed ? "Metadata-only copy ready" : "No removable metadata found"}</strong>{" "}
                · {formatBytes(selected.file.size)} → {formatBytes(selected.stripped.bytes)} · pixels {selected.stripped.verified.pixelsUnchanged ? "byte-identical" : "did not verify"} · {selected.stripped.keptOrientation ? "orientation tag retained" : "no orientation tag needed"}.
              </p>
              <ul className="image-checks">
                <li className={selected.stripped.verified.pixelsUnchanged ? "is-ok" : "is-bad"}>Pixels unchanged: {selected.stripped.verified.pixelsUnchanged ? "verified" : "failed"}</li>
                <li className={selected.stripped.verified.dimensionsMatch ? "is-ok" : "is-bad"}>Dimensions and orientation match: {selected.stripped.verified.dimensionsMatch ? "verified" : "failed"}</li>
                <li className={selected.stripped.verified.metadataRemoved ? "is-ok" : "is-bad"}>Declared metadata removed: {selected.stripped.verified.metadataRemoved ? "verified" : "failed"}</li>
              </ul>
              <p className="trim-note">
                Verified copy: {selected.stripped.after.gps ? "GPS still present" : "no GPS"} ·{" "}
                {selected.stripped.after.exif.entries} EXIF tag{selected.stripped.after.exif.entries === 1 ? "" : "s"} ·{" "}
                {selected.stripped.after.xmp.present ? "XMP still present" : "no XMP"} ·{" "}
                {selected.stripped.after.text.present ? "text still present" : "no text/comment"}.
              </p>
              {selected.stripped.changed && selected.stripped.removed.length > 0 && <p className="trim-note">Removed: {selected.stripped.removed.join(", ")}.</p>}
              {selected.stripped.after.other.present && (
                <p className="trim-note">
                  Retained display or colour chunks: {selected.stripped.after.other.labels.map((entry) => entry.label).join(", ")}. They are not identity tags, but they are still metadata.
                </p>
              )}
              {selected.stripped.after.icc.present && <p className="trim-note">ICC profile retained. Tick the option above and strip again if you need it removed.</p>}
              {selected.stripped.warning && <p className="notice warn">{selected.stripped.warning}</p>}
              {selected.stripped.verified.all ? (
                <a className="button" href={selected.stripped.url} download={`${safeStem(selected.file.name)}-metadata-stripped.${extensionForImageMime(selected.stripped.mime)}`}>
                  Download verified copy
                </a>
              ) : (
                <p className="notice warn" role="alert">This copy did not pass verification. The original is unchanged; do not rely on this download.</p>
              )}
            </div>
          )}
        </section>
      )}

      {selected && importBlob && importFormat && (
        <section className="trim-work image-import" aria-labelledby="image-import-heading">
          <h2 id="image-import-heading">Studio import (optional)</h2>
          <p className="trim-note">
            This is the only action that can upload a result. It needs a signed-in Studio
            session and a project you choose, and the result is saved as a private library
            asset. Nothing is published automatically.
          </p>
          <LocalImport
            key={`${selected.id}:${importBlob.size}:${importFormat}`}
            blob={importBlob}
            filename={importFilename}
            operation={selected.result ? "resize, crop and convert image" : "strip image metadata"}
            format={importFormat}
            caption={importCaption}
            onBusyChange={setImporting}
          />
        </section>
      )}

      <section className="trim-work image-batch" aria-labelledby="image-batch-heading">
        <div className="image-section-head">
          <h2 id="image-batch-heading">Batch</h2>
          <span>{items.length} image{items.length === 1 ? "" : "s"} · sequential</span>
        </div>
        <div className="image-control-actions">
          <button type="button" disabled={running || adding || !items.length || !plan?.ok} onClick={() => void runItems(items)}>
            Process all {items.length || ""} with these settings
          </button>
          {running && <button type="button" className="secondary" onClick={cancelBatch}>Cancel batch</button>}
          <button type="button" className="secondary" disabled={running || zipBusy || !doneItems.length} onClick={() => void makeZip()}>
            {zipBusy ? "Building ZIP…" : `Download ZIP${doneItems.length ? ` (${doneItems.length})` : ""}`}
          </button>
          {zipUrl && (
            <a className="button secondary" href={zipUrl} download={`media-studio-images-${doneItems.length}.zip`}>
              Save ZIP · {formatBytes(zipBytes)}
            </a>
          )}
        </div>
        {running && (
          <div className="image-progress">
            <progress value={batch.completed} max={batch.total || 1} aria-label="Batch progress" />
            <span role="status" aria-live="polite">
              {batch.completed} of {batch.total} complete{batch.current ? ` · ${batch.current}` : ""}
            </span>
          </div>
        )}
        {items.length > 0 && (
          <ul className="image-list">
            {items.map((item) => (
              <li className={item.id === selectedId ? "is-selected" : ""} key={item.id}>
                <button type="button" className="image-list-select" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === selectedId}>
                  <span className="image-list-name">{item.file.name}</span>
                  <span className="image-list-meta">
                    {item.source.orientedWidth} × {item.source.orientedHeight} · {formatBytes(item.file.size)} · {item.status}
                    {item.result ? ` · ${item.result.width} × ${item.result.height} · ${formatBytes(item.result.bytes)}` : ""}
                  </span>
                  {item.error && <span className="image-list-error">{item.error}</span>}
                </button>
                <div className="image-list-actions">
                  {item.result && (
                    <a className="button secondary" href={item.result.url} download={`${safeStem(item.file.name)}-${item.result.width}x${item.result.height}.${extensionForImageMime(item.result.mime)}`}>Download</a>
                  )}
                  {(item.status === "error" || item.status === "cancelled") && (
                    <button type="button" className="secondary" disabled={running} onClick={() => void runItems([item])}>Retry</button>
                  )}
                  <button type="button" className="quiet" disabled={running || adding || importing} onClick={() => removeItem(item)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="trim-note">
          Each image is decoded and encoded one at a time. Cancelling stops after the
          current encode; already completed downloads stay in the list. ZIP export uses
          a small store-only writer in this page, not a server archive.
        </p>
      </section>
    </main>
  );
}

export function mountImages(container: HTMLElement) {
  createRoot(container).render(<Images />);
}
