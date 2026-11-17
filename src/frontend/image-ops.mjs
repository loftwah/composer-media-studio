// MIT. Pure geometry for the signed-out image workbench. The browser uses the
// same plan it tests here, so a crop and output size are decided before canvas.

import {
  MAX_DECODED_PIXELS,
  MAX_IMAGE_OUTPUT_BYTES,
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

/** Where the aspect crop is taken from, so a face or subject is not cut off. */
export const CROP_ANCHOR_LABELS = Object.freeze({
  centre: "Centre",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
  topLeft: "Top left",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
});

const CROP_ANCHOR_WORDS = Object.freeze({
  centre: "centre",
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
  topLeft: "top-left",
  topRight: "top-right",
  bottomLeft: "bottom-left",
  bottomRight: "bottom-right",
});

export function isCropAnchor(value) {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CROP_ANCHOR_LABELS, value)
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export const MAX_STRAIGHTEN_DEGREES = 45;
/** A one-pixel safety inset keeps antialiased rotated edges out of the export. */
export const STRAIGHTEN_INSET_PX = 1;

/**
 * A usable straighten angle in degrees, rounded to 0.1°. Positive turns
 * clockwise. `null` means the value cannot be used; 0 means no straightening.
 */
export function normaliseStraighten(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_STRAIGHTEN_DEGREES) return null;
  const rounded = Math.round(value * 10) / 10;
  return Math.abs(rounded) < 0.1 ? 0 : rounded;
}

/**
 * The largest centred, axis-aligned rectangle with the requested aspect that
 * fits inside a `width × height` image turned by `degrees`, inset by one pixel
 * so a rotated antialiased edge never becomes part of the export. Returns the
 * rectangle in the rotated bounding box as well as the bounding box itself, so
 * the renderer and the visible keep overlay use the same numbers.
 */
