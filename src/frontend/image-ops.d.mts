export type CropAspectKey =
  | "original"
  | "square"
  | "portrait"
  | "portraitTall"
  | "landscape"
  | "wide"
  | "tall"
  | "photo";

export const CROP_ASPECTS: Readonly<Record<CropAspectKey, number | null>>;
export const CROP_ASPECT_LABELS: Readonly<Record<CropAspectKey, string>>;
export const DEFAULT_RESIZE_LONG_EDGE: number;

export type CropAnchorKey =
  | "centre"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

export const CROP_ANCHOR_LABELS: Readonly<Record<CropAnchorKey, string>>;

export function isCropAnchor(value: unknown): value is CropAnchorKey;

export type ResizePlan =
  | { mode: "long-edge"; longEdge: number; shrinkOnly?: boolean }
  | { mode: "exact"; width: number; height: number };

export type ImageCrop = { x: number; y: number; width: number; height: number };

export type StraightenPlan = {
  angle: number;
  boundingWidth: number;
  boundingHeight: number;
  width: number;
  height: number;
  offset: { x: number; y: number };
};

export type StraightenGeometry = {
  angle: number;
  radians: number;
  cos: number;
  sin: number;
  width: number;
  height: number;
  boundingWidth: number;
  boundingHeight: number;
  crop: ImageCrop;
};

export type TransformPlan =
  | {
      ok: true;
      sourceWidth: number;
      sourceHeight: number;
      rotate: number;
      flipH: boolean;
      flipV: boolean;
      rotatedWidth: number;
      rotatedHeight: number;
      straighten: StraightenPlan | null;
      crop: ImageCrop;
      outputWidth: number;
      outputHeight: number;
      scaleX: number;
      scaleY: number;
      aspectDistorted: boolean;
      upscaled: boolean;
    }
  | { ok: false; error: string };

export const MAX_STRAIGHTEN_DEGREES: number;
export const STRAIGHTEN_INSET_PX: number;

export function normaliseStraighten(value: unknown): number | null;

export function straightenGeometry(
  width: number,
  height: number,
  degrees: number,
  aspect?: number | null,
  inset?: number,
): StraightenGeometry | null;

export type KeptArea = {
  points: Array<{ x: number; y: number }>;
  area: number;
};

export function keptAreaPolygon(plan: TransformPlan): KeptArea | null;

export function rotatedDimensions(
  width: number,
  height: number,
  rotate?: number,
): { width: number; height: number } | null;
export function centredCrop(
  width: number,
  height: number,
  aspect?: number | null,
): ImageCrop | null;
export function anchoredCrop(
  width: number,
  height: number,
  aspect?: number | null,
  anchor?: CropAnchorKey,
): ImageCrop | null;
export function planImageTransform(input?: {
  sourceWidth?: number;
  sourceHeight?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  straighten?: number;
  cropAspect?: number | null;
  cropAnchor?: CropAnchorKey;
  cropRect?: ImageCrop | null;
  resize?: ResizePlan;
  maxPixels?: number;
  maxDimension?: number;
}): TransformPlan;
export function defaultLongEdge(width: number, height: number): number;
export function describeTransform(input?: {
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  straighten?: number;
  cropAspect?: CropAspectKey | number | null;
  cropAnchor?: CropAnchorKey;
  trimmed?: boolean;
  resize?: ResizePlan | null;
  resample?: "smooth" | "nearest";
  adjustments?: string;
  format?: string;
  quality?: number | null;
  metadata?: string;
}): string;
export function extensionForImageMime(mime: string): string;
export function mimeForExport(format: string): string;

export const TARGET_QUALITY_MIN: number;
export const TARGET_QUALITY_MAX: number;
export const TARGET_SEARCH_ATTEMPTS: number;
export const MIN_TARGET_BYTES: number;

export function targetSizeProblem(
  format: string,
  targetBytes: number | null | undefined,
): string | null;

export type TargetSearchResult =
  | {
      ok: true;
      met: boolean;
      quality: number;
      bytes: number;
      blob: Blob;
      attempts: number;
      targetBytes: number;
      overBy?: number;
    }
  | { ok: false; error: string };

export function searchTargetQuality(input: {
  targetBytes: number;
  encode: (quality: number) => Promise<Blob>;
  minQuality?: number;
  maxQuality?: number;
  attempts?: number;
}): Promise<TargetSearchResult>;

export function imageSmoothingFor(resample?: "smooth" | "nearest"): {
  enabled: boolean;
  quality: "low" | "high";
};
