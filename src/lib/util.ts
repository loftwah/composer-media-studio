// MIT. Strict TypeScript implementations of the small, dependency-free helpers
// shared by the worker, job engine and tests. util.mjs re-exports these same
// names so the original import paths keep working, with one shared HttpError
// class identity across every lane.

export const now = (): number => Date.now();

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function slug(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function problem(
  message: string,
  status = 400,
  code = "invalid_request",
): Response {
  return json({ error: { code, message } }, status);
}

export function text(
  value: unknown,
  max: number,
  label: string,
  { required = true }: { required?: boolean } = {},
): string {
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
  status: number;
  code: string;
  constructor(status: number, message: string, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function safeJson<T>(value: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function escapeHtml(value: unknown): string {
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

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  // The ArrayBuffer-backed view itself is handed to WebCrypto, so a sliced
  // window is hashed with exactly the bytes it views (byteOffset and length),
  // never its whole buffer.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1)
    diff |= left[index] ^ right[index];
  return diff === 0;
}

export function periodKey(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function money(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export function timingSafeEqualString(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return constantTimeEqual(a, b);
}
