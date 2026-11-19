import type { ImportedCue } from "./caption-import";

export const MAX_CAPTION_BYTES = 64 * 1024;
export type ClipCaptionTrack = Readonly<{ url: string; english: boolean }>;

function stamp(ms: number) {
  const minutes = Math.floor(ms / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

export function serializeClipCaptions(cues: readonly ImportedCue[], startSeconds: number, endSeconds: number) {
  const start = Math.round(startSeconds * 1000);
  const end = Math.round(endSeconds * 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  const blocks: string[] = [];
  for (const cue of cues) {
    const from = Math.max(cue.startMs, start), to = Math.min(cue.endMs, end);
    if (from >= to) continue;
    const text = cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    blocks.push(`${stamp(from - start)} --> ${stamp(to - start)}\n${text}`);
  }
  return blocks.length ? `WEBVTT\n\n${blocks.join("\n\n")}\n` : null;
}
