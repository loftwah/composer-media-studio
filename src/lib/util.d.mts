// Narrow, type-only declarations for the util.mjs helpers consumed by
// publication-derivatives.ts. Runtime behaviour stays in util.mjs; this file
// only names the symbols that lane imports so it can be checked in strict TS.

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}

export function extensionFor(mime: string): string;

export function imageSize(bytes: Uint8Array): {
  width: number | null;
  height: number | null;
  format: string | null;
};

export function sha256Hex(bytes: Uint8Array): Promise<string>;

export function sniffMedia(bytes: Uint8Array, declaredMime?: string): {
  mime: string;
  kind: string | null;
};
