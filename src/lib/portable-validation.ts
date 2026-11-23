// MIT. Full validation for portable Studio project manifests, typed.
//
// This is the pure owning validator for the sealed manifest shape: format,
// project fields, media blobs, asset records, cross-record references,
// dependency cycles, credential-shaped fields and the existing size bounds.
// portable-bundle.mjs imports validateManifest and re-exports it unchanged, so
// the owner worker, CLI, archive container and tests still use the one
// portable-bundle.mjs export path and the one PortableError class.
//
// D1 reads, R2 staging, id rewriting, commit and cleanup stay in
// portable-bundle.mjs. Nothing here writes, authorizes, stages or transports
// anything; the input stays `unknown` until the runtime checks below accept it.

import {
  MAX_PORTABLE_ASSET_BYTES,
  MAX_PORTABLE_BUNDLE_BYTES,
  MAX_PORTABLE_ASSETS,
  MAX_PORTABLE_MANIFEST_BYTES,
  MAX_PORTABLE_RECORDS,
  SHA256_HEX as SHA,
  canonicalJson,
  invalid,
  verifyManifestSeal,
} from "./portable-manifest.ts";

/** Per-kind entry limits used by export, validation and staging alike. */
export const IMAGE_BYTES: number = 32 * 1024 * 1024;
export const AUDIO_BYTES: number = 32 * 1024 * 1024;

/** Accepted manifest MIME types, mapped to the asset kind they must match. */
const MIME_KINDS = new Map<string, string>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/avif", "image"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["audio/mpeg", "audio"],
  ["audio/wav", "audio"],
  ["audio/mp4", "audio"],
  ["audio/ogg", "audio"],
]);

/** Record keys whose string value must name an asset in the same bundle. */
export const ASSET_ID_KEYS: ReadonlySet<string> = new Set([
  "assetId",
  "referenceAssetId",
  "maskAssetId",
  "parentAssetId",
  "outputAssetId",
  "posterAssetId",
  "songAssetId",
  "selectedTakeId",
  "slateAssetId",
  "slateVideoAssetId",
  "audioAssetId",
  "sourceAssetId",
]);

/** Credential-shaped field names that must never appear in a bundle. */
const SECRET_KEY =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|session[_-]?(cookie|secret|key)|provider[_-]?key|secret|passphrase|password|authorization|private[_-]?key|fal[_-]?key|client[_-]?secret)/i;

/** The one id alphabet the D1 writer can safely receive. */
const SAFE_ID = /^[a-z0-9_:-]{1,100}$/;

/** A JSON object, arrays included, matching the old `typeof === "object"` checks. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A non-array JSON object, for the places the old checks rejected arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

/** Read one key without throwing on a primitive or null intermediate. */
function readField(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

/** Narrow a list member to one of the accepted string literals. */
function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function integer(
  value: unknown,
  label: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {}
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    invalid(`${label} is not a supported integer`);
  return value;
}

function string(value: unknown, label: string, max = 2000): string {
  if (typeof value !== "string" || value.length > max)
    invalid(`${label} is not supported text`);
  return value;
}

/** Refuse credential-shaped keys anywhere in the manifest. */
export function scanSecrets(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key))
      invalid(
        `The bundle contains a credential-shaped field at ${path}.${key}`,
        "secret_material_present"
      );
    scanSecrets(entry, `${path}.${key}`);
  }
}

/** Visit every string-bearing key in a record tree. */
function walkRefs(
  value: unknown,
  visit: (key: string, value: unknown, path: string) => void,
  path = "$"
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkRefs(entry, visit, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    visit(key, entry, `${path}.${key}`);
    walkRefs(entry, visit, `${path}.${key}`);
  }
}

/** Asset ids may be a Set or the keyed asset Map; both only need `has`. */
type PortableAssetIds = ReadonlySet<string> | ReadonlyMap<string, unknown>;

