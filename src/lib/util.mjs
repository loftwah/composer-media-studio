// MIT. Small, dependency-free helpers shared by the worker, job engine and tests.

export const now = () => Date.now();

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function slug(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function problem(message, status = 400, code = "invalid_request") {
  return json({ error: { code, message } }, status);
}

export function text(value, max, label, { required = true } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text`);
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .trim();
  if (required && !clean) throw new HttpError(400, `${label} is required`);
  if (clean.length > max)
    throw new HttpError(400, `${label} must be ${max} characters or fewer`);
  return clean;
}

export class HttpError extends Error {
  constructor(status, message, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1)
    diff |= left[index] ^ right[index];
  return diff === 0;
}

// Image, video and audio byte parsing lives in media-metadata.ts with explicit
// types; these re-exports keep the original util.mjs import paths.
export { audioInfo, imageSize, videoInfo } from "./media-metadata.ts";

// Media type sniffing and storage extensions live in media-sniff.ts with
// explicit types; these re-exports keep the original util.mjs import paths.
export { sniffMedia, extensionFor } from "./media-sniff.ts";

export function periodKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function money(micro) {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return constantTimeEqual(a, b);
}
