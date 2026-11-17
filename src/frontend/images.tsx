import {
  DEFAULT_RESIZE_LONG_EDGE,
  CROP_ANCHOR_LABELS,
  MAX_STRAIGHTEN_DEGREES,
  CROP_ASPECTS,
  CROP_ASPECT_LABELS,
  defaultLongEdge,
  describeTransform,
  extensionForImageMime,
  imageSmoothingFor,
  keptAreaPolygon,
  mimeForExport,
  planImageTransform,
  rotatedDimensions,
  searchTargetQuality,
  targetSizeProblem,
  type CropAnchorKey,
  type CropAspectKey,
  type ImageCrop,
  type ResizePlan,
  type TransformPlan,
} from "./image-ops.ts";
import {
  ADJUSTMENT_KEYS,
  ADJUSTMENT_LABELS,
  ADJUSTMENT_PRESETS,
  ADJUSTMENT_RANGE,
  DEFAULT_ADJUSTMENTS,
  adjustPixels,
  adjustmentsAreNeutral,
  describeAdjustments,
  normaliseAdjustments,
  presetAdjustments,
  presetIdFor,
  type AdjustmentKey,
  type Adjustments,
} from "./image-adjust.ts";
import {
  MAX_SNIPPET_BYTES,
  SNIPPET_KINDS,
  SNIPPET_LABELS,
  buildImageSnippets,
  type SnippetKind,
  type SnippetResult,
} from "./image-snippets.mjs";
import {
  MAX_PALETTE_COLOURS,
  PALETTE_WORKING_EDGE,
  alphaBounds,
  extractPalette,
  formatHsl,
  formatRgb,
  mapBoundsThroughTransform,
  paletteToAse,
  paletteToCss,
  paletteToGpl,
  paletteToJson,
  pickImagePixel,
  rgbToHex,
  rgbToHsl,
  type ImageBounds,
  type PaletteResult,
  type Rgb,
} from "./image-colour.ts";
import {
  MAX_BATCH_IMAGES,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES,
  MAX_ZIP_BYTES,
  imageInputProblem,
  imagePixelProblem,
} from "./image-limits.ts";
import {
  inspectImage,
  sniffLocalImage,
  stripImageMetadata,
  type ImageMetadataSummary,
  type StripResult,
} from "./image-metadata.mjs";
import { createZip, ZIP_MIME } from "./image-zip.ts";
import { buildImageReceipt, type ImageReceipt } from "./image-receipt.ts";
import {
  SOCIAL_KIT_FORMATS,
  SOCIAL_SIZES,
  socialKitSettings,
  type SocialKitFormat,
} from "./image-social-kit.ts";
import { LocalImport } from "./local-import";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./audio-trim.css";
import "./images.css";

type ExportFormat = "png" | "jpeg" | "webp";
type ResizeMode = "long-edge" | "max-long-edge" | "exact";
type ResampleMode = "smooth" | "nearest";
type PreviewBackdrop = "checkerboard" | "white" | "black";
type ItemStatus = "ready" | "working" | "done" | "error" | "cancelled";

type Settings = {
  resizeMode: ResizeMode;
  longEdge: number;
  exactWidth: number;
  exactHeight: number;
  cropAspect: CropAspectKey;
  cropAnchor: CropAnchorKey;
  rotate: 0 | 1 | 2 | 3;
  flipH: boolean;
  flipV: boolean;
  straighten: number;
  resample: ResampleMode;
  adjust: Adjustments;
  format: ExportFormat;
  quality: number;
  targetKiB: number | null;
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
  trimmed: boolean;
  adjustChanged: number;
  target: { requestedBytes: number; met: boolean } | null;
};

type SocialOutput = {
  key: string;
  label: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  sha256: string;
  blob: Blob;
  url: string;
  receipt: ImageReceipt;
  receiptHref: string;
};

type TrimState = {
  itemId: string;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  rect: ImageBounds;
};

type PaletteState = {
  itemId: string;
  result: Extract<PaletteResult, { ok: true }>;
  workingWidth: number;
  workingHeight: number;
};

type PickedColour = { x: number; y: number; hex: string; rgb: Rgb; alpha: number };

type SnippetState = {
  key: string;
  data: Extract<SnippetResult, { ok: true }>;
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
  cropAnchor: "centre",
  rotate: 0,
  flipH: false,
  flipV: false,
  straighten: 0,
  resample: "smooth",
  adjust: { ...DEFAULT_ADJUSTMENTS },
  format: "png",
  quality: 0.9,
  targetKiB: null,
  matte: "#ffffff",
};

const WEB_READY_LONG_EDGE = 1600;
const WEB_READY_QUALITY = 0.82;

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

