import { MAX_IMAGE_INPUT_BYTES } from "./image-limits.ts";
import { SOCIAL_POST_LIMITS } from "./image-social-kit.ts";

const COMPOSER = "https://composer.loftwah.com";
export const COMPOSER_ARTWORK_DOWNLOAD_API = `${COMPOSER}/api/share-artwork-download`;

export interface ComposerArtworkRef {
  assetId: string;
  revision: string;
}

const EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function parseComposerArtworkHash(hash: string): ComposerArtworkRef | null {
  const match = /^#composer-artwork=([a-z0-9][a-z0-9-]{0,127})&revision=([a-f0-9]{64})$/.exec(hash);
  return match?.[0] === hash ? { assetId: match[1], revision: match[2] } : null;
}

export function composerArtworkSourceUrl(ref: ComposerArtworkRef): string {
  return `${COMPOSER}/share/artwork/${encodeURIComponent(ref.assetId)}`;
}

export function composerArtworkDownloadUrl(ref: ComposerArtworkRef): string {
  const query = new URLSearchParams({ id: ref.assetId, file: "0", revision: ref.revision });
  return `${COMPOSER_ARTWORK_DOWNLOAD_API}?${query}`;
}

export type ComposerArtworkFailureClass =
  | "changed-source"
  | "unavailable-source"
  | "timeout"
  | "http-refusal"
  | "invalid-image"
  | "cancelled"
  | "superseded"
  | "transport-unknown";

export interface ComposerArtworkLoadErrorOptions {
  category: ComposerArtworkFailureClass;
  status?: number;
  reference?: string | null;
}

export class ComposerArtworkLoadError extends Error {
  readonly category: ComposerArtworkFailureClass;
  readonly status: number | null;
  readonly reference: string | null;

  constructor(message: string, options: ComposerArtworkLoadErrorOptions) {
    super(message);
    this.name = "ComposerArtworkLoadError";
    this.category = options.category;
    this.status = typeof options.status === "number" ? options.status : null;
    this.reference = options.reference ?? null;
  }
}

const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failedDownload(response: Response): ComposerArtworkLoadError {
  const category = response.headers.get("x-composer-artwork-failure");
  const reference = response.headers.get("x-composer-artwork-request");
  const request = reference && REQUEST_UUID.test(reference) ? reference : null;
  const status = response.status;
  const failure = (message: string, failureClass: ComposerArtworkFailureClass) =>
    new ComposerArtworkLoadError(message, { category: failureClass, status, reference: request });
  const retry = "Try again or download the image from the source artwork page.";

  switch (status) {
    case 404:
      return failure("This artwork is no longer available from Composer. Choose another image.", "unavailable-source");
    case 409:
      return failure("This artwork changed. Reopen it in Composer to choose the current image.", "changed-source");
    case 400:
      if (category === "invalid-request")
        return failure("Composer could not read this artwork link. Reopen it in Composer.", "http-refusal");
      break;
    case 503:
      if (category === "catalogue-unavailable")
        return failure(`Composer’s artwork catalogue is temporarily unavailable. ${retry}`, "http-refusal");
      break;
    case 502:
      if (category === "file-unavailable") return failure(`Composer could not fetch the artwork file. ${retry}`, "http-refusal");
      if (category === "file-rejected") return failure(`Composer refused the artwork file. ${retry}`, "http-refusal");
      break;
    case 504:
      if (category === "file-timeout") return failure(`Composer timed out fetching the artwork file. ${retry}`, "timeout");
      break;
  }
  return failure(`Composer could not download the artwork. ${retry}`, "http-refusal");
}

