// MIT. The v1 portable restore archive byte container, typed.
//
// This is the typed core of the magic / length-prefixed manifest / ordered
// blobs / SHA-256 trailer format. It has no imports: the existing
// portable-bundle.mjs passes in its own PortableError, canonicalJson,
// sha256Bytes, validateManifest and constants. That keeps the public exports
// and every import path in scripts, the worker and the browser where they are,
// and avoids a cycle back into the 985-line D1 module.
//
// Decoded JSON stays `unknown` until validateManifest has accepted it; the only
// narrowing to a manifest surface happens after that call succeeds.

/** The minimal validated-manifest surface the container itself reads. */
export interface PortableArchiveManifest {
  /** Blob descriptors in archive order, already checked by validateManifest. */
  blobs: PortableArchiveBlob[];
}

/** A blob descriptor as validated before any byte is sliced. */
export interface PortableArchiveBlob {
  sha256: string;
  bytes: number;
}

/** Media supplied by sha256, as a Map or a plain object. */
export type PortableBlobSource =
  | Map<string, Uint8Array>
  | Record<string, Uint8Array>
  | null
  | undefined;

/** What decode returns: the manifest, its media, and the validation summary. */
export interface PortableDecodedArchive {
  manifest: PortableArchiveManifest;
  blobs: Map<string, Uint8Array>;
  validated: unknown;
}

/** The error class from portable-bundle.mjs, thrown unchanged. */
export interface PortableArchiveError extends Error {
  status: number;
  code: string;
  report: unknown;
}

/** Seams supplied by portable-bundle.mjs; no import back into that module. */
export interface PortableArchiveSeams {
  magic: string;
  maxManifestBytes: number;
  canonicalJson(value: unknown): string;
  sha256Bytes(bytes: Uint8Array | ArrayBuffer): Promise<string>;
  /** Full validation; success is the only point the parsed JSON is trusted. */
  validateManifest(manifest: unknown): Promise<unknown>;
  PortableError: new (
    status: number,
    code: string,
    message: string,
    report?: unknown
  ) => PortableArchiveError;
}

/** Concatenate byte chunks into one buffer, in order. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Seal a validated manifest and its media into the v1 archive bytes. */
export async function encodePortableArchive(
  manifest: unknown,
  blobs: PortableBlobSource,
  seams: PortableArchiveSeams
): Promise<Uint8Array> {
  await seams.validateManifest(manifest);
  const valid = manifest as PortableArchiveManifest;
  const encoder = new TextEncoder();
  const manifestBytes = encoder.encode(seams.canonicalJson(manifest));
  const magic = encoder.encode(seams.magic);
  const length = encoder.encode(`${String(manifestBytes.length).padStart(10, '0')}\n`);
  const chunks: Uint8Array[] = [];
  for (const blob of valid.blobs) {
    const bytes = blobs instanceof Map ? blobs.get(blob.sha256) : blobs?.[blob.sha256];
    if (!(bytes instanceof Uint8Array))
      throw new seams.PortableError(400, 'missing_media', `The archive is missing media ${blob.sha256}.`);
    const hash = await seams.sha256Bytes(bytes);
    if (bytes.byteLength !== blob.bytes || hash !== blob.sha256)
      throw new seams.PortableError(409, 'integrity_failed', `Media ${blob.sha256} does not match the manifest.`);
    chunks.push(bytes);
  }
  const blobHash = await seams.sha256Bytes(concat(chunks));
  const manifestHash = await seams.sha256Bytes(manifestBytes);
  return concat([magic, length, manifestBytes, ...chunks, encoder.encode(`${blobHash}\n${manifestHash}\n`)]);
}

/** Verify and unpack the v1 archive bytes; JSON is trusted only after validation. */
export async function decodePortableArchive(
  input: Uint8Array | ArrayBuffer,
  seams: PortableArchiveSeams
): Promise<PortableDecodedArchive> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const encoder = new TextEncoder();
  const magic = encoder.encode(seams.magic);
  if (bytes.byteLength < magic.byteLength + 11)
    throw new seams.PortableError(400, 'invalid_bundle', 'This is not a Studio project bundle.');
  for (let index = 0; index < magic.byteLength; index += 1)
    if (bytes[index] !== magic[index])
      throw new seams.PortableError(400, 'invalid_bundle', 'This is not a Studio project bundle.');
  const lengthText = new TextDecoder().decode(bytes.subarray(magic.byteLength, magic.byteLength + 11));
  if (!/^\d{10}\n$/.test(lengthText))
    throw new seams.PortableError(400, 'invalid_bundle', 'The bundle manifest length is malformed.');
  const manifestLength = Number(lengthText.slice(0, 10));
  if (manifestLength > seams.maxManifestBytes)
    throw new seams.PortableError(413, 'bundle_too_large', 'The bundle manifest exceeds the supported size.');
  const manifestStart = magic.byteLength + 11;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestLength < 2 || manifestEnd + 130 > bytes.byteLength)
    throw new seams.PortableError(400, 'invalid_bundle', 'The bundle is truncated.');
  const manifestBytes = bytes.subarray(manifestStart, manifestEnd);
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  } catch {
    throw new seams.PortableError(400, 'invalid_bundle', 'The bundle manifest is not JSON.');
  }
  const trailer = new TextDecoder().decode(bytes.subarray(bytes.byteLength - 130));
  const match = /^([a-f0-9]{64})\n([a-f0-9]{64})\n$/.exec(trailer);
  if (!match)
    throw new seams.PortableError(400, 'invalid_bundle', 'The bundle integrity trailer is malformed.');
  const [, blobHash, manifestHash] = match;
  const expectedManifest = await seams.sha256Bytes(manifestBytes);
  if (expectedManifest !== manifestHash)
    throw new seams.PortableError(409, 'integrity_failed', 'The bundle manifest was modified after sealing.');
  const blobs = new Map<string, Uint8Array>();
  let offset = manifestEnd;
  const chunks: Uint8Array[] = [];
  const validated = await seams.validateManifest(manifest);
  const valid = manifest as PortableArchiveManifest;
  for (const blob of valid.blobs) {
    const end = offset + blob.bytes;
    if (end > bytes.byteLength - 130)
      throw new seams.PortableError(400, 'invalid_bundle', 'The bundle is truncated.');
    const slice = bytes.subarray(offset, end);
    const hash = await seams.sha256Bytes(slice);
    if (hash !== blob.sha256)
      throw new seams.PortableError(409, 'integrity_failed', `Media ${blob.sha256} does not match its hash.`);
    blobs.set(blob.sha256, slice);
    chunks.push(slice);
    offset = end;
  }
  if (offset !== bytes.byteLength - 130)
    throw new seams.PortableError(400, 'invalid_bundle', 'The bundle has unexpected trailing bytes.');
  if (await seams.sha256Bytes(concat(chunks)) !== blobHash)
    throw new seams.PortableError(409, 'integrity_failed', 'The bundle media stream does not match its trailer.');
  return { manifest: valid, blobs, validated };
}
