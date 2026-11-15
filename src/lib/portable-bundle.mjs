// MIT. Portable Studio project bundles: a private, deterministic archive of
// project records and the exact R2 bytes needed to reopen the work in another
// owner-controlled installation.
//
// The browser-facing export is a manifest. The owner CLI downloads the listed
// media and writes one bounded archive. Import stages bytes under freshly
// owned R2 keys, verifies every hash, then commits D1 rows in one batch.
// Nothing here reads provider credentials or session material.

import { extensionFor, HttpError, id, safeJson, sha256Hex, slug, sniffMedia } from './util.mjs';

export const PORTABLE_FORMAT = 'studio-project-bundle/v1';
export const PORTABLE_SCHEMA_VERSION = 1;
export const PORTABLE_MAGIC = 'STUDIO-PROJECT-BUNDLE/1\n';
export const MAX_PORTABLE_ASSET_BYTES = 64 * 1024 * 1024;
export const MAX_PORTABLE_BUNDLE_BYTES = 512 * 1024 * 1024;
export const MAX_PORTABLE_ASSETS = 200;
export const MAX_PORTABLE_RECORDS = 2000;
export const MAX_PORTABLE_MANIFEST_BYTES = 1_500_000;

const IMAGE_BYTES = 32 * 1024 * 1024;
const AUDIO_BYTES = 32 * 1024 * 1024;

const MIME_KINDS = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['image/avif', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
  ['audio/mpeg', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/mp4', 'audio'],
  ['audio/ogg', 'audio'],
]);
const ASSET_ID_KEYS = new Set([
  'assetId',
  'referenceAssetId',
  'maskAssetId',
  'parentAssetId',
  'outputAssetId',
  'posterAssetId',
  'songAssetId',
  'selectedTakeId',
  'slateAssetId',
  'slateVideoAssetId',
  'audioAssetId',
  'sourceAssetId',
]);
const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|session[_-]?(cookie|secret|key)|provider[_-]?key|secret|passphrase|password|authorization|private[_-]?key|fal[_-]?key|client[_-]?secret)/i;
const SAFE_ID = /^[a-z0-9_:-]{1,100}$/;
const SHA = /^[a-f0-9]{64}$/;

export class PortableError extends Error {
  constructor(status, code, message, report = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.report = report;
  }
}

