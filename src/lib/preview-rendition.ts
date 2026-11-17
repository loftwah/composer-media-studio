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

export interface RenderedPreview {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  sha256: string;
}

// Only the Images members this module actually calls are described: no
// Cloudflare types are imported, and every annotation here is erased at runtime.
interface ImagesResult {
  response(): { arrayBuffer(): Promise<ArrayBuffer> };
}
interface ImagesBinding {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width?: number; height?: number }): {
      output(options: { format: string; quality: number }): ImagesResult;
    };
  };
}

export interface PreviewEnv {
  // Owned and used by renderPreview, not by its callers.
  IMAGES: ImagesBinding | null | undefined;
}

export interface RenderPreviewOptions {
  maxEdge?: number;
  quality?: number;
  width?: number;
  height?: number;
}

const asStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });

/** Scale one dimension pair down inside `maxEdge`, never up. */
export function previewDimensions(width: number, height: number, maxEdge: number = MAX_PREVIEW_EDGE) {
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
export async function renderPreview(
  env: PreviewEnv,
  bytes: Uint8Array,
  { maxEdge = MAX_PREVIEW_EDGE, quality = PREVIEW_QUALITY, width, height }: RenderPreviewOptions = {}
): Promise<RenderedPreview> {
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

  let sourceWidth: number | null | undefined = width;
  let sourceHeight: number | null | undefined = height;
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) {
    const measured = imageSize(bytes);
    sourceWidth = measured.width;
    sourceHeight = measured.height;
  }
  const target = previewDimensions(sourceWidth!, sourceHeight!, maxEdge);
  if (!target) throw new HttpError(415, "That still's size could not be read", "unsupported_type");

  // A still that is already inside the target is not worth re-encoding, but it
  // is also not necessarily a WebP: normalise it so one MIME type is cached.
  const transform = target.width >= target.height ? { width: target.width } : { height: target.height };
  let output: ImagesResult;
  try {
    output = await env.IMAGES.input(asStream(bytes))
      .transform(transform)
      .output({ format: "image/webp", quality });
  } catch (cause: any) {
    // Cloudflare answers 9432 on an account with legacy billing; the surface
    // should say what is wrong rather than repeat a binding failure. Keep one
    // bounded line in the log so a released failure can be diagnosed without
    // guessing which binding stage refused.
    console.warn(
      "preview rendition failed",
      cause?.code ?? "-",
      String(cause?.message ?? cause).slice(0, 160),
    );
    throw new HttpError(
      503,
      String(cause?.code) === "9432"
        ? "Cloudflare Images is not available on this account because it is on legacy billing (error 9432)."
        : "The preview could not be rendered from this still.",
      "preview_unavailable",
    );
  }
  const rendered = new Uint8Array(await output.response().arrayBuffer());
  if (!rendered.byteLength)
    throw new HttpError(502, "The preview came back empty. Try again.", "preview_empty");
  const measured = imageSize(rendered);
  const previewWidth = Number.isSafeInteger(measured.width) && measured.width! > 0 ? measured.width! : target.width;
  const previewHeight = Number.isSafeInteger(measured.height) && measured.height! > 0 ? measured.height! : target.height;
  return {
    bytes: rendered,
    mime: PREVIEW_MIME,
    width: previewWidth,
    height: previewHeight,
    sha256: await sha256Hex(rendered),
  };
}
