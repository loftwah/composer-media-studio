// MIT. The public Watch page is the stable public record. Its own fixed
// `/media` attachment is the only source the signed-out clip tool may load,
// and only after the visitor explicitly asks. Every limit here is a clip tool
// intake limit, so the handoff can reuse that exact validation rather than
// opening a second, looser path into the editor.
export const MAX_PUBLIC_VIDEO_BYTES = 128 * 1024 * 1024;
export const MAX_PUBLIC_VIDEO_SOURCE_SECONDS = 180;
// Add Music accepts a shorter source than Clip. The Watch page applies the same
// duration gate as Clip with this smaller maximum; a legacy publication with no
// stored duration still offers the handoff, and the editor decodes the exact
// bytes to enforce this limit before any export.
export const MAX_PUBLIC_ADD_MUSIC_SECONDS = 60;
// A stalled public media response must not pin a tool tab.
export const PUBLIC_VIDEO_TIMEOUT_MS = 20_000;

const PUBLIC_VIDEO_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PUBLIC_VIDEO_HASH = /^#public-video=([A-Za-z0-9_-]{1,128})$/;
const VIDEO_MP4 = "video/mp4";

export interface PublicVideoSource {
  /** The canonical public page, for the visitor-facing source link. */
  page: string;
  /** The publication's one fixed media attachment: the only fetchable path. */
  media: string;
}

/**
 * The whole fragment must be the handoff. A second source, a parameter or a
 * lookalike path is refused rather than silently reduced to a publication ID.
 */
export function publicVideoFromHash(hash: string): PublicVideoSource | null {
  const match = PUBLIC_VIDEO_HASH.exec(hash);
  if (!match || match[0] !== hash) return null;
  const page = `/p/${match[1]}`;
  return { page, media: `${page}/media` };
}

// Both local tools read the exact same whole-fragment publication ID. Only the
// route differs, so each tool reuses the one hash parser and the one bounded
// read without a second, looser handoff format.
function publishedToolUrl(tool: "video-clip" | "add-music", slug: string): string | null {
  return PUBLIC_VIDEO_ID.exec(slug)?.[0] === slug
    ? `/tools/${tool}#public-video=${slug}`
    : null;
}

export function publishedVideoToolUrl(slug: string): string | null {
  return publishedToolUrl("video-clip", slug);
}

type PublicVideoMetadata = {
  kind: unknown;
  mime: unknown;
  media: unknown;
  slug: unknown;
  bytes: unknown;
  durationMs: unknown;
};

/**
 * Public size bounds the deliberate download. Both tools share one stored-
 * duration gate with their own maximum. A known duration must be a positive
 * safe integer inside that limit; absent/zero duration is left for the editor
 * to decode from the exact bytes after the visitor explicitly acts.
 */
function publicVideoToolUrl({
  kind, mime, media, slug, bytes, durationMs,
}: PublicVideoMetadata, maxSeconds: number, tool: "video-clip" | "add-music"): string | null {
  if (kind !== "video" || mime !== VIDEO_MP4) return null;
  if (typeof slug !== "string" || !PUBLIC_VIDEO_ID.test(slug)) return null;
  if (media !== `/p/${slug}/media`) return null;
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0 || (bytes as number) > MAX_PUBLIC_VIDEO_BYTES) return null;
  if (durationMs != null && durationMs !== 0 && (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 || durationMs > maxSeconds * 1000)) return null;
  return publishedToolUrl(tool, slug);
}

export function publicVideoClipUrl(meta: PublicVideoMetadata): string | null {
  return publicVideoToolUrl(meta, MAX_PUBLIC_VIDEO_SOURCE_SECONDS, "video-clip");
}

export function publicVideoAddMusicUrl(meta: PublicVideoMetadata): string | null {
  return publicVideoToolUrl(meta, MAX_PUBLIC_ADD_MUSIC_SECONDS, "add-music");
}

/**
 * A public response can only enter the existing picker intake as a real MP4
 * File. Return the reason when it cannot, instead of loosening that intake or
 * buffering unbounded bytes first.
 */
export function publicVideoRefusal({
  ok, type, bytes,
}: { ok: boolean; type: string | null; bytes: number | null }): string | null {
  if (!ok) return "This published video is unavailable. Download it from its page instead.";
  if (type !== VIDEO_MP4) return "This published video is not a supported MP4.";
  if (bytes !== null && (!Number.isFinite(bytes) || bytes > MAX_PUBLIC_VIDEO_BYTES))
    return "This published video exceeds the 128 MB local input limit.";
  return null;
}

/**
 * A published film enters either editor as an ordinary File, so it takes the
 * exact same validated picker intake. Only this publication's fixed `/media`
 * path is accepted, the request stays same-origin and credential-free, and the
 * body is read in bounded chunks so no unbounded native Buffer is built. Clip
 * and Add Music share this one bounded read; neither fetches before activation.
 */
export async function fetchPublicVideo(
  source: PublicVideoSource,
  signal: AbortSignal,
): Promise<{ file: File } | { reason: string }> {
  const response = await fetch(source.media, {
    mode: "same-origin",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  const declared = response.headers.get("content-length");
  const refusal = publicVideoRefusal({
    ok: response.ok,
    type: response.headers.get("content-type"),
    bytes: declared === null ? null : Number(declared),
  });
  if (refusal || !response.body) {
    await response.body?.cancel();
    return { reason: refusal ?? "This published video could not be read." };
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PUBLIC_VIDEO_BYTES)
        return { reason: "This published video exceeds the 128 MB local input limit." };
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const slug = source.page.slice("/p/".length);
  return { file: new File(chunks, `${slug}.mp4`, { type: VIDEO_MP4 }) };
}
