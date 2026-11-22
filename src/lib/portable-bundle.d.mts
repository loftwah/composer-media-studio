// Browser-facing declarations for the shared portable-bundle module. The
// restore panel reads a sealed bundle and previews it; it never imports the
// worker-only database helpers, so the type surface stays small and explicit.
// The manifest-integrity names live typed in portable-manifest.ts; this file
// forwards them unchanged, keeping the portable-bundle.mjs import path the
// browser already uses.

export {
  MAX_PORTABLE_ASSET_BYTES,
  MAX_PORTABLE_BUNDLE_BYTES,
  MAX_PORTABLE_ASSETS,
  MAX_PORTABLE_MANIFEST_BYTES,
  MAX_PORTABLE_RECORDS,
  PORTABLE_FORMAT,
  PORTABLE_MAGIC,
  PORTABLE_SCHEMA_VERSION,
  PortableError,
  canonicalJson,
  sha256Bytes,
  verifyManifestSeal,
} from "./portable-manifest.ts";
