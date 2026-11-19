// Crop authority (pinned mediabunny 1.66.0): ConversionVideoOptions.crop is a
// CropRectangle { left, top, width, height } in the track's post-rotation
// display pixel space. Mediabunny clamps it to the track and applies it after
// rotation/flip but before the fit/resize step. A centre anchor needs no crop
// option at all: the existing centred `cover` already produces that result.
export type CropAnchor = "center" | "topLeft" | "bottomRight";
export const CROP_ANCHORS = ["center", "topLeft", "bottomRight"] as const;
export type CropRectangle = Readonly<{ left: number; top: number; width: number; height: number }>;

export function isCropAnchor(value: unknown): value is CropAnchor {
  return typeof value === "string" && (CROP_ANCHORS as readonly string[]).includes(value);
}

/**
 * Largest rectangle with the exact output aspect inside the displayed frame.
 * `display` must already be in post-rotation order. Returns null for centre or
 * for dimensions that cannot bound a real crop, so callers keep the original
 * centred fill rather than passing an unproven crop to the encoder.
 */
export function clipCropRectangle(
  display: { width: number; height: number },
  output: { width: number; height: number },
  anchor: CropAnchor,
): CropRectangle | null {
  if (anchor === "center") return null;
  if (![display.width, display.height, output.width, output.height].every(
    value => Number.isSafeInteger(value) && value > 0)) return null;

  // Crop the longer axis first, keeping the rectangle inside the source.
  let width = display.width;
  let height = Math.floor((width * output.height) / output.width);
  if (height > display.height) {
    height = display.height;
    width = Math.floor((height * output.width) / output.height);
  }
  width = Math.max(1, Math.min(display.width, width));
  height = Math.max(1, Math.min(display.height, height));

  // Top-left keeps the origin; bottom-right hugs the far edges.
  return {
    left: anchor === "bottomRight" ? display.width - width : 0,
    top: anchor === "bottomRight" ? display.height - height : 0,
    width,
    height,
  };
}

/** Native CSS positioning that mirrors the encoder crop in the preview. */
export function cropObjectPosition(anchor: CropAnchor, fit: "cover" | "contain"): string | undefined {
  if (fit !== "cover" || anchor === "center") return undefined;
  return anchor === "bottomRight" ? "100% 100%" : "0% 0%";
}
