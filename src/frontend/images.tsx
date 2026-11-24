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
} from "./image-snippets.ts";
import {
  MAX_PALETTE_COLOURS,
  PALETTE_WORKING_EDGE,
  alphaBounds,
  alphaMapPlan,
  alphaProfile,
  buildAlphaReport,
  writeAlphaMapBand,
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
  type AlphaMap,
  type AlphaProfileResult,
  type AlphaReport,
  type ImageBounds,
  type PaletteResult,
  type Rgb,
} from "./image-colour.ts";
import {
  MAX_BATCH_IMAGES,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES,
  MAX_IMAGE_OUTPUT_DIMENSION,
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
} from "./image-metadata.ts";
import {
  CONTACT_SHEET_MIN_IMAGES,
  CONTACT_SHEET_TILE,
  contactSheetDocument,
  contactSheetLayout,
  contactSheetPlacement,
  type ContactSheetColumns,
  type ContactSheetTile,
  type ContactSheetTileSize,
} from "./image-contact-sheet.ts";
import {
  atlasBoundsProblem,
  atlasDocument,
  atlasLayout,
  atlasPlacement,
} from "./image-atlas.ts";
import {
  GIF_DEFAULT_DELAY_MS,
  GIF_DEFAULT_FRAME_SIZE,
  GIF_FRAME_SIZES,
  GIF_DELAY_STEP_MS,
  GIF_MAX_DELAY_MS,
  GIF_MAX_FRAMES,
  GIF_MIN_DELAY_MS,
  GIF_MIN_FRAMES,
  encodeGif,
  gifDelaySummary,
  gifFrameDelaysProblem,
  gifFramePlacement,
  gifSettingsProblem,
} from "./image-gif.ts";
import { createZip, ZIP_MIME } from "./image-zip.ts";
import {
  IMAGE_QUALITY_MAX_PERCENT,
  IMAGE_QUALITY_MIN_PERCENT,
  imageQualityIsValid,
  settingsForImage,
  type ExportFormat,
} from "./image-export-override.ts";
import { buildImageReceipt, type ImageReceipt } from "./image-receipt.ts";
import {
  publicStillFromHash,
  socialSourceManifestEntry,
  sourceFilmPath,
  sourceStillPath,
  stillSourceManifestEntry,
} from "./image-social-source.ts";
import {
  COMPOSER_POST_BRIEF_MAX_BYTES,
  ComposerArtworkLoadError,
  composerArtworkManifestEntry,
  composerArtworkSourceUrl,
  fetchComposerArtwork,
  formatComposerArtworkDiagnostic,
  parseComposerArtworkHash,
  parseComposerPostBrief,
  type ComposerArtworkRef,
} from "./composer-artwork.ts";
import { ImageCover } from "./image-cover.tsx";
import { TitleCompare, type PreparedTitleImage } from "./image-title-compare.tsx";
import {
  SOCIAL_KIT_FORMATS,
  SOCIAL_POST_LIMITS,
  SOCIAL_SIZES,
  defaultSocialKitFormat,
  socialKitCropAnchor,
  socialKitCropStale,
  socialKitSettings,
  socialPostEntries,
  socialSourceEligible,
  type SocialKitFormat,
  type SocialPostText,
  type SocialSizeKey,
} from "./image-social-kit.ts";
import { canEncodeWebP } from "./image-encode-support.ts";
import { LocalImport } from "./local-import";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./audio-trim.css";
import "./images.css";

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
  key: SocialSizeKey;
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

type SocialZipEntry = { name: string; data: Uint8Array };