function assertAssetRef(
  assetIds: PortableAssetIds,
  value: unknown,
  label: string
): void {
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string" || !assetIds.has(value))
    invalid(
      `${label} refers to media that is not in the bundle`,
      "missing_dependency"
    );
}

function collectRecordRefs(
  record: unknown,
  assetIds: PortableAssetIds,
  label: string
): void {
  walkRefs(record, (key, value) => {
    if (ASSET_ID_KEYS.has(key)) assertAssetRef(assetIds, value, `${label}.${key}`);
    if (key === "assetIds" && Array.isArray(value))
      value.forEach((entry) => assertAssetRef(assetIds, entry, `${label}.assetIds`));
  });
}

/** A blob descriptor after the checks above have accepted it. */
interface PortableBlobRecord {
  sha256: string;
  mime: string;
  bytes: number;
}

/** The asset fields this validator reads for dependency checks. */
interface PortableAssetRecord {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  parentAssetId: unknown;
  generationId: unknown;
}

export interface PortableValidationStats {
  records: number;
  contentBytes: number;
  blobs: number;
  assets: number;
  [key: string]: unknown;
}

export interface ValidatedPortableManifest {
  bundleId: string;
  project: Record<string, unknown>;
  stats: PortableValidationStats;
}

/** Full validation, independent of the archive container. */
export async function validateManifest(
  manifest: unknown
): Promise<ValidatedPortableManifest> {
  const bundleId = await verifyManifestSeal(manifest);
  if (!isRecord(manifest)) invalid("Send a bundle manifest");
  if (
    new TextEncoder().encode(canonicalJson(manifest)).byteLength >
    MAX_PORTABLE_MANIFEST_BYTES
  )
    invalid("The bundle records exceed the supported manifest size", "bundle_too_large");
  scanSecrets(manifest);

  const project = manifest.project;
  if (!isRecord(project)) invalid("The bundle has no project record");
  const projectId = string(project.id, "Project id", 80);
  string(project.name, "Project name", 80);
  const projectSlug = string(project.slug, "Project slug", 80);
  string(project.creativeDirection ?? "", "Creative direction", 600);
  string(project.visibility ?? "private", "Visibility", 20);
  if (!SAFE_ID.test(projectId)) invalid("The project id is not a supported Studio id");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectSlug))
    invalid("The project slug is not supported");
  if (project.visibility !== "private" && project.visibility !== "unlisted")
    invalid("The project visibility is not supported");
  if (!Array.isArray(project.references) || project.references.length > 12)
    invalid("The project references are not supported");
  if (!isRecord(project.defaults))
    invalid("The project defaults are not supported");
  integer(project.createdAt, "Project created time");
  integer(project.updatedAt, "Project updated time");

  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_PORTABLE_ASSETS)
    invalid("The bundle asset list is too large");
  if (!Array.isArray(manifest.blobs) || manifest.blobs.length > MAX_PORTABLE_ASSETS)
    invalid("The bundle blob list is too large");

  const blobBySha = new Map<string, PortableBlobRecord>();
  let totalBytes = 0;
  for (const blob of manifest.blobs) {
    if (!isObject(blob)) invalid("A bundle blob entry is malformed");
    const sha = blob.sha256;
    if (typeof sha !== "string" || !SHA.test(sha))
      invalid("A bundle blob has an invalid hash");
    if (blobBySha.has(sha)) invalid("A bundle blob is listed twice", "duplicate_entry");
    if (blob.path !== `assets/${sha}`)
      invalid("A bundle blob path is not content-addressed", "path_traversal");
    const blobKind =
      typeof blob.mime === "string" ? MIME_KINDS.get(blob.mime) : undefined;
    const blobLimit =
      blobKind === "video"
        ? MAX_PORTABLE_ASSET_BYTES
        : blobKind === "audio"
          ? AUDIO_BYTES
          : IMAGE_BYTES;
    const bytes = integer(blob.bytes, "Blob size", { min: 1, max: blobLimit });
    if (typeof blob.mime !== "string" || !MIME_KINDS.has(blob.mime))
      invalid(`Unsupported media type ${String(blob.mime)}`);
    const mime = blob.mime;
    totalBytes += bytes;
    blobBySha.set(sha, { sha256: sha, mime, bytes });
  }
  if (totalBytes > MAX_PORTABLE_BUNDLE_BYTES)
    invalid("The bundle exceeds the supported archive size", "bundle_too_large");

  const assets = new Map<string, PortableAssetRecord>();
  for (const asset of manifest.assets) {
    if (!isObject(asset)) invalid("A bundle asset entry is malformed");
    const id = asset.id;
    if (typeof id !== "string" || !SAFE_ID.test(id) || assets.has(id))
      invalid("A bundle asset id is invalid or duplicated", "duplicate_entry");
    const kind = asset.kind;
    if (!isOneOf(kind, ["image", "video", "audio"]))
      invalid("A bundle asset has an unsupported kind");
    if (!isOneOf(asset.source, ["upload", "generated", "variant", "assembled"]))
      invalid("A bundle asset has an unsupported source");
    if (typeof asset.mime !== "string" || MIME_KINDS.get(asset.mime) !== kind)
      invalid("A bundle asset MIME type does not match its kind");
    const mime = asset.mime;
    const entryLimit =
      kind === "video"
        ? MAX_PORTABLE_ASSET_BYTES
        : kind === "audio"
          ? AUDIO_BYTES
          : IMAGE_BYTES;
    const bytes = integer(asset.bytes, "Asset size", { min: 1, max: entryLimit });
    const sha = asset.sha256;
    if (typeof sha !== "string" || !SHA.test(sha))
      invalid("A bundle asset has an invalid fingerprint");
    const content = asset.content;
    if (content !== "media" && content !== "tombstone")
      invalid("A bundle asset content flag is unsupported");
    if (content === "media") {
      const blob =
        typeof asset.blobSha256 === "string"
          ? blobBySha.get(asset.blobSha256)
          : undefined;
      if (!blob) invalid("A live asset has no media bytes in the bundle", "missing_media");
      if (blob.bytes !== bytes || blob.mime !== mime || blob.sha256 !== sha)
        invalid("A live asset disagrees with its media blob", "integrity_failed");
    } else if (asset.blobSha256 !== null)
      invalid("A tombstone cannot carry media bytes");
    if (
      content === "tombstone" &&
      (typeof asset.deletedAt !== "number" || !Number.isSafeInteger(asset.deletedAt))
    )
      invalid("A tombstone must keep its deletion time");
    assets.set(id, {
      id,
      sha256: sha,
      mime,
      bytes,
      parentAssetId: asset.parentAssetId,
      generationId: asset.generationId,
    });
  }

  const records = [
    "generations",
    "compositions",
    "recipes",
    "subjects",
    "songPlans",
    "footagePlans",
    "publications",
    "promoBriefs",
  ] as const;
  const lists: Record<string, unknown[]> = {};
  let recordCount = 0;
  for (const name of records) {
    const list = manifest[name];
    if (!Array.isArray(list)) invalid(`The bundle ${name} list is missing`);
    lists[name] = list;
    recordCount += list.length;
  }
  if (recordCount > MAX_PORTABLE_RECORDS)
    invalid("The bundle has too many records", "bundle_too_large");

  const generations = lists.generations;
  const compositions = lists.compositions;
  const recipes = lists.recipes;
  const subjects = lists.subjects;
  const songPlans = lists.songPlans;
  const footagePlans = lists.footagePlans;
  const publications = lists.publications;
  const promoBriefs = lists.promoBriefs;

  const compositionIds = new Set(compositions.map((row) => readField(row, "id")));
  if (recipes.some((row) => row === null || row === undefined))
    invalid("A recipe record is malformed");
  const recipeIds = new Set(recipes.map((row) => readField(row, "id")));
  const subjectVersions = new Set(
    subjects.map(
      (row) =>
        `${String(readField(row, "subjectId"))}:${String(readField(row, "revision"))}`
    )
  );
  for (const composition of compositions) {
    if (!isObject(composition) || typeof composition.title !== "string")
      invalid("A storyboard record is malformed");
    const spec = composition.spec;
    if (!isRecord(spec)) invalid("A storyboard spec is malformed");
    if (spec.shots !== undefined && !Array.isArray(spec.shots))
      invalid("A storyboard shot list is malformed");
  }
  for (const subject of subjects) {
    if (
      !isObject(subject) ||
      typeof subject.subjectId !== "string" ||
      typeof subject.revision !== "number" ||
      !Number.isSafeInteger(subject.revision) ||
      subject.revision < 1
    )
      invalid("A subject version is malformed");
    if (!isRecord(subject.spec)) invalid("A subject spec is malformed");
  }
  for (const plan of songPlans) {
    const id = readField(plan, "id");
    const spec = readField(plan, "spec");
    if (!isObject(plan) || typeof id !== "string" || !isRecord(spec))
      invalid("A song plan is malformed");
    if (
      !Array.isArray(spec.scenes) ||
      spec.scenes.length < 2 ||
      spec.scenes.length > 6
    )
      invalid("A song plan needs two to six scenes");
  }
  for (const plan of footagePlans) {
    const id = readField(plan, "id");
    const spec = readField(plan, "spec");
    if (!isObject(plan) || typeof id !== "string" || !isRecord(spec))
      invalid("A footage plan is malformed");
    if (
      !Array.isArray(spec.scenes) ||
      spec.scenes.length < 1 ||
      spec.scenes.length > 6
    )
      invalid("A footage plan needs one to six scenes");
  }
  for (const publication of publications) {
    if (!isObject(publication) || typeof publication.title !== "string")
      invalid("A publication record is malformed");
  }
  for (const brief of promoBriefs) {
    const id = readField(brief, "id");
    if (!isObject(brief) || typeof id !== "string" || !isRecord(brief.spec))
      invalid("A promo brief is malformed");
  }
  for (const asset of assets.values()) {
    const parentAssetId =
      typeof asset.parentAssetId === "string" && asset.parentAssetId
        ? asset.parentAssetId
        : null;
    if (asset.parentAssetId)
      assertAssetRef(assets, asset.parentAssetId, `asset ${asset.id}.parentAssetId`);
    if (
      asset.generationId &&
      !generations.some((row) => readField(row, "id") === asset.generationId)
    )
      invalid("An asset refers to a generation outside the bundle", "missing_dependency");
    const trail = new Set([asset.id]);
    let parent = parentAssetId ? assets.get(parentAssetId) : null;
    while (parent) {
      if (trail.has(parent.id))
        invalid("The bundle has a cyclic media dependency", "invalid_bundle");
      trail.add(parent.id);
      parent =
        typeof parent.parentAssetId === "string" && parent.parentAssetId
          ? assets.get(parent.parentAssetId) ?? null
          : null;
    }
  }
  for (const generation of generations) {
    if (!isObject(generation)) invalid("A bundle generation is malformed");
    const kind = generation.kind;
    if (!isOneOf(kind, ["image", "video", "audio"]))
      invalid("A generation has an unsupported kind");
    for (const field of ["model", "provider", "recipeId", "clientRequestId"] as const) {
      const value = generation[field];
      if (typeof value !== "string" || !value)
        invalid(`A generation has no ${field}`);
    }
    const request = generation.request;
    if (!isRecord(request)) invalid("A generation request is malformed");
    const outputAssetId = generation.outputAssetId;
    if (outputAssetId)
      assertAssetRef(
        assets,
        outputAssetId,
        `generation ${String(generation.id)}.outputAssetId`
      );
    const compositionId = generation.compositionId;
    if (compositionId && !compositionIds.has(compositionId))
      invalid("A generation refers to a storyboard outside the bundle", "missing_dependency");
    const recipeId = generation.recipeId;
    if (
      typeof recipeId === "string" &&
      recipeId.startsWith("rcp_") &&
      !recipeIds.has(recipeId)
    )
      invalid(
        "A generation refers to a custom recipe outside the bundle",
        "missing_dependency"
      );
    collectRecordRefs(
      generation.request,
      assets,
      `generation ${String(generation.id)}.request`
    );
  }
  for (const composition of compositions)
    collectRecordRefs(
      readField(composition, "spec"),
      assets,
      `composition ${String(readField(composition, "id"))}`
    );
  for (const subject of subjects) {
    const referenceAssetId = readField(subject, "referenceAssetId");
    assertAssetRef(
      assets,
      referenceAssetId,
      `subject ${String(readField(subject, "subjectId"))}`
    );
    const referenced =
      typeof referenceAssetId === "string"
        ? assets.get(referenceAssetId)
        : undefined;
    if (referenced?.sha256 !== readField(subject, "referenceSha256"))
      invalid("A subject reference fingerprint does not match its asset", "integrity_failed");
  }
  for (const plan of songPlans) {
    const planId = readField(plan, "id");
    const songAssetId = readField(plan, "songAssetId");
    assertAssetRef(assets, songAssetId, `song plan ${String(planId)}.songAssetId`);
    const referenced =
      typeof songAssetId === "string" ? assets.get(songAssetId) : undefined;
    if (referenced?.sha256 !== readField(plan, "songSha256"))
      invalid("A song plan fingerprint does not match its source", "integrity_failed");
    collectRecordRefs(readField(plan, "spec"), assets, `song plan ${String(planId)}`);
    const spec = readField(plan, "spec");
    const scenes = isRecord(spec) && Array.isArray(spec.scenes) ? spec.scenes : [];
    for (const scene of scenes) {
      if (scene === null || scene === undefined)
        invalid("A song plan scene is malformed");
      const origin = readField(scene, "subjectOrigin");
      if (
        origin &&
        !subjectVersions.has(
          `${String(readField(origin, "subjectId"))}:${String(readField(origin, "revision"))}`
        )
      )
        invalid(
          "A song scene refers to a subject version outside the bundle",
          "missing_dependency"
        );
    }
  }
  for (const plan of footagePlans) {
    const planId = readField(plan, "id");
    const sourceAssetId = readField(plan, "sourceAssetId");
    assertAssetRef(
      assets,
      sourceAssetId,
      `footage plan ${String(planId)}.sourceAssetId`
    );
    const referenced =
      typeof sourceAssetId === "string" ? assets.get(sourceAssetId) : undefined;
    if (referenced?.sha256 !== readField(plan, "sourceSha256"))
      invalid("A footage plan fingerprint does not match its source", "integrity_failed");
    collectRecordRefs(readField(plan, "spec"), assets, `footage plan ${String(planId)}`);
  }
  for (const publication of publications) {
    const publicationId = readField(publication, "id");
    assertAssetRef(
      assets,
      readField(publication, "assetId"),
      `publication ${String(publicationId)}.assetId`
    );
    assertAssetRef(
      assets,
      readField(publication, "posterAssetId"),
      `publication ${String(publicationId)}.posterAssetId`
    );
    const publicationSlug = readField(publication, "slug");
    if (
      typeof publicationSlug !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(publicationSlug)
    )
      invalid("A publication slug is not supported");
  }
  for (const brief of promoBriefs)
    collectRecordRefs(
      readField(brief, "spec"),
      assets,
      `promo brief ${String(readField(brief, "id"))}`
    );

  return {
    bundleId,
    project,
    stats: {
      ...Object.assign({}, manifest.stats),
      records: recordCount,
      contentBytes: totalBytes,
      blobs: blobBySha.size,
      assets: assets.size,
    },
  };
}
