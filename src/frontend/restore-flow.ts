// MIT. Owner-facing portable-restore flow.
//
// A portable bundle is a sealed container: magic, a length-prefixed manifest,
// the media blobs in manifest order, then a 130-byte integrity trailer. This
// module reads that container from a File with bounded random access (one blob
// at a time), verifies what the browser can verify, and drives the existing
// owner restore API. It never invents a second importer or a second store.
//
// Web Crypto has no streaming SHA-256, so the aggregate blob-stream hash in the
// trailer is not recomputed here. Instead every blob is hashed individually,
// the manifest bytes are hashed against the trailer, and the container length
// is checked exactly, so bytes cannot be reordered, dropped or appended. The
// server repeats every asset hash before commit.

import {
  MAX_PORTABLE_ASSETS,
  MAX_PORTABLE_BUNDLE_BYTES,
  MAX_PORTABLE_MANIFEST_BYTES,
  PORTABLE_FORMAT,
  PORTABLE_MAGIC,
  PortableError,
  sha256Bytes,
  verifyManifestSeal,
} from "../lib/portable-bundle.mjs";

const MAGIC_BYTES = new TextEncoder().encode(PORTABLE_MAGIC);
const LENGTH_BYTES = 11;
const TRAILER_BYTES = 130;
const SHA = /^[a-f0-9]{64}$/;

export class RestoreFlowError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RestoreFlowError";
    this.code = code;
  }
}

export interface BundleBlob {
  sha256: string;
  mime: string;
  bytes: number;
  offset: number;
}

export interface BundleProject {
  id: string;
  name: string;
  slug: string;
  visibility?: string;
}

export interface BundleManifest {
  format: string;
  schemaVersion: number;
  bundleId: string;
  project: BundleProject;
  blobs: { sha256: string; path: string; bytes: number; mime: string }[];
  assets: { id: string; content: "media" | "tombstone"; sha256: string; bytes: number; mime: string }[];
  stats?: Record<string, number>;
}

export interface OpenedBundle {
  manifest: BundleManifest;
  blobs: BundleBlob[];
  /** Size of the manifest region, used to explain the layout in errors. */
  manifestBytes: number;
  contentBytes: number;
  /**
   * False only when the page cannot hash (no Web Crypto, e.g. a plain-HTTP
   * origin). The server still verifies every hash before commit.
   */
  verified: boolean;
}

const hashingAvailable = () =>
  typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof crypto.subtle.digest === "function";

