// MIT. One bounded WebP rendition derived from media this studio already
// stores.
//
// Two different things need a small still and they must not drift apart:
//   * a public page's own chosen poster, so a 3 MB original is not the first
//     thing a phone downloads;
//   * an owner's private library card, so a project grid does not pull every
//     original.
//
// The bytes always come from the Cloudflare Images binding that this Worker
// already has for Darkroom reference fitting. Nothing here writes rows or
// decides who may read the result: the caller owns storage, scope and caching.

import { HttpError, imageSize, sha256Hex, sniffMedia } from "./util.mjs";

/** Long-edge target for a rendition that stands in for a full-size still. */
export const MAX_PREVIEW_EDGE = 1024;
/** Visually near-lossless for a page image at a fraction of the source bytes. */
export const PREVIEW_QUALITY = 80;
export const PREVIEW_MIME = "image/webp";
const PREVIEW_FORMATS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const asStream = (bytes) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });

/** Scale one dimension pair down inside `maxEdge`, never up. */
export function previewDimensions(width, height, maxEdge = MAX_PREVIEW_EDGE) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return null;
  const edge = Number.isSafeInteger(maxEdge) && maxEdge > 0 ? maxEdge : MAX_PREVIEW_EDGE;
  const largest = Math.max(width, height);
  if (largest <= edge) return { width, height };
  const scale = edge / largest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Re-encode `bytes` as a small WebP. `width`/`height` describe the source when
 * the caller already read them from the asset row; otherwise they are read from
 * the bytes themselves.
 *
 * @returns {Promise<{bytes: Uint8Array, mime: string, width: number, height: number, sha256: string}>}
 */
export async function renderPreview(env, bytes, { maxEdge = MAX_PREVIEW_EDGE, quality = PREVIEW_QUALITY, width, height } = {}) {
  if (!bytes?.byteLength) throw new HttpError(400, "There are no image bytes to preview", "invalid");
  const source = sniffMedia(bytes);
  if (source.kind !== "image" || !PREVIEW_FORMATS.has(source.mime))
    throw new HttpError(415, "Only a JPEG, PNG, WebP or GIF still can be previewed", "unsupported_type");
  if (!env?.IMAGES)
    throw new HttpError(
      503,
      "This installation cannot build previews because the Cloudflare Images binding is unavailable.",
      "preview_unavailable",
    );

  let sourceWidth = width;
  let sourceHeight = height;
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) {
    const measured = imageSize(bytes);
    sourceWidth = measured.width;
    sourceHeight = measured.height;
  }
  const target = previewDimensions(sourceWidth, sourceHeight, maxEdge);
  if (!target) throw new HttpError(415, "That still's size could not be read", "unsupported_type");

  // A still that is already inside the target is not worth re-encoding, but it
  // is also not necessarily a WebP: normalise it so one MIME type is cached.
  const transform = target.width >= target.height ? { width: target.width } : { height: target.height };
  let output;
  try {
    output = await env.IMAGES.input(asStream(bytes))
      .transform(transform)
      .output({ format: "image/webp", quality });
  } catch (cause) {
    // Cloudflare answers 9432 on an account with legacy billing; the surface
    // should say what is wrong rather than repeat a binding failure.
    throw new HttpError(
      503,
      cause?.code === 9432
        ? "Cloudflare Images is not available on this account because it is on legacy billing (error 9432)."
        : "The preview could not be rendered from this still.",
      "preview_unavailable",
    );
  }
  const rendered = new Uint8Array(await output.response().arrayBuffer());
  if (!rendered.byteLength)
    throw new HttpError(502, "The preview came back empty. Try again.", "preview_empty");
  const measured = imageSize(rendered);
  const previewWidth = Number.isSafeInteger(measured.width) && measured.width > 0 ? measured.width : target.width;
  const previewHeight = Number.isSafeInteger(measured.height) && measured.height > 0 ? measured.height : target.height;
  return {
    bytes: rendered,
    mime: PREVIEW_MIME,
    width: previewWidth,
    height: previewHeight,
    sha256: await sha256Hex(rendered),
  };
}
