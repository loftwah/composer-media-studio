// MIT. A bounded, reversible per-image export choice. The batch keeps its
// normal Settings; a PNG source can opt into a lossless PNG result while the
// batch default stays JPEG or WebP. PNG has no byte target, so an inherited
// target is dropped for that one image. This is not a receipt version change.

export type ExportFormat = "png" | "jpeg" | "webp";

type BatchExportSettings = {
  format: ExportFormat;
  targetKiB: number | null;
};

/** Only a PNG source in a JPEG/WebP batch needs this choice. */
export function canExportImageAsPng(sourceMime: string, batchFormat: string): boolean {
  return sourceMime === "image/png" && (batchFormat === "jpeg" || batchFormat === "webp");
}

/**
 * The effective settings for one image. Unchecked images, non-PNG sources and
 * an already-PNG batch keep the exact batch settings object. A checked PNG in a
 * JPEG/WebP batch becomes lossless PNG with no byte target.
 */
export function settingsForImage<T extends BatchExportSettings>(
  settings: T,
  sourceMime: string,
  pngOverride: boolean,
): Omit<T, "format" | "targetKiB"> & BatchExportSettings {
  if (!pngOverride || !canExportImageAsPng(sourceMime, settings.format)) return settings;
  return { ...settings, format: "png", targetKiB: null };
}
