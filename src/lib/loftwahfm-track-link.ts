// MIT. Shared validation for direct LoftwahFM track links before import.

const origin = "https://fm.loftwah.com";
const route = /^\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([^/]+)$/;
const filenamePattern = /^[^/\\\u0000-\u001f\u007f]{1,160}\.mp3$/i;
const MAX_INPUT_LENGTH = 800;
const MAX_SOURCE_LENGTH = 400;

export function parseLoftwahFmTrackLink(value: unknown): { ok: true; source: string; title: string } | { ok: false; reason: "invalid" | "too-long" } {
  try {
    const url = new URL(typeof value === "string" && value.length <= MAX_INPUT_LENGTH ? value.trim() : "");
    const match = route.exec(url.pathname);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password || !match) throw new Error();
    const album = match[1];
    const filename = decodeURIComponent(match[2]);
    if (!filenamePattern.test(filename) || filename.trim() !== filename) throw new Error();
    const source = `${origin}/media/${album}/${encodeURIComponent(filename)}`;
    if (source.length > MAX_SOURCE_LENGTH) return { ok: false, reason: "too-long" };
    return { ok: true, source, title: filename.slice(0, -4).slice(0, 100) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