export async function fetchComposerArtwork(ref: ComposerArtworkRef, signal: AbortSignal): Promise<File> {
  let status: number | undefined;
  try {
    const response = await fetch(composerArtworkDownloadUrl(ref), {
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal,
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw failedDownload(response);
    }

    const type = response.headers.get("content-type") ?? "";
    const extension = EXTENSIONS.get(type);
    if (!extension || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new ComposerArtworkLoadError("Composer artwork must be a JPEG, PNG or WebP image. Try the source artwork page.", {
        category: "invalid-image", status: response.status,
      });
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let total = 0;
    const sizeError = () => new ComposerArtworkLoadError("This Composer artwork exceeds the image size limit.", {
      category: "invalid-image", status: response.status,
    });
    try {
      if (Number(response.headers.get("content-length")) > MAX_IMAGE_INPUT_BYTES) throw sizeError();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_INPUT_BYTES) throw sizeError();
        chunks.push(new Uint8Array(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!total) throw new ComposerArtworkLoadError("Composer returned an empty image. Try again or download it from the source artwork page.", {
      category: "invalid-image", status: response.status,
    });
    return new File(chunks, `${ref.assetId}.${extension}`, { type });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ComposerArtworkLoadError) throw error;
    if (error instanceof TypeError)
      throw new ComposerArtworkLoadError("Studio could not reach or finish reading the download. Check your connection and try again, or use the source artwork page.", {
        category: "transport-unknown", status,
      });
    throw new ComposerArtworkLoadError("Studio could not read the Composer download. Try again or use the source artwork page.", {
      category: "transport-unknown", status,
    });
  }
}

const SAFE_ASSET_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_REVISION = /^[a-f0-9]{64}$/;
const SAFE_STUDIO_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/**
 * Bounded, copyable local detail for a failed Composer artwork load. Uses only
 * the typed failure class and the allow-listed public identifiers and values;
 * it never includes the raw error, response body, cookies, tokens, URLs,
 * private record IDs or source bytes. Keep the source-record revision separate
 * from any output byte hash.
 */
export function formatComposerArtworkDiagnostic(
  ref: ComposerArtworkRef,
  error: ComposerArtworkLoadError,
  studioRevision: string,
): string {
  const asset = SAFE_ASSET_ID.test(ref.assetId) ? ref.assetId : "Unavailable";
  const sourceRevision = SAFE_REVISION.test(ref.revision) ? ref.revision : "Unavailable";
  const build = SAFE_STUDIO_REVISION.test(studioRevision) ? studioRevision : "Unavailable";
  const status = error.status !== null && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
    ? String(error.status) : "Unavailable";
  const request = error.reference && REQUEST_UUID.test(error.reference) ? error.reference : "Unavailable";
  return [
    `class=${error.category}`,
    `studio=${build}`,
    `asset=${asset}`,
    `source-revision=${sourceRevision}`,
    `status=${status}`,
    `request=${request}`,
  ].join("\n");
}

const POST_BRIEF_SCHEMA = "app-composer/public-artwork-post";

/** A Composer post brief is read locally only; cap the read well below image limits. */
export const COMPOSER_POST_BRIEF_MAX_BYTES = 16 * 1024;

export type ComposerPostBriefResult =
  | { ok: true; caption: string; altText: string }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a locally chosen v1 Composer post brief against the exact artwork
 * reference already loaded in this workbench. This reads strings only: it never
 * fetches a URL from the brief, publishes anything or infers permission. On any
 * mismatch it returns an actionable reason and no text, so the caller keeps the
 * values already in the editable fields.
 */
export function parseComposerPostBrief(raw: string, ref: ComposerArtworkRef): ComposerPostBriefResult {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > COMPOSER_POST_BRIEF_MAX_BYTES)
    return { ok: false, reason: `That brief is larger than ${COMPOSER_POST_BRIEF_MAX_BYTES / 1024} KiB. Choose the original JSON from Composer.` };
  let brief: unknown;
  try {
    brief = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That file is not valid JSON. Choose the post brief exported by Composer." };
  }
  if (!isPlainObject(brief) || brief.schema !== POST_BRIEF_SCHEMA)
    return { ok: false, reason: "That is not a Composer post brief. Choose the v1 post brief JSON exported by Composer." };
  if (brief.version !== 1)
    return { ok: false, reason: "This brief is from an unsupported version. Export a fresh v1 brief from Composer." };
  if (brief.status !== "draft")
    return { ok: false, reason: "This brief is not a draft. Export a fresh draft brief from Composer." };
  const artwork = brief.artwork;
  if (!isPlainObject(artwork))
    return { ok: false, reason: "The brief is missing its artwork details." };
  if (artwork.reuse !== "unconfirmed")
    return { ok: false, reason: "This brief does not mark the artwork reuse as unconfirmed. Export a fresh draft from Composer." };
  if (artwork.id !== ref.assetId || artwork.revision !== ref.revision)
    return { ok: false, reason: "That brief is for a different artwork or revision. Export a brief for this loaded artwork." };
  if (artwork.canonicalUrl !== composerArtworkSourceUrl(ref) || artwork.downloadUrl !== composerArtworkDownloadUrl(ref))
    return { ok: false, reason: "That brief points to different artwork links. Export a fresh brief for this loaded artwork." };
  const caption = brief.caption;
  const altText = artwork.alt;
  if (typeof caption !== "string" || typeof altText !== "string")
    return { ok: false, reason: "The brief is missing plain caption or alt text." };
  if (caption.length > SOCIAL_POST_LIMITS.caption)
    return { ok: false, reason: `The brief's caption is over ${SOCIAL_POST_LIMITS.caption} characters. Enter a shorter version in Studio.` };
  if (altText.length > SOCIAL_POST_LIMITS.altText)
    return { ok: false, reason: `The brief's alt text is over ${SOCIAL_POST_LIMITS.altText} characters. Enter a shorter version in Studio.` };
  return { ok: true, caption, altText };
}

export function composerArtworkManifestEntry(ref: ComposerArtworkRef, sourceHash: string) {
  return {
    name: "source-manifest.json",
    data: new TextEncoder().encode(JSON.stringify({
      schema: "media-studio/composer-artwork",
      version: 1,
      source: composerArtworkSourceUrl(ref),
      download: composerArtworkDownloadUrl(ref),
      asset: ref.assetId,
      revision: ref.revision,
      reuse: "unconfirmed",
      sha256: sourceHash,
    }, null, 2)),
  };
}
