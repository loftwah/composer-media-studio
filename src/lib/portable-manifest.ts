// MIT. Manifest integrity for portable Studio project bundles, typed.
//
// This is the pure sealing core of the bundle format: the format and schema
// constants, the shared PortableError, stable canonical JSON, the SHA-256
// byte helper, and the seal/verify pair that stamps and checks a manifest's
// content digest. portable-bundle.mjs imports these names and re-exports
// them unchanged, so the CLI, tests, browser restore panel and owner worker
// keep their import paths and one PortableError class identity.
//
// Full manifest validation lives in portable-validation.ts; D1 reads, R2
// staging, id rewriting, commit and cleanup stay in portable-bundle.mjs. This
// module only hashes and seals what it is handed; decoded JSON keeps its
// unknown shape until a caller has validated it.

import { sha256Hex } from './util.mjs';

export const PORTABLE_FORMAT: string = 'studio-project-bundle/v1';
export const PORTABLE_SCHEMA_VERSION: number = 1;
export const PORTABLE_MAGIC: string = 'STUDIO-PROJECT-BUNDLE/1\n';
export const MAX_PORTABLE_ASSET_BYTES: number = 64 * 1024 * 1024;
export const MAX_PORTABLE_BUNDLE_BYTES: number = 512 * 1024 * 1024;
export const MAX_PORTABLE_ASSETS: number = 200;
export const MAX_PORTABLE_RECORDS: number = 2000;
export const MAX_PORTABLE_MANIFEST_BYTES: number = 1_500_000;

/** Lowercase hex SHA-256 digest: exactly 64 characters. */
export const SHA256_HEX = /^[a-f0-9]{64}$/;

/** The bundle-shaped refusal error; status and code match the API surface. */
export class PortableError extends Error {
  status: number;
  code: string;
  report: unknown;
  constructor(status: number, code: string, message: string, report: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.report = report;
  }
}

/** Refuse a bundle with a 400, exactly as the D1 lanes do. */
export function invalid(message: string, code = 'invalid_bundle'): never {
  throw new PortableError(400, code, message);
}

/** Stable JSON for hashing. Object keys are sorted; array order is meaningful. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** SHA-256 of one byte buffer, as lowercase hex. */
export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): Promise<string> {
  return sha256Hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** The untrusted manifest surface the seal check reads. Decoded JSON keeps
 * its unknown shape; this view exists only inside verifyManifestSeal, after
 * its object guard, and never escapes this module. */
type SealedManifestView = {
  format?: unknown;
  schemaVersion?: unknown;
  bundleId?: unknown;
  integrity?: IntegrityView;
};

type IntegrityView = {
  algorithm?: unknown;
  contentSha256?: string;
  treeSha256?: string;
};

/** The manifest minus the two seal fields; the rest is the hashed content. */
function contentOf(manifest: SealedManifestView) {
  const { bundleId, integrity, ...content } = manifest;
  return content;
}

/** Stamp a manifest with its own content digest. */
export async function sealManifest(content: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sealedContent = { ...content, schemaVersion: PORTABLE_SCHEMA_VERSION };
  const digest = await sha256Bytes(new TextEncoder().encode(canonicalJson(sealedContent)));
  return {
    ...sealedContent,
    bundleId: digest,
    integrity: { algorithm: 'sha256', contentSha256: digest, treeSha256: digest },
  };
}

/** Recompute a manifest's content digest and refuse any drift. */
export async function verifyManifestSeal(manifest: unknown): Promise<string> {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) invalid('Send a bundle manifest');
  const sealed = manifest as SealedManifestView;
  if (sealed.format !== PORTABLE_FORMAT) invalid(`Unsupported bundle format ${String(sealed.format)}`);
  if (sealed.schemaVersion !== PORTABLE_SCHEMA_VERSION) invalid(`Unsupported bundle schema version ${String(sealed.schemaVersion)}`, 'incompatible_schema');
  const digest = await sha256Bytes(new TextEncoder().encode(canonicalJson(contentOf(sealed))));
  const integrity = sealed.integrity;
  const tree = integrity?.treeSha256;
  if (integrity?.algorithm !== 'sha256' || !SHA256_HEX.test(integrity?.contentSha256 ?? '') || !SHA256_HEX.test(tree ?? ''))
    invalid('The bundle integrity record is missing or malformed', 'integrity_failed');
  if (integrity.contentSha256 !== digest || tree !== digest || sealed.bundleId !== digest)
    invalid('The bundle manifest changed after it was sealed', 'integrity_failed');
  return digest;
}
