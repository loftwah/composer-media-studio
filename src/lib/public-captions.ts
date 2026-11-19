// MIT. Reviewed captions from Composer's published edition of Take it with you.
export const PUBLIC_CAPTION_ROUTE = "/captions.vtt";

const filmSlug = "PbvQYtyGG-YlF0Dh";
const filmSha256 = "187134b76dc0687d95e263d7b3bb2b7cf6507affb4204e61c2badaeff567d046";
/** The one public Watch path whose clip tool may reuse these captions. */
const filmWatch = `https://media.loftwah.com/p/${filmSlug}`;
/** Composer #915: guarded, versioned HTML + React downloads for this reviewed film. */
export const FILM_EMBED_URL = "https://composer.loftwah.com/widgets#take-it-with-you-film";

/** A cue is words plus a millisecond span; the line setting is added at output. */
type ReviewedCue = Readonly<{ startMs: number; endMs: number; text: string }>;

// The single reviewed source. Both the byte-identical Watch VTT and any trimmed
// clip sidecar are serialised from these cues, so a word or line change happens
// once and is witnessed by both regression tests. A cue's text may hold several
// lines, as the last cue does here.
const reviewedCues: readonly ReviewedCue[] = [
  { startMs: 0, endMs: 600, text: "[A sharp click]" },
  { startMs: 600, endMs: 2050, text: "Bring your AI agent." },
  { startMs: 2050, endMs: 3650, text: "Build an app." },
  { startMs: 3850, endMs: 7700, text: "[Power-up chime]\nTake it with you." },
];

function stamp(ms: number): string {
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

/** Serialise cues to native WebVTT with the reviewed line:12% placement. */
function serializeReviewedCues(cues: readonly ReviewedCue[]): string {
  const blocks = cues.map(cue => `${stamp(cue.startMs)} --> ${stamp(cue.endMs)} line:12%\n${cue.text}`);
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function reviewedCaptionFor(slug: unknown, sha256: unknown): string | null {
  return slug === filmSlug && sha256 === filmSha256 ? serializeReviewedCues(reviewedCues) : null;
}

type ClipCaptionSource = Readonly<{
  sha256: unknown;
  watchUrl: unknown;
  startSeconds: number;
  endSeconds: number;
}>;

/**
 * The clip sidecar is exposed only after the receipt proves the original is the
 * exact registered public film (matching SHA and Watch path) and the finished
 * MP4 has an edit range. Cue overlaps are clipped to [start, end] and rebased to
 * zero; cues with no overlap are dropped, and an empty result exposes nothing.
 */
export function clippedCaptionFor({ sha256, watchUrl, startSeconds, endSeconds }: ClipCaptionSource): string | null {
  if (sha256 !== filmSha256 || watchUrl !== filmWatch) return null;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0) return null;
  const startMs = Math.round(startSeconds * 1000);
  const endMs = Math.round(endSeconds * 1000);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) return null;
  const clipped: ReviewedCue[] = [];
  for (const cue of reviewedCues) {
    const from = Math.max(cue.startMs, startMs);
    const to = Math.min(cue.endMs, endMs);
    if (to <= from) continue;
    clipped.push({ startMs: from - startMs, endMs: to - startMs, text: cue.text });
  }
  return clipped.length ? serializeReviewedCues(clipped) : null;
}
