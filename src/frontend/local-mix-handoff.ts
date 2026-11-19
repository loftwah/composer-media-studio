// MIT. One-shot, in-browser handoff of the exact finished Add Music MP4 to the
// signed-out Video Clip tool. No server, upload, account, cache, storage or
// published route is involved: Add Music opens a same-origin tab carrying a
// one-time token, and the two tabs exchange exactly one bounded postMessage.
// Every other origin, window, token and message shape is ignored, and both
// sides stop listening after one delivery or the deadline.

export const MAX_LOCAL_MIX_BYTES = 128 * 1024 * 1024;
export const LOCAL_MIX_HANDOFF_MS = 15_000;
export const LOCAL_MIX_CHANNEL = "media-studio/local-mix-handoff";
export const VIDEO_MP4 = "video/mp4";

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const HASH = /^#local-mix=([A-Za-z0-9_-]{16,128})$/;

export function newLocalMixToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function localMixToolUrl(token: string): string | null {
  return TOKEN.test(token) ? `/tools/video-clip#local-mix=${token}` : null;
}

/** The whole fragment must be this one handoff; any extra input is refused. */
export function localMixTokenFromHash(hash: string): string | null {
  const match = HASH.exec(hash);
  if (!match || match[0] !== hash) return null;
  return TOKEN.test(match[1]) ? match[1] : null;
}

/** The sender's own bound, applied before a popup is even opened. */
export function localMixBlobFits(blob: Blob): boolean {
  return blob.type === VIDEO_MP4 && blob.size > 0 && blob.size <= MAX_LOCAL_MIX_BYTES;
}

export function localMixReady(token: string) {
  return { channel: LOCAL_MIX_CHANNEL, type: "ready", token } as const;
}

export function isLocalMixReady(data: unknown, token: string): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const message = data as Record<string, unknown>;
  return message.channel === LOCAL_MIX_CHANNEL && message.type === "ready" && message.token === token;
}

export function localMixDeliver(file: File, token: string) {
  return { channel: LOCAL_MIX_CHANNEL, type: "deliver", token, file } as const;
}

/**
 * A delivered message only becomes a File for the tool's existing picker
 * intake when every bound holds. The origin and WindowProxy are checked by the
 * caller, since they cannot be carried in the message itself.
 */
export function parseLocalMixDeliver(data: unknown, token: string): File | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.channel !== LOCAL_MIX_CHANNEL || message.type !== "deliver" || message.token !== token) return null;
  const { file } = message;
  if (!(file instanceof File)) return null;
  if (!localMixBlobFits(file)) return null;
  return file;
}