type SocialZip = {
  itemId: string;
  url: string;
  bytes: number;
  manifest: SocialZipEntry | null;
  post: SocialZipEntry[];
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

type AlphaInspectState = {
  key: string;
  result: Extract<AlphaProfileResult, { ok: true }>;
  map: AlphaMap;
  report: AlphaReport;
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
  publicSource?: PublicImageSource;
  status: ItemStatus;
  result?: RenderedImage;
  stripped?: StrippedImage;
  error?: string;
  /** A reversible one-image export format. Undefined follows the batch. */
  formatOverride?: ExportFormat;
  /** A reversible one-image long edge in px. Undefined follows the batch. */
  longEdgeOverride?: number;
  /** A reversible one-image quality in whole percent. Undefined follows the batch. */
  qualityOverride?: number;
  /** A reversible one-image crop aspect. Undefined follows the batch. */
  cropAspectOverride?: CropAspectKey;
  /** A reversible one-image crop position. Undefined follows the batch. */
  cropAnchorOverride?: CropAnchorKey;
  /**
   * A reversible exact GIF delay for this row, in 100–2000 ms steps of 10.
   * Keyed by the row's stable id through reorder; undefined follows the batch
   * delay, and removing the row removes the override with it.
   */
  gifDelayMsOverride?: number;
  /**
   * Reversible crop positions for the four social kit sizes, held only in this
   * in-memory item. A missing key is blank and follows the editor's crop
   * position. Editing a choice never rewrites an existing result or download.
   */
  socialCropAnchors?: Partial<Record<SocialSizeKey, CropAnchorKey>>;
  socialPost?: SocialPostText;
};

type Rejection = { name: string; message: string };

type PublicImageSource =
  | { kind: "poster"; path: string }
  | { kind: "still"; path: string }
  | { kind: "composer"; ref: ComposerArtworkRef };

type ListFocus =
  | { kind: "row"; id: string }
  | { kind: "row-action"; id: string; offset: -1 | 1 }
  | { kind: "picker" };

type ContactSheet = { url: string; blob: Blob; layoutUrl: string; layoutText: string; count: number; columns: number; tileSize: number; width: number; height: number; mode: SheetMode };
type SheetMode = "contact-sheet" | "sprite-atlas";
type GifOutput = {
  url: string;
  width: number;
  height: number;
  count: number;
  /** The exact ordered vector captured when this blob was encoded. */
  delaysMs: number[];
  bytes: number;
};

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

// One tiny canvas, probed once when this lazy image-tool chunk loads.
const WEBP_ENCODABLE = canEncodeWebP();

const FORMATS: Array<{ value: ExportFormat; label: string; mime: string }> = [
  { value: "png", label: "PNG · lossless", mime: "image/png" },
  { value: "jpeg", label: "JPEG · smaller", mime: "image/jpeg" },
  {
    value: "webp",
    label: WEBP_ENCODABLE ? "WebP · smaller" : "WebP · unavailable in this browser",
    mime: "image/webp",
  },
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

function percentOf(count: number, total: number): string {
  if (!total) return "0";
  return String(Math.round((count / total) * 1000) / 10);
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

/** The download name of one finished render, also used when it becomes an input. */
function renderedFileName(
  name: string,
  result: { width: number; height: number; mime: string },
): string {
  return `${safeStem(name)}-${result.width}x${result.height}.${extensionForImageMime(result.mime)}`;
}

function settingsKey(settings: Settings, cropRect: ImageBounds | null = null): string {
  return JSON.stringify({ settings, cropRect });
}

function targetBytesFor(settings: Settings): number | null {
  if (settings.format === "png" || settings.targetKiB === null) return null;
  if (!Number.isFinite(settings.targetKiB) || settings.targetKiB <= 0) return null;
  return Math.round(settings.targetKiB * 1024);
}

function itemLongEdgeIsValid(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 1 && value <= MAX_IMAGE_OUTPUT_DIMENSION
  );
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

/**
 * A header-only PNG (IHDR plus IEND, no image data) passes the byte sniff and
 * the header pixel limits but has no pixels to export. Decode the candidate
 * with the same native decoder the export path uses, then close the temporary
 * bitmap immediately so intake never keeps a full-size copy in memory.
 */
async function browserDecodeProblem(file: File): Promise<string | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width >= 1 && bitmap.height >= 1) return null;
    return "the decoder returned no pixels";
  } catch {
    return "the decoder refused the file";
  } finally {
    bitmap?.close();
  }
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

const PUBLIC_IMAGE_TIMEOUT_MS = 15_000;

const STUDIO_REVISION = typeof document === "undefined"
  ? ""
  : document.getElementById("images")?.dataset.studioRevision ?? "";

const POSTER_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function publicPosterFromHash(): string | null {
  const path = new URLSearchParams(window.location.hash.slice(1)).get("public-poster");
  return path && sourceFilmPath(path) ? path : null;
}

const publicImageLabels = {
  composer: { source: "Composer artwork", loaded: "Composer artwork added" },
  still: { source: "published image", loaded: "Published image added" },
  poster: { source: "public poster", loaded: "Public poster added" },
};

async function fetchPublicImage(
  path: string,
  signal: AbortSignal,
  label: string,
): Promise<File> {
  const response = await fetch(path, {
    mode: "same-origin",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  const type = response.headers.get("content-type") ?? "";
  const extension = POSTER_EXTENSIONS.get(type);
  if (!response.ok || !extension || !response.body) {
    await response.body?.cancel();
    throw new Error(`This ${label} is unavailable or is not a supported image.`);
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_INPUT_BYTES)
      throw new Error(`This ${label} exceeds the image size limit.`);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_INPUT_BYTES)
        throw new Error(`This ${label} exceeds the image size limit.`);
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const [, , slug, route] = path.split("/");
  const suffix = route === "poster" || route === "thumb" ? "-poster" : "";
  return new File(chunks, `${slug}${suffix}.${extension}`, { type });
}

function publicImageSourceFromHash(): PublicImageSource | null {
  const composerArtwork = parseComposerArtworkHash(window.location.hash);
  if (composerArtwork) return { kind: "composer", ref: composerArtwork };
  const still = publicStillFromHash(window.location.hash);
  if (still) return { kind: "still", path: still };
  const poster = publicPosterFromHash();
  return poster ? { kind: "poster", path: poster } : null;
}

// The map is display only: it is painted from the same in-memory pixels that
// the exact counts used, and nothing reads it back for an export.
function AlphaMapCanvas({ map, label }: { map: AlphaMap; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(map.width, map.height);
    image.data.set(map.pixels);
    context.putImageData(image, 0, 0);
  }, [map]);
  return (
    <canvas
      ref={canvasRef}
      className="image-alpha-map"
      width={map.width}
      height={map.height}
      role="img"
      aria-label={label}
      aria-describedby="image-alpha-map-note"
    />
  );
}

function Images() {
  const [publicImageSource] = useState(publicImageSourceFromHash);
  const publicImageLabel = publicImageSource ? publicImageLabels[publicImageSource.kind].source : "";
  const [publicImageLoading, setPublicImageLoading] = useState(false);
  const [sourceDiagnostic, setSourceDiagnostic] = useState("");
  const publicImageRequest = useRef<AbortController | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [previewBackdrop, setPreviewBackdrop] = useState<PreviewBackdrop>("checkerboard");
  const [message, setMessage] = useState("");
  // Blocked drop/paste needs its own status: `message` is reused for progress
  // and would otherwise erase the "add it again" instruction mid-work.
  const [sourceNotice, setSourceNotice] = useState("");
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [adding, setAdding] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState({ total: 0, completed: 0, current: "" });
  const [zipUrl, setZipUrl] = useState("");
  const [zipBytes, setZipBytes] = useState(0);
  const [contactSheet, setContactSheet] = useState<ContactSheet | null>(null);
  const [sheetColumns, setSheetColumns] = useState<ContactSheetColumns>("auto");
  const [sheetTile, setSheetTile] = useState<ContactSheetTileSize>(CONTACT_SHEET_TILE);
  const [sheetMode, setSheetMode] = useState<SheetMode>("contact-sheet");
  const [batchExport, setBatchExport] = useState<"zip" | SheetMode | null>(null);
  const zipBusy = batchExport === "zip";
  const sheetBusy = batchExport === "contact-sheet" || batchExport === "sprite-atlas";
  const [gifOutput, setGifOutput] = useState<GifOutput | null>(null);
  const [gifBusy, setGifBusy] = useState(false);
  const [gifMessage, setGifMessage] = useState("");
  const [gifFrameSize, setGifFrameSize] = useState<number>(GIF_DEFAULT_FRAME_SIZE);
  const [gifDelayMs, setGifDelayMs] = useState<number>(GIF_DEFAULT_DELAY_MS);
  const [gifMatte, setGifMatte] = useState("#ffffff");
  const [gifLoop, setGifLoop] = useState(true);
  const gifSource = useRef("");
  const [batchMessage, setBatchMessage] = useState("");
  const [socialOutputs, setSocialOutputs] = useState<SocialOutput[]>([]);
  const [socialZip, setSocialZip] = useState<SocialZip | null>(null);
  const [socialOperation, setSocialOperation] = useState<"sizes" | "text" | null>(null);
  const socialBusy = socialOperation !== null;
  const [socialFormat, setSocialFormat] = useState<SocialKitFormat>(defaultSocialKitFormat(WEBP_ENCODABLE));
  const [postBriefStatus, setPostBriefStatus] = useState<{ bad: boolean; message: string } | null>(null);
  const [stripBusy, setStripBusy] = useState(false);
  const [removeIcc, setRemoveIcc] = useState(false);
  const [importing, setImporting] = useState(false);
  const [trim, setTrim] = useState<TrimState | null>(null);
  const [trimBusy, setTrimBusy] = useState(false);
  const [trimMessage, setTrimMessage] = useState("");
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [readingPaletteId, setReadingPaletteId] = useState("");
  const [paletteMessage, setPaletteMessage] = useState<{ itemId: string; text: string } | null>(null);
  const [picked, setPicked] = useState<PickedColour | null>(null);
  const [pickMessage, setPickMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [paletteCopyFallback, setPaletteCopyFallback] = useState<{
    label: string;
    value: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const [outputCopy, setOutputCopy] = useState<{ key: string; message: string } | null>(null);
  const [sheetCopy, setSheetCopy] = useState<{ key: string; message: string } | null>(null);
  const [sheetJsonFallback, setSheetJsonFallback] = useState<{ key: string; trigger: HTMLButtonElement } | null>(null);
  const [outputHashFallback, setOutputHashFallback] = useState<{
    key: string;
    hash: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const [snippets, setSnippets] = useState<SnippetState | null>(null);
  const [snippetKind, setSnippetKind] = useState<SnippetKind>("dataUri");
  const [snippetBusy, setSnippetBusy] = useState(false);
  const [snippetMessage, setSnippetMessage] = useState("");
  const [snippetUrl, setSnippetUrl] = useState<{ kind: SnippetKind; url: string } | null>(null);
  const [alphaInspect, setAlphaInspect] = useState<AlphaInspectState | null>(null);
  const [alphaBusy, setAlphaBusy] = useState(false);
  const [alphaMessage, setAlphaMessage] = useState("");
  const urls = useRef(new Set<string>());
  const revision = useRef(0);
  const batchExportRevision = useRef(0);
  const gifRevision = useRef(0);
  const batchController = useRef<{ controller: AbortController; report: (message: string) => void } | null>(null);
  const socialController = useRef<AbortController | null>(null);
  const postBriefRequest = useRef(0);
  const makeSocialKitRef = useRef<HTMLButtonElement>(null);
  const updateSocialTextRef = useRef<HTMLButtonElement>(null);
  const socialZipDownloadRef = useRef<HTMLAnchorElement>(null);
  const cancelSocialKitRef = useRef<HTMLButtonElement>(null);
  const socialSizesRef = useRef<HTMLFieldSetElement>(null);
  const restoreSocialKitFocus = useRef<"sizes" | "text" | null>(null);
  const stripRevision = useRef(0);
  const didInitSettings = useRef(false);
  const addFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const addingRef = useRef(false);
  const sampleBusyRef = useRef(false);
  const sampleRunRef = useRef(0);
  const runningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restorePickerFocus = useRef(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const processAllRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterListChange = useRef<ListFocus | null>(null);
  const eyedropperRef = useRef<HTMLImageElement | null>(null);
  const pickCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragIdRef = useRef("");
  const latestOutputCopy = useRef(0);
  const latestSheetCopy = useRef(0);
  const sheetJsonFallbackField = useRef<HTMLTextAreaElement>(null);
  const latestSnippetCopy = useRef(0);
  const snippetField = useRef<HTMLTextAreaElement>(null);
  const latestPaletteCopy = useRef(0);
  const paletteCopyField = useRef<HTMLInputElement>(null);
  const paletteCopyTextareaField = useRef<HTMLTextAreaElement>(null);
  const outputHashFallbackField = useRef<HTMLInputElement>(null);
  const currentOutputKey = useRef("");
  const currentSheetKey = useRef("");
  const alphaRevision = useRef(0);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const socialReady = socialSourceEligible(
    selected?.source.mime,
    selected?.publicSource?.kind === "poster",
    selected?.source.webpAnimated,
  );
  const socialPost = socialPostEntries(selected?.socialPost);
  const socialTextChanged = Boolean(
    socialZip && socialZip.itemId === selected?.id && socialOutputs.length === SOCIAL_SIZES.length &&
    (socialPost.length !== socialZip.post.length || socialPost.some((entry, index) => {
      const included = socialZip.post[index];
      return entry.name !== included.name || entry.data.length !== included.data.length ||
        entry.data.some((byte, offset) => byte !== included.data[offset]);
    })),
  );
  const socialCropStale = Boolean(
    socialZip &&
    socialZip.itemId === selected?.id &&
    selected &&
    socialOutputs.length === SOCIAL_SIZES.length &&
    socialKitCropStale(selected.socialCropAnchors, settings.cropAnchor, socialOutputs),
  );
  const animatedWebp = selected?.source.mime === "image/webp" && Boolean(selected?.source.webpAnimated);
  const publicImageLoaded = Boolean(publicImageSource && items.some((item) => item.publicSource === publicImageSource));
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
  // The batch controls stay shared; these per-item choices change only the
  // selected image's effective settings. Everything downstream reads that snapshot.
  const selectedSettings = selected
    ? settingsForImage(
        settings,
        selected.source.mime,
        false,
        selected.longEdgeOverride,
        selected.cropAspectOverride,
        selected.cropAnchorOverride,
        selected.qualityOverride,
        selected.formatOverride,
      )
    : settings;
  const plan = selected ? makePlan(selected.source, selectedSettings, activeTrim) : null;
  const currentSettingsKey = settingsKey(selectedSettings, activeTrim);
  const freshResult = selected?.result?.settingsKey === currentSettingsKey;
  const outputHash = selected?.result?.sha256;
  // Copy status belongs to one exact finished result, so selecting another row
  // or regenerating never shows an earlier result's message.
  const outputResultKey = selected?.result?.url ?? "";
  useLayoutEffect(() => {
    currentOutputKey.current = outputResultKey;
    latestOutputCopy.current += 1;
  }, [outputResultKey]);
  // Copy feedback belongs to one exact sheet blob. Replacing the sheet or
  // clearing the batch retires any in-flight message for the earlier PNG.
  const sheetKey = contactSheet?.url ?? "";
  useLayoutEffect(() => {
    currentSheetKey.current = sheetKey;
    latestSheetCopy.current += 1;
    setSheetJsonFallback(null);
  }, [sheetKey]);
  // An alpha profile belongs to one exact finished result. Selecting another
  // row or regenerating can never leave an earlier result's counts on screen.
  const visibleAlpha =
    alphaInspect?.key === outputResultKey ? alphaInspect.result : null;
  const visibleAlphaMap =
    alphaInspect?.key === outputResultKey ? alphaInspect.map : null;
  // The report is the same inspection snapshot, so a different row or a new
  // result retires the link with the counts instead of offering stale counts.
  const visibleAlphaReport =
    alphaInspect?.key === outputResultKey ? alphaInspect.report : null;
  const alphaReportHref = visibleAlphaReport
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(visibleAlphaReport))}`
    : "";
  const canCopyPng =
    typeof window !== "undefined" &&
    typeof window.ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function";
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
  const hasItemOverride = items.some(
    (item) =>
      item.formatOverride !== undefined ||
      item.longEdgeOverride !== undefined ||
      item.qualityOverride !== undefined ||
      item.cropAspectOverride !== undefined ||
      item.cropAnchorOverride !== undefined,
  );
  const invalidLongEdgeItem = items.find(
    (item) =>
      item.longEdgeOverride !== undefined && !itemLongEdgeIsValid(item.longEdgeOverride),
  );
  // Every row decision flows through the same effective settings as the render,
  // so its format, target and quality never drift from what the encoder uses.
  const rowSettings = (item: WorkItem) =>
    settingsForImage(
      settings,
      item.source.mime,
      false,
      item.longEdgeOverride,
      item.cropAspectOverride,
      item.cropAnchorOverride,
      item.qualityOverride,
      item.formatOverride,
    );
  const rowIsLossy = (item: WorkItem) => rowSettings(item).format !== "png";
  const rowUsesTargetBytes = (item: WorkItem) =>
    targetBytesFor(rowSettings(item)) !== null;
  const canSetRowQuality = (item: WorkItem) => {
    const effective = rowSettings(item);
    return effective.format !== "png" && effective.targetKiB === null;
  };
  const hasInvalidQuality = (item: WorkItem) => canSetRowQuality(item) &&
    item.qualityOverride !== undefined && !imageQualityIsValid(item.qualityOverride);
  const invalidQualityItem = items.find(hasInvalidQuality);
  const controlsAreOriginal =
    settingsKey(settings) === settingsKey(DEFAULT_SETTINGS) && !trim && !hasItemOverride;
  const requestedTargetBytes = targetBytesFor(selectedSettings);
  const targetProblem =
    requestedTargetBytes === null
      ? null
      : targetSizeProblem(selectedSettings.format, requestedTargetBytes);
  // A PNG row drops the byte target for that image only. The batch is blocked
  // by an unusable target only when at least one row still uses one.
  const batchUsesTarget = items.some(rowUsesTargetBytes);
  const batchTargetProblem = batchUsesTarget
    ? targetSizeProblem(settings.format, targetBytesFor(settings))
    : null;
  // The palette reads the original file, independently of any processed output.
  const visiblePalette = palette && selected && palette.itemId === selected.id ? palette : null;
  const visiblePaletteMessage = paletteMessage?.itemId === selected?.id ? paletteMessage?.text : "";
  const paletteBusy = Boolean(readingPaletteId);
  const visibleSnippets =
    snippets && selected?.result?.sha256 === snippets.key ? snippets.data : null;
  const snippetText = visibleSnippets ? visibleSnippets.snippets[snippetKind] : "";
  const doneItems = items.filter((item) => item.result);
  // GIFs use the admitted source files in list order, never the processed
  // results or per-row overrides. Only an add, remove or reorder invalidates an
  // existing GIF; finishing a batch render leaves the same stills in place.
  const gifSourceKey = items.map((item) => `${item.id}:${item.sourceHash}`).join("|");
  // A blank per-row override inherits the batch delay. The vector is derived
  // from the current list order and the rows' stable ids, never from an index
  // saved earlier, so reordering moves each override with its row.
  const gifFrameDelays = items.map((item) => item.gifDelayMsOverride ?? gifDelayMs);
  const gifProblem =
    gifSettingsProblem({
      frameCount: items.length,
      frameSize: gifFrameSize,
      delayMs: gifDelayMs,
    }) ??
    gifFrameDelaysProblem({ frameCount: items.length, frameDelaysMs: gifFrameDelays });
  const gifOutputDelaySummary = gifOutput ? gifDelaySummary(gifOutput.delaysMs) : null;
  const isAtlasMode = sheetMode === "sprite-atlas";
  const atlasEntries = isAtlasMode ? doneItems.flatMap((item) =>
    item.result?.mime === "image/png" ? [{ item, result: item.result }] : [],
  ) : [];
  const atlasPlan = isAtlasMode ? atlasLayout(atlasEntries.map(({ result }) => ({
    width: result.width,
    height: result.height,
  })), sheetColumns) : null;
  const atlasProblem = atlasPlan ? atlasBoundsProblem(atlasPlan) : null;
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
    ? renderedFileName(selected.file.name, selected.result)
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
  // The exact finished result is offered to the packaging compare below. It is
  // only an offer: TitleCompare changes a pair after the creator's explicit
  // Use prepared image action, with no re-encode, upload or automatic replace.
  const preparedTitleImage: PreparedTitleImage | null = selected?.result
    ? {
        blob: selected.result.blob,
        filename: renderedFileName(selected.file.name, selected.result),
        mime: selected.result.mime,
        bytes: selected.result.bytes,
        width: selected.result.width,
        height: selected.result.height,
      }
    : null;

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

  function clearBatchExports(): void {
    batchExportRevision.current += 1;
    latestSheetCopy.current += 1;
    setSheetCopy(null);
    setSheetJsonFallback(null);
    const nextMessage = zipBusy ? "The batch changed. Prepare the ZIP again." :
      sheetBusy ? `The batch changed. Make the ${sheetMode === "sprite-atlas" ? "sprite atlas" : "contact sheet"} again.` : "";
    setBatchMessage(nextMessage);
    releaseUrl(zipUrl);
    releaseUrl(contactSheet?.url);
    releaseUrl(contactSheet?.layoutUrl);
    setZipUrl("");
    setZipBytes(0);
    setContactSheet(null);
  }

  // A GIF is a snapshot of the source stills and the four GIF controls. Any
  // change to those retires the old blob immediately; an encode that is already
  // running checks the same revision before it can publish a stale result.
  function invalidateGif(message: string): void {
    gifRevision.current += 1;
    if (gifOutput) releaseUrl(gifOutput.url);
    setGifOutput(null);
    if (gifBusy || gifOutput) setGifMessage(message);
  }

  function releaseSocial(): void {
    for (const output of socialOutputs) releaseUrl(output.url);
    if (socialZip) releaseUrl(socialZip.url);
    setSocialOutputs([]);
    setSocialZip(null);
  }

  function clearSocial(): void {
    postBriefRequest.current++;
    setPostBriefStatus(null);
    socialController.current?.abort();
    releaseSocial();
  }

  useEffect(() => {
    return () => {
      postBriefRequest.current++;
      revision.current += 1;
      stripRevision.current += 1;
      batchExportRevision.current += 1;
      gifRevision.current += 1;
      alphaRevision.current += 1;
      batchController.current?.controller.abort();
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
    if (gifSource.current === gifSourceKey) return;
    gifSource.current = gifSourceKey;
    gifRevision.current += 1;
    if (!gifOutput) {
      if (gifBusy) setGifMessage("The batch changed. Make the GIF again.");
      return;
    }
    releaseUrl(gifOutput.url);
    setGifOutput(null);
    setGifMessage("The batch changed. Make the GIF again.");
  }, [gifSourceKey]);

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
    setAlphaInspect(null);
    setAlphaMessage("");
    setOutputHashFallback(null);
  }, [selected?.result?.url]);

  // One list focus lifecycle serves removals and reorders: the pending target
  // is chosen before the rows change, then restored after commit. Pointer
  // drags never set it, so they leave focus where the user had it.
  useLayoutEffect(() => {
    const pending = focusAfterListChange.current;
    if (!pending) return;
    focusAfterListChange.current = null;
    if (pending.kind === "picker") {
      fileInputRef.current?.focus();
      return;
    }
    const row = listRef.current?.querySelector<HTMLButtonElement>(`[data-image-row="${pending.id}"]`);
    if (pending.kind === "row-action") {
      // At a list boundary move focus to the same row without reversing direction.
      const direction = pending.offset < 0 ? "up" : "down";
      const action = row?.closest("li")?.querySelector<HTMLButtonElement>(
        `[data-image-move="${direction}"]:not(:disabled)`,
      );
      (action ?? row ?? fileInputRef.current)?.focus();
      return;
    }
    (row ?? fileInputRef.current)?.focus();
  }, [items]);

  // Intake from the native chooser disables the picker while it decodes, which
  // blurs it to BODY. Return focus only if the picker owned it and the user has
  // not moved elsewhere; paste and drop never set the flag, so they never steal focus.
  useLayoutEffect(() => {
    if (adding || !restorePickerFocus.current) return;
    restorePickerFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active === fileInputRef.current) fileInputRef.current?.focus();
  }, [adding]);

  useLayoutEffect(() => {
    if (socialBusy || !restoreSocialKitFocus.current) return;
    const trigger = restoreSocialKitFocus.current === "text"
      ? updateSocialTextRef.current ?? socialZipDownloadRef.current
      : makeSocialKitRef.current;
    restoreSocialKitFocus.current = null;
    if (document.activeElement === document.body) trigger?.focus();
  }, [socialBusy]);

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

  useEffect(() => {
    if (paletteCopyFallback?.trigger === document.activeElement) {
      const field = paletteCopyFallback.value.includes("\n")
        ? paletteCopyTextareaField.current
        : paletteCopyField.current;
      field?.focus();
    }
    if (outputHashFallback?.trigger === document.activeElement) {
      outputHashFallbackField.current?.focus();
    }
    if (sheetJsonFallback?.trigger === document.activeElement) {
      sheetJsonFallbackField.current?.focus();
    }
  }, [paletteCopyFallback, outputHashFallback, sheetJsonFallback]);

  useEffect(() => () => publicImageRequest.current?.abort(), []);

  async function addFiles(
    files: File[],
    fromPicker = false,
    publicImage?: PublicImageSource,
    onAdded?: (item: WorkItem) => void,
    onRejected?: (reason: string, intakeRevision: number) => void,
  ): Promise<void> {
    if (!files.length) return;
    if (addingRef.current || runningRef.current || socialController.current) {
      setSourceNotice("Wait for the current work to finish, then add the new images again.");
      return;
    }
    setSourceNotice("");
    restorePickerFocus.current = fromPicker && document.activeElement === fileInputRef.current;
    addingRef.current = true;
    const currentRevision = ++revision.current;
    setAdding(true);
    setRejections([]);
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
        // The header and pixel limits cannot prove there are pixels: a
        // structurally valid PNG can carry IHDR and IEND with no image data.
        // Refuse it here, before the first queued item or export reset.
        const decodeProblem = await browserDecodeProblem(file);
        if (currentRevision !== revision.current) break;
        if (decodeProblem)
          throw new Error(
            `This ${sniffed.format?.toUpperCase() ?? "image"} has a valid header but no decodable pixels: ${decodeProblem}.`,
          );
        const sourceHash = await sha256Hex(bytes);
        if (currentRevision !== revision.current) break;
        // Accepted images invalidate the finished exports once, at the first
        // addition; refused files leave the existing batch exports intact.
        if (!added) clearBatchExports();
        const url = trackUrl(file);
        const item: WorkItem = {
          id: crypto.randomUUID(),
          file,
          url,
          source,
          sourceHash,
          publicSource: publicImage,
          status: "ready",
        };
        setItems((previous) => [...previous, item]);
        if (onAdded) onAdded(item);
        else setSelectedId((previous) => previous || item.id);
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
        const reason = publicImage?.kind === "composer"
          ? "Studio could not decode the Composer image. Try again or download it from the source artwork page."
          : error instanceof Error ? error.message : "Could not read this image.";
        localRejections.push({ name: file.name, message: reason });
        // A public Composer file that passed the byte sniff but failed header or
        // pixel decode gets an invalid-image diagnostic, without touching the
        // local processing paths or any other source.
        onRejected?.(reason, currentRevision);
      }
    }
    if (currentRevision === revision.current) {
      setRejections(localRejections);
      setAdding(false);
      addingRef.current = false;
      const retained = !added && items.length
        ? " Your existing images and any finished downloads are still available."
        : "";
      setMessage(
        localRejections.length
          ? `${added} image${added === 1 ? "" : "s"} added. ${localRejections.length} file${localRejections.length === 1 ? " was" : "s were"} refused; read the reason below.${retained}`
          : `${added} image${added === 1 ? "" : "s"} added locally. Nothing was uploaded.`,
      );
    }
  }
  addFilesRef.current = addFiles;

  async function loadPublicImage(): Promise<void> {
    if (!publicImageSource || publicImageLoaded || publicImageRequest.current || addingRef.current ||
      runningRef.current || socialController.current || items.length >= MAX_BATCH_IMAGES) return;
    const controller = new AbortController();
    const token = revision.current;
    // Captured from the one real response fetchComposerArtwork observes, so a
    // later, separate decode failure can report the actual status.
    let observedStatus: number | undefined;
    const composerRef = publicImageSource.kind === "composer" ? publicImageSource.ref : null;
    const recordDiagnostic = (error: ComposerArtworkLoadError, expectedRevision = token) => {
      if (!composerRef || publicImageRequest.current !== controller ||
        expectedRevision !== revision.current || controller.signal.aborted) return;
      setSourceDiagnostic(formatComposerArtworkDiagnostic(composerRef, error, STUDIO_REVISION));
    };
    publicImageRequest.current = controller;
    setSourceDiagnostic("");
    setPublicImageLoading(true);
    const timeout = AbortSignal.timeout(PUBLIC_IMAGE_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    try {
      const file = publicImageSource.kind === "composer"
        ? await fetchComposerArtwork(publicImageSource.ref, signal, (status) => { observedStatus = status; })
        : await fetchPublicImage(publicImageSource.path, signal, publicImageLabel);
      if (controller.signal.aborted) return;
      if (token !== revision.current || runningRef.current || socialController.current) {
        setMessage(`The workbench changed while loading the image. Choose Load ${publicImageLabel} to try again.`);
        return;
      }
      await addFiles([file], false, publicImageSource, undefined, (reason, intakeRevision) => {
        // A byte/header/pixel decode failed after the fetch already observed a
        // real response. Keep its status instead of reporting "Unavailable".
        // Only the composer source reaches this callback, so local files and
        // other public media are untouched.
        recordDiagnostic(
          new ComposerArtworkLoadError(reason, { category: "invalid-image", status: observedStatus }),
          intakeRevision,
        );
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        if (token !== revision.current || runningRef.current || socialController.current) {
          return;
        }
        if (timeout.aborted) {
          // Local timer only: there is no observed HTTP status to disclose.
          const failure = new ComposerArtworkLoadError(
            `The download timed out. Choose Load ${publicImageLabel} to try again.`,
            { category: "timeout" },
          );
          setMessage(failure.message);
          recordDiagnostic(failure);
        } else if (error instanceof ComposerArtworkLoadError) {
          setMessage(error.message);
          recordDiagnostic(error);
        } else {
          const fallback =
            publicImageSource.kind === "composer"
              ? "Could not load the artwork. Try again or download it from Composer."
              : publicImageSource.kind === "still"
                ? "Could not download this published image. Try again or use Download image on its page."
                : "Could not download this public poster. Try again or use Download poster on the film page.";
          const failure = new ComposerArtworkLoadError(
            error instanceof Error && !(error instanceof TypeError) ? error.message : fallback,
            { category: "transport-unknown" },
          );
          setMessage(failure.message);
          recordDiagnostic(failure);
        }
      }
    } finally {
      if (publicImageRequest.current === controller && !controller.signal.aborted) {
        publicImageRequest.current = null;
        setPublicImageLoading(false);
      }
    }
  }

  async function addSample(): Promise<void> {
    // One encode per press: a held Enter key or a slow PNG encoder must not
    // queue a second sample behind the first. The revision check keeps a
    // finished encode from appending after Clear all or another intake.
    if (
      sampleBusyRef.current ||
      addingRef.current ||
      runningRef.current ||
      socialController.current ||
      items.length >= MAX_BATCH_IMAGES
    )
      return;
    sampleBusyRef.current = true;
    const run = ++sampleRunRef.current;
    setSampleBusy(true);
    const token = revision.current;
    setMessage("Making the sample on this device…");
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    try {
      drawSample(canvas);
      const blob = await canvasToBlob(canvas, "image/png");
      if (token !== revision.current || runningRef.current || socialController.current) return;
      await addFiles([new File([blob], "studio-image-sample.png", { type: "image/png" })]);
    } catch (error) {
      if (token === revision.current)
        setMessage(error instanceof Error ? error.message : "Could not make the sample.");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (sampleRunRef.current === run) {
        sampleBusyRef.current = false;
        setSampleBusy(false);
      }
    }
  }

  function removeItem(item: WorkItem): void {
    if (running) return;
    const index = items.findIndex((candidate) => candidate.id === item.id);
    // One surviving neighbour keeps focus and the preview on the same row.
    const neighbour = items[index + 1] ?? items[index - 1] ?? null;
    focusAfterListChange.current = neighbour ? { kind: "row", id: neighbour.id } : { kind: "picker" };
    clearBatchExports();
    releaseItem(item);
    setItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
    if (selectedId === item.id) {
      setSelectedId(neighbour?.id ?? "");
      clearSocial();
      setTrim(null);
      setTrimMessage("");
      clearPaletteCopyFallback();
      setPalette(null);
      setPaletteMessage(null);
      setPicked(null);
      setPickMessage("");
      setCopyMessage("");
    }
  }

  function resetAll(): void {
    if (importing) return;
    postBriefRequest.current++;
    setPostBriefStatus(null);
    publicImageRequest.current?.abort();
    publicImageRequest.current = null;
    setSourceDiagnostic("");
    setPublicImageLoading(false);
    focusAfterListChange.current = { kind: "picker" };
    revision.current += 1;
    stripRevision.current += 1;
    alphaRevision.current += 1;
    batchController.current?.controller.abort();
    socialController.current?.abort();
    addingRef.current = false;
    sampleRunRef.current += 1;
    sampleBusyRef.current = false;
    setSampleBusy(false);
    runningRef.current = false;
    clearBatchExports();
    gifRevision.current += 1;
    setGifOutput(null);
    setGifMessage("");
    setBatchMessage("");
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setItems([]);
    setSelectedId("");
    setSettings(DEFAULT_SETTINGS);
    setPreviewBackdrop("checkerboard");
    setTrim(null);
    setTrimMessage("");
    clearPaletteCopyFallback();
    setPalette(null);
    setPaletteMessage(null);
    setPicked(null);
    setPickMessage("");
    setCopyMessage("");
    setAlphaInspect(null);
    setAlphaBusy(false);
    setAlphaMessage("");
    setMessage("Cleared. Nothing remains in this tab.");
    setSourceNotice("");
    setRejections([]);
    setBatch({ total: 0, completed: 0, current: "" });
    setSocialOutputs([]);
    setSocialZip(null);
    didInitSettings.current = false;
  }

  async function runItems(list: WorkItem[], report: (message: string) => void = setMessage): Promise<void> {
    if (!list.length || runningRef.current || socialController.current || sheetBusy || importing) return;
    const invalidQuality = list.find(hasInvalidQuality);
    if (invalidQuality) {
      report(
        `Fix the quality for ${invalidQuality.file.name}: enter a whole percent from ${IMAGE_QUALITY_MIN_PERCENT} to ${IMAGE_QUALITY_MAX_PERCENT}, or leave it blank to use the batch quality.`,
      );
      return;
    }
    runningRef.current = true;
    const snapshot = { ...settings };
    const trimSnapshot = trim;
    const controller = new AbortController();
    batchController.current = { controller, report };
    setRunning(true);
    // Stop a ZIP still being written, but keep finished downloads until a row changes.
    if (zipBusy) batchExportRevision.current += 1;
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
        const itemSettings = settingsForImage(
          snapshot,
          item.source.mime,
          false,
          item.longEdgeOverride,
          item.cropAspectOverride,
          item.cropAnchorOverride,
          item.qualityOverride,
          item.formatOverride,
        );
        const rendered = await renderImage(item, itemSettings, controller.signal, cropRect);
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
        if (completed === 0) clearBatchExports();
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
    report(
      `${completed} image${completed === 1 ? "" : "s"} processed${failed ? `, ${failed} failed` : ""}.${stopped} Nothing was uploaded.`,
    );
    setBatch({ total: list.length, completed: processed, current: "" });
  }

  function cancelBatch(trigger: HTMLButtonElement): void {
    const attempt = batchController.current;
    if (!attempt) return;
    attempt.controller.abort();
    if (document.activeElement === trigger) {
      const next = processAllRef.current;
      if (next && !next.disabled) next.focus();
      else trigger.closest<HTMLElement>("#image-batch")?.focus();
    }
    attempt.report("Stopping after the image currently being encoded. Completed results will remain available.");
  }

  async function stripSelected(): Promise<void> {
    if (!selected || stripBusy || running || importing) return;
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
    if (!doneItems.length || batchExport || addingRef.current || runningRef.current || socialController.current) return;
    const zipAttempt = batchExportRevision.current;
    setBatchExport("zip");
    setBatchMessage("Preparing the ZIP on this device…");
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      let total = 0;
      for (const item of doneItems) {
        if (!item.result) continue;
        const bytes = new Uint8Array(await item.result.blob.arrayBuffer());
        if (zipAttempt !== batchExportRevision.current) return;
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
      setBatchMessage(`ZIP ready: ${entries.length} image${entries.length === 1 ? "" : "s"}, ${formatBytes(blob.size)}.`);
    } catch (error) {
      if (zipAttempt === batchExportRevision.current) {
        setBatchMessage(error instanceof Error ? error.message : "Could not build the ZIP.");
      }
    } finally {
      setBatchExport(null);
    }
  }

  async function makeSheet(): Promise<void> {
    if (batchExport || addingRef.current || runningRef.current || socialController.current) return;
    const isAtlas = sheetMode === "sprite-atlas";
    const name = isAtlas ? "sprite atlas" : "contact sheet";
    const entries = isAtlas
      ? atlasEntries
      : doneItems.flatMap(item => item.result ? [{ item, result: item.result }] : []);
    const atlas = atlasPlan;
    if (atlasProblem) {
      setBatchMessage(atlasProblem);
      return;
    }
    const contactLayout = isAtlas ? null : contactSheetLayout(entries.length, sheetColumns, sheetTile);
    const layout = isAtlas ? atlas : contactLayout;
    if (!layout) return;
    if (atlas) {
      const problem = atlasBoundsProblem(atlas);
      if (problem) {
        setBatchMessage(problem);
        return;
      }
    }

    const attempt = batchExportRevision.current;
    setBatchExport(sheetMode);
    setBatchMessage(`Making a ${name} on this device…`);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const tiles: ContactSheetTile[] = [];
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error(`This browser could not make the ${name}.`);
      for (const [index, { item, result }] of entries.entries()) {
        const bitmap = await createImageBitmap(result.blob);
        try {
          if (attempt !== batchExportRevision.current) return;
          let rect: ContactSheetTile["rect"];
          if (atlas) {
            if (bitmap.width !== result.width || bitmap.height !== result.height)
              throw new Error("A completed PNG changed size. Process the batch again.");
            rect = atlasPlacement(atlas, index, bitmap.width, bitmap.height);
            context.drawImage(bitmap, rect.x, rect.y);
          } else {
            if (!contactLayout) throw new Error(`This browser could not make the ${name}.`);
            rect = contactSheetPlacement(contactLayout, index, bitmap.width, bitmap.height);
            context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
          }
          tiles.push({
            index,
            rect,
            source: {
              sha256: item.sourceHash,
              width: item.source.orientedWidth,
              height: item.source.orientedHeight,
              mime: item.source.mime,
            },
            output: {
              sha256: result.sha256,
              width: bitmap.width,
              height: bitmap.height,
              mime: result.mime,
              bytes: result.bytes,
            },
          });
        } finally {
          bitmap.close();
        }
      }
      const blob = await canvasToBlob(canvas, "image/png");
      if (attempt !== batchExportRevision.current) return;
      if (isAtlas && blob.size > MAX_IMAGE_OUTPUT_BYTES)
        throw new Error(`The sprite atlas exceeds ${MAX_IMAGE_OUTPUT_BYTES / 1024 / 1024} MiB. Use smaller PNGs or split the batch.`);
      const sheetHash = await sha256Hex(await blob.arrayBuffer());
      if (attempt !== batchExportRevision.current) return;
      const sheet = { sha256: sheetHash, bytes: blob.size };
      const layoutDocument = contactLayout
        ? contactSheetDocument(contactLayout, sheet, tiles)
        : atlas
          ? atlasDocument(atlas, sheet, tiles)
          : null;
      if (!layoutDocument) throw new Error(`This browser could not describe the ${name} layout.`);
      const layoutText = JSON.stringify(layoutDocument);
      const layoutBlob = new Blob([layoutText], { type: "application/json" });
      const url = trackUrl(blob);
      const layoutUrl = trackUrl(layoutBlob);
      releaseUrl(contactSheet?.url);
      releaseUrl(contactSheet?.layoutUrl);
      setContactSheet({
        url,
        blob,
        layoutUrl,
        layoutText,
        count: layout.count,
        columns: layout.columns,
        tileSize: contactLayout?.tileSize ?? CONTACT_SHEET_TILE,
        width: layout.width,
        height: layout.height,
        mode: sheetMode,
      });
      const skipped = isAtlas ? doneItems.length - entries.length : 0;
      const skippedNote = skipped ? ` (${skipped} non-PNG result${skipped === 1 ? "" : "s"} skipped)` : "";
      setBatchMessage(`${isAtlas ? "Sprite atlas" : "Contact sheet"} ready: ${layout.count} ${isAtlas ? "PNGs" : "images"}${skippedNote} · ${layout.width} × ${layout.height} px.`);
    } catch (error) {
      if (attempt === batchExportRevision.current) {
        setBatchMessage(error instanceof Error ? error.message : `Could not make the ${name}.`);
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      setBatchExport(null);
    }
  }

  async function makeGif(): Promise<void> {
    if (gifBusy || batchExport || addingRef.current || runningRef.current || socialController.current || importing) return;
    const snapshot = items.slice();
    const size = gifFrameSize;
    const delayMs = gifDelayMs;
    const matte = gifMatte;
    const loop = gifLoop;
    // Capture the exact ordered vector once. A blank row inherits the batch
    // delay here, and later row edits cannot change this run's settings.
    const hasOverrides = snapshot.some((item) => item.gifDelayMsOverride !== undefined);
    const frameDelaysMs = snapshot.map((item) => item.gifDelayMsOverride ?? delayMs);
    const problem =
      gifSettingsProblem({ frameCount: snapshot.length, frameSize: size, delayMs }) ??
      gifFrameDelaysProblem({ frameCount: snapshot.length, frameDelaysMs });
    if (problem) {
      setGifMessage(problem);
      return;
    }
    const delaySummary = gifDelaySummary(frameDelaysMs);
    const attempt = gifRevision.current;
    setGifBusy(true);
    setGifMessage(`Rendering ${snapshot.length} frames on this device…`);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const frames: Uint8Array[] = [];
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not draw the GIF frames.");
      for (const [index, item] of snapshot.entries()) {
        let bitmap: ImageBitmap | null = null;
        let oriented: HTMLCanvasElement | null = null;
        try {
          let explicitNone = false;
          try {
            bitmap = await createImageBitmap(item.file, { imageOrientation: "none" });
            explicitNone = true;
          } catch {
            bitmap = await createImageBitmap(item.file);
          }
          if (attempt !== gifRevision.current) return;
          if (!bitmap || bitmap.width < 1 || bitmap.height < 1)
            throw new Error(`${item.file.name} did not decode for the GIF.`);
          const swapped =
            item.source.width !== item.source.height &&
            bitmap.width === item.source.height &&
            bitmap.height === item.source.width;
          const browserAppliedOrientation = explicitNone
            ? item.source.orientation >= 5 && swapped
            : true;
          oriented = drawOriented(bitmap, browserAppliedOrientation ? 1 : item.source.orientation);
          bitmap.close();
          bitmap = null;
          const placement = gifFramePlacement(size, oriented.width, oriented.height);
          context.fillStyle = matte;
          context.fillRect(0, 0, size, size);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(oriented, placement.x, placement.y, placement.width, placement.height);
          oriented.width = 0;
          oriented.height = 0;
          oriented = null;
          if (attempt !== gifRevision.current) return;
          const pixels = context.getImageData(0, 0, size, size).data;
          // Copy out of the canvas buffer; the next frame reuses this surface.
          frames.push(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice());
          setGifMessage(`Rendering frame ${index + 1} of ${snapshot.length}…`);
        } finally {
          bitmap?.close();
          if (oriented) {
            oriented.width = 0;
            oriented.height = 0;
          }
        }
      }
      const bytes = encodeGif({
        frames,
        width: size,
        height: size,
        delayMs,
        ...(hasOverrides ? { frameDelaysMs } : {}),
        loop,
      });
      if (attempt !== gifRevision.current) return;
      const blob = blobFromBytes(bytes, "image/gif");
      const url = trackUrl(blob);
      if (gifOutput) releaseUrl(gifOutput.url);
      setGifOutput({
        url,
        width: size,
        height: size,
        count: frames.length,
        delaysMs: frameDelaysMs,
        bytes: blob.size,
      });
      setGifMessage(
        `GIF ready: ${frames.length} frames · ${size} × ${size} px · ${delaySummary.phrase} · ` +
        `${formatBytes(blob.size)} · ${loop ? "loops forever" : "plays once"}.`,
      );
    } catch (error) {
      if (attempt === gifRevision.current)
        setGifMessage(error instanceof Error ? error.message : "Could not make the GIF.");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      setGifBusy(false);
    }
  }

  function setNextFormat(format: ExportFormat): void {
    setSettings((previous) => ({
      ...previous,
      format,
      targetKiB: format === "png" ? null : previous.targetKiB,
    }));
  }

  function setFormatOverride(item: WorkItem, value: ExportFormat | undefined): void {
    if (runningRef.current || addingRef.current) return;
    // The browser probe is the only honest gate for a WebP row. The encoder's
    // byte-level MIME check remains the final guard if a value ever gets here.
    if (value === "webp" && !WEBP_ENCODABLE) return;
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, formatOverride: value } : candidate,
      ),
    );
  }

  // The override belongs to the row's stable id, so reordering carries it with
  // that row and removing the row drops it. An edit retires any existing GIF.
  function setGifDelayOverride(item: WorkItem, value: number | undefined): void {
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, gifDelayMsOverride: value } : candidate,
      ),
    );
    if (gifOutput) invalidateGif("GIF frame delays changed. Make the GIF again.");
  }

  function gifDelayOverrideIsValid(value: number | undefined): boolean {
    return value === undefined ||
      gifFrameDelaysProblem({ frameCount: 1, frameDelaysMs: [value] }) === null;
  }

  // A blank control means "follow the batch". The native number input keeps
  // partial or invalid text as NaN so the existing whole-number check rejects
  // it instead of silently treating it as inheritance.
  function setLongEdgeOverride(item: WorkItem, value: number | undefined): void {
    if (runningRef.current || addingRef.current) return;
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, longEdgeOverride: value } : candidate,
      ),
    );
  }

  function longEdgeFromControl(control: HTMLInputElement): number | undefined {
    if (control.value === "" && !control.validity.badInput) return undefined;
    return control.valueAsNumber;
  }

  // Same blank-means-inherit rule as the long edge. The native number input
  // keeps partial text as NaN so the quality check rejects it, not inherits it.
  function setQualityOverride(item: WorkItem, value: number | undefined): void {
    if (runningRef.current || addingRef.current) return;
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, qualityOverride: value } : candidate,
      ),
    );
  }

  function qualityFromControl(control: HTMLInputElement): number | undefined {
    if (control.value === "" && !control.validity.badInput) return undefined;
    return control.valueAsNumber;
  }

  function setCropAspectOverride(item: WorkItem, value: CropAspectKey | undefined): void {
    if (runningRef.current || addingRef.current) return;
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, cropAspectOverride: value } : candidate,
      ),
    );
  }

  function setCropAnchorOverride(item: WorkItem, value: CropAnchorKey | undefined): void {
    if (runningRef.current || addingRef.current) return;
    setItems((previous) =>
      previous.map((candidate) =>
        candidate.id === item.id ? { ...candidate, cropAnchorOverride: value } : candidate,
      ),
    );
  }

  // One size's social crop position. "Use editor" removes that key, so a blank
  // choice is indistinguishable from never having made one. Only the in-memory
  // item changes: finished Edit results, receipts and current social downloads
  // are snapshots and are not touched.
  function setSocialCropAnchor(
    item: WorkItem,
    key: SocialSizeKey,
    value: CropAnchorKey | undefined,
  ): void {
    if (runningRef.current || addingRef.current || socialController.current) return;
    setItems((previous) =>
      previous.map((candidate) => {
        if (candidate.id !== item.id) return candidate;
        const choices: Partial<Record<SocialSizeKey, CropAnchorKey>> = {
          ...(candidate.socialCropAnchors ?? {}),
        };
        if (value === undefined) delete choices[key];
        else choices[key] = value;
        return {
          ...candidate,
          socialCropAnchors: Object.keys(choices).length ? choices : undefined,
        };
      }),
    );
  }

  function applyWebReady(): void {
    if (!selected || runningRef.current || socialController.current) return;
    if (selected.formatOverride !== undefined) setFormatOverride(selected, undefined);
    if (selected.longEdgeOverride !== undefined) setLongEdgeOverride(selected, undefined);
    if (selected.qualityOverride !== undefined) setQualityOverride(selected, undefined);
    setSettings((previous) => ({
      ...previous,
      resizeMode: "max-long-edge",
      longEdge: WEB_READY_LONG_EDGE,
      format: defaultSocialKitFormat(WEBP_ENCODABLE),
      quality: WEB_READY_QUALITY,
      targetKiB: null,
    }));
    setMessage("Web-ready settings applied. Choose Make this image to render.");
  }

  function setSocialPost(itemId: string, field: keyof SocialPostText, text: string): void {
    postBriefRequest.current++;
    setPostBriefStatus(null);
    setItems((previous) => previous.map((item) =>
      item.id === itemId
        ? { ...item, socialPost: { ...item.socialPost, [field]: text.slice(0, SOCIAL_POST_LIMITS[field]) } }
        : item,
    ));
  }

  async function applyComposerPostBrief(file?: File): Promise<void> {
    const item = selected;
    const source = item?.publicSource;
    if (!file || !item || source?.kind !== "composer") return;
    const request = ++postBriefRequest.current;
    if (file.size > COMPOSER_POST_BRIEF_MAX_BYTES) {
      setPostBriefStatus({ bad: true, message: "Choose a Composer post brief up to 16 KiB." });
      return;
    }
    setPostBriefStatus({ bad: false, message: "Reading your Composer post brief…" });
    try {
      const parsed = parseComposerPostBrief(await file.text(), source.ref);
      if (request !== postBriefRequest.current) return;
      if (!parsed.ok) {
        setPostBriefStatus({ bad: true, message: parsed.reason });
        return;
      }
      setItems(previous => previous.map(candidate => candidate.id === item.id
        ? { ...candidate, socialPost: { caption: parsed.caption, altText: parsed.altText } }
        : candidate));
      setPostBriefStatus({ bad: false, message: "Draft loaded. Review the caption, alt text and reuse rights for your crop." });
    } catch {
      if (request === postBriefRequest.current)
        setPostBriefStatus({ bad: true, message: "Could not read the post brief. Choose the JSON file again." });
    }
  }

  async function buildSocialZip(
    item: WorkItem,
    outputs: SocialOutput[],
    manifest: SocialZipEntry | null,
    post: SocialZipEntry[],
    alive: () => boolean,
  ): Promise<Blob> {
    if (!alive()) throw abortError();
    const stem = safeStem(item.file.name);
    const entries: SocialZipEntry[] = [];
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
    if (manifest) {
      total += manifest.data.length;
      entries.push(manifest);
    }
    for (const entry of post) total += entry.data.length;
    if (total > MAX_ZIP_BYTES)
      throw new Error(`ZIP export stays under ${MAX_ZIP_BYTES / 1024 / 1024} MiB. Download sizes separately instead.`);
    entries.push(...post);
    if (!alive()) throw abortError();
    const zip = createZip(entries, { date: new Date() });
    if (!zip.ok) throw new Error(zip.error);
    return blobFromBytes(zip.bytes, ZIP_MIME);
  }

  async function makeSocialKit(operation: "sizes" | "text" = "sizes"): Promise<void> {
    if (!selected || runningRef.current || socialController.current || batchExport || addingRef.current) return;
    const updateText = operation === "text";
    const previousZip = updateText && socialTextChanged ? socialZip : null;
    if (!socialReady || (updateText && !previousZip)) return;
    const item = selected;
    const snapshot = { ...settings };
    const sizeAnchors = item.socialCropAnchors;
    const format = socialFormat;
    const trimSnapshot = trim;
    const controller = new AbortController();
    socialController.current = controller;
    setSocialOperation(operation);
    if (updateText && updateSocialTextRef.current === document.activeElement)
      restoreSocialKitFocus.current = "text";
    setMessage(updateText ? "Updating post text in the ZIP…" :
      `Making four ${formatLabelForMime(mimeForExport(format))} sizes from the selected image…`);
    const outputs: SocialOutput[] = [];
    const isCurrent = () => socialController.current === controller;
    const alive = () => isCurrent() && !controller.signal.aborted;
    try {
      if (previousZip) {
        const blob = await buildSocialZip(item, socialOutputs, previousZip.manifest, socialPost, alive);
        if (!alive()) throw abortError();
        const url = trackUrl(blob);
        setSocialZip({ ...previousZip, url, bytes: blob.size, post: socialPost });
        releaseUrl(previousZip.url);
        setMessage("Post text updated. The ZIP uses the existing four image sizes.");
        return;
      }
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
        const sizeSettings = socialKitSettings(
          { ...snapshot, cropAnchor: socialKitCropAnchor(sizeAnchors, size.key, snapshot.cropAnchor) },
          size,
          WEB_READY_QUALITY,
          format,
        );
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
        // The first completed size replaces the previous run.
        if (outputs.length === 0) releaseSocial();
        outputs.push(output);
        setSocialOutputs([...outputs]);
        setMessage(`Made ${outputs.length} of ${SOCIAL_SIZES.length} sizes on this device.`);
      }
      const publicSource = item.publicSource;
      let manifest: SocialZipEntry | null = null;
      if (publicSource) {
        manifest = publicSource.kind === "composer"
          ? composerArtworkManifestEntry(publicSource.ref, item.sourceHash)
          : publicSource.kind === "still"
            ? stillSourceManifestEntry({
              media: publicSource.path,
              sourceHash: item.sourceHash,
              studioOrigin: window.location.origin,
            })
            : socialSourceManifestEntry({
              poster: publicSource.path,
              sourceHash: item.sourceHash,
              studioOrigin: window.location.origin,
            });
        if (!manifest) throw new Error("The public image source could not be recorded in this ZIP.");
      }
      const zipBlob = await buildSocialZip(item, outputs, manifest, socialPost, alive);
      if (!alive()) throw abortError();
      setSocialZip({
        itemId: item.id,
        url: trackUrl(zipBlob),
        bytes: zipBlob.size,
        manifest,
        post: socialPost,
      });
      setMessage(
        `Social kit ready: ${outputs.length} ${formatLabelForMime(outputs[0].mime)} sizes with per-size receipts${publicSource ? " and a public source manifest" : ""}, ${formatBytes(zipBlob.size)} total.${socialPost.length ? " Text files included." : ""}`,
      );
    } catch (error) {
      if (!isCurrent()) {
        for (const output of outputs) releaseUrl(output.url);
        return;
      }
      if (isAbort(error)) {
        const keptPrevious = outputs.length === 0 && (
          socialOutputs.some(output => urls.current.has(output.url)) ||
          (socialZip && urls.current.has(socialZip.url))
        );
        const label = updateText ? "the ZIP text update" : "the social kit";
        setMessage(keptPrevious
          ? `Stopped ${label}. The previous downloads are still available.`
          : `Stopped ${label}.`);
      } else {
        setMessage(error instanceof Error ? error.message :
          updateText ? "Could not update post text in the ZIP." : "Could not make the social kit.");
      }
    } finally {
      if (isCurrent()) {
        // Capture focus before the cancel button unmounts.
        if (controller.signal.aborted && document.activeElement === cancelSocialKitRef.current)
          restoreSocialKitFocus.current = operation;
        socialController.current = null;
        setSocialOperation(null);
      }
    }
  }

  function cancelSocialKit(): void {
    socialController.current?.abort();
    setMessage(socialOperation === "text" ? "Stopping the ZIP text update…" :
      "Stopping after the current size. Completed sizes keep their downloads.");
  }

  function selectItem(id: string): void {
    if (importing) return;
    if (id !== selectedId) clearSocial();
    setSelectedId(id);
    setTrim(null);
    setTrimMessage("");
    clearPaletteCopyFallback();
    setPalette(null);
    setPaletteMessage(null);
    setPicked(null);
    setPickMessage("");
    setCopyMessage("");
  }

  function reuseResultAsInput(item: WorkItem, trigger: HTMLButtonElement): void {
    const result = item.result;
    if (!result || result.bytes > MAX_IMAGE_INPUT_BYTES ||
      items.length >= MAX_BATCH_IMAGES || importing || batchExport) return;
    const file = new File([result.blob], renderedFileName(item.file.name, result), {
      type: result.mime,
    });
    // Treat the exported bytes as a new local file with no public source.
    void addFiles([file], false, undefined, (added) => {
      if (document.activeElement === trigger) focusAfterListChange.current = { kind: "row", id: added.id };
      selectItem(added.id);
    });
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
    setItems((previous) =>
      previous.map((item) =>
        item.formatOverride !== undefined ||
        item.longEdgeOverride !== undefined ||
        item.qualityOverride !== undefined ||
        item.cropAspectOverride !== undefined ||
        item.cropAnchorOverride !== undefined
          ? {
              ...item,
              formatOverride: undefined,
              longEdgeOverride: undefined,
              qualityOverride: undefined,
              cropAspectOverride: undefined,
              cropAnchorOverride: undefined,
            }
          : item,
      ),
    );
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
    {
      echo = value.length <= 120,
      fallback,
      report = setCopyMessage,
    }: { echo?: boolean; fallback?: string; report?: (message: string) => void } = {},
  ): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      report(
        echo
          ? `Copied ${label}: ${value}`
          : `Copied ${label} (${value.length.toLocaleString()} characters).`,
      );
      return true;
    } catch {
      report(fallback ?? `Could not copy automatically. Select the ${label} value and copy it.`);
      return false;
    }
  }

  function clearPaletteCopyFallback(): void {
    latestPaletteCopy.current += 1;
    setPaletteCopyFallback(null);
  }

  async function copyPaletteValue(
    button: HTMLButtonElement,
    label: string,
    value: string,
  ): Promise<void> {
    const attempt = ++latestPaletteCopy.current;
    const stillCurrent = () => attempt === latestPaletteCopy.current;
    const copied = await copyValue(label, value, {
      fallback: `Could not copy automatically. The exact ${label} value is in the field below — select it and copy it.`,
      report: (message) => { if (stillCurrent()) setCopyMessage(message); },
    });
    if (!stillCurrent()) return;
    if (copied) {
      setPaletteCopyFallback(null);
      return;
    }
    setPaletteCopyFallback({ label, value, trigger: button });
  }

  // Both controls report in one place. An older write cannot replace the
  // latest feedback, and a new rendered blob has its own object URL.
  function copyAttemptFor(key: string) {
    const attempt = ++latestOutputCopy.current;
    const stillCurrent = () =>
      attempt === latestOutputCopy.current && key === currentOutputKey.current;
    const report = (message: string) => {
      if (stillCurrent()) setOutputCopy({ key, message });
    };
    return { report, stillCurrent };
  }

  async function copyResultPng(item: WorkItem): Promise<void> {
    const result = item.result;
    if (!result || result.mime !== "image/png") return;
    const { report } = copyAttemptFor(result.url);
    try {
      const png = new window.ClipboardItem({ "image/png": result.blob });
      await navigator.clipboard.write([png]);
      report("PNG copied.");
    } catch {
      report("Could not copy the PNG. Use Download PNG instead.");
    }
  }

  // One action for both prepared sheets: the exact encoded PNG blob held for
  // the current download also goes to the clipboard, with no re-encode.
  function sheetCopyAttemptFor(key: string) {
    const attempt = ++latestSheetCopy.current;
    const stillCurrent = () =>
      attempt === latestSheetCopy.current && key === currentSheetKey.current;
    const report = (message: string) => {
      if (stillCurrent()) setSheetCopy({ key, message });
    };
    return { report, stillCurrent };
  }

  async function copySheetPng(): Promise<void> {
    const sheet = contactSheet;
    if (!sheet || !canCopyPng) return;
    const { report } = sheetCopyAttemptFor(sheet.url);
    try {
      const png = new window.ClipboardItem({ "image/png": sheet.blob });
      await navigator.clipboard.write([png]);
      report("PNG copied.");
    } catch {
      report(`Could not copy the PNG. Use Download ${sheet.mode === "sprite-atlas" ? "sprite atlas" : "contact sheet"} PNG instead.`);
    }
  }

  // The clipboard uses the same captured text as the download.
  async function copySheetLayoutJson(button: HTMLButtonElement): Promise<void> {
    const sheet = contactSheet;
    if (!sheet) return;
    const { report, stillCurrent } = sheetCopyAttemptFor(sheet.url);
    const copied = await copyValue("layout JSON", sheet.layoutText, {
      echo: false,
      fallback: "Clipboard unavailable. Select the exact layout JSON below and copy it.",
      report,
    });
    if (!stillCurrent()) return;
    setSheetJsonFallback(copied ? null : { key: sheet.url, trigger: button });
  }

  async function copyOutputHash(
    button: HTMLButtonElement,
    key: string,
    hash: string,
  ): Promise<void> {
    const { report, stillCurrent } = copyAttemptFor(key);
    const copied = await copyValue("output SHA-256", hash, {
      echo: false,
      fallback: "Clipboard unavailable. Select the exact hash beside this button and copy it.",
      report,
    });
    if (!stillCurrent()) return;
    setOutputHashFallback(copied ? null : { key, hash, trigger: button });
  }

  async function copySnippet(button: HTMLButtonElement): Promise<void> {
    const field = snippetField.current;
    if (!field) return;
    const text = field.value;
    const attempt = ++latestSnippetCopy.current;
    const stillCurrent = () =>
      attempt === latestSnippetCopy.current && field.isConnected && field.value === text;
    const copied = await copyValue(SNIPPET_LABELS[snippetKind], text, {
      echo: false,
      fallback: "Clipboard unavailable. Copy from the text field or download the snippet.",
      report: message => { if (stillCurrent()) setSnippetMessage(message); },
    });
    if (!copied && stillCurrent() && document.activeElement === button) field.focus();
  }

  async function buildSnippets(): Promise<void> {
    if (!selected?.result || snippetBusy || running) return;
    latestSnippetCopy.current += 1;
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

  function moveItem(id: string, offset: -1 | 1): void {
    if (running) return;
    const index = items.findIndex((candidate) => candidate.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= items.length) return;
    // The moved row keeps focus: the same direction while it remains valid,
    // then the row selector at an edge.
    focusAfterListChange.current = { kind: "row-action", id, offset };
    clearBatchExports();
    setItems((previous) => {
      const from = previous.findIndex((candidate) => candidate.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMessage(
      `${offset < 0 ? "Moved up" : "Moved down"}. The ZIP and contact sheet follow this list order.`,
    );
  }

  function dropItem(id: string): void {
    const source = dragIdRef.current;
    dragIdRef.current = "";
    if (!source || source === id || running) return;
    clearBatchExports();
    setItems((previous) => {
      const from = previous.findIndex((candidate) => candidate.id === source);
      const to = previous.findIndex((candidate) => candidate.id === id);
      if (from < 0 || to < 0) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMessage("Reordered. The ZIP and contact sheet follow this list order.");
  }

  async function extractSelectedPalette(): Promise<void> {
    if (!selected || paletteBusy || running) return;
    const item = selected;
    setReadingPaletteId(item.id);
    setPaletteMessage({ itemId: item.id, text: "Reading pixels on this device…" });
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
      clearPaletteCopyFallback();
      setPalette({ itemId: item.id, result, workingWidth: width, workingHeight: height });
      setPaletteMessage({
        itemId: item.id,
        text: result.colors.length
          ? `${result.colors.length} colour${result.colors.length === 1 ? "" : "s"} from a ${width} × ${height} working copy. Fully transparent pixels are ignored.`
          : "Every sampled pixel is fully transparent. There is no colour to report.",
      });
    } catch (error) {
      clearPaletteCopyFallback();
      setPalette(null);
      setPaletteMessage({
        itemId: item.id,
        text: error instanceof Error ? error.message : "Could not read a colour palette.",
      });
    } finally {
      bitmap?.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      setReadingPaletteId("");
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

  async function inspectResultAlpha(): Promise<void> {
    if (!selected?.result || alphaBusy || running) return;
    const result = selected.result;
    const key = result.url;
    const attempt = ++alphaRevision.current;
    const isCurrent = () => attempt === alphaRevision.current && key === currentOutputKey.current;
    setAlphaBusy(true);
    setAlphaMessage("Decoding the completed result on this device…");
    let bitmap: ImageBitmap | null = null;
    let canvas: HTMLCanvasElement | null = null;
    try {
      bitmap = await createImageBitmap(result.blob);
      if (!isCurrent()) return;
      if (bitmap.width !== result.width || bitmap.height !== result.height)
        throw new Error("The decoded result size did not match the completed result.");
      const { width, height } = result;
      const mapPlan = alphaMapPlan(width, height);
      if (!mapPlan) throw new Error("The decoded result dimensions are not usable.");
      // Read the bitmap at its native scale in bands to bound canvas and
      // readback memory even for a large completed image.
      const bandRows = Math.min(height, Math.max(1, Math.floor(512_000 / width)));
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = bandRows;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not read the result pixels.");
      context.globalCompositeOperation = "copy";
      const profile = {
        ok: true as const,
        width,
        height,
        totalPixels: width * height,
        transparent: 0,
        partial: 0,
        opaque: 0,
      };
      for (let y = 0; y < height; y += bandRows) {
        const rows = Math.min(bandRows, height - y);
        context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
        const data = context.getImageData(0, 0, width, rows).data;
        const band = alphaProfile(data, { width, height: rows });
        if (!band.ok) throw new Error(band.error);
        writeAlphaMapBand(mapPlan, data, y);
        profile.transparent += band.transparent;
        profile.partial += band.partial;
        profile.opaque += band.opaque;
        if ((y + bandRows) < height && (y / bandRows) % 4 === 3) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          if (!isCurrent()) return;
        }
      }
      if (!isCurrent()) return;
      setAlphaInspect({
        key,
        result: profile,
        map: mapPlan.map,
        report: buildAlphaReport({ result, profile }),
      });
      setAlphaMessage(
        `Read ${profile.totalPixels.toLocaleString()} exact pixels from this completed result. Nothing was uploaded.`,
      );
    } catch (error) {
      if (isCurrent()) {
        setAlphaInspect(null);
        setAlphaMessage(
          error instanceof Error ? error.message : "Could not read the result alpha.",
        );
      }
    } finally {
      bitmap?.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (attempt === alphaRevision.current) setAlphaBusy(false);
    }
  }

  return (
    <main className="trim-page image-page" id="main">
      <header>
        <a href="/">← Media Studio</a>
        <p className="eyebrow">Signed-out · browser-local</p>
        <h1>Image workbench</h1>
        <p>
          Resize, crop, rotate, convert and inspect images on this device. There is no
          sign-in, no provider and no upload. Your original
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
              void addFiles(files, true);
            }}
          />
        </label>
        {publicImageSource?.kind === "poster" && (
          <p className="trim-note">
            <a href={sourceFilmPath(publicImageSource.path) ?? undefined}>Source film</a>
            {" · "}The poster is downloaded from Media Studio when you choose Load public poster.
          </p>
        )}
        {publicImageSource?.kind === "still" && (
          <p className="trim-note">
            <a href={sourceStillPath(publicImageSource.path) ?? undefined}>Published page</a>
            {" · "}The image is downloaded from Media Studio when you choose Load published image.
          </p>
        )}
        {publicImageSource?.kind === "composer" && (
          <p className="trim-note">
            <a href={composerArtworkSourceUrl(publicImageSource.ref)}>Source artwork in Composer</a>
            {" · "}The image is downloaded when you choose Load Composer artwork.
            {" "}Reuse rights unconfirmed. Check the source before publishing.
          </p>
        )}
        <div className="image-source-actions">
          {publicImageSource && (
            <button
              type="button"
              className="secondary"
              onClick={() => void loadPublicImage()}
              disabled={running || socialBusy || items.length >= MAX_BATCH_IMAGES}
              aria-disabled={publicImageLoading || publicImageLoaded || adding}
            >
              {publicImageLoaded
                ? publicImageLabels[publicImageSource.kind].loaded
                : `Load ${publicImageLabel}`}
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => void addSample()}
            disabled={running || items.length >= MAX_BATCH_IMAGES}
            aria-disabled={adding || sampleBusy}
          >
            Try the sample
          </button>
          {selected && <a className="button secondary" href="#image-output-plan">Go to image output</a>}
          {socialReady && (
            <button type="button" className="button secondary" onClick={() => socialSizesRef.current?.focus()}>
              Go to social sizes
            </button>
          )}
          {items.length > 1 && <a className="button secondary" href="#image-batch">Go to batch</a>}
          {items.length > 0 && (
            <button type="button" className="quiet" onClick={resetAll} disabled={running || adding || importing}>
              Clear all
            </button>
          )}
        </div>
        <p className="trim-note">
          JPEG, PNG or WebP up to {MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB and 40
          megapixels each. Up to {MAX_BATCH_IMAGES} images, processed one at a time.
          SVG, HTML, HEIC/HEIF, AVIF and other formats are refused as input. GIF is
          not accepted as an input still either, but Batch can assemble 2–8 admitted
          stills into a real GIF output below.
        </p>
        <p className="trim-note">
          JPEG EXIF orientation is applied before editing. The source facts and the
          sample are read from the actual bytes and pixels, not from the filename.
        </p>
        <p role="status" aria-live="polite" className="image-status">
          {adding ? "Checking files on this device…" : publicImageLoading ? `Downloading the ${publicImageLabel}…` : message}
        </p>
        <div role="status" aria-live="polite">
          {sourceNotice && <p className="image-status">{sourceNotice}</p>}
        </div>
        {sourceDiagnostic && (
          <details className="image-source-diagnostic">
            <summary>Local load details</summary>
            <p className="small">Select and copy these details if you need to report the load failure.</p>
            <textarea
              className="image-diagnostic-field"
              readOnly
              rows={7}
              spellCheck={false}
              aria-label="Local load diagnostic"
              value={sourceDiagnostic}
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        )}
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

      <section className="trim-work" aria-labelledby="image-icon-kit-heading">
        <h2 id="image-icon-kit-heading">Site icon kit</h2>
        <p className="trim-note">
          Download your finished image here, then choose it as artwork in Launch Kit
          to make favicons, app icons and touch icons. Launch Kit opens in a new tab
          and your file stays on this device.
        </p>
        <a
          className="button secondary"
          href="https://composer-launch-kit.loftwah.workers.dev/?operation=icons"
          target="_blank"
          rel="noopener noreferrer"
        >
          Make icons in Launch Kit
        </a>
      </section>

      {selected && (
        <section className="trim-work" aria-labelledby="image-edit-heading">
          <div className="image-section-head">
            <h2 id="image-edit-heading">Edit {selected.file.name}</h2>
            <span>{selected.source.orientation === 1 ? "no EXIF rotation" : `EXIF ${ORIENTATION_LABELS[selected.source.orientation] ?? selected.source.orientation}`}</span>
          </div>
          {selected.publicSource?.kind === "poster" && (
            <p className="trim-note">
              Public poster from <a href={sourceFilmPath(selected.publicSource.path) ?? undefined}>the source film</a>.
            </p>
          )}
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
              Set {WEBP_ENCODABLE ? `WebP at ${Math.round(WEB_READY_QUALITY * 100)}% quality` : "PNG at lossless quality"} and cap the longest side at {WEB_READY_LONG_EDGE} px.
              The preset keeps transparency and your edits. It only shrinks images.
              {!WEBP_ENCODABLE && " This browser cannot encode WebP, so the preset uses PNG."}
            </p>
          </fieldset>

          <fieldset className="image-controls" ref={socialSizesRef} tabIndex={-1}>
            <legend>Social sizes</legend>
            <label>Kit format
              <select
                value={socialFormat}
                disabled={running || socialBusy || Boolean(batchExport) || adding}
                aria-describedby="image-social-kit-note"
                onChange={(event) => {
                  const next = SOCIAL_KIT_FORMATS.find((format) => format === event.target.value);
                  if (!next || next === socialFormat) return;
                  setSocialFormat(next);
                  setMessage("");
                }}
              >
                {SOCIAL_KIT_FORMATS.map((value) => (
                  <option key={value} value={value} disabled={value === "webp" && !WEBP_ENCODABLE}>
                    {value === "webp"
                      ? WEBP_ENCODABLE
                        ? "WebP · default, smaller files"
                        : "WebP · unavailable in this browser"
                      : "PNG · lossless, larger files"}
                  </option>
                ))}
              </select>
            </label>
            {selected && socialReady && (
              <details className="image-social-anchors">
                <summary>Crop position for each size</summary>
                <div className="image-social-anchor-grid">
                  {SOCIAL_SIZES.map((size) => (
                    <label key={size.key}>
                      <span>{size.label}</span>
                      <select
                        value={selected.socialCropAnchors?.[size.key] ?? ""}
                        disabled={running || socialBusy || Boolean(batchExport) || adding}
                        aria-label={`Crop position for ${size.label}; Use editor keeps the editor crop position`}
                        onChange={(event) =>
                          setSocialCropAnchor(
                            selected,
                            size.key,
                            event.target.value === ""
                              ? undefined
                              : (event.target.value as CropAnchorKey),
                          )
                        }
                      >
                        <option value="">Use editor</option>
                        {Object.entries(CROP_ANCHOR_LABELS).map(([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="trim-note">
                  Use editor keeps the crop position from the editor. Each choice takes effect on the next
                  Make 4 social sizes; the current downloads stay available until then.
                </p>
              </details>
            )}
            {socialReady && (
              <details className="image-social-post">
                <summary>Add post text</summary>
                {selected?.publicSource?.kind === "composer" &&
                  selected.publicSource === publicImageSource && (
                    <>
                      <label className="trim-file">
                        Fill from Composer post brief (JSON)
                        <input
                          type="file"
                          accept="application/json,.json"
                          disabled={running || socialBusy || Boolean(batchExport) || adding}
                          onChange={(event) => {
                            const input = event.currentTarget;
                            void applyComposerPostBrief(input.files?.[0]);
                            input.value = "";
                          }}
                        />
                      </label>
                    </>
                  )}
                <label>
                  Caption (optional)
                  <textarea
                    rows={3}
                    value={selected.socialPost?.caption ?? ""}
                    maxLength={SOCIAL_POST_LIMITS.caption}
                    onChange={(event) => setSocialPost(selected.id, "caption", event.target.value)}
                  />
                </label>
                <label>
                  Image alt text (optional)
                  <textarea
                    rows={2}
                    value={selected.socialPost?.altText ?? ""}
                    maxLength={SOCIAL_POST_LIMITS.altText}
                    onChange={(event) => setSocialPost(selected.id, "altText", event.target.value)}
                  />
                </label>
                <p className="trim-note">
                  Text stays on this device and goes into the next ZIP as separate text files.
                </p>
                {socialTextChanged && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={running || socialBusy || Boolean(batchExport) || adding}
                    ref={updateSocialTextRef}
                    onClick={() => void makeSocialKit("text")}
                  >
                    {socialOperation === "text" ? "Updating post text…" : "Update post text in ZIP"}
                  </button>
                )}
                {postBriefStatus && (
                  <p
                    className={postBriefStatus.bad ? "notice warn" : "trim-note"}
                    role={postBriefStatus.bad ? "alert" : "status"}
                  >
                    {postBriefStatus.message}
                  </p>
                )}
              </details>
            )}
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={running || socialBusy || Boolean(batchExport) || adding || !socialReady}
                aria-describedby="image-social-kit-note"
                ref={makeSocialKitRef}
                onClick={() => void makeSocialKit()}
              >
                {socialOperation === "sizes" ? "Making sizes…" : "Make 4 social sizes"}
              </button>
              {socialBusy && (
                <button type="button" className="quiet" ref={cancelSocialKitRef} onClick={cancelSocialKit}>
                  {socialOperation === "text" ? "Cancel ZIP update" : "Cancel kit"}
                </button>
              )}
            </div>
            <p className="trim-note" id="image-social-kit-note">
              The selected PNG, JPEG, still WebP or public poster becomes {formatLabelForMime(mimeForExport(socialFormat))} at 1080 × 1080 (1:1), 1080 × 1350 (4:5),
              1080 × 1920 (9:16) and 1920 × 1080 (16:9)
              {socialFormat === "webp" ? ` with ${Math.round(WEB_READY_QUALITY * 100)}% quality` : " at lossless quality"}.
              Smaller crops can be enlarged to fit. The ZIP includes one receipt for each size.
              {selected?.publicSource?.kind === "poster" && " The ZIP also includes a link to the source film and poster."}
              {selected?.publicSource?.kind === "still" && " The ZIP also records the published image, its public page and the verified source hash."}
              {selected?.publicSource?.kind === "composer" && " The ZIP also records the source artwork and revision."}
            </p>
            {!socialReady &&
              (animatedWebp ? (
                <p className="notice calm">This WebP is animated. Choose a still PNG, JPEG or WebP to make a social kit.</p>
              ) : (
                <p className="notice calm">Choose a PNG, JPEG or still WebP to make this kit.</p>
              ))}
          </fieldset>

          {socialOutputs.length > 0 && (
            <div className="image-result" aria-live="polite">
              <ul className="image-social-list">
                {socialOutputs.map((output) => (
                  <li key={output.key} className="image-social-item">
                    <img
                      src={output.url}
                      alt=""
                      width={output.width}
                      height={output.height}
                      loading="lazy"
                      className="image-social-thumb"
                    />
                    <div className="image-social-details">
                      <a href={output.url} download={`${safeStem(selected.file.name)}-${output.key}-${output.width}x${output.height}.${extensionForImageMime(output.mime)}`}>
                        {output.label} · {output.width} × {output.height}
                      </a>{" "}
                      <span className="small">{formatBytes(output.bytes)} · sha256 {shortHash(output.sha256)}</span>{" "}
                      <a
                        href={output.receiptHref}
                        download={`${safeStem(selected.file.name)}-${output.key}-receipt.json`}
                        aria-label={`Download ${output.label} receipt`}
                      >receipt</a>
                    </div>
                  </li>
                ))}
              </ul>
              {socialZip && (
                <>
                  <a
                    className="button"
                    ref={socialZipDownloadRef}
                    href={socialZip.url}
                    download={`${safeStem(selected.file.name)}-social-kit.zip`}
                    aria-describedby={socialCropStale ? "social-zip-pending-crop" : undefined}
                  >
                    Download ZIP · {formatLabelForMime(socialOutputs[0].mime)} · {formatBytes(socialZip.bytes)}
                  </a>
                  {socialCropStale && (
                    <p className="notice calm" id="social-zip-pending-crop">
                      The ZIP uses the previous crop positions. Make 4 social sizes to apply your changes.
                    </p>
                  )}
                </>
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
              <select value={settings.cropAnchor} disabled={running || (settings.cropAspect === "original" && selectedSettings.cropAspect === "original")} onChange={(event) => setSettings((previous) => ({ ...previous, cropAnchor: event.target.value as CropAnchorKey }))}>
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
              Crop position applies when the aspect is not Original, including an
              aspect chosen for one row. It decides which part of the picture is kept
              instead of always cutting from the centre.
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
              <select
                value={settings.format}
                disabled={running}
                aria-describedby={WEBP_ENCODABLE ? undefined : "image-webp-unavailable-note"}
                onChange={(event) => setNextFormat(event.target.value as ExportFormat)}
              >
                {FORMATS.map(({ value, label }) => (
                  <option value={value} key={value} disabled={value === "webp" && !WEBP_ENCODABLE}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!WEBP_ENCODABLE && (
              <p className="trim-note" id="image-webp-unavailable-note">
                This browser cannot export WebP. Use PNG to preserve transparency, or JPEG for a smaller file.
              </p>
            )}
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
                PNG is lossless, so a byte target is not achievable here. Lower the output width and height, or choose JPEG{WEBP_ENCODABLE ? " or WebP" : ""}.
              </p>
            ) : (
              <p className="trim-note" id="image-target-note">
                The quality slider applies when no target is set. A target instead runs a bounded, deterministic search and reports the real encoded bytes; if the smallest result still exceeds it, the result says so instead of claiming success.
              </p>
            )}
            {selectedSettings.format !== settings.format && (
              <p className="trim-note">This image will export as PNG. The batch format and byte target still apply to the other images using those settings.</p>
            )}
            {settings.format === "jpeg" && (
              <label>Matte colour for transparency
                <input type="color" value={settings.matte} disabled={running} onChange={(event) => setSettings((previous) => ({ ...previous, matte: event.target.value }))} />
              </label>
            )}
          </fieldset>

          <p id="image-output-plan" tabIndex={-1} className={`image-plan${plan && !plan.ok ? " is-error" : ""}`}>
            {plan?.ok
              ? `Planned result: ${plan.outputWidth} × ${plan.outputHeight} px${activeTrim ? ` · trimmed from ${plan.rotatedWidth} × ${plan.rotatedHeight} px` : ""}${plan.aspectDistorted ? " · exact dimensions change the aspect" : ""}${plan.upscaled ? " · enlarged by resampling; no detail is invented" : ""}.`
              : plan?.error ?? "Choose a usable size."}
          </p>
          {targetProblem && <p className="image-plan is-error" role="alert">{targetProblem}</p>}
          <div className="image-control-actions">
            <button
              type="button"
              disabled={socialBusy || adding || sheetBusy || importing || !plan?.ok || Boolean(targetProblem)}
              aria-disabled={running}
              onClick={() => {
                if (running) return;
                void runItems([selected]);
              }}
            >
              {selected.status === "working" ? "Processing…" : "Make this image"}
            </button>
            {selected.result && <a className="button secondary" href="#image-downloads">Go to downloads</a>}
            {selected.status === "error" && (
              <button type="button" className="secondary" disabled={running || sheetBusy || importing} onClick={() => void runItems([selected])}>Retry</button>
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
            <div id="image-downloads" tabIndex={-1} className="image-result">
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
              <p className={freshResult ? "sr-only" : "notice calm"} role="status" aria-atomic="true">
                {!freshResult && (
                  <>
                    The settings changed since this result. Make the image again to match the
                    current controls. The existing download still uses the earlier settings.
                  </>
                )}
              </p>
              <a
                className="button"
                href={selected.result.url}
                download={renderedFileName(selected.file.name, selected.result)}
              >
                Download {selected.result.mime.replace("image/", "").toUpperCase()}
              </a>
              <button
                type="button"
                className="button secondary"
                disabled={running || importing || socialBusy || Boolean(batchExport) ||
                  items.length >= MAX_BATCH_IMAGES || selected.result.bytes > MAX_IMAGE_INPUT_BYTES}
                aria-disabled={adding}
                aria-describedby="image-reuse-note"
                onClick={(event) => reuseResultAsInput(selected, event.currentTarget)}
              >
                Use as new input
              </button>
              <p className="trim-note" id="image-reuse-note">
                {selected.result.bytes > MAX_IMAGE_INPUT_BYTES
                  ? `New inputs must be ${formatBytes(MAX_IMAGE_INPUT_BYTES)} or smaller.`
                  : items.length >= MAX_BATCH_IMAGES
                    ? "Remove an image before adding this result."
                    : "Continue editing from this file. The source and its result stay in the batch."}
              </p>
              {selected.result.mime === "image/png" && canCopyPng && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void copyResultPng(selected)}
                >
                  Copy PNG
                </button>
              )}
              <a
                className="button secondary"
                href={imageReceiptHref}
                download="studio-image-receipt.json"
              >
                Download image receipt (.json)
              </a>
              {outputHash && (
                <div className="image-hash-copy">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={(event) => void copyOutputHash(event.currentTarget, outputResultKey, outputHash)}
                  >
                    Copy output SHA-256
                  </button>
                  {outputHashFallback?.key === outputResultKey && (
                    <label className="image-copy-fallback">
                      Exact output SHA-256 — select and copy
                      <input
                        readOnly
                        ref={outputHashFallbackField}
                        value={outputHashFallback.hash}
                        spellCheck={false}
                        aria-label="Exact output SHA-256 value to copy"
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                      />
                    </label>
                  )}
                </div>
              )}
              <p className="trim-note" role="status">
                {outputCopy?.key === outputResultKey ? outputCopy?.message : ""}
              </p>
              <p className="trim-note">
                Keep the hashes and settings for this finished image. Later
                edits to the controls leave this receipt tied to the download.
              </p>
              <ImageCover
                key={`${selected.id}:${selected.result.sha256}`}
                source={selected.result}
                encodePng={canvas => canvasToBlob(canvas, "image/png")}
                addToBatch={async (file) => {
                  let added = false;
                  await addFiles([file], false, undefined, () => { added = true; });
                  return added;
                }}
                canAddToBatch={!adding && !running && !importing && !socialBusy && !batchExport}
                batchFull={items.length >= MAX_BATCH_IMAGES}
              />
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
                {readingPaletteId === selected.id ? "Reading colours…" : "Extract palette"}
              </button>
              {!running && !paletteBusy && visiblePalette && visiblePalette.result.colors.length > 0 && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    onClick={(event) => void copyPaletteValue(
                      event.currentTarget,
                      "palette CSS",
                      paletteToCss(visiblePalette.result.colors),
                    )}
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
                    href="https://composer-launch-kit.loftwah.workers.dev/#studio-palette"
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
              {visiblePaletteMessage ||
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
                        onClick={(event) => void copyPaletteValue(event.currentTarget, "HEX", colour.hex)}
                      />
                      <div className="image-palette-values">
                        <span><strong>{colour.hex}</strong> · {colour.coverage}%{colour.alpha < 255 ? ` · alpha ${Math.round(colour.alpha / 2.55)}%` : ""}</span>
                        <span>{formatRgb(colour.rgb)}</span>
                        <span>{formatHsl(colour.hsl)}</span>
                        <div className="image-copy-actions">
                          <button type="button" className="quiet image-copy" aria-label={`Copy HEX ${colour.hex}`} onClick={(event) => void copyPaletteValue(event.currentTarget, "HEX", colour.hex)}>Copy HEX</button>
                          <button type="button" className="quiet image-copy" aria-label={`Copy RGB ${formatRgb(colour.rgb)}`} onClick={(event) => void copyPaletteValue(event.currentTarget, "RGB", formatRgb(colour.rgb))}>Copy RGB</button>
                          <button type="button" className="quiet image-copy" aria-label={`Copy HSL ${formatHsl(colour.hsl)}`} onClick={(event) => void copyPaletteValue(event.currentTarget, "HSL", formatHsl(colour.hsl))}>Copy HSL</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {paletteCopyFallback && (
                  <label className="image-copy-fallback">
                    {paletteCopyFallback.label} value — select and copy
                    {paletteCopyFallback.value.includes("\n") ? (
                      <textarea
                        readOnly
                        ref={paletteCopyTextareaField}
                        value={paletteCopyFallback.value}
                        rows={Math.min(12, paletteCopyFallback.value.split("\n").length + 1)}
                        spellCheck={false}
                        aria-label={`Exact ${paletteCopyFallback.label} value to copy`}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                      />
                    ) : (
                      <input
                        readOnly
                        ref={paletteCopyField}
                        value={paletteCopyFallback.value}
                        spellCheck={false}
                        aria-label={`Exact ${paletteCopyFallback.label} value to copy`}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                      />
                    )}
                  </label>
                )}
              </>
            )}
          </div>

          <div className="image-colour-block">
            <h3>Result alpha</h3>
            <p className="trim-note" id="image-alpha-note">
              Counts every pixel in the finished image on this device. Transparent is
              alpha 0, partial is 1–254 and opaque is 255.
            </p>
            <div className="image-control-actions">
              <button
                type="button"
                className="secondary"
                disabled={!selected.result || running}
                aria-disabled={alphaBusy || running}
                aria-describedby="image-alpha-note"
                onClick={() => void inspectResultAlpha()}
              >
                {alphaBusy
                  ? "Reading result alpha…"
                  : visibleAlpha
                    ? "Re-inspect result alpha"
                    : "Inspect result alpha"}
              </button>
            </div>
            <p className="trim-note" role="status" aria-live="polite">{alphaMessage}</p>
            {visibleAlpha && (
              <>
                <dl className="image-alpha-summary">
                  <div>
                    <dt>Transparent</dt>
                    <dd>{visibleAlpha.transparent.toLocaleString()} px · {percentOf(visibleAlpha.transparent, visibleAlpha.totalPixels)}%</dd>
                  </div>
                  <div>
                    <dt>Partial</dt>
                    <dd>{visibleAlpha.partial.toLocaleString()} px · {percentOf(visibleAlpha.partial, visibleAlpha.totalPixels)}%</dd>
                  </div>
                  <div>
                    <dt>Opaque</dt>
                    <dd>{visibleAlpha.opaque.toLocaleString()} px · {percentOf(visibleAlpha.opaque, visibleAlpha.totalPixels)}%</dd>
                  </div>
                </dl>
                <div className="image-control-actions">
                  <a
                    className="button secondary"
                    href={alphaReportHref}
                    download="studio-alpha-report.json"
                  >
                    Download alpha report (JSON)
                  </a>
                </div>
                {visibleAlphaMap && (
                  <figure className="image-alpha-map-figure">
                    <AlphaMapCanvas
                      map={visibleAlphaMap}
                      label={`Alpha map of the finished result at ${visibleAlphaMap.width} × ${visibleAlphaMap.height}${visibleAlphaMap.sampled ? ", sampled from the full result" : ", native pixels"}`}
                    />
                    <figcaption className="trim-note" id="image-alpha-map-note">
                      Black is transparent, white is opaque and grey shows the alpha value.
                      {visibleAlphaMap.sampled
                        ? " This preview samples the finished image. The counts use every pixel."
                        : " This preview shows every pixel at its native size."}
                    </figcaption>
                  </figure>
                )}
                <p className="trim-note">
                  {visibleAlpha.totalPixels.toLocaleString()} pixels at{" "}
                  {visibleAlpha.width} × {visibleAlpha.height}, decoded from the exact
                  finished image.
                  {visibleAlpha.partial > 0
                    ? " Partial pixels are semi-transparent; check them on white and black."
                    : ""}
                  {selected.result?.mime === "image/jpeg"
                    ? " JPEG was flattened onto the chosen matte, so all pixels should be opaque."
                    : ""}
                </p>
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
              disabled={running}
              aria-disabled={snippetBusy || running}
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
                    onClick={() => {
                      if (kind === snippetKind) return;
                      latestSnippetCopy.current += 1;
                      setSnippetKind(kind);
                      setSnippetMessage("");
                    }}
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
                  ref={snippetField}
                  value={snippetText}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <div className="image-copy-actions">
                <button
                  type="button"
                  className="quiet image-copy"
                  onClick={(event) => void copySnippet(event.currentTarget)}
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
            <button type="button" className="secondary" disabled={running || importing} aria-disabled={stripBusy || running} onClick={() => void stripSelected()}>
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
            key={selected.result?.url ?? selected.stripped?.url}
            blob={importBlob}
            filename={importFilename}
            operation={selected.result ? "resize, crop and convert image" : "strip image metadata"}
            format={importFormat}
            caption={importCaption}
            onBusyChange={setImporting}
            blocked={running || stripBusy}
          />
        </section>
      )}

      <section id="image-batch" tabIndex={-1} className="trim-work image-batch" aria-labelledby="image-batch-heading">
        <div className="image-section-head">
          <h2 id="image-batch-heading">Batch</h2>
          <span>{items.length} image{items.length === 1 ? "" : "s"} · sequential</span>
        </div>
        {batchTargetProblem && batchTargetProblem !== targetProblem && (
          <p className="trim-note">Batch output size: {batchTargetProblem}</p>
        )}
        {invalidLongEdgeItem && (
          <p className="image-plan is-error" role="alert">
            Fix the long edge for {invalidLongEdgeItem.file.name}: enter a whole number from 1 to{" "}
            {MAX_IMAGE_OUTPUT_DIMENSION}, or leave it blank to use the batch resize.
          </p>
        )}
        {invalidQualityItem && (
          <p className="image-plan is-error" role="alert">
            Fix the quality for {invalidQualityItem.file.name}: enter a whole percent from{" "}
            {IMAGE_QUALITY_MIN_PERCENT} to {IMAGE_QUALITY_MAX_PERCENT}, or leave it blank to use
            the batch quality.
          </p>
        )}
        <label className="image-sheet-columns">
          Sheet mode
          <select value={sheetMode} disabled={running || sheetBusy} onChange={(event) =>
            setSheetMode(event.target.value === "sprite-atlas" ? "sprite-atlas" : "contact-sheet")
          }>
            <option value="contact-sheet">Contact sheet · fitted tiles</option>
            <option value="sprite-atlas">Sprite atlas · native size</option>
          </select>
        </label>
        <label className="image-sheet-columns">
          {sheetMode === "sprite-atlas" ? "Atlas columns" : "Contact sheet columns"}
          <select
            value={sheetColumns}
            disabled={running || sheetBusy}
            aria-describedby={sheetMode === "sprite-atlas" ? "image-atlas-preflight" : undefined}
            onChange={(event) => {
              const value = event.target.value;
              setSheetColumns(value === "auto" ? "auto" : Number(value) as ContactSheetColumns);
            }}>
            <option value="auto">Auto (up to 4)</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>
        {!isAtlasMode && (
          <label className="image-sheet-columns">
            Contact sheet tile size
            <select
              value={sheetTile}
              disabled={running || sheetBusy}
              onChange={(event) =>
                setSheetTile(Number(event.target.value) as ContactSheetTileSize)
              }>
              <option value="120">Compact · 120 px</option>
              <option value="240">Standard · 240 px</option>
              <option value="360">Large · 360 px</option>
            </select>
          </label>
        )}
        {isAtlasMode && (
          <p id="image-atlas-preflight"
            className={atlasProblem ? "image-plan is-error" : "trim-note"}
            role="status"
          >
            {atlasPlan && <>Planned size {atlasPlan.width} × {atlasPlan.height} px. </>}
            {atlasProblem ?? (atlasPlan
              ? "Native size with transparent gaps."
              : "Process at least two PNGs to plan the atlas.")}
          </p>
        )}
        <div className="image-control-actions">
          <button
            type="button"
            ref={processAllRef}
            disabled={socialBusy || adding || sheetBusy || importing || !items.length || !plan?.ok || Boolean(batchTargetProblem) || Boolean(invalidLongEdgeItem) || Boolean(invalidQualityItem)}
            aria-disabled={running}
            onClick={() => {
              if (running) return;
              void runItems(items, setBatchMessage);
            }}
          >
            Process all {items.length || ""} with these settings
          </button>
          {running && <button type="button" className="secondary" onClick={(event) => cancelBatch(event.currentTarget)}>Cancel batch</button>}
          <button
            type="button"
            className="secondary"
            disabled={running || socialBusy || adding || sheetBusy || !doneItems.length}
            aria-disabled={zipBusy}
            onClick={() => {
              if (zipBusy) return;
              void makeZip();
            }}
          >
            {zipBusy ? "Preparing ZIP…" : `Prepare ZIP${doneItems.length ? ` (${doneItems.length})` : ""}`}
          </button>
          {zipUrl && (
            <a className="button secondary" href={zipUrl} download={`media-studio-images-${doneItems.length}.zip`}>
              Download ZIP · {formatBytes(zipBytes)}
            </a>
          )}
          <button
            type="button"
            className="secondary"
            disabled={running || socialBusy || adding || zipBusy || (isAtlasMode
              ? !atlasPlan || Boolean(atlasProblem)
              : doneItems.length < CONTACT_SHEET_MIN_IMAGES)}
            aria-disabled={sheetBusy}
            onClick={() => {
              if (sheetBusy) return;
              void makeSheet();
            }}
          >
            {sheetMode === "sprite-atlas"
              ? sheetBusy ? "Making sprite atlas…" : "Make sprite atlas"
              : sheetBusy ? "Making contact sheet…" : "Make contact sheet"}
          </button>
          {contactSheet && contactSheet.mode === "sprite-atlas" ? (
            <>
              <a className="button secondary" href={contactSheet.url} download={`media-studio-sprite-atlas-${contactSheet.count}.png`}>
                Download sprite atlas PNG
              </a>
              <a className="button secondary" href={contactSheet.layoutUrl} download={`media-studio-sprite-atlas-${contactSheet.count}.json`}>
                Download atlas layout JSON
              </a>
            </>
          ) : contactSheet && (
            <>
              <a className="button secondary" href={contactSheet.url} download={`media-studio-contact-sheet-${contactSheet.count}.png`}>
                Download contact sheet PNG
              </a>
              <a className="button secondary" href={contactSheet.layoutUrl} download={`media-studio-contact-sheet-${contactSheet.count}.json`}>
                Download layout JSON
              </a>
            </>
          )}
          {contactSheet && canCopyPng && (
            <button
              type="button"
              className="button secondary"
              onClick={() => void copySheetPng()}
            >
              Copy PNG
            </button>
          )}
          {contactSheet && (
            <button
              type="button"
              className="button secondary"
              onClick={(event) => void copySheetLayoutJson(event.currentTarget)}
            >
              Copy layout JSON
            </button>
          )}
        </div>
        {sheetJsonFallback?.key === sheetKey && contactSheet && (
          <label className="image-copy-fallback">
            Exact layout JSON — select and copy
            <textarea
              readOnly
              ref={sheetJsonFallbackField}
              value={contactSheet.layoutText}
              rows={6}
              spellCheck={false}
              aria-label="Exact layout JSON to copy"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
        )}
        {sheetCopy?.key === sheetKey && (
          <p className="image-status" role="status" aria-live="polite">{sheetCopy.message}</p>
        )}
        <p className="image-status" role="status" aria-live="polite">{batchMessage}</p>
        {contactSheet && (
          <>
            <img
              className="image-contact-sheet"
              src={contactSheet.url}
              width={contactSheet.width}
              height={contactSheet.height}
              alt={contactSheet.mode === "sprite-atlas"
                ? `Sprite atlas of ${contactSheet.count} completed PNG images`
                : `Contact sheet of ${contactSheet.count} completed images`}
            />
            {contactSheet.mode === "sprite-atlas" ? (
              <p className="trim-note">
                Completed PNGs at their native size, centred on whole pixels in transparent cells across {contactSheet.columns} column{contactSheet.columns === 1 ? "" : "s"} in batch order. No resampling.
              </p>
            ) : (
              <p className="trim-note">
                The layout uses {contactSheet.tileSize} px transparent tiles across {contactSheet.columns} column{contactSheet.columns === 1 ? "" : "s"} in batch order.
              </p>
            )}
          </>
        )}
        <fieldset className="image-gif" aria-describedby="image-gif-note">
          <legend>Make an animated GIF</legend>
          <p className="trim-note" id="image-gif-note">
            Use {GIF_MIN_FRAMES}–{GIF_MAX_FRAMES} source stills in batch order.
            Every frame uses the same square size and matte. The batch delay
            applies to every frame unless a row below sets its own. The fixed
            256-colour palette can cause banding in gradients.
          </p>
          <div className="image-gif-settings">
            <label className="image-sheet-columns">
              GIF frame size
              <select
                value={gifFrameSize}
                disabled={gifBusy}
                onChange={(event) => {
                  setGifFrameSize(Number(event.target.value));
                  if (gifOutput) invalidateGif("GIF frame size changed. Make the GIF again.");
                }}
              >
                {GIF_FRAME_SIZES.map((size) => (
                  <option value={size} key={size}>
                    {size} px square{size === GIF_DEFAULT_FRAME_SIZE ? " · default" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="image-sheet-columns">
              GIF delay (ms per frame)
              <input
                type="number"
                min={GIF_MIN_DELAY_MS}
                max={GIF_MAX_DELAY_MS}
                step={GIF_DELAY_STEP_MS}
                inputMode="numeric"
                value={Number.isFinite(gifDelayMs) ? gifDelayMs : ""}
                disabled={gifBusy}
                onChange={(event) => {
                  setGifDelayMs(event.currentTarget.valueAsNumber);
                  if (gifOutput) invalidateGif("GIF delay changed. Make the GIF again.");
                }}
              />
            </label>
            <label className="image-sheet-columns">
              GIF matte
              <input
                type="color"
                value={gifMatte}
                disabled={gifBusy}
                onChange={(event) => {
                  setGifMatte(event.target.value);
                  if (gifOutput) invalidateGif("GIF matte changed. Make the GIF again.");
                }}
              />
            </label>
            <label className="image-check">
              <input
                type="checkbox"
                checked={gifLoop}
                disabled={gifBusy}
                onChange={(event) => {
                  setGifLoop(event.target.checked);
                  if (gifOutput) invalidateGif("GIF loop changed. Make the GIF again.");
                }}
              />
              Repeat after the last frame
            </label>
          </div>
          {items.length > 0 && (
            <details className="image-gif-delays">
              <summary>Per-frame delays (optional)</summary>
              <p className="trim-note" id="image-gif-delays-note">
                Leave a frame blank to use the batch delay. Each value is
                {" "}{GIF_MIN_DELAY_MS}–{GIF_MAX_DELAY_MS} ms in {GIF_DELAY_STEP_MS} ms
                steps and stays with its row when the batch is reordered.
              </p>
              <div className="image-gif-delay-grid">
                {items.map((item, index) => (
                  <label className="image-sheet-columns" key={item.id}>
                    Frame {index + 1} delay (ms)
                    <input
                      type="number"
                      min={GIF_MIN_DELAY_MS}
                      max={GIF_MAX_DELAY_MS}
                      step={GIF_DELAY_STEP_MS}
                      inputMode="numeric"
                      placeholder={Number.isFinite(gifDelayMs) ? String(gifDelayMs) : "Batch"}
                      value={
                        item.gifDelayMsOverride === undefined ||
                        !Number.isFinite(item.gifDelayMsOverride)
                          ? ""
                          : item.gifDelayMsOverride
                      }
                      disabled={gifBusy}
                      aria-describedby="image-gif-delays-note"
                      aria-invalid={
                        item.gifDelayMsOverride !== undefined &&
                        !gifDelayOverrideIsValid(item.gifDelayMsOverride)
                          ? true
                          : undefined
                      }
                      onChange={(event) =>
                        setGifDelayOverride(item, longEdgeFromControl(event.currentTarget))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="image-control-actions">
            <button
              type="button"
              className="secondary"
              disabled={
                gifBusy || Boolean(batchExport) || socialBusy || adding || importing || running ||
                Boolean(gifProblem)
              }
              onClick={() => {
                if (gifBusy) return;
                void makeGif();
              }}
            >
              {gifBusy ? "Making GIF…" : `Make GIF${items.length >= GIF_MIN_FRAMES && items.length <= GIF_MAX_FRAMES ? ` (${items.length} frames)` : ""}`}
            </button>
            {gifOutput && (
              <a
                className="button secondary"
                href={gifOutput.url}
                download={`media-studio-gif-${gifOutput.count}-frames-${gifOutput.width}px-${gifOutputDelaySummary?.token}.gif`}
              >
                Download GIF · {formatBytes(gifOutput.bytes)}
              </a>
            )}
          </div>
          {gifProblem && items.length > 0 && (
            <p className="image-plan is-error" role="alert">{gifProblem}</p>
          )}
          <p className="image-status" role="status" aria-live="polite">{gifMessage}</p>
          {gifOutput && (
            <>
              <img
                className="image-gif-preview"
                src={gifOutput.url}
                width={gifOutput.width}
                height={gifOutput.height}
                alt={`Encoded GIF: ${gifOutput.count} frames at ${gifOutput.width} × ${gifOutput.height} px, ${gifOutputDelaySummary?.phrase}`}
              />
            </>
          )}
        </fieldset>
        {running && (
          <div className="image-progress">
            <progress value={batch.completed} max={batch.total || 1} aria-label="Batch progress" />
            <span role="status" aria-live="polite">
              {batch.completed} of {batch.total} complete{batch.current ? ` · ${batch.current}` : ""}
            </span>
          </div>
        )}
        {items.length > 0 && (
          <ul className="image-list" ref={listRef}>
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
                <div className="image-list-main">
                  <button
                    type="button"
                    className="image-list-select"
                    data-image-row={item.id}
                    onClick={() => selectItem(item.id)}
                    disabled={importing}
                    aria-pressed={item.id === selectedId}
                  >
                    <span className="image-list-name">{item.file.name}</span>
                    <span className="image-list-meta">
                      {item.source.orientedWidth} × {item.source.orientedHeight} · {formatBytes(item.file.size)} · {item.status}
                      {item.result ? ` · ${item.result.width} × ${item.result.height} · ${formatBytes(item.result.bytes)}` : ""}
                    </span>
                    {item.error && <span className="image-list-error">{item.error}</span>}
                  </button>
                  <label className="image-list-override">
                    <select
                      value={item.formatOverride ?? ""}
                      disabled={running || adding}
                      aria-label={`Export format for ${item.file.name}; Use batch keeps the batch format`}
                      aria-describedby="image-batch-note"
                      onChange={(event) =>
                        setFormatOverride(
                          item,
                          event.target.value === ""
                            ? undefined
                            : (event.target.value as ExportFormat),
                        )
                      }
                    >
                      <option value="">Use batch</option>
                      {FORMATS.map(({ value, label }) => (
                        <option
                          value={value}
                          key={value}
                          disabled={value === "webp" && !WEBP_ENCODABLE}
                        >
                          {label}
                        </option>
                      ))}
                    </select>
                    Format for this image
                  </label>
                  <label className="image-list-override">
                    <input
                      type="number"
                      min="1"
                      max={MAX_IMAGE_OUTPUT_DIMENSION}
                      step="1"
                      inputMode="numeric"
                      placeholder="Batch"
                      value={
                        item.longEdgeOverride === undefined ||
                        !Number.isFinite(item.longEdgeOverride)
                          ? ""
                          : item.longEdgeOverride
                      }
                      disabled={running || adding}
                      aria-label={`Long edge in pixels for ${item.file.name}; leave blank to use the batch resize`}
                      aria-describedby="image-batch-note"
                      aria-invalid={
                        item.longEdgeOverride !== undefined &&
                        !itemLongEdgeIsValid(item.longEdgeOverride)
                          ? true
                          : undefined
                      }
                      onChange={(event) =>
                        setLongEdgeOverride(item, longEdgeFromControl(event.currentTarget))
                      }
                    />
                    Long edge for this image (px)
                  </label>
                  {item.longEdgeOverride !== undefined &&
                    !itemLongEdgeIsValid(item.longEdgeOverride) && (
                      <span className="image-list-error">
                        Enter a whole number from 1 to {MAX_IMAGE_OUTPUT_DIMENSION}, or leave it
                        blank to use the batch resize.
                      </span>
                    )}
                  {rowIsLossy(item) && (
                    <label className="image-list-override">
                      <input
                        type="number"
                        min={IMAGE_QUALITY_MIN_PERCENT}
                        max={IMAGE_QUALITY_MAX_PERCENT}
                        step="1"
                        inputMode="numeric"
                        placeholder="Batch"
                        value={
                          item.qualityOverride === undefined ||
                          !Number.isFinite(item.qualityOverride)
                            ? ""
                            : item.qualityOverride
                        }
                        disabled={
                          running || adding || !canSetRowQuality(item)
                        }
                        aria-label={`JPEG or WebP quality in percent for ${item.file.name}; leave blank to use the batch quality`}
                        aria-describedby="image-batch-note"
                        aria-invalid={
                          hasInvalidQuality(item)
                            ? true
                            : undefined
                        }
                        onChange={(event) =>
                          setQualityOverride(item, qualityFromControl(event.currentTarget))
                        }
                      />
                      Quality for this image (%)
                    </label>
                  )}
                  {hasInvalidQuality(item) && (
                      <span className="image-list-error">
                        Enter a whole percent from {IMAGE_QUALITY_MIN_PERCENT} to{" "}
                        {IMAGE_QUALITY_MAX_PERCENT}, or leave it blank to use the batch quality.
                      </span>
                    )}
                  <label className="image-list-override">
                    <select
                      value={item.cropAspectOverride ?? ""}
                      disabled={running || adding}
                      aria-label={`Crop aspect for ${item.file.name}; use batch keeps the batch aspect`}
                      aria-describedby="image-batch-note"
                      onChange={(event) =>
                        setCropAspectOverride(
                          item,
                          event.target.value === ""
                            ? undefined
                            : (event.target.value as CropAspectKey),
                        )
                      }
                    >
                      <option value="">Use batch</option>
                      {Object.entries(CROP_ASPECT_LABELS).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    Crop aspect for this image
                  </label>
                  <label className="image-list-override">
                    <select
                      value={item.cropAnchorOverride ?? ""}
                      disabled={
                        running ||
                        adding ||
                        (item.cropAspectOverride ?? settings.cropAspect) === "original"
                      }
                      aria-label={`Crop position for ${item.file.name}; use batch keeps the batch position`}
                      aria-describedby="image-batch-note"
                      onChange={(event) =>
                        setCropAnchorOverride(
                          item,
                          event.target.value === ""
                            ? undefined
                            : (event.target.value as CropAnchorKey),
                        )
                      }
                    >
                      <option value="">Use batch</option>
                      {Object.entries(CROP_ANCHOR_LABELS).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    Crop position for this image
                  </label>
                </div>
                <div className="image-list-actions">
                  <button
                    type="button"
                    className="quiet"
                    data-image-move="up"
                    disabled={running || index === 0}
                    aria-label={`Move ${item.file.name} up in batch order`}
                    onClick={() => moveItem(item.id, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    data-image-move="down"
                    disabled={running || index === items.length - 1}
                    aria-label={`Move ${item.file.name} down in batch order`}
                    onClick={() => moveItem(item.id, 1)}
                  >
                    Move down
                  </button>
                  {item.result && (
                    <a className="button secondary" href={item.result.url} download={`${safeStem(item.file.name)}-${item.result.width}x${item.result.height}.${extensionForImageMime(item.result.mime)}`}>Download</a>
                  )}
                  {(item.status === "error" || item.status === "cancelled") && (
                    <button type="button" className="secondary" disabled={running || sheetBusy || importing} onClick={() => void runItems([item])}>Retry</button>
                  )}
                  <button type="button" className="quiet" disabled={running || adding || importing} onClick={() => removeItem(item)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="trim-note" id="image-batch-note">
          Drag a row or use Move up and Move down to change the order. Each image is
          decoded and encoded one at a time. ZIPs and contact sheets follow this list order. Cancelling
          stops after the current encode, and already completed downloads stay in the
          list. ZIP export uses a small store-only writer in this page, not a server
          archive. <strong>Format for this image</strong> offers Use batch, PNG, JPEG or
          WebP for that row only; Use batch follows the batch format. A PNG row is
          lossless and uses no byte target. A JPEG row is flattened onto the chosen
          matte. WebP is unavailable when this browser cannot encode it, and a format
          mismatch is reported rather than saved under another name.
          <strong> Long edge for this image</strong> resizes only that row; leave it blank
          to follow the batch resize. <strong>Quality for this image</strong> sets a whole
          percent from {IMAGE_QUALITY_MIN_PERCENT} to {IMAGE_QUALITY_MAX_PERCENT} for that
          row only. Leave it blank to follow the batch quality. It applies when that row's
          format is JPEG or WebP and no byte target is set. <strong>Crop aspect for this image</strong> changes
          only that row; <strong>Use batch</strong> follows the batch aspect.
          <strong> Crop position for this image</strong> overrides the shared position for
          that row while its effective aspect is not Original; <strong>Use batch</strong>
          follows the batch position.
        </p>
      </section>

      <TitleCompare preparedImage={preparedTitleImage} />
    </main>
  );
}

export function mountImages(container: HTMLElement) {
  createRoot(container).render(<Images />);
}
