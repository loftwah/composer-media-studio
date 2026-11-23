// MIT. A bounded, reversible per-image export choice. The batch keeps its
// normal Settings; one row can choose PNG, JPEG or WebP while the batch keeps
// its own format. The older PNG-source boolean still means "lossless PNG" for
// callers that do not pass a format. PNG has no byte target, so an inherited
// target is dropped for that one image. A lossy row in a PNG batch drops the
// batch's stored target too, so a hidden value cannot revive a byte search.
// This is not a receipt version change.
// A per-image long edge composes with that choice: a number resizes only that
// image, and a blank value keeps the batch resize. A per-image crop aspect
// likewise changes only that image; an undefined value keeps the batch crop.
// A per-image crop position is used only while that image's effective aspect is
// not Original, so an aspect-agnostic anchor can be kept without changing the
// plan or receipt of an uncropped row. A per-image quality is a whole percent
// for a lossy row: blank follows the batch, and it is ignored for PNG (lossless)
// or while a byte target runs its own bounded search.

export type ExportFormat = "png" | "jpeg" | "webp";

type BatchExportSettings = {
  format: ExportFormat;
  targetKiB: number | null;
  resizeMode: string;
  longEdge: number;
  cropAspect: string;
  cropAnchor: string;
  quality: number;
};

type EffectiveSettings<T extends BatchExportSettings> = Omit<
  T,
  "format" | "targetKiB" | "resizeMode" | "longEdge" | "cropAspect"
> & {
  format: ExportFormat;
  targetKiB: number | null;
  resizeMode: T["resizeMode"] | "long-edge";
  longEdge: number;
  cropAspect: T["cropAspect"];
};

// Quality is stored as a 0.5–1 fraction (the batch slider's 0.01 step) and
// shown as whole percent in controls, so a row entry maps back to that step.
export const IMAGE_QUALITY_MIN_PERCENT = 50;
export const IMAGE_QUALITY_MAX_PERCENT = 100;

export function imageQualityIsValid(percent: number): boolean {
  return (
    Number.isInteger(percent) &&
    percent >= IMAGE_QUALITY_MIN_PERCENT &&
    percent <= IMAGE_QUALITY_MAX_PERCENT
  );
}

/** Only a PNG source in a JPEG/WebP batch needs this choice. */
export function canExportImageAsPng(sourceMime: string, batchFormat: string): boolean {
  return sourceMime === "image/png" && (batchFormat === "jpeg" || batchFormat === "webp");
}

/**
 * The effective settings for one image. With no row format and no PNG flag,
 * the exact batch settings object is returned.
 *
 * A row format replaces the batch format for that image. A PNG result is
 * lossless and has no byte target. A lossy result keeps a target that already
 * belongs to a lossy batch, but a lossy result from a PNG batch clears the
 * batch's stored target so a hidden value cannot become a byte search. The
 * older `pngOverride` flag still becomes lossless PNG when the source is PNG
 * and the batch is JPEG or WebP; an explicit row format takes precedence.
 *
 * A defined long edge replaces the batch resize for one image with an explicit
 * long edge, including when the batch uses exact dimensions or a maximum. An
 * invalid number is passed through unchanged so the existing whole-number long
 * edge check reports it.
 *
 * A defined crop aspect replaces the batch crop for one image. A defined crop
 * position replaces the batch position only when that effective aspect is not
 * Original; otherwise the batch anchor is left untouched, so the row keeps its
 * stored choice for a later crop without changing an uncropped result.
 *
 * A defined quality percent replaces the batch quality only for a lossy row
 * with no byte target; PNG (lossless) and target searches keep the batch value.
 * An out-of-range entry is ignored until the row control reports and clears it.
 */
export function settingsForImage<T extends BatchExportSettings>(
  settings: T,
  sourceMime: string,
  pngOverride: boolean,
  longEdgeOverride?: number,
  cropAspectOverride?: T["cropAspect"],
  cropAnchorOverride?: T["cropAnchor"],
  qualityOverride?: number,
  formatOverride?: ExportFormat,
): EffectiveSettings<T> {
  let effective: EffectiveSettings<T> = settings;
  if (longEdgeOverride !== undefined) {
    effective = { ...effective, resizeMode: "long-edge", longEdge: longEdgeOverride };
  }
  if (cropAspectOverride !== undefined) {
    effective = { ...effective, cropAspect: cropAspectOverride };
  }
  if (cropAnchorOverride !== undefined && effective.cropAspect !== "original") {
    effective = { ...effective, cropAnchor: cropAnchorOverride };
  }
  const applyQuality = (candidate: EffectiveSettings<T>): EffectiveSettings<T> =>
    qualityOverride !== undefined &&
    imageQualityIsValid(qualityOverride) &&
    candidate.format !== "png" &&
    candidate.targetKiB === null
      ? { ...candidate, quality: qualityOverride / 100 }
      : candidate;
  const requestedFormat =
    formatOverride === "png" || formatOverride === "jpeg" || formatOverride === "webp"
      ? formatOverride
      : undefined;
  const format = requestedFormat ??
    (pngOverride && canExportImageAsPng(sourceMime, settings.format) ? "png" : undefined);
  if (format === undefined) {
    return applyQuality(effective);
  }
  return applyQuality({
    ...effective,
    format,
    targetKiB: format === "png" || settings.format === "png" ? null : effective.targetKiB,
  });
}