function invalid(message, code = 'invalid_bundle') {
  throw new PortableError(400, code, message);
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined)) return null;
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${label} is not a supported integer`);
  return value;
}

function string(value, label, max = 2000, { optional = false } = {}) {
  if (optional && (value === null || value === undefined)) return '';
  if (typeof value !== 'string' || value.length > max) invalid(`${label} is not supported text`);
  return value;
}

/** Stable JSON for hashing. Object keys are sorted; array order is meaningful. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256Bytes(bytes) {
  return sha256Hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

function scanSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) invalid(`The bundle contains a credential-shaped field at ${path}.${key}`, 'secret_material_present');
    scanSecrets(entry, `${path}.${key}`);
  }
}

function contentOf(manifest) {
  const { bundleId, integrity, ...content } = manifest;
  return content;
}

export async function sealManifest(content) {
  const sealedContent = { ...content, schemaVersion: PORTABLE_SCHEMA_VERSION };
  const digest = await sha256Bytes(new TextEncoder().encode(canonicalJson(sealedContent)));
  return {
    ...sealedContent,
    bundleId: digest,
    integrity: { algorithm: 'sha256', contentSha256: digest, treeSha256: digest },
  };
}

export async function verifyManifestSeal(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) invalid('Send a bundle manifest');
  if (manifest.format !== PORTABLE_FORMAT) invalid(`Unsupported bundle format ${String(manifest.format)}`);
  if (manifest.schemaVersion !== PORTABLE_SCHEMA_VERSION) invalid(`Unsupported bundle schema version ${String(manifest.schemaVersion)}`, 'incompatible_schema');
  const digest = await sha256Bytes(new TextEncoder().encode(canonicalJson(contentOf(manifest))));
  const tree = manifest.integrity?.treeSha256;
  if (manifest.integrity?.algorithm !== 'sha256' || !SHA.test(manifest.integrity?.contentSha256 ?? '') || !SHA.test(tree ?? ''))
    invalid('The bundle integrity record is missing or malformed', 'integrity_failed');
  if (manifest.integrity.contentSha256 !== digest || tree !== digest || manifest.bundleId !== digest)
    invalid('The bundle manifest changed after it was sealed', 'integrity_failed');
  return digest;
}

/** Build a manifest from D1 metadata. Media bytes are read by the export CLI,
 * which verifies each stored hash before writing it into the archive. */
export async function exportProjectManifest(env, project) {
  const rows = async (sql, ...bind) => (await env.DB.prepare(sql).bind(...bind).all()).results;
  const assets = await rows('SELECT * FROM assets WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const generations = await rows('SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const compositions = await rows('SELECT * FROM compositions WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const recipes = await rows('SELECT * FROM recipes WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const subjects = await rows('SELECT * FROM subject_versions WHERE project_id=?1 ORDER BY subject_id ASC,revision ASC', project.id);
  const songPlans = await rows('SELECT * FROM song_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const footagePlans = await rows('SELECT * FROM footage_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const publications = await rows('SELECT * FROM publications WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);
  const promoBriefs = await rows('SELECT * FROM promo_briefs WHERE project_id=?1 ORDER BY created_at ASC,id ASC', project.id);

  if (assets.length > MAX_PORTABLE_ASSETS) throw new HttpError(413, `A portable bundle carries at most ${MAX_PORTABLE_ASSETS} asset records.`, 'bundle_too_large');
  const recordCount = generations.length + compositions.length + recipes.length + subjects.length + songPlans.length + footagePlans.length + publications.length + promoBriefs.length;
  if (recordCount > MAX_PORTABLE_RECORDS) throw new HttpError(413, `A portable bundle carries at most ${MAX_PORTABLE_RECORDS} record rows.`, 'bundle_too_large');
  const blobs = new Map();
  const assetRecords = [];
  for (const asset of assets) {
    const media = asset.deleted_at === null;
    const blobSha = media ? String(asset.sha256 ?? '') : null;
    if (media && !SHA.test(blobSha)) throw new HttpError(409, `Asset ${asset.id} has no usable fingerprint.`, 'asset_without_hash');
    const entryLimit = asset.kind === 'video' ? MAX_PORTABLE_ASSET_BYTES : asset.kind === 'audio' ? AUDIO_BYTES : IMAGE_BYTES;
    if (media && Number(asset.bytes) > entryLimit) throw new HttpError(413, `Asset ${asset.id} is larger than one archive entry allows.`, 'bundle_too_large');
    if (media) {
      const existing = blobs.get(blobSha);
      if (existing && (existing.bytes !== Number(asset.bytes) || existing.mime !== asset.mime))
        throw new HttpError(409, `Asset ${asset.id} disagrees with another copy of the same bytes.`, 'asset_mime_conflict');
      if (!existing) blobs.set(blobSha, { sha256: blobSha, path: `assets/${blobSha}`, bytes: Number(asset.bytes), mime: asset.mime });
    }
    assetRecords.push({
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      bytes: Number(asset.bytes),
      blobSha256: media ? blobSha : null,
      content: media ? 'media' : 'tombstone',
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration_ms,
      sampleRate: asset.sample_rate ?? null,
      channels: asset.channels ?? null,
      sha256: asset.sha256,
      title: asset.title,
      caption: asset.caption,
      source: asset.source,
      parentAssetId: asset.parent_asset_id,
      generationId: asset.generation_id,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      deletedAt: asset.deleted_at,
      deleteRevision: asset.delete_revision,
    });
  }

  const totalBlobBytes = [...blobs.values()].reduce((sum, blob) => sum + blob.bytes, 0);
  if (totalBlobBytes > MAX_PORTABLE_BUNDLE_BYTES) throw new HttpError(413, 'This project is larger than one portable archive allows.', 'bundle_too_large');

  const content = {
    format: PORTABLE_FORMAT,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      creativeDirection: project.creative_direction,
      references: safeJson(project.references_json, []),
      visibility: project.visibility,
      defaults: safeJson(project.defaults_json, {}),
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    },
    blobs: [...blobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    assets: assetRecords,
    generations: generations.map((row) => ({
      id: row.id,
      compositionId: row.composition_id ?? null,
      clientRequestId: row.client_request_id,
      kind: row.kind,
      recipeId: row.recipe_id,
      provider: row.provider,
      model: row.model,
      modelVersion: row.model_version,
      request: safeJson(row.request_json, {}),
      providerRequestId: null,
      providerStatusUrl: null,
      providerResponseUrl: null,
      status: row.status,
      errorCode: row.error_code,
      errorDetail: row.error_detail,
      retainedBytes: row.retained_bytes,
      retainedMime: row.retained_mime,
      outputAssetId: row.output_asset_id,
      costEstimateMicro: row.cost_estimate_micro,
      costReservedMicro: row.cost_reserved_micro,
      costAllocatedMicro: row.cost_allocated_micro,
      providerChargedMicro: row.provider_charged_micro ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      deletedAt: row.deleted_at,
      deleteRevision: row.delete_revision,
    })),
    compositions: compositions.map((row) => ({
      id: row.id,
      title: row.title,
      spec: safeJson(row.spec_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    recipes: recipes.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      kind: row.kind,
      promptTemplate: row.prompt_template,
      controls: safeJson(row.controls_json, []),
      version: row.version,
      createdAt: row.created_at,
    })),
    subjects: subjects.map((row) => ({
      subjectId: row.subject_id,
      revision: row.revision,
      spec: safeJson(row.spec_json, {}),
      referenceAssetId: row.reference_asset_id,
      referenceSha256: row.reference_sha256,
      createdAt: row.created_at,
    })),
    songPlans: songPlans.map((row) => ({
      id: row.id,
      songAssetId: row.song_asset_id,
      songSha256: row.song_sha256,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    footagePlans: footagePlans.map((row) => ({
      id: row.id,
      sourceAssetId: row.source_asset_id,
      sourceSha256: row.source_sha256,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    publications: publications.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      posterAssetId: row.poster_asset_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      assetRevision: row.asset_revision,
      listed: row.listed,
      hidden: row.hidden,
      attribution: safeJson(row.attribution_json, []),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    })),
    promoBriefs: promoBriefs.map((row) => ({
      id: row.id,
      spec: safeJson(row.spec_json, {}),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    excluded: [
      'Studio provider keys, worker secrets, session cookies and bearer tokens',
      'Composer workspace binding and grant checks',
      'MCP OAuth clients, codes, tokens and spend reservations',
      'Monthly budget reservations (restore never invents bills)',
      'Signed media URLs, render links, local-render and footage-export receipts',
      'Installation-wide publication policies (restored publications stay private)',
    ],
    limits: {
      maxAssetBytes: MAX_PORTABLE_ASSET_BYTES,
      maxBundleBytes: MAX_PORTABLE_BUNDLE_BYTES,
      maxAssets: MAX_PORTABLE_ASSETS,
      maxRecords: MAX_PORTABLE_RECORDS,
    },
    stats: {
      assets: assetRecords.length,
      mediaAssets: assetRecords.filter((asset) => asset.content === 'media').length,
      tombstones: assetRecords.filter((asset) => asset.content === 'tombstone').length,
      blobs: blobs.size,
      contentBytes: totalBlobBytes,
      generations: generations.length,
      compositions: compositions.length,
      recipes: recipes.length,
      subjects: subjects.length,
      songPlans: songPlans.length,
      footagePlans: footagePlans.length,
      publications: publications.length,
      promoBriefs: promoBriefs.length,
    },
  };
  scanSecrets(content);
  const sealed = await sealManifest(content);
  await validateManifest(sealed);
  return sealed;
}

function walkRefs(value, visit, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => walkRefs(entry, visit, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    visit(key, entry, `${path}.${key}`);
    walkRefs(entry, visit, `${path}.${key}`);
  }
}

function assertAssetRef(assetIds, value, label) {
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'string' || !assetIds.has(value)) invalid(`${label} refers to media that is not in the bundle`, 'missing_dependency');
}

function collectRecordRefs(record, assetIds, label) {
  walkRefs(record, (key, value) => {
    if (ASSET_ID_KEYS.has(key)) assertAssetRef(assetIds, value, `${label}.${key}`);
    if (key === 'assetIds' && Array.isArray(value)) value.forEach((entry) => assertAssetRef(assetIds, entry, `${label}.assetIds`));
  });
}

/** Full validation, independent of the archive container. */
export async function validateManifest(manifest) {
  await verifyManifestSeal(manifest);
  if (new TextEncoder().encode(canonicalJson(manifest)).byteLength > MAX_PORTABLE_MANIFEST_BYTES)
    invalid('The bundle records exceed the supported manifest size', 'bundle_too_large');
  scanSecrets(manifest);
  const project = manifest.project;
  if (!project || typeof project !== 'object' || Array.isArray(project)) invalid('The bundle has no project record');
  string(project.id, 'Project id', 80); string(project.name, 'Project name', 80); string(project.slug, 'Project slug', 80);
  string(project.creativeDirection ?? '', 'Creative direction', 600); string(project.visibility ?? 'private', 'Visibility', 20);
  if (!SAFE_ID.test(project.id)) invalid('The project id is not a supported Studio id');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(project.slug)) invalid('The project slug is not supported');
  if (!['private', 'unlisted'].includes(project.visibility)) invalid('The project visibility is not supported');
  if (!Array.isArray(project.references) || project.references.length > 12) invalid('The project references are not supported');
  if (!project.defaults || typeof project.defaults !== 'object' || Array.isArray(project.defaults)) invalid('The project defaults are not supported');
  integer(project.createdAt, 'Project created time'); integer(project.updatedAt, 'Project updated time');

  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_PORTABLE_ASSETS) invalid('The bundle asset list is too large');
  if (!Array.isArray(manifest.blobs) || manifest.blobs.length > MAX_PORTABLE_ASSETS) invalid('The bundle blob list is too large');
  const blobBySha = new Map();
  let totalBytes = 0;
  for (const blob of manifest.blobs) {
    if (!blob || typeof blob !== 'object') invalid('A bundle blob entry is malformed');
    if (!SHA.test(blob.sha256 ?? '')) invalid('A bundle blob has an invalid hash');
    if (blobBySha.has(blob.sha256)) invalid('A bundle blob is listed twice', 'duplicate_entry');
    if (blob.path !== `assets/${blob.sha256}`) invalid('A bundle blob path is not content-addressed', 'path_traversal');
    const blobKind = MIME_KINDS.get(blob.mime);
    const blobLimit = blobKind === 'video' ? MAX_PORTABLE_ASSET_BYTES : blobKind === 'audio' ? AUDIO_BYTES : IMAGE_BYTES;
    integer(blob.bytes, 'Blob size', { min: 1, max: blobLimit });
    if (!MIME_KINDS.has(blob.mime)) invalid(`Unsupported media type ${String(blob.mime)}`);
    totalBytes += blob.bytes;
    blobBySha.set(blob.sha256, blob);
  }
  if (totalBytes > MAX_PORTABLE_BUNDLE_BYTES) invalid('The bundle exceeds the supported archive size', 'bundle_too_large');

  const assets = new Map();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== 'object') invalid('A bundle asset entry is malformed');
    if (typeof asset.id !== 'string' || !SAFE_ID.test(asset.id) || assets.has(asset.id)) invalid('A bundle asset id is invalid or duplicated', 'duplicate_entry');
    if (!['image', 'video', 'audio'].includes(asset.kind)) invalid('A bundle asset has an unsupported kind');
    if (!['upload', 'generated', 'variant', 'assembled'].includes(asset.source)) invalid('A bundle asset has an unsupported source');
    if (MIME_KINDS.get(asset.mime) !== asset.kind) invalid('A bundle asset MIME type does not match its kind');
    const entryLimit = asset.kind === 'video' ? MAX_PORTABLE_ASSET_BYTES : asset.kind === 'audio' ? AUDIO_BYTES : IMAGE_BYTES;
    integer(asset.bytes, 'Asset size', { min: 1, max: entryLimit });
    if (!SHA.test(asset.sha256 ?? '')) invalid('A bundle asset has an invalid fingerprint');
    if (asset.content !== 'media' && asset.content !== 'tombstone') invalid('A bundle asset content flag is unsupported');
    if (asset.content === 'media') {
      const blob = blobBySha.get(asset.blobSha256);
      if (!blob) invalid('A live asset has no media bytes in the bundle', 'missing_media');
      if (blob.bytes !== asset.bytes || blob.mime !== asset.mime || blob.sha256 !== asset.sha256) invalid('A live asset disagrees with its media blob', 'integrity_failed');
    } else if (asset.blobSha256 !== null) invalid('A tombstone cannot carry media bytes');
    if (asset.content === 'tombstone' && !Number.isSafeInteger(asset.deletedAt)) invalid('A tombstone must keep its deletion time');
    assets.set(asset.id, asset);
  }

  const records = ['generations', 'compositions', 'recipes', 'subjects', 'songPlans', 'footagePlans', 'publications', 'promoBriefs'];
  let recordCount = 0;
  for (const name of records) {
    if (!Array.isArray(manifest[name])) invalid(`The bundle ${name} list is missing`);
    recordCount += manifest[name].length;
  }
  if (recordCount > MAX_PORTABLE_RECORDS) invalid('The bundle has too many records', 'bundle_too_large');

  const compositionIds = new Set(manifest.compositions.map((row) => row.id));
  const recipeIds = new Set(manifest.recipes.map((row) => row.id));
  const subjectVersions = new Set(manifest.subjects.map((row) => `${row.subjectId}:${row.revision}`));
  for (const composition of manifest.compositions) {
    if (!composition || typeof composition !== 'object' || typeof composition.title !== 'string') invalid('A storyboard record is malformed');
    if (!composition.spec || typeof composition.spec !== 'object' || Array.isArray(composition.spec)) invalid('A storyboard spec is malformed');
    if (composition.spec.shots !== undefined && !Array.isArray(composition.spec.shots)) invalid('A storyboard shot list is malformed');
  }
  for (const subject of manifest.subjects) {
    if (!subject || typeof subject.subjectId !== 'string' || !Number.isSafeInteger(subject.revision) || subject.revision < 1) invalid('A subject version is malformed');
    if (!subject.spec || typeof subject.spec !== 'object' || Array.isArray(subject.spec)) invalid('A subject spec is malformed');
  }
  for (const plan of manifest.songPlans) {
    if (!plan || typeof plan.id !== 'string' || !plan.spec || typeof plan.spec !== 'object' || Array.isArray(plan.spec)) invalid('A song plan is malformed');
    if (!Array.isArray(plan.spec.scenes) || plan.spec.scenes.length < 2 || plan.spec.scenes.length > 6) invalid('A song plan needs two to six scenes');
  }
  for (const plan of manifest.footagePlans) {
    if (!plan || typeof plan.id !== 'string' || !plan.spec || typeof plan.spec !== 'object' || Array.isArray(plan.spec)) invalid('A footage plan is malformed');
    if (!Array.isArray(plan.spec.scenes) || plan.spec.scenes.length < 1 || plan.spec.scenes.length > 6) invalid('A footage plan needs one to six scenes');
  }
  for (const publication of manifest.publications) {
    if (!publication || typeof publication.title !== 'string') invalid('A publication record is malformed');
  }
  for (const brief of manifest.promoBriefs) {
    if (!brief || typeof brief.id !== 'string' || !brief.spec || typeof brief.spec !== 'object' || Array.isArray(brief.spec)) invalid('A promo brief is malformed');
  }
  for (const asset of assets.values()) {
    if (asset.parentAssetId) assertAssetRef(assets, asset.parentAssetId, `asset ${asset.id}.parentAssetId`);
    if (asset.generationId && !manifest.generations.some((row) => row.id === asset.generationId)) invalid('An asset refers to a generation outside the bundle', 'missing_dependency');
    const trail = new Set([asset.id]);
    let parent = asset.parentAssetId ? assets.get(asset.parentAssetId) : null;
    while (parent) {
      if (trail.has(parent.id)) invalid('The bundle has a cyclic media dependency', 'invalid_bundle');
      trail.add(parent.id);
      parent = parent.parentAssetId ? assets.get(parent.parentAssetId) : null;
    }
  }
  for (const generation of manifest.generations) {
    if (!generation || typeof generation !== 'object') invalid('A bundle generation is malformed');
    if (!['image', 'video', 'audio'].includes(generation.kind)) invalid('A generation has an unsupported kind');
    for (const field of ['model', 'provider', 'recipeId', 'clientRequestId']) {
      if (typeof generation[field] !== 'string' || !generation[field]) invalid(`A generation has no ${field}`);
    }
    if (!generation.request || typeof generation.request !== 'object' || Array.isArray(generation.request)) invalid('A generation request is malformed');
    if (generation.outputAssetId) assertAssetRef(assets, generation.outputAssetId, `generation ${generation.id}.outputAssetId`);
    if (generation.compositionId && !compositionIds.has(generation.compositionId)) invalid('A generation refers to a storyboard outside the bundle', 'missing_dependency');
    if (typeof generation.recipeId === 'string' && generation.recipeId.startsWith('rcp_') && !recipeIds.has(generation.recipeId)) invalid('A generation refers to a custom recipe outside the bundle', 'missing_dependency');
    collectRecordRefs(generation.request, assets, `generation ${generation.id}.request`);
  }
  for (const composition of manifest.compositions) collectRecordRefs(composition.spec, assets, `composition ${composition.id}`);
  for (const subject of manifest.subjects) {
    assertAssetRef(assets, subject.referenceAssetId, `subject ${subject.subjectId}`);
    if (assets.get(subject.referenceAssetId)?.sha256 !== subject.referenceSha256) invalid('A subject reference fingerprint does not match its asset', 'integrity_failed');
  }
  for (const plan of manifest.songPlans) {
    assertAssetRef(assets, plan.songAssetId, `song plan ${plan.id}.songAssetId`);
    if (assets.get(plan.songAssetId)?.sha256 !== plan.songSha256) invalid('A song plan fingerprint does not match its source', 'integrity_failed');
    collectRecordRefs(plan.spec, assets, `song plan ${plan.id}`);
    for (const scene of plan.spec?.scenes ?? []) {
      if (scene.subjectOrigin && !subjectVersions.has(`${scene.subjectOrigin.subjectId}:${scene.subjectOrigin.revision}`)) invalid('A song scene refers to a subject version outside the bundle', 'missing_dependency');
    }
  }
  for (const plan of manifest.footagePlans) {
    assertAssetRef(assets, plan.sourceAssetId, `footage plan ${plan.id}.sourceAssetId`);
    if (assets.get(plan.sourceAssetId)?.sha256 !== plan.sourceSha256) invalid('A footage plan fingerprint does not match its source', 'integrity_failed');
    collectRecordRefs(plan.spec, assets, `footage plan ${plan.id}`);
  }
  for (const publication of manifest.publications) {
    assertAssetRef(assets, publication.assetId, `publication ${publication.id}.assetId`);
    assertAssetRef(assets, publication.posterAssetId, `publication ${publication.id}.posterAssetId`);
    if (typeof publication.slug !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(publication.slug)) invalid('A publication slug is not supported');
  }
  for (const brief of manifest.promoBriefs) collectRecordRefs(brief.spec, assets, `promo brief ${brief.id}`);

  return {
    bundleId: manifest.bundleId,
    project: manifest.project,
    stats: {
      ...manifest.stats,
      records: recordCount,
      contentBytes: totalBytes,
      blobs: blobBySha.size,
      assets: assets.size,
    },
  };
}

function repoKey(projectId, assetId, mime) {
  return `projects/${projectId}/assets/${assetId}/original.${extensionFor(mime)}`;
}

function newMap(manifest) {
  const map = { assets: {}, subjects: {}, plans: {}, footage: {}, compositions: {}, generations: {}, recipes: {}, publications: {}, promos: {} };
  for (const asset of manifest.assets) map.assets[asset.id] = id('asset');
  for (const subject of manifest.subjects) map.subjects[subject.subjectId] ??= id('sub');
  for (const plan of manifest.songPlans) map.plans[plan.id] = id('plan');
  for (const plan of manifest.footagePlans) map.footage[plan.id] = id('foot');
  for (const composition of manifest.compositions) map.compositions[composition.id] = id('cmp');
  for (const generation of manifest.generations) map.generations[generation.id] = id('gen');
  for (const recipe of manifest.recipes) map.recipes[recipe.id] = id('rcp');
  for (const publication of manifest.publications) map.publications[publication.id] = id('pub');
  for (const promo of manifest.promoBriefs) map.promos[promo.id] = id('promo');
  return map;
}

function rewrite(value, map, key = '') {
  if (Array.isArray(value)) return value.map((entry) => rewrite(entry, map, key));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [childKey, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      if (ASSET_ID_KEYS.has(childKey) && map.assets[entry]) { output[childKey] = map.assets[entry]; continue; }
      if (childKey === 'subjectId' && map.subjects[entry]) { output[childKey] = map.subjects[entry]; continue; }
      if (childKey === 'compositionId' && map.compositions[entry]) { output[childKey] = map.compositions[entry]; continue; }
      if ((childKey === 'planId' || childKey === 'songPlanId') && map.plans[entry]) { output[childKey] = map.plans[entry]; continue; }
      if (childKey === 'recipeId' && map.recipes[entry]) { output[childKey] = map.recipes[entry]; continue; }
    }
    if (childKey === 'assetIds' && Array.isArray(entry)) { output[childKey] = entry.map((item) => map.assets[item] ?? item); continue; }
    if (childKey === 'originSongPlan' && entry && typeof entry === 'object') {
      output[childKey] = { ...rewrite(entry, map, childKey), id: map.plans[entry.id] ?? entry.id };
      continue;
    }
    output[childKey] = rewrite(entry, map, childKey);
  }
  return output;
}

function statementsFor(env, manifest, row) {
  const map = JSON.parse(row.id_map_json);
  const projectId = row.project_id;
  const now = Date.now();
  const statements = [];
  const project = manifest.project;
  statements.push(env.DB.prepare(
    'INSERT INTO projects(id,name,slug,creative_direction,references_json,visibility,defaults_json,workspace_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9)',
  ).bind(projectId, project.name, project.slug, project.creativeDirection ?? '', JSON.stringify(rewrite(project.references ?? [], map)), project.visibility ?? 'private', JSON.stringify(rewrite(project.defaults ?? {}, map)), project.createdAt, project.updatedAt));

  // Assets are inserted parents-first because parent_asset_id is a real FK.
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const ordered = [];
  const seen = new Set();
  const visit = (asset, trail = new Set()) => {
    if (!asset || seen.has(asset.id)) return;
    if (trail.has(asset.id)) throw new PortableError(400, 'media_dependency_cycle', 'The bundle has a cyclic media dependency');
    trail.add(asset.id);
    if (asset.parentAssetId) visit(assets.get(asset.parentAssetId), trail);
    trail.delete(asset.id);
    seen.add(asset.id);
    ordered.push(asset);
  };
  manifest.assets.forEach((asset) => visit(asset));
  for (const asset of ordered) {
    const assetId = map.assets[asset.id];
    const mime = asset.mime;
    statements.push(env.DB.prepare(
      'INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sample_rate,channels,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at,deleted_at,delete_revision,erasure_pending) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,0)',
    ).bind(assetId, projectId, asset.kind, repoKey(projectId, assetId, mime), mime, asset.bytes, asset.width ?? null, asset.height ?? null, asset.durationMs ?? null, asset.sampleRate ?? null, asset.channels ?? null, asset.sha256, asset.title ?? '', asset.caption ?? '', asset.source, asset.parentAssetId ? map.assets[asset.parentAssetId] : null, asset.generationId ? map.generations[asset.generationId] : null, asset.createdAt, asset.updatedAt, asset.deletedAt ?? null, asset.deleteRevision ?? 1));
  }

  for (const composition of manifest.compositions) {
    statements.push(env.DB.prepare('INSERT INTO compositions(id,project_id,title,spec_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6)')
      .bind(map.compositions[composition.id], projectId, composition.title, JSON.stringify(rewrite(composition.spec, map)), composition.createdAt, composition.updatedAt));
  }
  for (const recipe of manifest.recipes) {
    statements.push(env.DB.prepare('INSERT INTO recipes(id,project_id,slug,title,description,kind,prompt_template,controls_json,version,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
      .bind(map.recipes[recipe.id], projectId, recipe.slug, recipe.title, recipe.description, recipe.kind, recipe.promptTemplate, JSON.stringify(recipe.controls ?? []), recipe.version ?? 1, recipe.createdAt));
  }
  for (const generation of manifest.generations) {
    // A restore is not a provider resume. Anything that was not already saved
    // becomes a terminal, non-dispatchable historical record.
    const settled = generation.status === 'saved';
    const status = settled ? 'saved' : 'failed';
    statements.push(env.DB.prepare(
      'INSERT INTO generations(id,project_id,composition_id,client_request_id,kind,recipe_id,provider,model,model_version,request_json,provider_request_id,provider_status_url,provider_response_url,status,error_code,error_detail,retained_key,retained_mime,retained_bytes,output_asset_id,cost_estimate_micro,cost_reserved_micro,cost_allocated_micro,provider_charged_micro,created_at,updated_at,submitted_at,completed_at,cancelled_at,deleted_at,delete_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,NULL,NULL,?11,?12,?13,NULL,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,NULL,?25,1)',
    ).bind(map.generations[generation.id], projectId, generation.compositionId ? map.compositions[generation.compositionId] : null, generation.clientRequestId, generation.kind, map.recipes[generation.recipeId] ?? generation.recipeId, generation.provider, generation.model, generation.modelVersion ?? '', JSON.stringify(rewrite(generation.request, map)), status, settled ? generation.errorCode ?? null : 'restored_not_dispatched', settled ? generation.errorDetail ?? null : 'Restored from a portable bundle; provider work is not replayed.', generation.retainedMime ?? null, generation.retainedBytes ?? null, generation.outputAssetId ? map.assets[generation.outputAssetId] : null, generation.costEstimateMicro ?? 0, generation.costReservedMicro ?? 0, generation.costAllocatedMicro ?? null, generation.providerChargedMicro ?? null, generation.createdAt, generation.updatedAt, generation.submittedAt ?? null, generation.completedAt ?? null, generation.deletedAt ?? null));
  }
  for (const subject of manifest.subjects) {
    statements.push(env.DB.prepare('INSERT INTO subject_versions(subject_id,project_id,revision,spec_json,reference_asset_id,reference_sha256,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)')
      .bind(map.subjects[subject.subjectId], projectId, subject.revision, JSON.stringify(rewrite(subject.spec, map)), map.assets[subject.referenceAssetId], subject.referenceSha256, subject.createdAt));
  }
  for (const plan of manifest.songPlans) {
    statements.push(env.DB.prepare('INSERT INTO song_plans(id,project_id,song_asset_id,song_sha256,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)')
      .bind(map.plans[plan.id], projectId, map.assets[plan.songAssetId], plan.songSha256, JSON.stringify(rewrite(plan.spec, map)), plan.revision, plan.createdAt, plan.updatedAt));
  }
  for (const plan of manifest.footagePlans) {
    statements.push(env.DB.prepare('INSERT INTO footage_plans(id,project_id,source_asset_id,source_sha256,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)')
      .bind(map.footage[plan.id], projectId, map.assets[plan.sourceAssetId], plan.sourceSha256, JSON.stringify(rewrite(plan.spec, map)), plan.revision, plan.createdAt, plan.updatedAt));
  }
  for (const publication of manifest.publications) {
    // Restored pages are withdrawn and unlisted; the owner must review and
    // publish again rather than resurrect an old public URL automatically.
    statements.push(env.DB.prepare('INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at,revoked_at,hidden,listed,attribution_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,0,?11)')
      .bind(map.publications[publication.id], projectId, map.assets[publication.assetId], publication.posterAssetId ? map.assets[publication.posterAssetId] : null, slug(12), publication.title, publication.description ?? '', publication.assetRevision ?? 1, publication.createdAt, now, JSON.stringify(publication.attribution ?? [])));
  }
  for (const brief of manifest.promoBriefs) {
    statements.push(env.DB.prepare('INSERT INTO promo_briefs(id,project_id,spec_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6)')
      .bind(map.promos[brief.id], projectId, JSON.stringify(rewrite(brief.spec, map)), brief.revision, brief.createdAt, brief.updatedAt));
  }
  statements.push(env.DB.prepare("UPDATE project_bundle_imports SET status='committed',committed_at=?2,updated_at=?2 WHERE id=?1").bind(row.id, now));
  return statements;
}

export async function checkImportConflicts(env, manifest) {
  const conflicts = [];
  const project = await env.DB.prepare('SELECT id,slug FROM projects WHERE id=?1 OR slug=?2').bind(manifest.project.id, manifest.project.slug).first();
  if (project) {
    if (project.id === manifest.project.id) conflicts.push({ code: 'project_id_exists', message: 'A project with this source id already exists in this installation.', projectId: project.id });
    if (project.slug === manifest.project.slug) conflicts.push({ code: 'project_slug_exists', message: 'Another project already uses this slug.', projectId: project.id });
  }
  const record = await env.DB.prepare('SELECT * FROM project_bundle_imports WHERE bundle_id=?1').bind(manifest.bundleId).first();
  const priorSource = await env.DB.prepare("SELECT * FROM project_bundle_imports WHERE source_project_id=?1 AND status='committed' ORDER BY committed_at DESC LIMIT 1").bind(manifest.project.id).first();
  if (priorSource && priorSource.bundle_id !== manifest.bundleId)
    conflicts.push({ code: 'source_project_exists', message: 'A different bundle from this source project was already restored. Import into a fresh installation or remove that restored project deliberately.', projectId: priorSource.project_id });
  return { conflicts, existingImport: record ?? null };
}

export async function previewPortableImport(env, manifest, { storageLimitBytes = null } = {}) {
  const validated = await validateManifest(manifest);
  const { conflicts, existingImport } = await checkImportConflicts(env, manifest);
  if (existingImport?.status === 'committed') {
    return {
      dryRun: true,
      status: 'already_imported',
      bundleId: manifest.bundleId,
      projectId: existingImport.project_id,
      importedAt: existingImport.committed_at,
      conflicts: [],
      blockers: [],
      plan: { ...validated.stats, sourceProjectId: manifest.project.id, sourceSlug: manifest.project.slug },
    };
  }
  const blockers = conflicts.map((conflict) => conflict.code);
  const warnings = [
    'Publications are restored withdrawn, hidden and unlisted; publish again deliberately.',
    'Provider jobs are never replayed, and monthly budget reservations are not restored.',
    'Media is rewritten to new project-owned R2 keys; source keys and public URLs are not reused.',
  ];
  const duplicateContent = [...new Map(manifest.assets.filter((asset) => asset.content === 'media').map((asset) => [asset.sha256, []])).keys()]
    .map((sha) => ({ sha256: sha, assetIds: manifest.assets.filter((asset) => asset.sha256 === sha).map((asset) => asset.id) }))
    .filter((entry) => entry.assetIds.length > 1);
  const existingContent = [];
  for (const blob of manifest.blobs.slice(0, 20)) {
    const rows = await env.DB.prepare('SELECT id,project_id,title FROM assets WHERE sha256=?1 AND deleted_at IS NULL LIMIT 3').bind(blob.sha256).all();
    if (rows.results.length) existingContent.push({ sha256: blob.sha256, assets: rows.results.map((row) => ({ id: row.id, projectId: row.project_id, title: row.title })) });
  }
  const totalBytes = validated.stats.contentBytes;
  if (Number.isFinite(storageLimitBytes) && storageLimitBytes > 0) {
    const used = await env.DB.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE deleted_at IS NULL').first();
    if (Number(used?.bytes ?? 0) + totalBytes > storageLimitBytes) blockers.push('insufficient_storage');
  }
  if (blockers.length) throw new PortableError(409, blockers[0], 'This bundle cannot be imported without changing an existing project.', {
    status: 'blocked', bundleId: manifest.bundleId, conflicts, blockers, plan: validated.stats, warnings,
  });
  return {
    dryRun: true,
    status: existingImport ? 'resume_staging' : 'ready',
    bundleId: manifest.bundleId,
    importId: existingImport?.id ?? null,
    project: { sourceId: manifest.project.id, name: manifest.project.name, slug: manifest.project.slug, visibility: manifest.project.visibility },
    plan: { ...validated.stats, sourceProjectId: manifest.project.id, sourceSlug: manifest.project.slug },
    duplicateContent,
    existingContent,
    conflicts,
    blockers,
    warnings,
  };
}

export async function beginPortableImport(env, manifest, { dryRun = false, storageLimitBytes = null } = {}) {
  if (dryRun) return previewPortableImport(env, manifest, { storageLimitBytes });
  const validated = await validateManifest(manifest);
  const { conflicts, existingImport } = await checkImportConflicts(env, manifest);
  if (existingImport?.status === 'committed') {
    return { status: 'already_imported', bundleId: manifest.bundleId, projectId: existingImport.project_id, importedAt: existingImport.committed_at, dryRun: false };
  }
  if (conflicts.length) throw new PortableError(409, conflicts[0].code, conflicts[0].message, { status: 'blocked', conflicts, blockers: conflicts.map((item) => item.code) });
  if (existingImport) {
    if (existingImport.status === 'failed') {
      const map = newMap(manifest);
      const projectId = id('prj');
      await env.DB.prepare("UPDATE project_bundle_imports SET project_id=?2,id_map_json=?3,staged_keys_json='[]',status='staging',manifest_json=?4,updated_at=?5,committed_at=NULL WHERE id=?1")
        .bind(existingImport.id, projectId, JSON.stringify(map), JSON.stringify(manifest), Date.now()).run();
      return {
        status: 'staging', resumed: false, restarted: true, importId: existingImport.id, projectId,
        bundleId: manifest.bundleId, map, assets: stagingAssetList(manifest, projectId, map), warnings: importWarnings(),
      };
    }
    const map = JSON.parse(existingImport.id_map_json);
    return {
      status: 'staging', resumed: true, importId: existingImport.id, projectId: existingImport.project_id,
      bundleId: manifest.bundleId, map, assets: stagingAssetList(manifest, existingImport.project_id, map), warnings: importWarnings(),
    };
  }
  const map = newMap(manifest);
  const importId = id('imp');
  const projectId = id('prj');
  const timestamp = Date.now();
  await env.DB.prepare('INSERT INTO project_bundle_imports(id,bundle_id,bundle_sha256,source_project_id,project_id,manifest_json,id_map_json,staged_keys_json,status,asset_count,byte_count,created_at,updated_at,committed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,\'[]\',\'staging\',?8,?9,?10,?10,NULL)')
    .bind(importId, manifest.bundleId, manifest.bundleId, manifest.project.id, projectId, JSON.stringify(manifest), JSON.stringify(map), manifest.assets.length, validated.stats.contentBytes, timestamp)
    .run();
  return {
    status: 'staging', resumed: false, importId, projectId, bundleId: manifest.bundleId, map,
    assets: stagingAssetList(manifest, projectId, map), warnings: importWarnings(),
  };
}

function importWarnings() {
  return [
    'Upload each listed asset to its staging path before commit.',
    'Commit verifies every staged byte again. Nothing becomes visible before commit.',
    'Publications are restored withdrawn, hidden and unlisted.',
  ];
}

function stagingAssetList(manifest, projectId, map) {
  return manifest.assets.filter((asset) => asset.content === 'media').map((asset) => ({
    sourceId: asset.id,
    assetId: map.assets[asset.id],
    key: repoKey(projectId, map.assets[asset.id], asset.mime),
    sha256: asset.sha256,
    bytes: asset.bytes,
    mime: asset.mime,
    title: asset.title,
  }));
}

export async function stagePortableAsset(env, importId, sourceAssetId, bytes) {
  const row = await env.DB.prepare('SELECT * FROM project_bundle_imports WHERE id=?1').bind(importId).first();
  if (!row) throw new PortableError(404, 'import_not_found', 'That restore does not exist.');
  if (row.status === 'committed') return { status: 'already_committed', projectId: row.project_id };
  if (row.status !== 'staging') throw new PortableError(409, 'import_not_staging', 'That restore is not accepting media.');
  const manifest = JSON.parse(row.manifest_json);
  const asset = manifest.assets.find((entry) => entry.id === sourceAssetId && entry.content === 'media');
  if (!asset) throw new PortableError(400, 'unknown_asset', 'That media is not part of this bundle.');
  const map = JSON.parse(row.id_map_json);
  const key = repoKey(row.project_id, map.assets[asset.id], asset.mime);
  const actual = await sha256Bytes(bytes);
  if (bytes.byteLength !== asset.bytes) throw new PortableError(400, 'size_mismatch', `Media ${asset.id} has ${bytes.byteLength} bytes; the manifest expects ${asset.bytes}.`);
  if (actual !== asset.sha256) throw new PortableError(409, 'integrity_failed', `Media ${asset.id} does not match its saved hash.`);
  const sniffed = sniffMedia(bytes, asset.mime);
  if (sniffed.kind !== asset.kind || sniffed.mime !== asset.mime) throw new PortableError(415, 'unsupported_type', `Media ${asset.id} is not the declared ${asset.mime}.`);
  const entryLimit = asset.kind === 'video' ? MAX_PORTABLE_ASSET_BYTES : asset.kind === 'audio' ? AUDIO_BYTES : IMAGE_BYTES;
  if (bytes.byteLength > entryLimit) throw new PortableError(413, 'too_large', 'That media exceeds the supported bundle entry size.');
  const existing = await env.MEDIA.get(key);
  if (existing) {
    const stored = new Uint8Array(await existing.arrayBuffer());
    const storedHash = await sha256Bytes(stored);
    if (storedHash !== asset.sha256) throw new PortableError(409, 'staging_conflict', 'A different object already uses this restore path.');
    return { status: 'already_staged', assetId: map.assets[asset.id], key, sha256: actual, bytes: bytes.byteLength };
  }
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: asset.mime }, customMetadata: { sha256: actual, import: importId } });
  const staged = new Set(safeJson(row.staged_keys_json, []));
  staged.add(key);
  await env.DB.prepare('UPDATE project_bundle_imports SET staged_keys_json=?2,updated_at=?3 WHERE id=?1').bind(importId, JSON.stringify([...staged]), Date.now()).run();
  return { status: 'staged', assetId: map.assets[asset.id], key, sha256: actual, bytes: bytes.byteLength };
}

export async function commitPortableImport(env, importId, { confirm = false } = {}) {
  const row = await env.DB.prepare('SELECT * FROM project_bundle_imports WHERE id=?1').bind(importId).first();
  if (!row) throw new PortableError(404, 'import_not_found', 'That restore does not exist.');
  if (!confirm) throw new PortableError(409, 'confirmation_required', 'Confirm the restore before committing.');
  if (row.status === 'committed') return { status: 'already_imported', projectId: row.project_id, importId, bundleId: row.bundle_id };
  if (row.status !== 'staging') throw new PortableError(409, 'import_not_staging', 'That restore cannot be committed.');
  const manifest = JSON.parse(row.manifest_json);
  await validateManifest(manifest);
  const map = JSON.parse(row.id_map_json);
  const missing = [];
  for (const asset of manifest.assets) {
    if (asset.content !== 'media') continue;
    const key = repoKey(row.project_id, map.assets[asset.id], asset.mime);
    const object = await env.MEDIA.get(key);
    if (!object) { missing.push({ assetId: asset.id, key, reason: 'missing' }); continue; }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const hash = await sha256Bytes(bytes);
    if (bytes.byteLength !== asset.bytes || hash !== asset.sha256) missing.push({ assetId: asset.id, key, reason: 'hash_mismatch' });
  }
  if (missing.length) throw new PortableError(409, 'missing_media', 'The restore is incomplete. Stage every media file before committing.', { missing });
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id=?1 OR slug=?2').bind(row.project_id, manifest.project.slug).first();
  if (existing) throw new PortableError(409, 'project_conflict', 'A project appeared at this restore destination. Nothing was activated.', { projectId: existing.id });
  await env.DB.batch(statementsFor(env, manifest, row));
  return {
    status: 'committed', importId, bundleId: row.bundle_id, projectId: row.project_id,
    counts: { ...manifest.stats, records: manifest.generations.length + manifest.compositions.length + manifest.recipes.length + manifest.subjects.length + manifest.songPlans.length + manifest.footagePlans.length + manifest.publications.length + manifest.promoBriefs.length },
    map,
  };
}

export async function importStatus(env, importId) {
  const row = await env.DB.prepare('SELECT id,bundle_id,source_project_id,project_id,status,asset_count,byte_count,created_at,updated_at,committed_at FROM project_bundle_imports WHERE id=?1').bind(importId).first();
  if (!row) throw new PortableError(404, 'import_not_found', 'That restore does not exist.');
  return { importId: row.id, bundleId: row.bundle_id, sourceProjectId: row.source_project_id, projectId: row.project_id, status: row.status, assets: row.asset_count, bytes: row.byte_count, createdAt: row.created_at, updatedAt: row.updated_at, committedAt: row.committed_at };
}

/** Read-only inventory. Useful for #158 duplicate review and restore support. */
export async function portableInventory(env, { projectId = null } = {}) {
  const imports = (await (projectId
    ? env.DB.prepare('SELECT id,bundle_id,source_project_id,project_id,status,asset_count,byte_count,created_at,committed_at FROM project_bundle_imports WHERE project_id=?1 ORDER BY created_at DESC').bind(projectId).all()
    : env.DB.prepare('SELECT id,bundle_id,source_project_id,project_id,status,asset_count,byte_count,created_at,committed_at FROM project_bundle_imports ORDER BY created_at DESC LIMIT 100').all())).results;
  const duplicates = (await env.DB.prepare(
    'SELECT project_id,sha256,COUNT(*) AS n,SUM(bytes) AS bytes,GROUP_CONCAT(id) AS asset_ids FROM assets WHERE deleted_at IS NULL GROUP BY project_id,sha256 HAVING COUNT(*)>1 ORDER BY (COUNT(*)-1)*SUM(bytes) DESC LIMIT 100',
  ).all()).results.map((row) => ({
    projectId: row.project_id,
    sha256: row.sha256,
    count: row.n,
    bytesEach: Number(row.bytes) / row.n,
    wastedBytes: Number(row.bytes) - Number(row.bytes) / row.n,
    assetIds: String(row.asset_ids).split(','),
  }));
  const totals = await env.DB.prepare('SELECT COUNT(*) AS assets,COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE deleted_at IS NULL').first();
  return {
    readOnly: true,
    generatedAt: Date.now(),
    totals: { assets: totals.assets, bytes: totals.bytes },
    imports: imports.map((row) => ({ importId: row.id, bundleId: row.bundle_id, sourceProjectId: row.source_project_id, projectId: row.project_id, status: row.status, assets: row.asset_count, bytes: row.byte_count, createdAt: row.created_at, committedAt: row.committed_at })),
    duplicateContent: duplicates,
  };
}

/** Opt-in cleanup of staging objects that are not referenced by an asset row.
 * Never deletes a live original, a publication dependency or another import. */
export async function cleanupPortableImport(env, importId, { confirm = false } = {}) {
  if (!confirm) throw new PortableError(409, 'confirmation_required', 'Cleanup is opt-in: send confirm=true.');
  const row = await env.DB.prepare('SELECT * FROM project_bundle_imports WHERE id=?1').bind(importId).first();
  if (!row) throw new PortableError(404, 'import_not_found', 'That restore does not exist.');
  const keys = safeJson(row.staged_keys_json, []);
  const deleted = [];
  const kept = [];
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(`projects/${row.project_id}/assets/`)) { kept.push({ key, reason: 'outside_owned_prefix' }); continue; }
    const referenced = await env.DB.prepare('SELECT id FROM assets WHERE r2_key=?1 LIMIT 1').bind(key).first();
    if (referenced) { kept.push({ key, reason: 'referenced_asset', assetId: referenced.id }); continue; }
    await env.MEDIA.delete(key);
    deleted.push(key);
  }
  if (row.status === 'staging') await env.DB.prepare("UPDATE project_bundle_imports SET status='failed',updated_at=?2 WHERE id=?1").bind(importId, Date.now()).run();
  return { status: 'cleaned', importId, deleted, kept, originalAssetsTouched: 0 };
}

// ---------------------------------------------------------------------------
// Deterministic container: magic, length-prefixed canonical manifest, blobs in
// manifest order, then a SHA-256 trailer for the manifest and the blob stream.
// ---------------------------------------------------------------------------

export async function encodePortableBundle(manifest, blobs) {
  const validated = await validateManifest(manifest);
  const encoder = new TextEncoder();
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  const magic = encoder.encode(PORTABLE_MAGIC);
  const length = encoder.encode(`${String(manifestBytes.length).padStart(10, '0')}\n`);
  const chunks = [];
  for (const blob of manifest.blobs) {
    const bytes = blobs instanceof Map ? blobs.get(blob.sha256) : blobs?.[blob.sha256];
    if (!(bytes instanceof Uint8Array)) throw new PortableError(400, 'missing_media', `The archive is missing media ${blob.sha256}.`);
    const hash = await sha256Bytes(bytes);
    if (bytes.byteLength !== blob.bytes || hash !== blob.sha256) throw new PortableError(409, 'integrity_failed', `Media ${blob.sha256} does not match the manifest.`);
    chunks.push(bytes);
  }
  const blobHash = await sha256Bytes(concat(chunks));
  const manifestHash = await sha256Bytes(manifestBytes);
  return concat([magic, length, manifestBytes, ...chunks, encoder.encode(`${blobHash}\n${manifestHash}\n`)]);
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export async function decodePortableBundle(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const encoder = new TextEncoder();
  const magic = encoder.encode(PORTABLE_MAGIC);
  if (bytes.byteLength < magic.byteLength + 11) throw new PortableError(400, 'invalid_bundle', 'This is not a Studio project bundle.');
  for (let index = 0; index < magic.byteLength; index += 1) if (bytes[index] !== magic[index]) throw new PortableError(400, 'invalid_bundle', 'This is not a Studio project bundle.');
  const lengthText = new TextDecoder().decode(bytes.subarray(magic.byteLength, magic.byteLength + 11));
  if (!/^\d{10}\n$/.test(lengthText)) throw new PortableError(400, 'invalid_bundle', 'The bundle manifest length is malformed.');
  const manifestLength = Number(lengthText.slice(0, 10));
  if (manifestLength > MAX_PORTABLE_MANIFEST_BYTES) throw new PortableError(413, 'bundle_too_large', 'The bundle manifest exceeds the supported size.');
  const manifestStart = magic.byteLength + 11;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestLength < 2 || manifestEnd + 130 > bytes.byteLength) throw new PortableError(400, 'invalid_bundle', 'The bundle is truncated.');
  const manifestBytes = bytes.subarray(manifestStart, manifestEnd);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new PortableError(400, 'invalid_bundle', 'The bundle manifest is not JSON.'); }
  const trailer = new TextDecoder().decode(bytes.subarray(bytes.byteLength - 130));
  const match = /^([a-f0-9]{64})\n([a-f0-9]{64})\n$/.exec(trailer);
  if (!match) throw new PortableError(400, 'invalid_bundle', 'The bundle integrity trailer is malformed.');
  const [, blobHash, manifestHash] = match;
  const expectedManifest = await sha256Bytes(manifestBytes);
  if (expectedManifest !== manifestHash) throw new PortableError(409, 'integrity_failed', 'The bundle manifest was modified after sealing.');
  const blobs = new Map();
  let offset = manifestEnd;
  const chunks = [];
  const validated = await validateManifest(manifest);
  for (const blob of manifest.blobs) {
    const end = offset + blob.bytes;
    if (end > bytes.byteLength - 130) throw new PortableError(400, 'invalid_bundle', 'The bundle is truncated.');
    const slice = bytes.subarray(offset, end);
    const hash = await sha256Bytes(slice);
    if (hash !== blob.sha256) throw new PortableError(409, 'integrity_failed', `Media ${blob.sha256} does not match its hash.`);
    blobs.set(blob.sha256, slice);
    chunks.push(slice);
    offset = end;
  }
  if (offset !== bytes.byteLength - 130) throw new PortableError(400, 'invalid_bundle', 'The bundle has unexpected trailing bytes.');
  if (await sha256Bytes(concat(chunks)) !== blobHash) throw new PortableError(409, 'integrity_failed', 'The bundle media stream does not match its trailer.');
  return { manifest, blobs, validated };
}

/** Local validation helper used by the CLI before any network write. */
export function describeBundle(manifest) {
  return {
    format: manifest.format,
    schemaVersion: manifest.schemaVersion,
    bundleId: manifest.bundleId,
    project: manifest.project,
    stats: manifest.stats,
    excluded: manifest.excluded,
    limits: manifest.limits,
  };
}