function formatLabelForMime(mime: string): string {
  const extension = extensionForImageMime(mime);
  return extension === "webp" ? "WebP" : extension.toUpperCase();
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

function settingsKey(settings: Settings, cropRect: ImageBounds | null = null): string {
  return JSON.stringify({ settings, cropRect });
}

function targetBytesFor(settings: Settings): number | null {
  if (settings.format === "png" || settings.targetKiB === null) return null;
  if (!Number.isFinite(settings.targetKiB) || settings.targetKiB <= 0) return null;
  return Math.round(settings.targetKiB * 1024);
}

function resizeFor(settings: Settings): ResizePlan {
  if (settings.resizeMode === "exact")
    return { mode: "exact", width: settings.exactWidth, height: settings.exactHeight };
  return {
    mode: "long-edge",
    longEdge: settings.longEdge,
    shrinkOnly: settings.resizeMode === "max-long-edge",
  };
}

function makePlan(
  source: ImageMetadataSummary,
  settings: Settings,
  cropRect: ImageBounds | null = null,
): TransformPlan {
  return planImageTransform({
    sourceWidth: source.orientedWidth,
    sourceHeight: source.orientedHeight,
    rotate: settings.rotate,
    flipH: settings.flipH,
    flipV: settings.flipV,
    straighten: settings.straighten,
    cropAspect: CROP_ASPECTS[settings.cropAspect],
    cropAnchor: settings.cropAnchor,
    cropRect,
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

// Small binary palettes (.ase) can be offered as a base64 data URI, so the
// download needs no object-URL lifecycle and stays entirely in this tab.
function bytesToDataUri(bytes: Uint8Array, type: string): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
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

function drawStraightened(
  source: HTMLCanvasElement,
  straighten: NonNullable<TransformResult["straighten"]>,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = straighten.width;
  canvas.height = straighten.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a drawing surface.");
  // The kept rectangle sits at `offset` inside the rotated bounding box. Draw
  // the turned source so that rectangle lands on the output canvas exactly.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(
    straighten.boundingWidth / 2 - straighten.offset.x,
    straighten.boundingHeight / 2 - straighten.offset.y,
  );
  context.rotate((straighten.angle * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function renderImage(
  item: WorkItem,
  settings: Settings,
  signal: AbortSignal,
  cropRect: ImageBounds | null = null,
): Promise<RenderedImage> {
  if (signal.aborted) throw abortError();
  const requestedTarget = targetBytesFor(settings);
  const targetProblem = targetSizeProblem(settings.format, requestedTarget);
  if (targetProblem) throw new Error(targetProblem);
  let bitmap: ImageBitmap | null = null;
  let oriented: HTMLCanvasElement | null = null;
  let transformed: HTMLCanvasElement | null = null;
  let straightened: HTMLCanvasElement | null = null;
  let output: HTMLCanvasElement | null = null;
  let flattened: HTMLCanvasElement | null = null;
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
      cropRect,
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
        straighten: settings.straighten,
        cropAspect: CROP_ASPECTS[settings.cropAspect],
        cropAnchor: settings.cropAnchor,
        cropRect,
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
    if (plan.straighten) {
      straightened = drawStraightened(stage, plan.straighten);
      stage.width = 0;
      stage.height = 0;
      stage = straightened;
      if (stage.width !== plan.straighten.width || stage.height !== plan.straighten.height)
        throw new Error("The straightened area did not match the plan.");
    }
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
    const adjustments = normaliseAdjustments(settings.adjust);
    const needsAdjust = !adjustmentsAreNeutral(adjustments);
    const context = output.getContext("2d", { willReadFrequently: needsAdjust });
    if (!context) throw new Error("This browser could not create a drawing surface.");
    const smoothing = imageSmoothingFor(settings.resample);
    context.imageSmoothingEnabled = smoothing.enabled;
    context.imageSmoothingQuality = smoothing.quality;
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
    let adjustChanged = 0;
    if (needsAdjust) {
      const pixels = context.getImageData(0, 0, output.width, output.height);
      const adjusted = adjustPixels(pixels.data, {
        width: output.width,
        height: output.height,
        adjustments,
      });
      if (!adjusted.ok) throw new Error(adjusted.error);
      context.putImageData(pixels, 0, 0);
      adjustChanged = adjusted.changed;
      if (signal.aborted) throw abortError();
    }
    // The matte is composited after the adjustments so a chosen JPEG background
    // keeps its exact colour instead of being exposed or saturated with the photo.
    let encodeSource = output;
    if (settings.format === "jpeg") {
      flattened = document.createElement("canvas");
      flattened.width = output.width;
      flattened.height = output.height;
      const flattenContext = flattened.getContext("2d");
      if (!flattenContext) throw new Error("This browser could not create a drawing surface.");
      flattenContext.fillStyle = settings.matte;
      flattenContext.fillRect(0, 0, flattened.width, flattened.height);
      flattenContext.drawImage(output, 0, 0);
      encodeSource = flattened;
    }
    const mime = mimeForExport(settings.format);
    let blob: Blob;
    let qualityUsed = settings.quality;
    let target: RenderedImage["target"] = null;
    if (requestedTarget !== null) {
      const search = await searchTargetQuality({
        targetBytes: requestedTarget,
        encode: async (quality) => {
          if (signal.aborted) throw abortError();
          const encoded = await canvasToBlob(encodeSource, mime, quality);
          if (signal.aborted) throw abortError();
          return encoded;
        },
      });
      if (signal.aborted) throw abortError();
      if (!search.ok) throw new Error(search.error);
      blob = search.blob;
      qualityUsed = search.quality;
      target = { requestedBytes: requestedTarget, met: search.met };
    } else {
      blob = await canvasToBlob(
        encodeSource,
        mime,
        settings.format === "png" ? undefined : settings.quality,
      );
    }
    if (signal.aborted) throw abortError();
    if (blob.type !== mime)
      throw new Error(
        `This browser encoded ${blob.type || "another format"} instead of ${mime}. Choose PNG, or a browser and device that can encode ${mime.replace("image/", "").toUpperCase()}.`,
      );
    if (!blob.size) throw new Error("The result was empty.");
    if (blob.size > MAX_IMAGE_OUTPUT_BYTES)
      throw new Error(`The result is larger than ${MAX_IMAGE_OUTPUT_BYTES / 1024 / 1024} MiB. Try a smaller size or less quality.`);
    if (
      target &&
      ((target.met && blob.size > target.requestedBytes) ||
        (!target.met && blob.size <= target.requestedBytes))
    )
      throw new Error("The target result did not verify against its measured bytes.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sniffed = sniffLocalImage(bytes);
    if (!sniffed.supported || sniffed.mime !== mime)
      throw new Error("The browser wrote a file that did not verify as the chosen image format.");
    const digest = await sha256Hex(bytes);
    const actualSettings = { ...settings, quality: qualityUsed };
    return {
      blob,
      url: "",
      width: output.width,
      height: output.height,
      bytes: blob.size,
      mime,
      sha256: digest,
      plan,
      settingsKey: settingsKey(settings, cropRect),
      settings: actualSettings,
      sourceWidth: oriented.width,
      sourceHeight: oriented.height,
      trimmed: Boolean(cropRect),
      adjustChanged,
      target,
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
    if (straightened) {
      straightened.width = 0;
      straightened.height = 0;
    }
    if (flattened) {
      flattened.width = 0;
      flattened.height = 0;
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
  const [previewBackdrop, setPreviewBackdrop] = useState<PreviewBackdrop>("checkerboard");
  const [message, setMessage] = useState("");
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState({ total: 0, completed: 0, current: "" });
  const [zipUrl, setZipUrl] = useState("");
  const [zipBytes, setZipBytes] = useState(0);
  const [zipBusy, setZipBusy] = useState(false);
  const [socialOutputs, setSocialOutputs] = useState<SocialOutput[]>([]);
  const [socialZip, setSocialZip] = useState<{ url: string; bytes: number } | null>(null);
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialFormat, setSocialFormat] = useState<SocialKitFormat>("webp");
  const [stripBusy, setStripBusy] = useState(false);
  const [removeIcc, setRemoveIcc] = useState(false);
  const [importing, setImporting] = useState(false);
  const [trim, setTrim] = useState<TrimState | null>(null);
  const [trimBusy, setTrimBusy] = useState(false);
  const [trimMessage, setTrimMessage] = useState("");
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [paletteBusy, setPaletteBusy] = useState(false);
  const [paletteMessage, setPaletteMessage] = useState("");
  const [picked, setPicked] = useState<PickedColour | null>(null);
  const [pickMessage, setPickMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [snippets, setSnippets] = useState<SnippetState | null>(null);
  const [snippetKind, setSnippetKind] = useState<SnippetKind>("dataUri");
  const [snippetBusy, setSnippetBusy] = useState(false);
  const [snippetMessage, setSnippetMessage] = useState("");
  const [snippetUrl, setSnippetUrl] = useState<{ kind: SnippetKind; url: string } | null>(null);
  const urls = useRef(new Set<string>());
  const revision = useRef(0);
  const batchController = useRef<AbortController | null>(null);
  const socialController = useRef<AbortController | null>(null);
  const stripRevision = useRef(0);
  const didInitSettings = useRef(false);
  const addFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const addingRef = useRef(false);
  const runningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const focusPickerAfterClear = useRef(false);
  const eyedropperRef = useRef<HTMLImageElement | null>(null);
  const pickCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragIdRef = useRef("");

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const socialReady = selected?.source.mime === "image/png";
  const activeTrim =
    selected &&
    trim &&
    trim.itemId === selected.id &&
    settings.straighten === 0 &&
    trim.rotate === settings.rotate &&
    trim.flipH === settings.flipH &&
    trim.flipV === settings.flipV
      ? trim.rect
      : null;
  const plan = selected ? makePlan(selected.source, settings, activeTrim) : null;
  const currentSettingsKey = settingsKey(settings, activeTrim);
  const freshResult = selected?.result?.settingsKey === currentSettingsKey;
  const keptArea = plan?.ok ? keptAreaPolygon(plan) : null;
  const keepFull =
    keptArea && selected
      ? Math.abs(
          keptArea.area -
            selected.source.orientedWidth * selected.source.orientedHeight,
        ) /
          (selected.source.orientedWidth * selected.source.orientedHeight) <
        0.001
      : false;
  const controlsAreOriginal =
    settingsKey(settings) === settingsKey(DEFAULT_SETTINGS) && !trim;
  const requestedTargetBytes =
    settings.targetKiB === null ? null : Math.round(settings.targetKiB * 1024);
  const targetProblem =
    requestedTargetBytes === null
      ? null
      : targetSizeProblem(settings.format, requestedTargetBytes);
  const visiblePalette = palette && selected && palette.itemId === selected.id ? palette : null;
  const visibleSnippets =
    snippets && selected?.result?.sha256 === snippets.key ? snippets.data : null;
  const snippetText = visibleSnippets ? visibleSnippets.snippets[snippetKind] : "";
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
            straighten: selected.result.settings.straighten,
            cropAspect: selected.result.settings.cropAspect === "original" ? null : CROP_ASPECTS[selected.result.settings.cropAspect],
            cropAnchor: selected.result.settings.cropAnchor,
            trimmed: selected.result.trimmed,
            resize: resizeFor(selected.result.settings),
            resample: selected.result.settings.resample,
            adjustments: describeAdjustments(selected.result.settings.adjust),
            format: selected.result.settings.format,
            quality: selected.result.settings.format === "png" ? null : selected.result.settings.quality,
            metadata: "canvas re-encode",
          })}.`
        : `Local metadata-only pass. Source: ${selected.file.name.slice(0, 80)} (sha256 ${selected.sourceHash}). Pixels copied without re-encoding; removable metadata was stripped.`
      : "";
  // The receipt is a snapshot of the finished render, built from the stored
  // result and source hash only. Live editor controls are never an input, so
  // changing them later cannot rewrite this result or its receipt.
  const imageReceipt = selected?.result
    ? buildImageReceipt({ sourceHash: selected.sourceHash, result: selected.result })
    : null;
  const imageReceiptHref = imageReceipt
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(imageReceipt))}`
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

  function releaseSocial(): void {
    for (const output of socialOutputs) releaseUrl(output.url);
    if (socialZip) releaseUrl(socialZip.url);
    setSocialOutputs([]);
    setSocialZip(null);
  }

  function clearSocial(): void {
    socialController.current?.abort();
    releaseSocial();
  }

  useEffect(() => {
    return () => {
      revision.current += 1;
      stripRevision.current += 1;
      batchController.current?.abort();
      socialController.current?.abort();
      socialController.current = null;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
      if (pickCanvasRef.current) {
        pickCanvasRef.current.width = 0;
        pickCanvasRef.current.height = 0;
      }
    };
  }, []);

  useEffect(() => {
    if (!snippetText) {
      setSnippetUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([snippetText], { type: "text/plain" }));
    setSnippetUrl({ kind: snippetKind, url });
    return () => URL.revokeObjectURL(url);
  }, [snippetText, snippetKind]);

  useEffect(() => {
    setPicked(null);
    setPickMessage("");
    setSnippetMessage("");
  }, [selected?.result?.url]);

  useEffect(() => {
    if (items.length || !focusPickerAfterClear.current) return;
    focusPickerAfterClear.current = false;
    fileInputRef.current?.focus();
  }, [items.length]);

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
    if (!files.length || addingRef.current || runningRef.current || socialController.current) return;
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
      clearSocial();
      setTrim(null);
      setTrimMessage("");
      setPalette(null);
      setPaletteMessage("");
      setPicked(null);
      setPickMessage("");
      setCopyMessage("");
    }
  }

  function resetAll(): void {
    focusPickerAfterClear.current = true;
    revision.current += 1;
    stripRevision.current += 1;
    batchController.current?.abort();
    socialController.current?.abort();
    addingRef.current = false;
    runningRef.current = false;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setItems([]);
    setSelectedId("");
    setSettings(DEFAULT_SETTINGS);
    setPreviewBackdrop("checkerboard");
    setTrim(null);
    setTrimMessage("");
    setPalette(null);
    setPaletteMessage("");
    setPicked(null);
    setPickMessage("");
    setCopyMessage("");
    setMessage("Cleared. Nothing remains in this tab.");
    setRejections([]);
    setBatch({ total: 0, completed: 0, current: "" });
    setZipUrl("");
    setZipBytes(0);
    setSocialOutputs([]);
    setSocialZip(null);
    didInitSettings.current = false;
  }

  async function runItems(list: WorkItem[]): Promise<void> {
    if (!list.length || runningRef.current || socialController.current) return;
    runningRef.current = true;
    const snapshot = { ...settings };
    const trimSnapshot = trim;
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
        const cropRect =
          trimSnapshot &&
          snapshot.straighten === 0 &&
          trimSnapshot.itemId === item.id &&
          trimSnapshot.rotate === snapshot.rotate &&
          trimSnapshot.flipH === snapshot.flipH &&
          trimSnapshot.flipV === snapshot.flipV
            ? trimSnapshot.rect
            : null;
        const rendered = await renderImage(item, snapshot, controller.signal, cropRect);
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
    if (!doneItems.length || zipBusy || socialController.current) return;
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
    setSettings((previous) => ({
      ...previous,
      format,
      targetKiB: format === "png" ? null : previous.targetKiB,
    }));
  }

  function applyWebReady(): void {
    if (!selected || runningRef.current || socialController.current) return;
    setSettings((previous) => ({
      ...previous,
      resizeMode: "max-long-edge",
      longEdge: WEB_READY_LONG_EDGE,
      format: "webp",
      quality: WEB_READY_QUALITY,
      targetKiB: null,
    }));
    setMessage("Web-ready settings applied. Choose Make this image to render.");
  }

  async function makeSocialKit(): Promise<void> {
    if (!selected || runningRef.current || socialController.current || zipBusy || addingRef.current) return;
    if (selected.source.mime !== "image/png") return;
    const item = selected;
    const snapshot = { ...settings };
    const format = socialFormat;
    const trimSnapshot = trim;
    const controller = new AbortController();
    socialController.current = controller;
    releaseSocial();
    setSocialBusy(true);
    setMessage(`Making four ${formatLabelForMime(mimeForExport(format))} sizes from the selected PNG…`);
    const outputs: SocialOutput[] = [];
    const isCurrent = () => socialController.current === controller;
    const alive = () => isCurrent() && !controller.signal.aborted;
    try {
      for (const size of SOCIAL_SIZES) {
        if (!alive()) throw abortError();
        const cropRect =
          trimSnapshot &&
          snapshot.straighten === 0 &&
          trimSnapshot.itemId === item.id &&
          trimSnapshot.rotate === snapshot.rotate &&
          trimSnapshot.flipH === snapshot.flipH &&
          trimSnapshot.flipV === snapshot.flipV
            ? trimSnapshot.rect
            : null;
        const sizeSettings = socialKitSettings(snapshot, size, WEB_READY_QUALITY, format);
        const rendered = await renderImage(item, sizeSettings, controller.signal, cropRect);
        if (!alive()) throw abortError();
        const receipt = buildImageReceipt({ sourceHash: item.sourceHash, result: rendered });
        const output: SocialOutput = {
          key: size.key,
          label: size.label,
          width: rendered.width,
          height: rendered.height,
          mime: rendered.mime,
          bytes: rendered.bytes,
          sha256: rendered.sha256,
          blob: rendered.blob,
          url: trackUrl(rendered.blob),
          receipt,
          receiptHref: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt))}`,
        };
        outputs.push(output);
        setSocialOutputs([...outputs]);
        setMessage(`Made ${outputs.length} of ${SOCIAL_SIZES.length} sizes on this device.`);
      }
      if (!alive()) throw abortError();
      const stem = safeStem(item.file.name);
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      let total = 0;
      for (const output of outputs) {
        if (!alive()) throw abortError();
        const bytes = new Uint8Array(await output.blob.arrayBuffer());
        total += bytes.length;
        if (total > MAX_ZIP_BYTES)
          throw new Error(`ZIP export stays under ${MAX_ZIP_BYTES / 1024 / 1024} MiB. Download sizes separately instead.`);
        entries.push({
          name: `${stem}-${output.key}-${output.width}x${output.height}.${extensionForImageMime(output.mime)}`,
          data: bytes,
        });
        const receiptBytes = new TextEncoder().encode(JSON.stringify(output.receipt, null, 2));
        total += receiptBytes.length;
        if (total > MAX_ZIP_BYTES)
          throw new Error(`ZIP export stays under ${MAX_ZIP_BYTES / 1024 / 1024} MiB. Download sizes separately instead.`);
        entries.push({ name: `${stem}-${output.key}-receipt.json`, data: receiptBytes });
      }
      if (!alive()) throw abortError();
      const zip = createZip(entries, { date: new Date() });
      if (!zip.ok) throw new Error(zip.error);
      const zipBlob = blobFromBytes(zip.bytes, ZIP_MIME);
      setSocialZip({ url: trackUrl(zipBlob), bytes: zipBlob.size });
      setMessage(
        `Social kit ready: ${outputs.length} ${formatLabelForMime(outputs[0].mime)} sizes with per-size receipts, ${formatBytes(zipBlob.size)} total.`,
      );
    } catch (error) {
      if (!isCurrent()) {
        for (const output of outputs) releaseUrl(output.url);
        return;
      }
      if (isAbort(error)) setMessage("Stopped the social kit.");
      else setMessage(error instanceof Error ? error.message : "Could not make the social kit.");
    } finally {
      if (isCurrent()) {
        socialController.current = null;
        setSocialBusy(false);
      }
    }
  }

  function cancelSocialKit(): void {
    socialController.current?.abort();
    setMessage("Stopping after the current size. Completed sizes keep their downloads.");
  }

  function selectItem(id: string): void {
    if (id !== selectedId) clearSocial();
    setSelectedId(id);
    setTrim(null);
    setTrimMessage("");
    setPalette(null);
    setPaletteMessage("");
    setPicked(null);
    setPickMessage("");
    setCopyMessage("");
  }

  function changeRotation(next: Settings["rotate"]): void {
    setTrim(null);
    setTrimMessage("");
    setSettings((previous) => ({ ...previous, rotate: next }));
  }

  function changeFlip(axis: "flipH" | "flipV", value: boolean): void {
    setTrim(null);
    setTrimMessage("");
    setSettings((previous) =>
      axis === "flipH"
        ? { ...previous, flipH: value }
        : { ...previous, flipV: value },
    );
  }

  function changeStraighten(value: number): void {
    if (!Number.isFinite(value)) return;
    setSettings((previous) => ({
      ...previous,
      straighten: Math.max(
        -MAX_STRAIGHTEN_DEGREES,
        Math.min(MAX_STRAIGHTEN_DEGREES, Math.round(value * 10) / 10),
      ),
    }));
    if (trim) {
      setTrim(null);
      setTrimMessage(
        "Trim cleared: straightening keeps the largest fully-covered area instead of the alpha bounds.",
      );
    }
  }

  function resetControls(): void {
    setSettings(DEFAULT_SETTINGS);
    setTrim(null);
    setTrimMessage("");
    setMessage(
      "Controls reset to their original values. Your images and completed downloads are unchanged.",
    );
  }

  function clearTrim(): void {
    setTrim(null);
    setTrimMessage("Trim cleared. The full image is used again.");
  }

  async function copyValue(
    label: string,
    value: string,
    { echo = value.length <= 120, fallback }: { echo?: boolean; fallback?: string } = {},
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(
        echo
          ? `Copied ${label}: ${value}`
          : `Copied ${label} (${value.length.toLocaleString()} characters).`,
      );
    } catch {
      setCopyMessage(fallback ?? `Could not copy automatically. Select the ${label} value and copy it.`);
    }
  }

  async function buildSnippets(): Promise<void> {
    if (!selected?.result || snippetBusy) return;
    const item = selected;
    const result = item.result;
    if (!result) return;
    setSnippetBusy(true);
    setSnippetMessage("Reading the encoded result on this device…");
    try {
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const built = buildImageSnippets({
        bytes,
        mime: result.mime,
        filename: `${safeStem(item.file.name)}-${result.width}x${result.height}.${extensionForImageMime(result.mime)}`,
        width: result.width,
        height: result.height,
      });
      if (!built.ok) throw new Error(built.error);
      setSnippets({ key: result.sha256, data: built });
      setSnippetMessage(
        `Embed code is ready from ${formatBytes(built.bytes)} of real output. Nothing left this tab.`,
      );
    } catch (error) {
      setSnippets(null);
      setSnippetMessage(
        error instanceof Error ? error.message : "Could not build embed code.",
      );
    } finally {
      setSnippetBusy(false);
    }
  }

  function setAdjustment(key: AdjustmentKey, value: number): void {
    setSettings((previous) => ({
      ...previous,
      adjust: normaliseAdjustments({ ...previous.adjust, [key]: value }),
    }));
  }

  function applyAdjustmentPreset(id: string): void {
    setSettings((previous) => ({ ...previous, adjust: presetAdjustments(id) }));
  }

  function moveItem(id: string, offset: number): void {
    if (running) return;
    clearZip();
    setItems((previous) => {
      const index = previous.findIndex((candidate) => candidate.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setMessage(
      `${offset < 0 ? "Moved up" : "Moved down"}. The ZIP follows this list order.`,
    );
  }

  function dropItem(id: string): void {
    const source = dragIdRef.current;
    dragIdRef.current = "";
    if (!source || source === id || running) return;
    clearZip();
    setItems((previous) => {
      const from = previous.findIndex((candidate) => candidate.id === source);
      const to = previous.findIndex((candidate) => candidate.id === id);
      if (from < 0 || to < 0) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMessage("Reordered. The ZIP follows this list order.");
  }

  async function extractSelectedPalette(): Promise<void> {
    if (!selected || paletteBusy || running) return;
    const item = selected;
    setPaletteBusy(true);
    setPaletteMessage("Reading pixels on this device…");
    let bitmap: ImageBitmap | null = null;
    let canvas: HTMLCanvasElement | null = null;
    try {
      bitmap = await createImageBitmap(item.file);
      const scale = Math.min(
        1,
        PALETTE_WORKING_EDGE / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not read the image pixels.");
      context.drawImage(bitmap, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const result = extractPalette(data, {
        width,
        height,
        maxColors: MAX_PALETTE_COLOURS,
      });
      if (!result.ok) throw new Error(result.error);
      setPalette({ itemId: item.id, result, workingWidth: width, workingHeight: height });
      setPaletteMessage(
        result.colors.length
          ? `${result.colors.length} colour${result.colors.length === 1 ? "" : "s"} from a ${width} × ${height} working copy. Fully transparent pixels are ignored.`
          : "Every sampled pixel is fully transparent. There is no colour to report.",
      );
    } catch (error) {
      setPalette(null);
      setPaletteMessage(
        error instanceof Error ? error.message : "Could not read a colour palette.",
      );
    } finally {
      bitmap?.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      setPaletteBusy(false);
    }
  }

  async function checkTrim(): Promise<void> {
    if (!selected || trimBusy || running) return;
    if (settings.straighten !== 0) {
      setTrimMessage(
        "Set straighten to 0° before trimming. Trim measures upright alpha bounds; straighten then keeps the largest fully-covered area.",
      );
      return;
    }
    const item = selected;
    const snapshot = { ...settings };
    setTrimBusy(true);
    setTrimMessage("Reading every alpha value on this device…");
    let bitmap: ImageBitmap | null = null;
    let canvas: HTMLCanvasElement | null = null;
    try {
      bitmap = await createImageBitmap(item.file);
      if (
        bitmap.width !== item.source.orientedWidth ||
        bitmap.height !== item.source.orientedHeight
      )
        throw new Error("The decoded image size did not match its header, so trim was not applied.");
      canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not read the image pixels.");
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const found = alphaBounds(data, { width: bitmap.width, height: bitmap.height });
      if (!found.ok) throw new Error(found.error);
      if (found.empty) {
        setTrim(null);
        setTrimMessage("Every pixel is fully transparent. There is no visible area to trim to.");
        return;
      }
      if (found.isFull) {
        setTrim(null);
        setTrimMessage(
          item.source.alpha
            ? "No fully transparent padding touches the edges. Nothing to trim."
            : "This image has no alpha channel, so there is no transparent padding to trim.",
        );
        return;
      }
      if (!found.bounds)
        throw new Error("The alpha bounds could not be read from the decoded pixels.");
      const mapped = mapBoundsThroughTransform(found.bounds, {
        width: bitmap.width,
        height: bitmap.height,
        rotate: snapshot.rotate,
        flipH: snapshot.flipH,
        flipV: snapshot.flipV,
      });
      if (!mapped.ok) throw new Error(mapped.error);
      setTrim({
        itemId: item.id,
        rotate: snapshot.rotate,
        flipH: snapshot.flipH,
        flipV: snapshot.flipV,
        rect: mapped.bounds,
      });
      setTrimMessage(
        `Trim to ${mapped.bounds.width} × ${mapped.bounds.height} px. This image only, until the rotation, flips or image change.`,
      );
    } catch (error) {
      setTrim(null);
      setTrimMessage(
        error instanceof Error ? error.message : "Could not read the alpha channel.",
      );
    } finally {
      bitmap?.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      setTrimBusy(false);
    }
  }

  function samplePixel(x: number, y: number): void {
    const image = eyedropperRef.current;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
      setPickMessage("The result preview is not ready yet. Make the image or wait for it to load.");
      return;
    }
    if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
    try {
      let canvas = pickCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        pickCanvasRef.current = canvas;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no drawing surface");
      context.clearRect(0, 0, 1, 1);
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      const rgb = { r: data[0], g: data[1], b: data[2] };
      const hex = rgbToHex(rgb);
      setPicked({ x, y, hex, rgb, alpha: data[3] });
      setPickMessage(`Pixel ${x}, ${y}: ${hex}.`);
    } catch {
      setPickMessage("Could not read that pixel. The preview may still be loading.");
    }
  }

  function pickAtClient(clientX: number, clientY: number): void {
    const image = eyedropperRef.current;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    const point = pickImagePixel({
      clientX,
      clientY,
      rect,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
    });
    if (point) samplePixel(point.x, point.y);
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
            ref={fileInputRef}
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
            <legend>Web-ready image</legend>
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={running || socialBusy}
                aria-describedby="image-web-ready-note"
                onClick={applyWebReady}
              >
                Apply Web-ready image
              </button>
            </div>
            <p className="trim-note" id="image-web-ready-note">
              Set WebP at {Math.round(WEB_READY_QUALITY * 100)}% quality and cap the longest side at {WEB_READY_LONG_EDGE} px.
              The preset keeps transparency and your edits. It only shrinks images.
            </p>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Social sizes</legend>
            <label>Kit format
              <select
                value={socialFormat}
                disabled={running || socialBusy || zipBusy || adding}
                aria-describedby="image-social-kit-note"
                onChange={(event) => {
                  const next = SOCIAL_KIT_FORMATS.find((format) => format === event.target.value);
                  if (!next || next === socialFormat) return;
                  releaseSocial();
                  setSocialFormat(next);
                  setMessage("");
                }}
              >
                {SOCIAL_KIT_FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {value === "webp" ? "WebP · default, smaller files" : "PNG · lossless, larger files"}
                  </option>
                ))}
              </select>
            </label>
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={running || socialBusy || zipBusy || adding || !socialReady}
                aria-describedby="image-social-kit-note"
                onClick={() => void makeSocialKit()}
              >
                {socialBusy ? "Making sizes…" : "Make 4 social sizes"}
              </button>
              {socialBusy && (
                <button type="button" className="quiet" onClick={cancelSocialKit}>
                  Cancel kit
                </button>
              )}
            </div>
            <p className="trim-note" id="image-social-kit-note">
              One selected PNG becomes {formatLabelForMime(mimeForExport(socialFormat))} at 1080 × 1080 (1:1), 1080 × 1350 (4:5),
              1080 × 1920 (9:16) and 1920 × 1080 (16:9)
              {socialFormat === "webp" ? ` with ${Math.round(WEB_READY_QUALITY * 100)}% quality` : " at lossless quality"}.
              Smaller crops can be enlarged to fit. The ZIP includes one receipt for each size.
            </p>
            {!socialReady && <p className="notice calm">Choose a PNG to make this kit.</p>}
          </fieldset>

          {socialOutputs.length > 0 && (
            <div className="image-result" aria-live="polite">
              <ul className="image-social-list">
                {socialOutputs.map((output) => (
                  <li key={output.key}>
                    <a href={output.url} download={`${safeStem(selected.file.name)}-${output.key}-${output.width}x${output.height}.${extensionForImageMime(output.mime)}`}>
                      {output.label} · {output.width} × {output.height}
                    </a>{" "}
                    <span className="small">{formatBytes(output.bytes)} · sha256 {shortHash(output.sha256)}</span>{" "}
                    <a href={output.receiptHref} download={`${safeStem(selected.file.name)}-${output.key}-receipt.json`}>receipt</a>
                  </li>
                ))}
              </ul>
              {socialZip && (
                <a
                  className="button"
                  href={socialZip.url}
                  download={`${safeStem(selected.file.name)}-social-kit.zip`}
                >
                  Download ZIP · {formatBytes(socialZip.bytes)}
                </a>
              )}
              {!socialZip && socialBusy && <p className="small">Building the ZIP on this device…</p>}
            </div>
          )}

          <fieldset className="image-controls">
            <legend>Resize and crop</legend>
            <label>Resize by
              <select value={settings.resizeMode} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, resizeMode: event.target.value as ResizeMode }))}>
                <option value="long-edge">Long edge</option>
                <option value="max-long-edge">Maximum long edge</option>
                <option value="exact">Exact width and height</option>
              </select>
            </label>
            {settings.resizeMode !== "exact" ? (
              <label>{settings.resizeMode === "max-long-edge" ? "Maximum long edge (px)" : "Long edge (px)"}
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
            <label>Crop aspect
              <select value={settings.cropAspect} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, cropAspect: event.target.value as CropAspectKey }))}>
                {Object.entries(CROP_ASPECT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>Crop position
              <select value={settings.cropAnchor} disabled={running || settings.cropAspect === "original"} onChange={(event) => setSettings((previous) => ({ ...previous, cropAnchor: event.target.value as CropAnchorKey }))}>
                {Object.entries(CROP_ANCHOR_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>Resampling
              <select value={settings.resample} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, resample: event.target.value as ResampleMode }))}>
                <option value="smooth">Smooth · photos</option>
                <option value="nearest">Nearest-neighbour · pixel art</option>
              </select>
            </label>
            <div className="image-control-actions">
              <button type="button" className="secondary" disabled={running || !selected} onClick={() => setSettings((previous) => ({ ...previous, resizeMode: "exact", exactWidth: selected.source.orientedWidth, exactHeight: selected.source.orientedHeight }))}>Use displayed size</button>
              <button type="button" className="secondary" disabled={running} onClick={() => setSettings((previous) => ({ ...previous, resizeMode: "long-edge", longEdge: defaultLongEdge(selected.source.orientedWidth, selected.source.orientedHeight) }))}>Use 2048 max</button>
              <button type="button" className="secondary" disabled={running || trimBusy || !selected} onClick={() => void checkTrim()}>
                {trimBusy ? "Reading alpha…" : "Trim transparent edges"}
              </button>
              {activeTrim && (
                <button type="button" className="quiet" disabled={running} onClick={clearTrim}>
                  Use full image
                </button>
              )}
            </div>
            <p className="trim-note" role="status" aria-live="polite">
              {trimMessage || (selected.source.alpha ? "Trim removes fully transparent padding; near-transparent edge pixels are kept." : "This image declares no alpha channel, so transparent padding is unlikely. Trim will check the decoded pixels before changing the plan.")}
            </p>
            <p className="trim-note">
              Crop position applies when the aspect is not Original. It decides which
              part of the picture is kept instead of always cutting from the centre.
            </p>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Rotate, straighten and flip</legend>
            <div className="image-control-actions">
              <button type="button" className="secondary" disabled={running} onClick={() => changeRotation(((settings.rotate + 3) % 4) as Settings["rotate"])}>Rotate left</button>
              <button type="button" className="secondary" disabled={running} onClick={() => changeRotation(((settings.rotate + 1) % 4) as Settings["rotate"])}>Rotate right</button>
              <button type="button" className="secondary" disabled={running} onClick={() => changeRotation(0)}>Reset rotation</button>
              <button type="button" className="secondary" disabled={running || settings.straighten === 0} onClick={() => changeStraighten(0)}>Reset straighten</button>
            </div>
            <label>
              Straighten{" "}
              {settings.straighten === 0
                ? "0°"
                : `${Math.abs(settings.straighten).toFixed(1)}° ${settings.straighten > 0 ? "clockwise" : "anticlockwise"}`}
              <input
                type="range"
                min={-MAX_STRAIGHTEN_DEGREES}
                max={MAX_STRAIGHTEN_DEGREES}
                step="0.1"
                value={settings.straighten}
                disabled={running}
                aria-describedby="image-straighten-note"
                onChange={(event) => changeStraighten(Number(event.target.value))}
              />
            </label>
            <label className="image-check"><input type="checkbox" checked={settings.flipH} disabled={running} onChange={(event) => changeFlip("flipH", event.target.checked)} /> Flip horizontal</label>
            <label className="image-check"><input type="checkbox" checked={settings.flipV} disabled={running} onChange={(event) => changeFlip("flipV", event.target.checked)} /> Flip vertical</label>
            <p className="trim-note" id="image-straighten-note">
              Straighten keeps the largest area that is entirely real pixels, so no
              empty corner is exported. Positive turns clockwise. {settings.straighten === 0
                ? "Trim transparent edges remains available while upright."
                : "Trim is unavailable while the image is turned; set straighten to 0° to trim instead."}
            </p>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Light and colour</legend>
            <label>Preset
              <select value={presetIdFor(settings.adjust)} disabled={running} onChange={(event) => applyAdjustmentPreset(event.target.value)}>
                {ADJUSTMENT_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}
                <option value="custom" disabled>Custom settings</option>
              </select>
            </label>
            {ADJUSTMENT_KEYS.map((key) => (
              <label key={key}>
                {ADJUSTMENT_LABELS[key]} {settings.adjust[key] > 0 ? `+${settings.adjust[key]}` : settings.adjust[key]}
                <input
                  type="range"
                  min={-ADJUSTMENT_RANGE}
                  max={ADJUSTMENT_RANGE}
                  step="1"
                  value={settings.adjust[key]}
                  disabled={running}
                  onChange={(event) => setAdjustment(key, Number(event.target.value))}
                />
              </label>
            ))}
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={running || adjustmentsAreNeutral(settings.adjust)}
                onClick={() => setSettings((previous) => ({ ...previous, adjust: { ...DEFAULT_ADJUSTMENTS } }))}
              >
                Reset adjustments
              </button>
            </div>
            <p className="trim-note">
              Presets are just named values for these four controls, so the result
              caption states the real numbers. Adjustments are applied to the exported
              pixels after resize and crop; the alpha channel is never changed and the
              original File stays untouched.
            </p>
          </fieldset>

          <fieldset className="image-controls">
            <legend>Output</legend>
            <label>Format
              <select value={settings.format} disabled={running} onChange={(event) => setNextFormat(event.target.value as ExportFormat)}>
                {FORMATS.map((format) => <option value={format.value} key={format.value}>{format.label}</option>)}
              </select>
            </label>
            <label>Quality {settings.format === "png" ? "(PNG is lossless)" : `${Math.round(settings.quality * 100)}%`}
              <input type="range" min="0.5" max="1" step="0.01" value={settings.quality} disabled={running || settings.format === "png" || settings.targetKiB !== null} onChange={(event) => setSettings((previous) => ({ ...previous, quality: Number(event.target.value) }))} />
            </label>
            <label>Target size (KiB, optional)
              <input
                type="number"
                min="1"
                max={MAX_IMAGE_OUTPUT_BYTES / 1024}
                step="1"
                placeholder="No target"
                value={settings.targetKiB ?? ""}
                disabled={running || settings.format === "png"}
                aria-describedby="image-target-note"
                onChange={(event) =>
                  setSettings((previous) => ({
                    ...previous,
                    targetKiB: event.target.value === "" ? null : Number(event.target.value),
                  }))
                }
              />
            </label>
            {settings.format === "png" ? (
              <p className="trim-note" id="image-target-note">
                PNG is lossless, so a byte target is not achievable here. Lower the output width and height, or choose JPEG or WebP.
              </p>
            ) : (
              <p className="trim-note" id="image-target-note">
                The quality slider applies when no target is set. A target instead runs a bounded, deterministic search and reports the real encoded bytes; if the smallest result still exceeds it, the result says so instead of claiming success.
              </p>
            )}
            {settings.format === "jpeg" && (
              <label>Matte colour for transparency
                <input type="color" value={settings.matte} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, matte: event.target.value }))} />
              </label>
            )}
          </fieldset>

          <p className={`image-plan${plan && !plan.ok ? " is-error" : ""}`}>
            {plan?.ok
              ? `Planned result: ${plan.outputWidth} × ${plan.outputHeight} px${activeTrim ? ` · trimmed from ${plan.rotatedWidth} × ${plan.rotatedHeight} px` : ""}${plan.aspectDistorted ? " · exact dimensions change the aspect" : ""}${plan.upscaled ? " · enlarged by resampling; no detail is invented" : ""}.`
              : plan?.error ?? "Choose a usable size."}
          </p>
          {targetProblem && <p className="image-plan is-error" role="alert">{targetProblem}</p>}
          <div className="image-control-actions">
            <button type="button" disabled={running || socialBusy || adding || !plan?.ok || Boolean(targetProblem)} onClick={() => void runItems([selected])}>
              {selected.status === "working" ? "Processing…" : "Make this image"}
            </button>
            {selected.status === "error" && (
              <button type="button" className="secondary" disabled={running} onClick={() => void runItems([selected])}>Retry</button>
            )}
            <button
              type="button"
              className="quiet"
              disabled={running || adding || controlsAreOriginal}
              aria-describedby="image-reset-note"
              onClick={resetControls}
            >
              Reset controls
            </button>
          </div>
          <p className="trim-note" id="image-reset-note">
            Reset controls restores the original values for this batch. Images,
            completed downloads and source Files are unchanged.
          </p>

          {plan?.ok && keptArea ? (
            <figure className="image-keep">
              <div className="image-keep-stage">
                <img
                  src={selected.url}
                  alt={`Original ${selected.file.name} with the kept area outlined`}
                />
                <svg
                  className="image-keep-overlay"
                  viewBox={`0 0 ${selected.source.orientedWidth} ${selected.source.orientedHeight}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  {!keepFull && (
                    <path
                      className="image-keep-shade"
                      fillRule="evenodd"
                      d={`M0 0H${selected.source.orientedWidth}V${selected.source.orientedHeight}H0Z ${keptArea.points
                        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
                        .join(" ")} Z`}
                    />
                  )}
                  <polygon
                    className="image-keep-outline-halo"
                    points={keptArea.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  />
                  <polygon
                    className="image-keep-outline"
                    points={keptArea.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  />
                </svg>
              </div>
              <figcaption>
                Kept area · {plan.crop.width} × {plan.crop.height} px of{" "}
                {selected.source.orientedWidth} × {selected.source.orientedHeight}.{" "}
                {keepFull
                  ? "The whole displayed image is exported; the source File stays unchanged."
                  : "The dimmed area is discarded by the export; the source File stays unchanged."}
              </figcaption>
            </figure>
          ) : (
            <p className="trim-note">
              No keep preview yet. Choose usable output settings to see the exact area
              the export will keep.
            </p>
          )}

          {selected.result && selected.source.alpha && selected.result.mime !== "image/jpeg" && (
            <fieldset className="image-controls">
              <legend>Preview backdrop</legend>
              <label>
                Preview background
                <select
                  value={previewBackdrop}
                  onChange={(event) => setPreviewBackdrop(event.target.value as PreviewBackdrop)}
                  aria-describedby="image-backdrop-note"
                >
                  <option value="checkerboard">Checkerboard</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <p className="trim-note" id="image-backdrop-note">
                Use white or black to check for halos around transparent edges.
                This changes the previews on screen. Your download stays the same.
              </p>
            </fieldset>
          )}

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
                <img src={selected.result.url} alt={`Processed ${selected.file.name}`} data-backdrop={previewBackdrop} />
              </figure>
            )}
          </div>
          {selected.result && (
            <div className="image-result">
              <p>
                <strong>Your result</strong> · SHA-256 <code title={selected.result.sha256}>{shortHash(selected.result.sha256)}</code> · original unchanged.
              </p>
              <p className="trim-note">
                {describeTransform({
                  rotate: selected.result.settings.rotate,
                  flipH: selected.result.settings.flipH,
                  flipV: selected.result.settings.flipV,
                  straighten: selected.result.settings.straighten,
                  cropAspect: selected.result.settings.cropAspect === "original" ? null : CROP_ASPECTS[selected.result.settings.cropAspect],
                  cropAnchor: selected.result.settings.cropAnchor,
                  trimmed: selected.result.trimmed,
                  resize: resizeFor(selected.result.settings),
                  resample: selected.result.settings.resample,
                  adjustments: describeAdjustments(selected.result.settings.adjust),
                  format: selected.result.settings.format,
                  quality: selected.result.settings.format === "png" ? null : selected.result.settings.quality,
                  metadata: "canvas re-encode",
                })}
              </p>
              {selected.result.adjustChanged > 0 && (
                <p className="trim-note">
                  Adjustments changed {selected.result.adjustChanged.toLocaleString()} pixel
                  {selected.result.adjustChanged === 1 ? "" : "s"} in the exported result.
                  Fully transparent pixels kept their colour and every alpha value is unchanged.
                </p>
              )}
              {selected.result.target && (
                <p className={selected.result.target.met ? "notice calm" : "notice warn"} role="status">
                  Target {formatBytes(selected.result.target.requestedBytes)}:{" "}
                  {selected.result.target.met ? "met" : "not met"} — actual result{" "}
                  {formatBytes(selected.result.bytes)}
                  {selected.result.target.met
                    ? "."
                    : `, ${formatBytes(selected.result.bytes - selected.result.target.requestedBytes)} over. Lower the output size or choose a different format.`}
                </p>
              )}
              {!freshResult && <p className="notice calm">The settings changed since this result. Make the image again to match the current controls; the existing download is still valid for the earlier settings.</p>}
              <a
                className="button"
                href={selected.result.url}
                download={`${safeStem(selected.file.name)}-${selected.result.width}x${selected.result.height}.${extensionForImageMime(selected.result.mime)}`}
              >
                Download {selected.result.mime.replace("image/", "").toUpperCase()}
              </a>
              <a
                className="button secondary"
                href={imageReceiptHref}
                download="studio-image-receipt.json"
              >
                Download image receipt (.json)
              </a>
              <p className="trim-note">
                Keep the hashes and settings for this finished image. Later
                edits to the controls leave this receipt tied to the download.
              </p>
            </div>
          )}
          {selected.error && <p className="notice warn" role="alert">{selected.error}</p>}
        </section>
      )}

      {selected && (
        <section className="trim-work image-colour" aria-labelledby="image-colour-heading">
          <div className="image-section-head">
            <h2 id="image-colour-heading">Colour</h2>
            <span>palette and exact pixels</span>
          </div>
          <p className="trim-note" role="status" aria-live="polite">{copyMessage}</p>

          <div className="image-colour-block">
            <h3>Palette</h3>
            <p className="trim-note">
              Up to {MAX_PALETTE_COLOURS} dominant colours from the source image.
              Fully transparent pixels are ignored, near-duplicates are merged, and
              coverage is the share of sampled pixels with any alpha.
            </p>
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={running || paletteBusy || !selected}
                onClick={() => void extractSelectedPalette()}
              >
                {paletteBusy ? "Reading colours…" : "Extract palette"}
              </button>
              {!running && !paletteBusy && visiblePalette && visiblePalette.result.colors.length > 0 && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void copyValue("palette CSS", paletteToCss(visiblePalette.result.colors), {
                      echo: false,
                      fallback: "Could not copy the palette. Download the CSS file instead.",
                    })}
                  >
                    Copy palette CSS
                  </button>
                  <a
                    className="button secondary"
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(paletteToGpl(visiblePalette.result.colors))}`}
                    download="studio-palette.gpl"
                  >
                    Download palette (.gpl)
                  </a>
                  <a
                    className="button secondary"
                    href={`data:text/css;charset=utf-8,${encodeURIComponent(paletteToCss(visiblePalette.result.colors))}`}
                    download="studio-palette.css"
                  >
                    Download palette (.css)
                  </a>
                  <a
                    className="button secondary"
                    href={bytesToDataUri(paletteToAse(visiblePalette.result.colors), "application/octet-stream")}
                    download="studio-palette.ase"
                  >
                    Download palette (.ase)
                  </a>
                  <a
                    className="button secondary"
                    href={`data:application/json;charset=utf-8,${encodeURIComponent(paletteToJson(visiblePalette.result.colors))}`}
                    download="studio-palette.json"
                  >
                    Download palette (.json)
                  </a>
                  <a
                    className="button secondary"
                    href="https://composer-launch-kit.loftwah.workers.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Use palette in Launch Kit
                  </a>
                </>
              )}
            </div>
            {!running && !paletteBusy && visiblePalette && visiblePalette.result.colors.length > 0 && (
              <p className="trim-note">
                Download the palette JSON, then select it under “Import a Media Studio palette” in Launch Kit. The file stays on your device.
              </p>
            )}
            <p className="trim-note" role="status" aria-live="polite">
              {paletteMessage ||
                "No palette yet. Extraction runs on this device and does not change the original File."}
            </p>
            {visiblePalette && visiblePalette.result.colors.length > 0 && (
              <>
                <p className="trim-note">
                  {visiblePalette.result.colors.length} colour
                  {visiblePalette.result.colors.length === 1 ? "" : "s"} ·{" "}
                  {visiblePalette.result.coveredPercent}% of visible sampled pixels ·{" "}
                  {visiblePalette.workingWidth} × {visiblePalette.workingHeight} working copy
                  {visiblePalette.result.complete ? "" : " (sampled)"}.
                </p>
                <ul className="image-palette">
                  {visiblePalette.result.colors.map((colour) => (
                    <li key={`${colour.hex}:${colour.rgb.g}:${colour.rgb.b}`} className="image-palette-row">
                      <button
                        type="button"
                        className="image-swatch"
                        style={{ backgroundColor: colour.hex }}
                        aria-label={`Copy HEX ${colour.hex}, ${colour.coverage}% of visible sampled pixels`}
                        title={`Copy ${colour.hex}`}
                        onClick={() => void copyValue("HEX", colour.hex)}
                      />
                      <div className="image-palette-values">
                        <span><strong>{colour.hex}</strong> · {colour.coverage}%{colour.alpha < 255 ? ` · alpha ${Math.round(colour.alpha / 2.55)}%` : ""}</span>
                        <span>{formatRgb(colour.rgb)}</span>
                        <span>{formatHsl(colour.hsl)}</span>
                        <div className="image-copy-actions">
                          <button type="button" className="quiet image-copy" aria-label={`Copy HEX ${colour.hex}`} onClick={() => void copyValue("HEX", colour.hex)}>Copy HEX</button>
                          <button type="button" className="quiet image-copy" aria-label={`Copy RGB ${formatRgb(colour.rgb)}`} onClick={() => void copyValue("RGB", formatRgb(colour.rgb))}>Copy RGB</button>
                          <button type="button" className="quiet image-copy" aria-label={`Copy HSL ${formatHsl(colour.hsl)}`} onClick={() => void copyValue("HSL", formatHsl(colour.hsl))}>Copy HSL</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="image-colour-block">
            <h3>Eyedropper</h3>
            {selected.result ? (
              <>
                <p className="trim-note" id="image-eyedropper-help">
                  Click the result preview or move the pointer over it to read the exact
                  intrinsic pixel. With the preview focused, arrow keys move one pixel,
                  Shift and an arrow moves ten, and Enter samples again. Copying uses the
                  buttons; it does not require another canvas click.
                </p>
                <figure className="image-eyedropper">
                  <div className="image-eyedropper-stage">
                    <img
                      ref={eyedropperRef}
                      src={selected.result.url}
                      alt={`Colour sample preview for ${selected.file.name}`}
                      tabIndex={0}
                      width={selected.result.width}
                      height={selected.result.height}
                      data-backdrop={previewBackdrop}
                      aria-describedby="image-eyedropper-help"
                      onPointerMove={(event) => {
                        if (event.pointerType === "mouse")
                          pickAtClient(event.clientX, event.clientY);
                      }}
                      onClick={(event) => pickAtClient(event.clientX, event.clientY)}
                      onKeyDown={(event) => {
                        const image = event.currentTarget;
                        if (!image.naturalWidth || !image.naturalHeight) {
                          setPickMessage("The result preview is not ready yet.");
                          return;
                        }
                        const start = picked ?? {
                          x: Math.floor(image.naturalWidth / 2),
                          y: Math.floor(image.naturalHeight / 2),
                        };
                        const step = event.shiftKey ? 10 : 1;
                        let x = start.x;
                        let y = start.y;
                        if (event.key === "ArrowLeft") x = Math.max(0, x - step);
                        else if (event.key === "ArrowRight")
                          x = Math.min(image.naturalWidth - 1, x + step);
                        else if (event.key === "ArrowUp") y = Math.max(0, y - step);
                        else if (event.key === "ArrowDown")
                          y = Math.min(image.naturalHeight - 1, y + step);
                        else if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          samplePixel(start.x, start.y);
                          return;
                        } else return;
                        event.preventDefault();
                        samplePixel(x, y);
                      }}
                    />
                    {picked && (
                      <span
                        className="image-pick-marker"
                        aria-hidden="true"
                        style={{
                          left: `${((picked.x + 0.5) / selected.result!.width) * 100}%`,
                          top: `${((picked.y + 0.5) / selected.result!.height) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  <figcaption>
                    Result preview · {selected.result.width} × {selected.result.height} px.
                    The sample reads the encoded result, not a scaled screen copy.
                  </figcaption>
                </figure>
                {picked ? (
                  <div className="image-pick-readout">
                    <span
                      className="image-swatch"
                      style={{ backgroundColor: picked.hex }}
                      aria-hidden="true"
                    />
                    <div className="image-palette-values">
                      <span><strong>{picked.hex}</strong> · pixel {picked.x}, {picked.y}{picked.alpha < 255 ? ` · alpha ${Math.round(picked.alpha / 2.55)}%` : ""}</span>
                      <span>{formatRgb(picked.rgb)}</span>
                      <span>{formatHsl(rgbToHsl(picked.rgb))}</span>
                      <div className="image-copy-actions">
                        <button type="button" className="quiet image-copy" aria-label={`Copy sampled HEX ${picked.hex}`} onClick={() => void copyValue("HEX", picked.hex)}>Copy HEX</button>
                        <button type="button" className="quiet image-copy" aria-label={`Copy sampled RGB ${formatRgb(picked.rgb)}`} onClick={() => void copyValue("RGB", formatRgb(picked.rgb))}>Copy RGB</button>
                        <button type="button" className="quiet image-copy" aria-label={`Copy sampled HSL ${formatHsl(rgbToHsl(picked.rgb))}`} onClick={() => void copyValue("HSL", formatHsl(rgbToHsl(picked.rgb)))}>Copy HSL</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="trim-note">No pixel sampled yet. Click the preview or focus it and use the arrow keys.</p>
                )}
                <p className="trim-note" role="status" aria-live="polite">
                  {pickMessage || "The sample coordinate maps through the displayed size to the intrinsic pixel."}
                </p>
              </>
            ) : (
              <p className="trim-note">
                Make this image to enable the eyedropper. It samples the actual encoded
                result and maps the displayed CSS coordinates to intrinsic pixels.
              </p>
            )}
          </div>
        </section>
      )}

      {selected?.result && (
        <section className="trim-work image-embed" aria-labelledby="image-embed-heading">
          <div className="image-section-head">
            <h2 id="image-embed-heading">Embed code</h2>
            <span>data URI from this result</span>
          </div>
          <p className="trim-note" id="image-embed-note">
            A data URI carries the exact exported bytes. It is not encryption, redaction
            or a private link: anyone who receives the text has the image. Base64 is
            about a third larger than the file, and embed code stops at{" "}
            {formatBytes(MAX_SNIPPET_BYTES)} so a paste cannot hide a huge payload.
          </p>
          <div className="image-control-actions">
            <button
              type="button"
              className="secondary"
              disabled={snippetBusy || running}
              aria-describedby="image-embed-note"
              onClick={() => void buildSnippets()}
            >
              {snippetBusy ? "Building embed code…" : visibleSnippets ? "Rebuild embed code" : "Build embed code"}
            </button>
            {visibleSnippets && snippetUrl?.kind === snippetKind && (
              <a
                className="button secondary"
                href={snippetUrl.url}
                download={`${safeStem(selected.file.name)}-${selected.result!.width}x${selected.result!.height}-${snippetKind}.txt`}
              >
                Download {SNIPPET_LABELS[snippetKind]}
              </a>
            )}
          </div>
          <p className="trim-note" role="status" aria-live="polite">{snippetMessage}</p>
          {visibleSnippets && (
            <div className="image-snippet">
              <div className="image-snippet-actions">
                {SNIPPET_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={kind === snippetKind ? "secondary image-copy" : "quiet image-copy"}
                    aria-pressed={kind === snippetKind}
                    onClick={() => setSnippetKind(kind)}
                  >
                    {SNIPPET_LABELS[kind]}
                  </button>
                ))}
              </div>
              <p className="trim-note">
                {visibleSnippets.base64Length.toLocaleString()} base64 characters ·{" "}
                {visibleSnippets.dataUriLength.toLocaleString()} data-URI characters ·{" "}
                {formatBytes(visibleSnippets.bytes)} of real output
              </p>
              {visibleSnippets.warning && <p className="notice warn">{visibleSnippets.warning}</p>}
              <label>
                {SNIPPET_LABELS[snippetKind]} text
                <textarea
                  readOnly
                  rows={6}
                  spellCheck={false}
                  value={snippetText}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <div className="image-copy-actions">
                <button
                  type="button"
                  className="quiet image-copy"
                  onClick={() => void copyValue(SNIPPET_LABELS[snippetKind], snippetText)}
                >
                  Copy {SNIPPET_LABELS[snippetKind]}
                </button>
              </div>
            </div>
          )}
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
          <button type="button" disabled={running || socialBusy || adding || !items.length || !plan?.ok || Boolean(targetProblem)} onClick={() => void runItems(items)}>
            Process all {items.length || ""} with these settings
          </button>
          {running && <button type="button" className="secondary" onClick={cancelBatch}>Cancel batch</button>}
          <button type="button" className="secondary" disabled={running || socialBusy || zipBusy || !doneItems.length} onClick={() => void makeZip()}>
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
            {items.map((item, index) => (
              <li
                className={item.id === selectedId ? "is-selected" : ""}
                key={item.id}
                draggable={!running}
                onDragStart={() => {
                  dragIdRef.current = item.id;
                }}
                onDragOver={(event) => {
                  if (dragIdRef.current) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropItem(item.id);
                }}
              >
                <button type="button" className="image-list-select" onClick={() => selectItem(item.id)} aria-pressed={item.id === selectedId}>
                  <span className="image-list-name">{item.file.name}</span>
                  <span className="image-list-meta">
                    {item.source.orientedWidth} × {item.source.orientedHeight} · {formatBytes(item.file.size)} · {item.status}
                    {item.result ? ` · ${item.result.width} × ${item.result.height} · ${formatBytes(item.result.bytes)}` : ""}
                  </span>
                  {item.error && <span className="image-list-error">{item.error}</span>}
                </button>
                <div className="image-list-actions">
                  <button
                    type="button"
                    className="quiet"
                    disabled={running || index === 0}
                    aria-label={`Move ${item.file.name} up in the ZIP order`}
                    onClick={() => moveItem(item.id, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={running || index === items.length - 1}
                    aria-label={`Move ${item.file.name} down in the ZIP order`}
                    onClick={() => moveItem(item.id, 1)}
                  >
                    Move down
                  </button>
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
          Drag a row or use Move up and Move down to change the order. Each image is
          decoded and encoded one at a time; the ZIP follows this list order. Cancelling
          stops after the current encode, and already completed downloads stay in the
          list. ZIP export uses a small store-only writer in this page, not a server
          archive.
        </p>
      </section>
    </main>
  );
}

export function mountImages(container: HTMLElement) {
  createRoot(container).render(<Images />);
}