export function straightenGeometry(
  width,
  height,
  degrees,
  aspect = null,
  inset = STRAIGHTEN_INSET_PX,
) {
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  const angle = normaliseStraighten(degrees);
  if (angle === null || angle === 0) return null;
  const ratio = aspect === null || aspect === undefined ? width / height : aspect;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (!Number.isFinite(inset) || inset < 0) return null;
  const radians = (Math.abs(angle) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const availableWidth = width - 2 * inset;
  const availableHeight = height - 2 * inset;
  if (availableWidth < 1 || availableHeight < 1) return null;
  const half = Math.min(
    availableWidth / (2 * (ratio * cos + sin)),
    availableHeight / (2 * (ratio * sin + cos)),
  );
  if (!Number.isFinite(half) || half < 0.5) return null;
  const cropWidth = Math.max(
    1,
    Math.min(Math.floor(availableWidth), Math.floor(2 * ratio * half)),
  );
  const cropHeight = Math.max(
    1,
    Math.min(Math.floor(availableHeight), Math.floor(2 * half)),
  );
  const boundingWidth = Math.max(1, Math.ceil(width * cos + height * sin));
  const boundingHeight = Math.max(1, Math.ceil(width * sin + height * cos));
  return {
    angle,
    radians,
    cos,
    sin,
    width: cropWidth,
    height: cropHeight,
    boundingWidth,
    boundingHeight,
    crop: {
      x: Math.max(0, Math.floor((boundingWidth - cropWidth) / 2)),
      y: Math.max(0, Math.floor((boundingHeight - cropHeight) / 2)),
      width: cropWidth,
      height: cropHeight,
    },
  };
}

/** canvas dimensions after a clockwise quarter-turn count. */
export function rotatedDimensions(width, height, rotate = 0) {
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  if (!Number.isInteger(rotate) || rotate < 0 || rotate > 3) return null;
  return rotate % 2 === 1 ? { width: height, height: width } : { width, height };
}

/**
 * The largest rectangle with the requested aspect ratio, positioned by anchor.
 * Rounded dimensions are clamped to the source and never leave a zero side.
 */
export function anchoredCrop(width, height, aspect = null, anchor = "centre") {
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  if (!isCropAnchor(anchor)) return null;
  if (aspect === null || aspect === undefined) return { x: 0, y: 0, width, height };
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  let cropWidth = width;
  let cropHeight = height;
  if (width / height > aspect) {
    cropWidth = Math.min(width, Math.max(1, Math.round(height * aspect)));
  } else {
    cropHeight = Math.min(height, Math.max(1, Math.round(width / aspect)));
  }
  const word = anchor.toLowerCase();
  const horizontal = word.includes("left") ? "left" : word.includes("right") ? "right" : "centre";
  const vertical = word.includes("top") ? "top" : word.includes("bottom") ? "bottom" : "centre";
  const freeX = width - cropWidth;
  const freeY = height - cropHeight;
  return {
    x: horizontal === "left" ? 0 : horizontal === "right" ? freeX : Math.floor(freeX / 2),
    y: vertical === "top" ? 0 : vertical === "bottom" ? freeY : Math.floor(freeY / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/** The centred rectangle, kept as the documented default behaviour. */
export function centredCrop(width, height, aspect = null) {
  return anchoredCrop(width, height, aspect, "centre");
}

function cropWithin(rect, aspect = null, anchor = "centre") {
  if (aspect === null || aspect === undefined) return { ...rect };
  const inner = anchoredCrop(rect.width, rect.height, aspect, anchor);
  if (!inner) return null;
  return {
    x: rect.x + inner.x,
    y: rect.y + inner.y,
    width: inner.width,
    height: inner.height,
  };
}

function validCropRect(rect) {
  return (
    rect &&
    Number.isSafeInteger(rect.x) &&
    Number.isSafeInteger(rect.y) &&
    positiveInteger(rect.width) &&
    positiveInteger(rect.height)
  );
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
 *   { mode: "long-edge", longEdge, shrinkOnly? }
 *   { mode: "exact", width, height }
 * `cropAspect` is a positive aspect ratio, or null for no crop.
 * `cropAnchor` positions that crop when it is smaller than the source.
 * `cropRect` is an optional exact region in rotated space (used by trim);
 * the aspect crop, when requested, is then taken inside that region.
 * `straighten` turns the picture by that many degrees (positive clockwise) and
 * keeps the largest fully-covered area, so no empty corner reaches the export.
 */
export function planImageTransform({
  sourceWidth,
  sourceHeight,
  rotate = 0,
  flipH = false,
  flipV = false,
  straighten = 0,
  cropAspect = null,
  cropAnchor = "centre",
  cropRect = null,
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
  if (!isCropAnchor(cropAnchor))
    return { ok: false, error: "Choose a crop anchor from the list." };
  const angle = normaliseStraighten(straighten);
  if (angle === null)
    return {
      ok: false,
      error: `Straighten must be a number between -${MAX_STRAIGHTEN_DEGREES} and ${MAX_STRAIGHTEN_DEGREES} degrees.`,
    };
  if (angle !== 0 && cropRect !== null)
    return {
      ok: false,
      error: "Set straighten to 0° before trimming; trim and straighten cannot be combined.",
    };
  const rotated = rotatedDimensions(sourceWidth, sourceHeight, rotate);
  if (!rotated) return { ok: false, error: "The rotated dimensions are not usable." };
  if (cropRect !== null) {
    if (!validCropRect(cropRect))
      return { ok: false, error: "The trim rectangle is not usable." };
    if (
      cropRect.x < 0 ||
      cropRect.y < 0 ||
      cropRect.x + cropRect.width > rotated.width ||
      cropRect.y + cropRect.height > rotated.height
    )
      return { ok: false, error: "The trim rectangle does not fit inside the image." };
  }
  const straightened =
    angle === 0
      ? null
      : straightenGeometry(rotated.width, rotated.height, angle, cropAspect);
  if (angle !== 0 && !straightened)
    return {
      ok: false,
      error: "This angle leaves no fully-covered area at this size. Lower the angle or the crop aspect.",
    };
  const stage = straightened
    ? { width: straightened.width, height: straightened.height }
    : rotated;
  const crop = cropRect
    ? cropWithin(cropRect, cropAspect, cropAnchor)
    : anchoredCrop(stage.width, stage.height, cropAspect, cropAnchor);
  if (!crop)
    return { ok: false, error: "The crop aspect or source dimensions are invalid." };
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > stage.width ||
    crop.y + crop.height > stage.height
  )
    return { ok: false, error: "The crop does not fit inside the source." };

  let output;
  if (resize?.mode === "long-edge") {
    if (!positiveInteger(resize.longEdge))
      return { ok: false, error: "Choose a whole-number long edge." };
    if (resize.longEdge > maxDimension)
      return { ok: false, error: `Keep the output at or below ${maxDimension} px per side.` };
    const longEdge = resize.shrinkOnly
      ? Math.min(resize.longEdge, Math.max(crop.width, crop.height))
      : resize.longEdge;
    output = scaleToLongEdge(crop.width, crop.height, longEdge);
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
    straighten: straightened
      ? {
          angle: straightened.angle,
          boundingWidth: straightened.boundingWidth,
          boundingHeight: straightened.boundingHeight,
          width: straightened.width,
          height: straightened.height,
          offset: { x: straightened.crop.x, y: straightened.crop.y },
        }
      : null,
    crop,
    outputWidth: output.width,
    outputHeight: output.height,
    scaleX,
    scaleY,
    aspectDistorted:
      Math.abs(output.width / output.height - crop.width / crop.height) /
        (crop.width / crop.height) >
      0.005,
    upscaled: output.width > crop.width || output.height > crop.height,
  };
}

/**
 * Map a point in the transformed stage back to the displayed (EXIF-oriented)
 * source image, undoing straightening, flips and quarter turns in that order.
 */
function sourcePointForStage(plan, point) {
  let x = point.x;
  let y = point.y;
  if (plan.straighten) {
    const { angle, boundingWidth, boundingHeight, offset } = plan.straighten;
    const radians = (Math.abs(angle) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const boxX = x + offset.x - boundingWidth / 2;
    const boxY = y + offset.y - boundingHeight / 2;
    x = boxX * cos + boxY * sin + plan.rotatedWidth / 2;
    y = -boxX * sin + boxY * cos + plan.rotatedHeight / 2;
  }
  if (plan.flipH) x = plan.rotatedWidth - x;
  if (plan.flipV) y = plan.rotatedHeight - y;
  if (plan.rotate === 1) return { x: y, y: plan.rotatedWidth - x };
  if (plan.rotate === 2)
    return { x: plan.rotatedWidth - x, y: plan.rotatedHeight - y };
  if (plan.rotate === 3) return { x: plan.rotatedHeight - y, y: x };
  return { x, y };
}

/**
 * The kept crop as a quadrilateral in displayed-source coordinates, for the
 * visible overlay. `area` is in source pixels and matches the crop area, so a
 * zero-area or malformed plan cannot be presented as a real selection.
 */
export function keptAreaPolygon(plan) {
  if (!plan || plan.ok !== true) return null;
  const crop = plan.crop;
  if (!validCropRect(crop)) return null;
  if (!positiveInteger(plan.sourceWidth) || !positiveInteger(plan.sourceHeight)) return null;
  const corners = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    { x: crop.x, y: crop.y + crop.height },
  ].map((point) => {
    const source = sourcePointForStage(plan, point);
    return {
      x: Math.round(source.x * 1000) / 1000,
      y: Math.round(source.y * 1000) / 1000,
    };
  });
  const area = Math.abs(
    corners.reduce((sum, point, index) => {
      const next = corners[(index + 1) % corners.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  if (!Number.isFinite(area) || area <= 0) return null;
  return { points: corners, area };
}

export const DEFAULT_RESIZE_LONG_EDGE = 2048;

export function defaultLongEdge(width, height) {
  if (!positiveInteger(width) || !positiveInteger(height)) return DEFAULT_RESIZE_LONG_EDGE;
  return Math.max(1, Math.min(DEFAULT_RESIZE_LONG_EDGE, Math.max(width, height)));
}

export const TARGET_QUALITY_MIN = 0.35;
export const TARGET_QUALITY_MAX = 0.98;
export const TARGET_SEARCH_ATTEMPTS = 7;
export const MIN_TARGET_BYTES = 1024;

/**
 * A byte target is only an instruction for a lossy encoder. PNG is honest about
 * not having one, and the bounds match the export path.
 */
export function targetSizeProblem(format, targetBytes) {
  if (targetBytes === null || targetBytes === undefined) return null;
  if (format === "png")
    return "PNG is lossless, so a byte target cannot be guaranteed. Lower the output width and height, or choose JPEG or WebP.";
  if (!Number.isSafeInteger(targetBytes) || targetBytes < MIN_TARGET_BYTES)
    return `Choose a target of at least ${MIN_TARGET_BYTES / 1024} KiB.`;
  if (targetBytes > MAX_IMAGE_OUTPUT_BYTES)
    return `The target must stay at or below ${MAX_IMAGE_OUTPUT_BYTES / 1024 / 1024} MiB.`;
  return null;
}

function roundQuality(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Find the highest tested encoder quality whose real bytes meet the target.
 *
 * `encode(quality)` must resolve to a Blob with a measured `size`. The search
 * is deterministic and bounded: it tries the maximum, then the minimum, then a
 * binary search for at most `attempts` encodes. `met` is always read from the
 * returned bytes; an unmet target is returned with the smallest real result,
 * never as success.
 */
export async function searchTargetQuality({
  targetBytes,
  encode,
  minQuality = TARGET_QUALITY_MIN,
  maxQuality = TARGET_QUALITY_MAX,
  attempts = TARGET_SEARCH_ATTEMPTS,
} = {}) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < MIN_TARGET_BYTES)
    return { ok: false, error: `Choose a target of at least ${MIN_TARGET_BYTES / 1024} KiB.` };
  if (typeof encode !== "function")
    return { ok: false, error: "This browser cannot encode a target-sized result." };
  if (
    !Number.isFinite(minQuality) ||
    !Number.isFinite(maxQuality) ||
    minQuality < 0 ||
    maxQuality > 1 ||
    minQuality >= maxQuality
  )
    return { ok: false, error: "The quality range is invalid." };
  if (!Number.isSafeInteger(attempts) || attempts < 2 || attempts > 12)
    return { ok: false, error: "The quality search must run between 2 and 12 attempts." };

  let used = 0;
  async function attempt(quality) {
    const rounded = roundQuality(quality);
    const blob = await encode(rounded);
    used += 1;
    if (!blob || !Number.isFinite(blob.size) || blob.size < 1)
      throw new Error("The encoder returned no measurable image bytes.");
    return { quality: rounded, bytes: blob.size, blob };
  }

  try {
    const highest = await attempt(maxQuality);
    if (highest.bytes <= targetBytes)
      return { ok: true, met: true, ...highest, attempts: used, targetBytes };

    const lowest = await attempt(minQuality);
    if (lowest.bytes > targetBytes)
      return {
        ok: true,
        met: false,
        ...lowest,
        attempts: used,
        targetBytes,
        overBy: lowest.bytes - targetBytes,
      };

    let best = lowest;
    let low = minQuality;
    let high = maxQuality;
    while (used < attempts) {
      const quality = roundQuality((low + high) / 2);
      if (quality <= low || quality >= high) break;
      const candidate = await attempt(quality);
      if (candidate.bytes <= targetBytes) {
        best = candidate;
        low = quality;
      } else {
        high = quality;
      }
    }
    return {
      ok: true,
      met: true,
      ...best,
      attempts: used,
      targetBytes,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "This browser could not encode a target-sized result.",
    };
  }
}

/** Canvas sampling settings for the chosen resampler. */
export function imageSmoothingFor(resample = "smooth") {
  return resample === "nearest"
    ? { enabled: false, quality: "low" }
    : { enabled: true, quality: "high" };
}

function cropAspectLabel(cropAspect) {
  if (typeof cropAspect === "string") return CROP_ASPECT_LABELS[cropAspect] ?? "aspect";
  const match = Object.entries(CROP_ASPECTS).find(([, value]) => value === cropAspect);
  return match ? CROP_ASPECT_LABELS[match[0]] : "aspect";
}

/** A deterministic caption fragment for an explicit Studio import. */
export function describeTransform({
  rotate = 0,
  flipH = false,
  flipV = false,
  straighten = 0,
  cropAspect = null,
  cropAnchor = "centre",
  trimmed = false,
  resize = null,
  resample = "smooth",
  adjustments = "",
  format = "png",
  quality = null,
  metadata = "re-encoded",
} = {}) {
  const parts = [];
  if (rotate) parts.push(`rotate ${rotate * 90}°`);
  if (flipH) parts.push("flip horizontal");
  if (flipV) parts.push("flip vertical");
  if (
    typeof straighten === "number" &&
    Number.isFinite(straighten) &&
    Math.abs(straighten) >= 0.05
  )
    parts.push(
      `straighten ${Math.abs(straighten).toFixed(1)}° ${straighten > 0 ? "clockwise" : "anticlockwise"}`,
    );
  if (cropAspect)
    parts.push(
      `${CROP_ANCHOR_WORDS[cropAnchor] ?? "centre"} crop ${cropAspectLabel(cropAspect)}`,
    );
  if (trimmed) parts.push("trim transparent edges");
  if (resample === "nearest") parts.push("nearest-neighbour");
  if (adjustments) parts.push(adjustments);
  if (resize?.mode === "long-edge") parts.push(`${resize.shrinkOnly ? "maximum long edge" : "long edge"} ${resize.longEdge}px`);
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
