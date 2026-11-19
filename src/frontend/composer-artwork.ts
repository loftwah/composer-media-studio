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

export async function fetchComposerArtwork(ref: ComposerArtworkRef, signal: AbortSignal): Promise<File> {
  const response = await fetch(composerArtworkDownloadUrl(ref), {
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 409) throw new Error("This artwork changed. Reopen it in Composer and try again.");
    if (response.status === 404) throw new Error("This artwork is no longer available from Composer.");
    throw new Error("Could not download the artwork. Try again or download it from Composer.");
  }

  const type = response.headers.get("content-type") ?? "";
  const extension = EXTENSIONS.get(type);
  if (!extension || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Composer artwork must be a JPEG, PNG or WebP image.");
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_INPUT_BYTES)
      throw new Error("This Composer artwork exceeds the image size limit.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_INPUT_BYTES) throw new Error("This Composer artwork exceeds the image size limit.");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new File(chunks, `${ref.assetId}.${extension}`, { type });
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
      sha256: sourceHash,
    }, null, 2)),
  };
}
