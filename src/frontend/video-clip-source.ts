// MIT. The public Watch page is the stable public record. Its own fixed
// `/media` attachment is the only source the signed-out clip tool may load,
// and only after the visitor explicitly asks. Every limit here is a clip tool
// intake limit, so the handoff can reuse that exact validation rather than
// opening a second, looser path into the editor.
import { sha256Hex } from "../lib/util.mjs";

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

// A private Studio save is a different, narrower handoff: one exact asset id
// and one exact stored digest. It never accepts a caller-supplied URL.
export const MAX_SAVED_VIDEO_BYTES = 64 * 1024 * 1024;
const SAVED_VIDEO_ID = /^asset_[0-9a-f]{32}$/;
const SAVED_VIDEO_HASH = /^[0-9a-f]{64}$/;
const STUDIO_VIDEO_HASH = /^#studio-video=(asset_[0-9a-f]{32})&sha256=([0-9a-f]{64})$/;
const SAVED_REOPEN = "Reopen the saved video in Studio, then choose it again.";
const SAVED_TOO_LARGE = `This saved video exceeds the 64 MB local input limit. ${SAVED_REOPEN}`;
const SAVED_CHANGED = "The saved video changed since you opened it. Reopen it in Studio and reselect it with the new digest.";

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
 * Both tools stream the exact body in bounded chunks, so neither builds an
 * unbounded native Buffer before the size is proven and neither can be pinned
 * by a response that lies about content-length. This is the one bounded read;
 * the public and private handoffs only supply their own limit and refusal.
 */
async function readBoundedVideo(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  tooLarge: string,
): Promise<{ chunks: BlobPart[] } | { reason: string }> {
  const reader = body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return { reason: tooLarge };
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { chunks };
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
  const read = await readBoundedVideo(
    response.body, MAX_PUBLIC_VIDEO_BYTES,
    "This published video exceeds the 128 MB local input limit.",
  );
  if ("reason" in read) return { reason: read.reason };
  const slug = source.page.slice("/p/".length);
  return { file: new File(read.chunks, `${slug}.mp4`, { type: VIDEO_MP4 }) };
}

/**
 * The Studio viewer offers a saved, private MP4 only when its whole fragment
 * names one known asset and its stored digest. Known size and duration stay
 * inside the clip intake; an absent duration is left for the editor to decode
 * from the exact bytes after the visitor acts, exactly as for a public film.
 */
export function savedVideoClipUrl(asset: {
  id: unknown; sha256: unknown; kind: unknown; mime: unknown; bytes: unknown; durationMs: unknown;
}): string | null {
  if (asset.kind !== "video" || asset.mime !== VIDEO_MP4) return null;
  if (typeof asset.id !== "string" || SAVED_VIDEO_ID.exec(asset.id)?.[0] !== asset.id) return null;
  if (typeof asset.sha256 !== "string" || SAVED_VIDEO_HASH.exec(asset.sha256)?.[0] !== asset.sha256) return null;
  if (!Number.isSafeInteger(asset.bytes) || (asset.bytes as number) <= 0 || (asset.bytes as number) > MAX_SAVED_VIDEO_BYTES) return null;
  if (asset.durationMs != null && asset.durationMs !== 0 && (
    typeof asset.durationMs !== "number" || !Number.isSafeInteger(asset.durationMs) ||
    asset.durationMs <= 0 || asset.durationMs > MAX_PUBLIC_VIDEO_SOURCE_SECONDS * 1000
  )) return null;
  return `/tools/video-clip#studio-video=${asset.id}&sha256=${asset.sha256}`;
}

/** Only the whole two-part fragment resolves, to that asset's one fixed file path. */
export function savedStudioVideoFromHash(hash: string): { id: string; sha256: string; media: string } | null {
  const match = STUDIO_VIDEO_HASH.exec(hash);
  if (!match || match[0] !== hash) return null;
  return { id: match[1], sha256: match[2], media: `/api/assets/${match[1]}/file` };
}

function savedVideoRefusal(response: Response): string | null {
  if (response.status === 401) return "Sign in to Studio, then reopen the saved video.";
  if (response.status === 403) return "Open the saved video from a Studio session with access to its project.";
  if (!response.ok) return `The saved video could not be read. ${SAVED_REOPEN}`;
  if (response.headers.get("content-type") !== VIDEO_MP4)
    return `This saved video is not a supported MP4. ${SAVED_REOPEN}`;
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size > MAX_SAVED_VIDEO_BYTES) return SAVED_TOO_LARGE;
  }
  return null;
}

/**
 * Read the one named private asset with the browser's existing same-origin
 * cookies: no new authorization, endpoint or redirect, no published copy. The
 * exact bytes are hashed before they become an ordinary local picker File, so
 * a changed or stale save is refused instead of silently edited.
 */
export async function fetchSavedStudioVideo(
  source: { id: string; sha256: string; media: string },
  signal: AbortSignal,
): Promise<{ file: File } | { reason: string }> {
  // Rebuild the fixed path from the validated parts; never fetch a caller URL.
  if (typeof source?.id !== "string" || SAVED_VIDEO_ID.exec(source.id)?.[0] !== source.id ||
      typeof source?.sha256 !== "string" || SAVED_VIDEO_HASH.exec(source.sha256)?.[0] !== source.sha256) {
    return { reason: `That saved-video link is not valid. ${SAVED_REOPEN}` };
  }
  let response: Response;
  try {
    response = await fetch(`/api/assets/${source.id}/file`, {
      mode: "same-origin",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
    });
  } catch {
    return { reason: `The saved video could not be reached. ${SAVED_REOPEN}` };
  }
  const refusal = savedVideoRefusal(response);
  if (refusal || !response.body) {
    await response.body?.cancel();
    return { reason: refusal ?? `The saved video could not be read. ${SAVED_REOPEN}` };
  }
  const read = await readBoundedVideo(response.body, MAX_SAVED_VIDEO_BYTES, SAVED_TOO_LARGE);
  if ("reason" in read) return { reason: read.reason };
  const file = new File(read.chunks, "saved-studio-video.mp4", { type: VIDEO_MP4 });
  if (await sha256Hex(new Uint8Array(await file.arrayBuffer())) !== source.sha256) return { reason: SAVED_CHANGED };
  return { file };
}