/** Read and check the bundle envelope without loading the media bytes. */
export async function openBundle(file: Blob): Promise<OpenedBundle> {
  const headerLength = MAGIC_BYTES.length + LENGTH_BYTES;
  if (file.size < headerLength + 2 + TRAILER_BYTES)
    throw new RestoreFlowError("not_a_bundle", "That file is too small to be a Studio project bundle.");
  const header = new Uint8Array(await file.slice(0, headerLength).arrayBuffer());
  for (let index = 0; index < MAGIC_BYTES.length; index += 1)
    if (header[index] !== MAGIC_BYTES[index])
      throw new RestoreFlowError(
        "not_a_bundle",
        "That file is not a Studio project bundle. Choose the .studio archive exported from a Studio; a metadata-only JSON export cannot be restored.",
      );
  const lengthText = new TextDecoder().decode(header.subarray(MAGIC_BYTES.length));
  if (!/^\d{10}\n$/.test(lengthText))
    throw new RestoreFlowError("invalid_bundle", "The bundle header is malformed, so the manifest length cannot be read.");
  const manifestLength = Number(lengthText.slice(0, 10));
  if (manifestLength < 2)
    throw new RestoreFlowError("invalid_bundle", "The bundle manifest is empty.");
  if (manifestLength > MAX_PORTABLE_MANIFEST_BYTES)
    throw new RestoreFlowError("bundle_too_large", "The bundle manifest is larger than this Studio supports.");
  const manifestStart = headerLength;
  const manifestEnd = manifestStart + manifestLength;
  if (file.size < manifestEnd + TRAILER_BYTES)
    throw new RestoreFlowError(
      "truncated",
      "The bundle is incomplete: it ends before its manifest does. Choose the original file again — a partial copy or an interrupted download cannot be restored.",
    );
  const manifestBytes = new Uint8Array(await file.slice(manifestStart, manifestEnd).arrayBuffer());
  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BundleManifest;
  } catch {
    throw new RestoreFlowError("invalid_bundle", "The bundle manifest is not valid JSON, so the file is damaged.");
  }
  if (manifest?.format !== PORTABLE_FORMAT)
    throw new RestoreFlowError(
      "not_a_bundle",
      `That file is not a Studio project bundle (found format ${JSON.stringify(String(manifest?.format ?? "none"))}).`,
    );

  if (!Array.isArray(manifest.blobs) || manifest.blobs.length > MAX_PORTABLE_ASSETS)
    throw new RestoreFlowError("bundle_too_large", "The bundle lists more media files than this Studio supports.");
  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_PORTABLE_ASSETS)
    throw new RestoreFlowError("bundle_too_large", "The bundle lists more asset records than this Studio supports.");
  const blobs: BundleBlob[] = [];
  let offset = manifestEnd;
  let contentBytes = 0;
  const seen = new Set<string>();
  for (const blob of manifest.blobs) {
    if (!blob || typeof blob !== "object" || !SHA.test(String(blob.sha256 ?? "")))
      throw new RestoreFlowError("invalid_bundle", "A media entry in this bundle has an invalid hash.");
    if (seen.has(blob.sha256))
      throw new RestoreFlowError("duplicate_entry", "This bundle lists the same media file twice.");
    if (blob.path !== `assets/${blob.sha256}`)
      throw new RestoreFlowError(
        "path_traversal",
        "A media path in this bundle is not content-addressed. The file was modified and is refused.",
      );
    if (!Number.isSafeInteger(blob.bytes) || blob.bytes < 1)
      throw new RestoreFlowError("invalid_bundle", "A media entry in this bundle has an invalid size.");
    if (typeof blob.mime !== "string" || !blob.mime.includes("/"))
      throw new RestoreFlowError("invalid_bundle", "A media entry in this bundle has no usable type.");
    seen.add(blob.sha256);
    blobs.push({ sha256: blob.sha256, mime: blob.mime, bytes: blob.bytes, offset });
    offset += blob.bytes;
    contentBytes += blob.bytes;
  }
  if (contentBytes > MAX_PORTABLE_BUNDLE_BYTES)
    throw new RestoreFlowError("bundle_too_large", "This bundle's media is larger than one Studio restore supports.");
  const expected = offset + TRAILER_BYTES;
  if (file.size < expected)
    throw new RestoreFlowError(
      "truncated",
      "The bundle is incomplete: at least one media file is missing from the end of the file.",
    );
  if (file.size > expected)
    throw new RestoreFlowError(
      "invalid_bundle",
      "The file has extra bytes after the bundle trailer. It was appended to or modified and is refused.",
    );

  const trailer = new TextDecoder().decode(new Uint8Array(await file.slice(file.size - TRAILER_BYTES).arrayBuffer()));
  const trailerMatch = /^([a-f0-9]{64})\n([a-f0-9]{64})\n$/.exec(trailer);
  if (!trailerMatch)
    throw new RestoreFlowError("invalid_bundle", "The bundle integrity trailer is malformed, so the file is damaged.");
  const [, , manifestHash] = trailerMatch;
  const verified = hashingAvailable();
  if (verified) {
    if ((await sha256Bytes(manifestBytes)) !== manifestHash)
      throw new RestoreFlowError(
        "integrity_failed",
        "The bundle manifest does not match its trailer. The file was modified or damaged after export.",
      );
    // Same seal check the worker runs, so a tampered manifest never reaches the API.
    await verifyManifestSeal(manifest);
  }
  return { manifest, blobs, manifestBytes: manifestLength, contentBytes, verified };
}

export interface StageTarget {
  sourceId: string;
  sha256: string;
  bytes: number;
  mime: string;
  title?: string;
}

