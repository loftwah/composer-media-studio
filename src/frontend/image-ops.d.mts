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

export type ResizePlan =
  | { mode: "long-edge"; longEdge: number }
  | { mode: "exact"; width: number; height: number };

export type ImageCrop = { x: number; y: number; width: number; height: number };

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
      crop: ImageCrop;
      outputWidth: number;
      outputHeight: number;
      scaleX: number;
      scaleY: number;
      aspectDistorted: boolean;
      upscaled: boolean;
    }
  | { ok: false; error: string };

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
export function planImageTransform(input?: {
  sourceWidth?: number;
  sourceHeight?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  cropAspect?: number | null;
  resize?: ResizePlan;
  maxPixels?: number;
  maxDimension?: number;
}): TransformPlan;
export function defaultLongEdge(width: number, height: number): number;
export function describeTransform(input?: {
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  cropAspect?: number | null;
  resize?: ResizePlan | null;
  format?: string;
  quality?: number | null;
  metadata?: string;
}): string;
export function extensionForImageMime(mime: string): string;
export function mimeForExport(format: string): string;
