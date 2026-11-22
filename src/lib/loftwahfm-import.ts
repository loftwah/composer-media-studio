// MIT. A private audio import from LoftwahFM's published media route.
import { audioInfo } from "./media-metadata.ts";
import { parseLoftwahFmTrackLink } from "./loftwahfm-track-link.ts";
import { HttpError } from "./util.mjs";

/** A measured MP3 copied from LoftwahFM, with the source link it came from. */
export interface LoftwahFmTrack {
  bytes: Uint8Array;
  source: string;
  title: string;
}

export async function readLoftwahFmTrack(value: unknown, limit: number): Promise<LoftwahFmTrack> {
  const parsed = parseLoftwahFmTrackLink(value);
  if (!parsed.ok) {
    if (parsed.reason === "too-long")
      throw new HttpError(400, "This audio link is too long to preserve with the track.", "invalid_track_link");
    throw new HttpError(400, "Paste a direct LoftwahFM MP3 link.", "invalid_track_link");
  }
  const { source, title } = parsed;
  const unavailable = () => new HttpError(502, "LoftwahFM could not supply this MP3. Check the link and try again.", "track_unavailable");
  let stage = "request";
  try {
    // workerd supports manual and follow. Accept only 200 and never follow a redirect.
    const response = await fetch(source, { redirect: "manual", signal: AbortSignal.timeout(12000) });
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
    const parts: Uint8Array[] = [];
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
    const { durationMs } = audio;
    if (audio.format !== "mp3" || typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 2000)
      throw new HttpError(415, "Studio could not measure this MP3. Try another track.", "unsupported_type");
    return { bytes, source, title };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = (error as { message?: unknown } | null | undefined)?.message ?? error;
    console.warn("LoftwahFM track transfer error", {
      stage,
      cause: String(message).replace(/https?:\/\/\S+/g, "[url]").slice(0, 160),
    });
    throw unavailable();
  }
}
