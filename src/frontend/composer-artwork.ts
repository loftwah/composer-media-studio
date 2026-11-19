import { MAX_IMAGE_INPUT_BYTES } from "./image-limits.ts";

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
