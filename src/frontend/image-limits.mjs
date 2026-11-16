// MIT. Local-image limits shared by the browser workbench and its tests.
// These are product limits, not a claim about what every device can decode.

export const MAX_IMAGE_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 40_000_000;
export const MAX_SOURCE_DIMENSION = 16384;
export const MAX_IMAGE_OUTPUT_DIMENSION = 8192;
export const MAX_IMAGE_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_BATCH_IMAGES = 20;
export const MAX_ZIP_ENTRIES = MAX_BATCH_IMAGES;
export const MAX_ZIP_BYTES = 128 * 1024 * 1024;

export const ACCEPTED_IMAGE_MIMES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIMES.join(",");

const ACTIVE_EXTENSION = /\.(?:svgz?|html?|xhtml|xml|js|mjs|wasm)$/i;
const HEIF_EXTENSION = /\.(?:heic|heif)$/i;
const AVIF_EXTENSION = /\.avif$/i;
const ACCEPTED_EXTENSION = new Set(["jpg", "jpeg", "png", "webp"]);

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

function labelFor(mime) {
  if (mime === "image/gif") return "GIF";
  if (mime === "image/avif") return "AVIF";
  if (mime === "image/heic") return "HEIC";
  if (mime === "image/heif") return "HEIF";
  if (mime === "image/bmp") return "BMP";
  if (mime === "image/tiff") return "TIFF";
  return mime || "that file";
}

/** Validate the browser's declared file facts before any bytes are read. */
export function imageInputProblem({ name = "", type = "", size = 0 } = {}) {
  if (!Number.isFinite(size) || size <= 0) return "That file is empty.";
  if (size > MAX_IMAGE_INPUT_BYTES)
    return `Keep image files at or below ${MAX_IMAGE_INPUT_BYTES / 1024 / 1024} MiB.`;
  if (ACTIVE_EXTENSION.test(name))
    return "SVG, HTML and other active content are not opened here. Use a JPEG, PNG or WebP image.";
  const mime = String(type ?? "").trim().toLowerCase();
  if (mime === "image/svg+xml" || mime === "text/html" || mime === "application/xhtml+xml")
    return "SVG, HTML and other active content are not opened here. Use a JPEG, PNG or WebP image.";
  if (mime === "image/heic" || mime === "image/heif" || HEIF_EXTENSION.test(name))
    return "HEIC and HEIF are not decoded in this slice. Export a JPEG, PNG or WebP from your device first.";
  if (mime === "image/avif" || AVIF_EXTENSION.test(name))
    return "AVIF is not enabled in this slice. Use a JPEG, PNG or WebP image.";
  if (mime === "image/jpg") return null;
  if (mime && mime !== "application/octet-stream" && !ACCEPTED_IMAGE_MIMES.includes(mime))
    return `This slice accepts JPEG, PNG and WebP images, not ${labelFor(mime)}.`;
  if (!mime) {
    const extension = extensionOf(name);
    if (extension && !ACCEPTED_EXTENSION.has(extension))
      return `This slice accepts JPEG, PNG and WebP images, not .${extension}.`;
  }
  return null;
}

/** A decoded-pixel and dimension check for untrusted image headers. */
export function imagePixelProblem(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return "The image dimensions could not be read. Try a standard JPEG, PNG or WebP.";
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION)
    return `Keep each side at or below ${MAX_SOURCE_DIMENSION} px in this slice.`;
  if (width * height > MAX_DECODED_PIXELS)
    return `Decoded images must stay at or below ${MAX_DECODED_PIXELS / 1_000_000} megapixels.`;
  return null;
}

export function batchCountProblem(count) {
  if (!Number.isSafeInteger(count) || count < 1) return "Choose at least one image.";
  if (count > MAX_BATCH_IMAGES) return `Process at most ${MAX_BATCH_IMAGES} images in one batch.`;
  return null;
}
