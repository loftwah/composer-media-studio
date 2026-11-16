// Browser-facing declarations for the shared portable-bundle module. The
// restore panel reads a sealed bundle and previews it; it never imports the
// worker-only database helpers, but the type surface stays small and explicit.

export const PORTABLE_FORMAT: string;
export const PORTABLE_SCHEMA_VERSION: number;
export const PORTABLE_MAGIC: string;
export const MAX_PORTABLE_ASSET_BYTES: number;
export const MAX_PORTABLE_BUNDLE_BYTES: number;
export const MAX_PORTABLE_ASSETS: number;
export const MAX_PORTABLE_RECORDS: number;
export const MAX_PORTABLE_MANIFEST_BYTES: number;

export class PortableError extends Error {
  status: number;
  code: string;
  report: unknown;
  constructor(status: number, code: string, message: string, report?: unknown);
}

export function canonicalJson(value: unknown): string;
export function sha256Bytes(bytes: Uint8Array | ArrayBuffer): Promise<string>;
export function verifyManifestSeal(manifest: unknown): Promise<string>;
