// MIT. A bounded, reversible per-image export choice. The batch keeps its
// normal Settings; a PNG source can opt into a lossless PNG result while the
// batch default stays JPEG or WebP. PNG has no byte target, so an inherited
// target is dropped for that one image. This is not a receipt version change.
// A per-image long edge composes with that choice: a number resizes only that
// image, and a blank value keeps the batch resize.

export type ExportFormat = "png" | "jpeg" | "webp";

type BatchExportSettings = {
  format: ExportFormat;
  targetKiB: number | null;
  resizeMode: string;
  longEdge: number;
};

type EffectiveSettings<T extends BatchExportSettings> = Omit<
  T,
  "format" | "targetKiB" | "resizeMode" | "longEdge"
> & {
  format: ExportFormat;
  targetKiB: number | null;
  resizeMode: T["resizeMode"] | "long-edge";
  longEdge: number;
};

/** Only a PNG source in a JPEG/WebP batch needs this choice. */
export function canExportImageAsPng(sourceMime: string, batchFormat: string): boolean {
  return sourceMime === "image/png" && (batchFormat === "jpeg" || batchFormat === "webp");
}

/**
 * The effective settings for one image. Unchecked images, non-PNG sources and
 * an already-PNG batch keep the exact batch settings object. A checked PNG in a
 * JPEG/WebP batch becomes lossless PNG with no byte target.
 *
 * A defined long edge replaces the batch resize for one image with an explicit
 * long edge, including when the batch uses exact dimensions or a maximum. An
 * invalid number is passed through unchanged so the existing whole-number long
 * edge check reports it.
 */
export function settingsForImage<T extends BatchExportSettings>(
  settings: T,
  sourceMime: string,
  pngOverride: boolean,
  longEdgeOverride?: number,
): EffectiveSettings<T> {
  let sized: EffectiveSettings<T> = settings;
  if (longEdgeOverride !== undefined) {
    sized = { ...settings, resizeMode: "long-edge", longEdge: longEdgeOverride };
  }
  if (!pngOverride || !canExportImageAsPng(sourceMime, settings.format)) return sized;
  return { ...sized, format: "png", targetKiB: null };
}
