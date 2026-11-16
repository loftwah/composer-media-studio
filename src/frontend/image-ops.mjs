// MIT. Pure geometry for the signed-out image workbench. The browser uses the
// same plan it tests here, so a crop and output size are decided before canvas.

import {
  MAX_DECODED_PIXELS,
  MAX_IMAGE_OUTPUT_DIMENSION,
} from "./image-limits.mjs";

export const CROP_ASPECTS = Object.freeze({
  original: null,
  square: 1,
  portrait: 4 / 5,
  portraitTall: 2 / 3,
  landscape: 5 / 4,
  wide: 16 / 9,
  tall: 9 / 16,
  photo: 3 / 2,
});

export const CROP_ASPECT_LABELS = Object.freeze({
  original: "Original aspect",
  square: "1:1 square",
  portrait: "4:5 portrait",
  portraitTall: "2:3 portrait",
  landscape: "5:4 landscape",
  wide: "16:9 wide",
  tall: "9:16 tall",
  photo: "3:2 photo",
});

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/** canvas dimensions after a clockwise quarter-turn count. */
export function rotatedDimensions(width, height, rotate = 0) {
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  if (!Number.isInteger(rotate) || rotate < 0 || rotate > 3) return null;
  return rotate % 2 === 1 ? { width: height, height: width } : { width, height };
}

/**
 * The largest centred rectangle with the requested aspect ratio.
 * Rounded dimensions are clamped to the source and never leave a zero side.
 */
export function centredCrop(width, height, aspect = null) {
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  if (aspect === null || aspect === undefined) return { x: 0, y: 0, width, height };
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  let cropWidth = width;
  let cropHeight = height;
  if (width / height > aspect) {
    cropWidth = Math.min(width, Math.max(1, Math.round(height * aspect)));
  } else {
    cropHeight = Math.min(height, Math.max(1, Math.round(width / aspect)));
  }
  return {
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

function scaleToLongEdge(cropWidth, cropHeight, longEdge) {
  if (cropWidth >= cropHeight) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round((cropHeight * longEdge) / cropWidth)),
    };
  }
  return {
    width: Math.max(1, Math.round((cropWidth * longEdge) / cropHeight)),
    height: longEdge,
  };
}

/**
 * Plan one local transform. `resize` is either:
 *   { mode: "long-edge", longEdge }
 *   { mode: "exact", width, height }
 * `cropAspect` is a positive aspect ratio, or null for no crop.
 */
export function planImageTransform({
  sourceWidth,
  sourceHeight,
  rotate = 0,
  flipH = false,
  flipV = false,
  cropAspect = null,
  resize = { mode: "long-edge", longEdge: 2048 },
  maxPixels = MAX_DECODED_PIXELS,
  maxDimension = MAX_IMAGE_OUTPUT_DIMENSION,
} = {}) {
  if (!positiveInteger(sourceWidth) || !positiveInteger(sourceHeight))
    return { ok: false, error: "The source dimensions are not usable." };
  if (!Number.isInteger(rotate) || rotate < 0 || rotate > 3)
    return { ok: false, error: "Rotation must be a quarter turn between 0 and 3." };
  if (typeof flipH !== "boolean" || typeof flipV !== "boolean")
    return { ok: false, error: "Flip settings are invalid." };
  const rotated = rotatedDimensions(sourceWidth, sourceHeight, rotate);
  if (!rotated) return { ok: false, error: "The rotated dimensions are not usable." };
  const crop = centredCrop(rotated.width, rotated.height, cropAspect);
  if (!crop)
    return { ok: false, error: "The crop aspect or source dimensions are invalid." };
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > rotated.width ||
    crop.y + crop.height > rotated.height
  )
    return { ok: false, error: "The crop does not fit inside the source." };

  let output;
  if (resize?.mode === "long-edge") {
    if (!positiveInteger(resize.longEdge))
      return { ok: false, error: "Choose a whole-number long edge." };
    if (resize.longEdge > maxDimension)
      return { ok: false, error: `Keep the output at or below ${maxDimension} px per side.` };
    output = scaleToLongEdge(crop.width, crop.height, resize.longEdge);
  } else if (resize?.mode === "exact") {
    if (!positiveInteger(resize.width) || !positiveInteger(resize.height))
      return { ok: false, error: "Choose whole-number output width and height." };
    if (resize.width > maxDimension || resize.height > maxDimension)
      return { ok: false, error: `Keep the output at or below ${maxDimension} px per side.` };
    output = { width: resize.width, height: resize.height };
  } else {
    return { ok: false, error: "Choose a resize mode." };
  }

  if (output.width < 1 || output.height < 1)
    return { ok: false, error: "The output dimensions are too small." };
  if (output.width * output.height > maxPixels)
    return {
      ok: false,
      error: `Keep the output at or below ${maxPixels / 1_000_000} megapixels.`,
    };

  const scaleX = output.width / crop.width;
  const scaleY = output.height / crop.height;
  return {
    ok: true,
    sourceWidth,
    sourceHeight,
    rotate,
    flipH,
    flipV,
    rotatedWidth: rotated.width,
    rotatedHeight: rotated.height,
    crop,
    outputWidth: output.width,
    outputHeight: output.height,
    scaleX,
    scaleY,
    aspectDistorted: Math.abs(scaleX - scaleY) > 0.0001,
    upscaled: output.width > crop.width || output.height > crop.height,
  };
}

export const DEFAULT_RESIZE_LONG_EDGE = 2048;

export function defaultLongEdge(width, height) {
  if (!positiveInteger(width) || !positiveInteger(height)) return DEFAULT_RESIZE_LONG_EDGE;
  return Math.max(1, Math.min(DEFAULT_RESIZE_LONG_EDGE, Math.max(width, height)));
}

/** A deterministic caption fragment for an explicit Studio import. */
export function describeTransform({
  rotate = 0,
  flipH = false,
  flipV = false,
  cropAspect = null,
  resize = null,
  format = "png",
  quality = null,
  metadata = "re-encoded",
} = {}) {
  const parts = [];
  if (rotate) parts.push(`rotate ${rotate * 90}°`);
  if (flipH) parts.push("flip horizontal");
  if (flipV) parts.push("flip vertical");
  if (cropAspect) parts.push(`centre crop ${CROP_ASPECT_LABELS[cropAspect] ?? "aspect"}`);
  if (resize?.mode === "long-edge") parts.push(`long edge ${resize.longEdge}px`);
  if (resize?.mode === "exact") parts.push(`exact ${resize.width}×${resize.height}px`);
  parts.push(`${String(format).toUpperCase()}${quality !== null && format !== "png" ? ` q${Math.round(quality * 100)}` : ""}`);
  parts.push(metadata);
  return parts.join(", ");
}

/** Filename-safe extension for the output encoder. */
export function extensionForImageMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function mimeForExport(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}