/** Read one media blob and check it against the manifest before it is sent. */
export async function readBundleBlob(
  file: Blob,
  bundle: OpenedBundle,
  target: StageTarget,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = bundle.blobs.find((entry) => entry.sha256 === target.sha256);
  const label = target.title || target.sourceId;
  if (!blob)
    throw new RestoreFlowError(
      "missing_media",
      `The bundle has no media bytes for “${label}”. The file is incomplete.`,
    );
  if (blob.bytes !== target.bytes)
    throw new RestoreFlowError(
      "integrity_failed",
      `“${label}” is listed with ${target.bytes} bytes but the bundle stores ${blob.bytes}. The file is damaged.`,
    );
  const bytes = new Uint8Array(await file.slice(blob.offset, blob.offset + blob.bytes).arrayBuffer());
  if (bytes.byteLength !== blob.bytes)
    throw new RestoreFlowError("truncated", `“${label}” ended early while reading. Choose the original file again.`);
  if (bundle.verified) {
    const hash = await sha256Bytes(bytes);
    if (hash !== blob.sha256)
      throw new RestoreFlowError(
        "integrity_failed",
        `“${label}” does not match the hash recorded in the bundle. The file is damaged; export it again.`,
      );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Preview, progress and error wording
// ---------------------------------------------------------------------------

export interface PreviewPlan {
  assets?: number;
  mediaAssets?: number;
  tombstones?: number;
  blobs?: number;
  contentBytes?: number;
  records?: number;
  generations?: number;
  compositions?: number;
  recipes?: number;
  subjects?: number;
  songPlans?: number;
  footagePlans?: number;
  publications?: number;
  promoBriefs?: number;
  sourceProjectId?: string;
  sourceSlug?: string;
}

export interface PreviewConflict {
  code: string;
  message: string;
  projectId?: string;
}

export interface PreviewReport {
  status?: string;
  /** Status of an existing import row for this bundle, when there is one. */
  importStatus?: string | null;
  bundleId?: string;
  importId?: string | null;
  projectId?: string;
  importedAt?: number;
  project?: { sourceId: string; name: string; slug: string; visibility?: string };
  plan?: PreviewPlan;
  conflicts?: PreviewConflict[];
  blockers?: string[];
  warnings?: string[];
  duplicateContent?: { sha256: string; assetIds: string[] }[];
  existingContent?: { sha256: string; assets: { id: string; projectId: string; title: string }[] }[];
}

export type PreviewDecision = "start" | "resume" | "already" | "blocked";

/** Which owner action the preview permits. */
export function previewDecision(preview: PreviewReport | null): PreviewDecision {
  if (!preview) return "start";
  if (preview.status === "already_imported") return "already";
  if (preview.status === "blocked" || (preview.conflicts?.length ?? 0) > 0 || (preview.blockers?.length ?? 0) > 0)
    return "blocked";
  if (preview.status === "resume_staging") return "resume";
  return "start";
}

export interface PlanFact {
  label: string;
  value: string;
  note?: string;
}

const count = (value: number | undefined, one: string, many = `${one}s`) =>
  `${value ?? 0} ${(value ?? 0) === 1 ? one : many}`;

/** What the preview says will be written, in the owner's words. */
export function planFacts(plan: PreviewPlan | undefined, bundle?: OpenedBundle | null): PlanFact[] {
  if (!plan) return [];
  const media = plan.mediaAssets ?? 0;
  const tombstones = plan.tombstones ?? 0;
  const bytes = plan.contentBytes ?? 0;
  const blobs = plan.blobs ?? 0;
  const breakdown = [
    plan.generations ? count(plan.generations, "generation") : "",
    plan.compositions ? count(plan.compositions, "storyboard") : "",
    plan.subjects ? count(plan.subjects, "subject version") : "",
    plan.songPlans ? count(plan.songPlans, "song plan") : "",
    plan.footagePlans ? count(plan.footagePlans, "footage plan") : "",
    plan.recipes ? count(plan.recipes, "recipe", "recipes") : "",
    plan.promoBriefs ? count(plan.promoBriefs, "promo brief") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const facts: PlanFact[] = [
    {
      label: "Media to restore",
      value: `${count(media, "file")} · ${formatBytes(bytes)}`,
      note:
        blobs !== media
          ? `${count(blobs, "distinct file")} stored once; identical copies share bytes.`
          : undefined,
    },
    {
      label: "Asset records",
      value: count(plan.assets, "record"),
      note: tombstones ? `${count(tombstones, "deleted asset")} skipped: restore does not resurrect deletions.` : undefined,
    },
    {
      label: "Records",
      value: count(plan.records, "record"),
      note: breakdown || undefined,
    },
    {
      label: "Publications",
      value: count(plan.publications, "page"),
      note: plan.publications ? "Restored withdrawn, hidden and unlisted. Publish again deliberately." : undefined,
    },
    {
      label: "Provider jobs",
      value: count(plan.generations, "job"),
      note: plan.generations ? "Kept as history. Nothing is replayed or charged." : undefined,
    },
    {
      label: "Monthly budget",
      value: "Not restored",
      note: "This studio's existing allowance and spend are unchanged.",
    },
  ];
  if (bundle && !bundle.verified)
    facts.push({
      label: "Local check",
      value: "Server only",
      note: "This page cannot hash files (no Web Crypto). The server still verifies every hash before commit.",
    });
  return facts;
}

export function formatBytes(bytes: number | undefined): string {
  const value = Number(bytes ?? 0);
  if (!value) return "0 bytes";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export type StageAckStatus = "staged" | "already_staged";

export interface ProgressSnapshot {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  percent: number;
}

/** Counts come only from server acknowledgements, never from a timer. */
export function progressFor(
  assets: StageTarget[],
  acks: Record<string, StageAckStatus>,
): ProgressSnapshot {
  let done = 0;
  let bytesDone = 0;
  let bytesTotal = 0;
  for (const asset of assets) {
    bytesTotal += Number(asset.bytes) || 0;
    if (acks[asset.sourceId]) {
      done += 1;
      bytesDone += Number(asset.bytes) || 0;
    }
  }
  return {
    done,
    total: assets.length,
    bytesDone,
    bytesTotal,
    percent: assets.length ? Math.round((done / assets.length) * 100) : 0,
  };
}

/** Resume must not resend bytes the server already holds. */
export function stageQueue(assets: StageTarget[], alreadyStaged: string[]): StageTarget[] {
  const skip = new Set(alreadyStaged);
  return assets.filter((asset) => !skip.has(asset.sourceId));
}

export function progressSentence(
  progress: ProgressSnapshot,
  current?: { title: string; index: number } | null,
): string {
  if (!progress.total) return "No media files need staging.";
  const base = `${progress.done} of ${progress.total} files staged · ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)} verified`;
  if (progress.done >= progress.total) return `All ${progress.total} files are staged. ${formatBytes(progress.bytesTotal)} verified.`;
  if (current) return `Staging “${current.title}” (${current.index} of ${progress.total}). ${base}.`;
  return `${base}.`;
}

export interface RestoreProblem {
  code: string;
  title: string;
  detail: string;
  action: string | null;
  /** True when pressing Retry can sensibly continue the same restore. */
  retryable: boolean;
}

const PROBLEMS: Record<string, { title: string; action: string | null; retryable?: boolean }> = {
  owner_required: {
    title: "Restore needs the installation owner",
    action: "Open this Studio at /studio and sign in with its owner passphrase, then choose the bundle again. App Composer sessions cannot restore an installation-wide project.",
  },
  not_a_bundle: {
    title: "That is not a Studio bundle",
    action: "Choose the .studio file. A metadata-only JSON export has no media bytes and cannot be restored.",
  },
  invalid_bundle: {
    title: "The bundle is damaged",
    action: "Export the project again from the source Studio and choose the new file. Nothing was written.",
  },
  truncated: {
    title: "The bundle is incomplete",
    action: "Choose the original file again; a partial copy or interrupted download cannot be restored.",
  },
  integrity_failed: {
    title: "The bundle does not match its own hashes",
    action: "The file was modified or damaged after export. Export it again and restore that copy. Nothing was activated.",
  },
  incompatible_schema: {
    title: "This bundle needs a newer Studio",
    action: "It was written with a newer bundle schema. Update this Studio, then restore the bundle again.",
  },
  secret_material_present: {
    title: "The bundle contains a credential-shaped field",
    action: "This Studio refuses it. Export again from a Studio you trust; no provider key or session should ever be in a bundle.",
  },
  bundle_too_large: {
    title: "The bundle is larger than this Studio supports",
    action: "A bundle carries at most 200 assets, 1.5 MB of records and 512 MB of media. Nothing was written.",
  },
  insufficient_storage: {
    title: "Not enough storage in this studio",
    action: "The bundle's media would exceed this installation's configured storage limit. Free space or raise STUDIO_PORTABLE_STORAGE_LIMIT_BYTES deliberately, then preview again. Nothing was written.",
  },
  project_id_exists: {
    title: "That project is already in this studio",
    action: "A project with the bundle's source id already exists here. Restore into a fresh installation, or open that project instead of creating a duplicate.",
  },
  project_slug_exists: {
    title: "Another project already uses that address",
    action: "This studio has a project with the bundle's slug. Restore into a fresh installation, or rename the existing project deliberately first.",
  },
  source_project_exists: {
    title: "A different bundle from this project is already restored",
    action: "Restore a newer export into a fresh installation, or remove the restored project deliberately. Nothing was overwritten.",
  },
  already_imported: {
    title: "That bundle is already in this studio",
    action: "Open the studio it restored. Restoring it again would create a duplicate, so it was not repeated.",
  },
  missing_media: {
    title: "Some files have not reached storage",
    action: "Retry continues the same restore and sends only the missing files. Nothing was activated.",
    retryable: true,
  },
  size_mismatch: {
    title: "A file changed while restoring",
    action: "The bytes read now do not match the bundle. Choose the original file again and retry. Nothing was activated.",
    retryable: true,
  },
  unsupported_type: {
    title: "A file does not match its recorded type",
    action: "The bundle or the file is corrupt. Export the project again; this restore is refused.",
  },
  staging_conflict: {
    title: "Another object already uses this restore path",
    action: "Start a fresh restore of this bundle, or remove the earlier staged files first. Nothing was overwritten.",
    retryable: true,
  },
  import_not_staging: {
    title: "This restore is no longer accepting files",
    action: "Preview the bundle again to start a new restore. Nothing was activated.",
    retryable: true,
  },
  import_not_found: {
    title: "That restore no longer exists",
    action: "Choose the bundle again to start a new restore.",
    retryable: true,
  },
  network: {
    title: "This studio could not be reached",
    action: "Check the connection and try again. Retrying continues the same restore; nothing is duplicated.",
    retryable: true,
  },
};

export function restoreProblem(error: unknown): RestoreProblem {
  if (error instanceof RestoreFlowError)
    return problemFor(error.code, error.message);
  if (error instanceof PortableError) {
    const report = (error as unknown as { report?: PreviewReport | null }).report;
    return problemFor(error.code || "invalid_bundle", error.message, report?.blockers?.[0]);
  }
  const value = error as { code?: string; message?: string; status?: number; report?: PreviewReport | null; name?: string } | null;
  if (value?.report?.blockers?.[0])
    return problemFor(String(value.code ?? "invalid_bundle"), String(value.message ?? ""), value.report.blockers[0]);
  if (value && typeof value.code === "string" && PROBLEMS[value.code])
    return problemFor(value.code, String(value.message ?? ""));
  if (value && value.name === "TypeError")
    return problemFor("network", "The request did not complete.");
  if (value && typeof value.message === "string")
    return problemFor("invalid_bundle", value.message);
  return problemFor("invalid_bundle", "The restore stopped unexpectedly.");
}

function problemFor(code: string, detail: string, overrideCode?: string): RestoreProblem {
  const resolved = overrideCode && PROBLEMS[overrideCode] ? overrideCode : code;
  const known = PROBLEMS[resolved];
  if (!known)
    return {
      code: resolved || "invalid_bundle",
      title: "The restore was refused",
      detail: detail || "This Studio refused the request.",
      action: "Nothing was activated. Preview the bundle again after checking the file.",
      retryable: false,
    };
  return {
    code: resolved,
    title: known.title,
    detail: detail || known.title,
    action: known.action,
    retryable: known.retryable === true,
  };
}

export interface CommitCounts extends PreviewPlan {
  contentBytes?: number;
}

/** The success line uses the counts the server returned at commit. */
export function commitSentence(counts: CommitCounts | undefined, name: string | undefined): string {
  const parts = [
    count(counts?.mediaAssets ?? counts?.assets, "file"),
    formatBytes(counts?.contentBytes),
    counts?.generations ? count(counts.generations, "generation") : "",
    counts?.compositions ? count(counts.compositions, "storyboard") : "",
    counts?.subjects ? count(counts.subjects, "subject version") : "",
    counts?.songPlans ? count(counts.songPlans, "song plan") : "",
    counts?.publications ? count(counts.publications, "private publication") : "",
  ].filter(Boolean);
  return `${name ? `“${name}”` : "The studio"} was restored with ${parts.join(", ")}.`;
}
