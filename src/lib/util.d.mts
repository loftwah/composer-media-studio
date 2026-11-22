// Narrow, type-only declarations for the util.mjs helpers consumed by
// director.ts, publication-derivatives.ts and sitemap.ts. Runtime behaviour
// stays in util.mjs; this file only names the symbols those lanes import so
// they can be checked in strict TS.

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}

export function id(prefix: string): string;

export function slug(bytes?: number): string;

export function now(): number;

export function safeJson<T>(value: string, fallback: T): T;

export function text(
  value: unknown,
  max: number,
  label: string,
  options?: { required?: boolean },
): string;

export function money(micro: number): string;

export { extensionFor, sniffMedia } from "./media-sniff.ts";

export function escapeHtml(value: unknown): string;

export { imageSize } from "./media-metadata.ts";

export function sha256Hex(bytes: Uint8Array): Promise<string>;

export function constantTimeEqual(a: string, b: string): boolean;
