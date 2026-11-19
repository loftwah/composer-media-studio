// MIT. The public Watch page is the stable public record. Its own fixed
// `/media` attachment is the only source the signed-out clip tool may load,
// and only after the visitor explicitly asks. Every limit here is a clip tool
// intake limit, so the handoff can reuse that exact validation rather than
// opening a second, looser path into the editor.
export const MAX_PUBLIC_VIDEO_BYTES = 128 * 1024 * 1024;
export const MAX_PUBLIC_VIDEO_SOURCE_SECONDS = 180;
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

export function publishedVideoToolUrl(slug: string): string | null {
  return PUBLIC_VIDEO_ID.exec(slug)?.[0] === slug
    ? `/tools/video-clip#public-video=${slug}`
    : null;
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
 * Public size bounds the deliberate download. The editor checks decoded
 * duration even when a legacy publication has no stored duration.
 */
export function publicVideoClipUrl({
  kind, mime, media, slug, bytes, durationMs,
}: PublicVideoMetadata): string | null {
  if (kind !== "video" || mime !== VIDEO_MP4) return null;
  if (typeof slug !== "string" || !PUBLIC_VIDEO_ID.test(slug)) return null;
  if (media !== `/p/${slug}/media`) return null;
  if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0 || (bytes as number) > MAX_PUBLIC_VIDEO_BYTES) return null;
  if (durationMs != null && (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 || durationMs > MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000)) return null;
  return publishedVideoToolUrl(slug);
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
