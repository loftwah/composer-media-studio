// MIT. A private audio import from LoftwahFM's published media route.
import { audioInfo, HttpError } from "./util.mjs";

const origin = "https://fm.loftwah.com";

export async function readLoftwahFmTrack(value, limit, radio) {
  let url, filename, album;
  try {
    url = new URL(typeof value === "string" && value.length <= 800 ? value.trim() : "");
    const match = /^\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([^/]+)$/.exec(url.pathname);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password || !match) throw Error();
    [, album] = match;
    filename = decodeURIComponent(match[2]);
    if (!/^[^/\\\u0000-\u001f\u007f]{1,160}\.mp3$/i.test(filename) || filename.trim() !== filename) throw Error();
  } catch {
    throw new HttpError(400, "Paste a direct LoftwahFM MP3 link.", "invalid_track_link");
  }

  const source = `${origin}/media/${album}/${encodeURIComponent(filename)}`;
  if (source.length > 400)
    throw new HttpError(400, "This audio link is too long to preserve with the track.", "invalid_track_link");
  const unavailable = () => new HttpError(502, "LoftwahFM could not supply this MP3. Check the link and try again.", "track_unavailable");
  let stage = "request";
  try {
    const options = { redirect: "error", signal: AbortSignal.timeout(12000) };
    const response = radio ? await radio.fetch(source, options) : await fetch(source, options);
    const mime = response.headers.get("content-type")?.split(";")[0].trim();
    if (response.status !== 200 || mime !== "audio/mpeg" || !response.body) {
      console.warn("LoftwahFM track response refused", { status: response.status, audio: mime === "audio/mpeg" });
      await response.body?.cancel().catch(() => {});
      throw unavailable();
    }
    const tooLarge = () => new HttpError(413, "This track exceeds the Studio audio limit.", "too_large");
    if (Number(response.headers.get("content-length")) > limit) throw tooLarge();
    stage = "body";
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    try {
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw tooLarge();
        }
        parts.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of parts) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    stage = "measure";
    const audio = audioInfo(bytes);
    if (audio.format !== "mp3" || !Number.isFinite(audio.durationMs) || audio.durationMs < 2000)
      throw new HttpError(415, "Studio could not measure this MP3. Try another track.", "unsupported_type");
    return { bytes, source, title: filename.slice(0, -4).slice(0, 100) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.warn("LoftwahFM track transfer error", {
      stage,
      cause: String(error?.message ?? error).replace(/https?:\/\/\S+/g, "[url]").slice(0, 160),
    });
    throw unavailable();
  }
}
