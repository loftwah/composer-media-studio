// MIT. Pure embed-code builders for the signed-out image workbench.
// The snippets wrap the exact exported bytes in a data URI. They are not a
// privacy feature: anyone holding the text holds the image.

export type SnippetKind = "base64" | "dataUri" | "css" | "html" | "markdown";

export type SnippetResult =
  | {
      ok: true;
      mime: string;
      bytes: number;
      base64Length: number;
      dataUriLength: number;
      snippets: Record<SnippetKind, string>;
      warning: string | null;
    }
  | { ok: false; error: string };

export const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;
export const SNIPPET_WARN_BYTES = 128 * 1024;
export const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_SNIPPET_BYTES / 3);
// The whole paste is bounded before whitespace is removed. The allowance fits
// ordinary line wrapping and indentation, plus the longest exact data-URI prefix.
export const MAX_BASE64_INPUT_CHARACTERS =
  MAX_BASE64_LENGTH + "data:image/jpeg;base64,".length + Math.ceil(MAX_BASE64_LENGTH / 8);

export const SNIPPET_KINDS: ReadonlyArray<SnippetKind> = Object.freeze([
  "base64",
  "dataUri",
  "css",
  "html",
  "markdown",
]);

export const SNIPPET_LABELS: Readonly<Record<SnippetKind, string>> = Object.freeze({
  base64: "Base64",
  dataUri: "Data URI",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
});

const SNIPPET_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

/** The whole `<img>`/Markdown text is attribute-escaped, not sanitised HTML. */
export function escapeSnippetText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function escapeMarkdownAlt(value: unknown): string {
  return String(value ?? "").replace(/[\\[\]]/g, (character) => `\\${character}`);
}

function safeClassName(filename: unknown): string {
  const stem = String(filename ?? "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return stem ? `image-${stem}` : "image";
}

function formatSnippetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/** Standard base64 with padding, built without Buffer or a Node-only path. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (!bytes || typeof bytes.length !== "number") return "";
  const chunks: string[] = [];
  let chunk = "";
  const length = bytes.length;
  for (let index = 0; index < length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < length;
    const hasThird = index + 2 < length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const triple = (first << 16) | (second << 8) | third;
    chunk +=
      BASE64_ALPHABET[(triple >> 18) & 63] +
      BASE64_ALPHABET[(triple >> 12) & 63] +
      (hasSecond ? BASE64_ALPHABET[(triple >> 6) & 63] : "=") +
      (hasThird ? BASE64_ALPHABET[triple & 63] : "=");
    if (chunk.length >= 0x8000) {
      chunks.push(chunk);
      chunk = "";
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join("");
}

/**
 * Decode bounded, canonical standard base64 with optional ordinary whitespace.
 * Padding, alphabet and unused trailing bits are checked before byte allocation.
 */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  const source = String(text ?? "");
  if (source.length > MAX_BASE64_INPUT_CHARACTERS) return null;
  const value = source.replace(/[ \t\r\n\f\v]+/g, "");
  if (!value) return new Uint8Array(0);
  if (value.length > MAX_BASE64_LENGTH || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (
    (padding === 2 && (BASE64_VALUES[value.charCodeAt(value.length - 3)] & 0x0f) !== 0) ||
    (padding === 1 && (BASE64_VALUES[value.charCodeAt(value.length - 2)] & 0x03) !== 0)
  )
    return null;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength > MAX_SNIPPET_BYTES) return null;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    let triple = 0;
    for (let step = 0; step < 4; step += 1) {
      const character = value[index + step];
      const digit = character === "=" ? 0 : BASE64_VALUES[value.charCodeAt(index + step)];
      if (digit < 0) return null;
      triple = (triple << 6) | digit;
    }
    if (offset < bytes.length) bytes[offset++] = (triple >> 16) & 0xff;
    if (offset < bytes.length) bytes[offset++] = (triple >> 8) & 0xff;
    if (offset < bytes.length) bytes[offset++] = triple & 0xff;
  }
  return bytes;
}

/**
 * Build every snippet from one measured export. `bytes` must be the actual
 * encoded file, so the data URI and the download are the same pixels and the
 * same container.
 */
export function buildImageSnippets({
  bytes,
  mime,
  filename = "image",
  width = 0,
  height = 0,
}: {
  bytes?: Uint8Array;
  mime?: string;
  filename?: string;
  width?: number;
  height?: number;
} = {}): SnippetResult {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 1)
    return { ok: false, error: "There are no encoded bytes to embed." };
  if (mime === "image/jpg") mime = "image/jpeg";
  if (typeof mime !== "string" || !SNIPPET_MIMES.has(mime))
    return { ok: false, error: "Embed code is available for PNG, JPEG and WebP results only." };
  if (bytes.length > MAX_SNIPPET_BYTES)
    return {
      ok: false,
      error: `This result is ${formatSnippetBytes(bytes.length)}. Embed code is limited to ${formatSnippetBytes(MAX_SNIPPET_BYTES)}; download the file or lower the output size instead.`,
    };

  const base64 = bytesToBase64(bytes);
  const dataUri = `data:${mime};base64,${base64}`;
  const alt = String(filename || "image");
  const safeAlt = escapeSnippetText(alt);
  const markdownAlt = escapeMarkdownAlt(alt);
  const className = safeClassName(filename);
  const dimensionComment = width > 0 && height > 0 ? `${width} × ${height}` : "unknown size";
  const sizeComment = `${dimensionComment} ${mime.replace("image/", "").toUpperCase()} · ${formatSnippetBytes(bytes.length)}`;

  const css = `/* ${sizeComment} */\n.${className} {\n  display: block;\n  width: 100%;\n  height: auto;\n  aspect-ratio: ${width > 0 && height > 0 ? `${width} / ${height}` : "auto"};\n  background: url("${dataUri}") center / contain no-repeat;\n}\n`;
  const html =
    width > 0 && height > 0
      ? `<img src="${dataUri}" width="${width}" height="${height}" alt="${safeAlt}">`
      : `<img src="${dataUri}" alt="${safeAlt}">`;
  const markdown = `![${markdownAlt}](${dataUri})`;

  const warning =
    bytes.length >= SNIPPET_WARN_BYTES
      ? `This result is ${formatSnippetBytes(bytes.length)}; the base64 text is ${formatSnippetBytes(base64.length)} and editors or chat tools may truncate or reject it. Lower the output size if a snippet is pasted somewhere with a limit.`
      : null;

  return {
    ok: true,
    mime,
    bytes: bytes.length,
    base64Length: base64.length,
    dataUriLength: dataUri.length,
    snippets: { base64, dataUri, css, html, markdown },
    warning,
  };
}
