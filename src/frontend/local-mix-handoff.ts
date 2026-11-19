// MIT. One-shot, in-browser handoff of an exact finished MP4 between the two
// signed-out tools: Add Music -> Video Clip and Video Clip -> Add Music. No
// server, upload, account, cache, storage or published route is involved: the
// sender opens a same-origin tool tab carrying a one-time token, and the two
// tabs exchange exactly one bounded postMessage. Every other origin, window,
// token, target path and message shape is ignored, and both sides stop
// listening after one delivery, a stale snapshot or the deadline.

export const MAX_LOCAL_MIX_BYTES = 128 * 1024 * 1024;
export const LOCAL_MIX_HANDOFF_MS = 15_000;
export const LOCAL_MIX_CHANNEL = "media-studio/local-mix-handoff";
export const VIDEO_MP4 = "video/mp4";

// The only two destinations this helper can ever open. No caller-supplied path.
const TOOL_PATHS = {
  videoClip: "/tools/video-clip",
  addMusic: "/tools/add-music",
} as const;
export type LocalMixTool = keyof typeof TOOL_PATHS;

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const HASH = /^#local-mix=([A-Za-z0-9_-]{16,128})$/;

export function newLocalMixToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Only the two fixed tool paths, with one strict token, can ever be opened. */
export function localMixToolUrl(tool: LocalMixTool, token: string): string | null {
  if (!TOKEN.test(token) || !Object.prototype.hasOwnProperty.call(TOOL_PATHS, tool)) return null;
  return `${TOOL_PATHS[tool]}#local-mix=${token}`;
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

export type LocalMixHandoffStatus = "sent" | "stale" | "failed" | "timeout";
export type LocalMixHandoff = Readonly<{ close: () => void }>;

/**
 * Sender lifecycle shared by both tools. The caller opens the target tool in a
 * deliberate click with window.open and passes the resulting WindowProxy here.
 * This listens for exactly one matching ready from that window and origin,
 * replies with one bounded File, then closes on delivery, a changed snapshot
 * or the deadline. Returns null when the popup was blocked, so the caller can
 * keep its Save MP4 / download fallback fully available.
 */
export function openLocalMixHandoff(opts: {
  popup: Window | null;
  token: string;
  origin: string;
  file: File;
  isCurrent: () => boolean;
  onStatus: (status: LocalMixHandoffStatus) => void;
  onDone: () => void;
  timeoutMs?: number;
}): LocalMixHandoff | null {
  const { popup, token, origin, file, isCurrent, onStatus, onDone } = opts;
  if (!popup || popup.closed) return null;
  let done = false;
  let timer = 0;
  let listener: (event: MessageEvent) => void = () => {};
  const close = () => {
    if (done) return;
    done = true;
    window.removeEventListener("message", listener);
    window.clearTimeout(timer);
    onDone();
  };
  listener = (event: MessageEvent) => {
    if (done || event.origin !== origin || event.source !== popup) return;
    if (!isLocalMixReady(event.data, token)) return;
    close();
    if (!isCurrent()) { onStatus("stale"); return; }
    try {
      popup.postMessage(localMixDeliver(file, token), origin);
      onStatus("sent");
    } catch {
      onStatus("failed");
    }
  };
  window.addEventListener("message", listener);
  timer = window.setTimeout(() => {
    if (done) return;
    close();
    onStatus("timeout");
  }, opts.timeoutMs ?? LOCAL_MIX_HANDOFF_MS);
  return { close };
}

export type LocalMixReceiverStatus = "no-opener" | "failed" | "timeout";

/**
 * Receiver lifecycle shared by both tools. Call from an effect with the token
 * parsed from this tab's fragment. It announces ready to opener once, accepts
 * one bounded delivery from that exact same-origin WindowProxy, then calls
 * onDeliver(file). onStatus reports every refusal/deadline so the caller can
 * fall back to its normal file picker. The returned function stops listening.
 */
export function receiveLocalMix(opts: {
  token: string;
  origin: string;
  opener: Window | null;
  onDeliver: (file: File) => void;
  onStatus: (status: LocalMixReceiverStatus) => void;
  timeoutMs?: number;
}): () => void {
  const { token, origin, opener, onDeliver, onStatus } = opts;
  // A handoff URL is single use: drop the fragment so a reload cannot replay it.
  history.replaceState(history.state, "", location.pathname + location.search);
  if (!opener || opener.closed) {
    onStatus("no-opener");
    return () => {};
  }
  let done = false;
  let timer = 0;
  let listener: (event: MessageEvent) => void = () => {};
  const stop = () => {
    done = true;
    window.removeEventListener("message", listener);
    window.clearTimeout(timer);
  };
  listener = (event: MessageEvent) => {
    if (done || event.origin !== origin || event.source !== opener) return;
    const delivered = parseLocalMixDeliver(event.data, token);
    if (!delivered) return;
    stop();
    onDeliver(delivered);
  };
  window.addEventListener("message", listener);
  timer = window.setTimeout(() => {
    if (done) return;
    stop();
    onStatus("timeout");
  }, opts.timeoutMs ?? LOCAL_MIX_HANDOFF_MS);
  try {
    opener.postMessage(localMixReady(token), origin);
  } catch {
    stop();
    onStatus("failed");
  }
  return stop;
}
