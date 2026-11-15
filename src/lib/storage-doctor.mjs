// MIT. Read-only storage inventory and saved-reference graph for one project.
//
// This module never writes D1 or R2, never deletes bytes, never calls a
// provider and never reads another project's rows. It answers three questions:
// what takes space, where is a saved original referenced, and which records are
// too incomplete to classify. "No saved reference found" is not a claim that
// bytes are safe to delete.

import { safeJson } from "./util.mjs";

const SHA = /^[a-f0-9]{64}$/i;
const KINDS = ["image", "video", "audio"];
const MAX_ASSETS = 1000;
const MAX_OBJECT_CHECKS = 1000;
const MAX_USES = 5000;
const MAX_LISTED_OBJECTS = 2000;
const MAX_DANGLING = 500;
const MAX_DUPLICATE_GROUPS = 100;

const USE_LABELS = {
  variant: "Variant or derived asset",
  generation_output: "Generation result",
  generation_reference: "Generation reference",
  generation_mask: "Generation mask",
  generation_parent: "Generation parent",
  generation_source: "Generation source",
  storyboard_shot: "Storyboard shot",
  storyboard_audio: "Storyboard audio bed",
  storyboard_track: "Storyboard soundtrack",
  storyboard_slate: "Storyboard slate",
  storyboard_slate_video: "Storyboard slate clip",
  publication: "Published page",
  publication_poster: "Publication poster",
  subject_version: "Subject version",
  song_plan_song: "Song plan source",
  song_plan_reference: "Song plan scene reference",
  song_plan_take: "Song plan selected take",
  footage_plan_source: "Cut map source",
  footage_plan_reference: "Cut map scene reference",
  footage_plan_take: "Cut map selected take",
  render_receipt_output: "Local render receipt output",
  render_receipt_shot: "Local render shot",
  render_receipt_soundtrack: "Local render soundtrack",
  render_receipt_track: "Local render source track",
  render_receipt_song: "Local render captions song",
  footage_export_output: "Footage export output",
  footage_export_source: "Footage export source",
  review_room: "Private review room",
};

const SOURCE_TABLES = [
  "generations",
  "compositions",
  "publications",
  "subject_versions",
  "song_plans",
  "footage_plans",
  "local_render_receipts",
  "footage_export_receipts",
  "review_rooms",
];

async function rows(env, sql, ...bind) {
  return (await env.DB.prepare(sql).bind(...bind).all()).results;
}

async function optionalRows(env, sql, ...bind) {
  try {
    return { available: true, rows: await rows(env, sql, ...bind) };
  } catch {
    return { available: false, rows: [] };
  }
}

function projectHref(projectId, route) {
  return `#/p/${encodeURIComponent(projectId)}/${route}`;
}

function assetHref(projectId, assetId) {
  return `#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
}

function asCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normaliseLineage(asset, generation) {
  const reasons = [];
  const sha = String(asset.sha256 ?? "");
  if (!SHA.test(sha)) reasons.push("fingerprint_missing_or_invalid");
  if (!Number.isSafeInteger(Number(asset.bytes)) || Number(asset.bytes) <= 0) reasons.push("size_invalid");
  if (typeof asset.mime !== "string" || !asset.mime) reasons.push("mime_missing");
  if (typeof asset.r2_key !== "string" || !asset.r2_key) reasons.push("r2_key_missing");
  else if (!asset.r2_key.startsWith(`projects/${asset.project_id}/assets/`)) reasons.push("r2_key_outside_project");
  if (["generated", "variant", "assembled"].includes(asset.source) && !generation) reasons.push("generation_missing");
  if (asset.generation_id && !generation) reasons.push("generation_row_missing");
  if (generation && generation.output_asset_id && generation.output_asset_id !== asset.id) reasons.push("generation_output_mismatch");

  const request = generation ? safeJson(generation.request_json, {}) : {};
  const hasDerivation =
    Boolean(asset.parent_asset_id) ||
    Boolean(request.referenceAssetId) ||
    Boolean(request.maskAssetId) ||
    Boolean(generation?.composition_id) ||
    ["variant", "assembled"].includes(asset.source);

  let role = "unknown";
  if (asset.source === "upload" && !asset.parent_asset_id) role = "original";
  else if (hasDerivation) role = "derivative";
  else if (asset.source === "generated" && generation) role = "original";
  else if (asset.source === "upload") role = "original";

  return { role, legacyReasons: reasons };
}

/**
 * Build a read-only report for one project. `checkObjects` uses one R2 HEAD per
 * live asset (bounded); `listObjects` inspects the project's own key prefix for
 * objects with no asset row (bounded). Both are reads.
 */
export async function projectStorageReport(env, project, { checkObjects = true, listObjects = true } = {}) {
  const projectId = project.id;
  const assets = await rows(env, "SELECT * FROM assets WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId);
  const generationRows = await rows(env, "SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId).catch(() => null);
  const compositionRows = await rows(env, "SELECT * FROM compositions WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId).catch(() => null);
  const publicationRows = await rows(env, "SELECT * FROM publications WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId).catch(() => null);

  const optional = {
    subject_versions: await optionalRows(env, "SELECT * FROM subject_versions WHERE project_id=?1 ORDER BY subject_id ASC,revision ASC", projectId),
    song_plans: await optionalRows(env, "SELECT * FROM song_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId),
    footage_plans: await optionalRows(env, "SELECT * FROM footage_plans WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId),
    local_render_receipts: await optionalRows(env, "SELECT * FROM local_render_receipts WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId),
    footage_export_receipts: await optionalRows(env, "SELECT * FROM footage_export_receipts WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId),
    review_rooms: await optionalRows(env, "SELECT * FROM review_rooms WHERE project_id=?1 ORDER BY created_at ASC,id ASC", projectId),
  };
  const optionalImports = await optionalRows(
    env,
    "SELECT id,status,staged_keys_json FROM project_bundle_imports WHERE project_id=?1 ORDER BY created_at ASC,id ASC",
    projectId,
  );

  const coverageSources = [];
  for (const [name, value] of Object.entries({ generations: generationRows, compositions: compositionRows, publications: publicationRows })) {
    coverageSources.push({ source: name, available: Array.isArray(value), rows: Array.isArray(value) ? value.length : 0 });
  }
  for (const [name, value] of Object.entries(optional)) {
    coverageSources.push({ source: name, available: value.available, rows: value.rows.length });
  }
  const coverageComplete =
    Array.isArray(generationRows) &&
    Array.isArray(compositionRows) &&
    Array.isArray(publicationRows) &&
    Object.values(optional).every((value) => value.available);
  const generationById = new Map((generationRows ?? []).map((generation) => [generation.id, generation]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const live = assets.filter((asset) => asset.deleted_at === null);
  const tombstoned = assets.filter((asset) => asset.deleted_at !== null);

  const uses = new Map();
  const dangling = [];
  let danglingTotal = 0;
  let totalUses = 0;
  let usesTruncated = false;

  const addUse = (assetId, use) => {
    if (typeof assetId !== "string" || !assetId) return;
    const asset = assetById.get(assetId);
    if (!asset) {
      danglingTotal += 1;
      if (dangling.length < MAX_DANGLING) dangling.push({ ...use, assetId, reason: "asset_missing" });
      return;
    }
    if (asset.deleted_at !== null) {
      danglingTotal += 1;
      if (dangling.length < MAX_DANGLING)
        dangling.push({ ...use, assetId, assetTitle: asset.title, reason: "asset_tombstoned" });
    }
    const entry = {
      type: use.type,
      label: USE_LABELS[use.type] ?? use.type,
      parentId: use.parentId ?? null,
      parentLabel: use.parentLabel ?? null,
      detail: use.detail ?? null,
      href: use.href ?? assetHref(projectId, asset.id),
      savedAt: use.savedAt ?? null,
      available: asset.deleted_at === null,
      active: use.active !== false,
    };
    const list = uses.get(assetId) ?? [];
    if (list.some((existing) => existing.type === entry.type && existing.parentId === entry.parentId && existing.href === entry.href)) return;
    if (totalUses >= MAX_USES) {
      usesTruncated = true;
      return;
    }
    list.push(entry);
    uses.set(assetId, list);
    totalUses += 1;
  };

  // Parents and variants are real saved lineage, not title guesses.
  for (const asset of assets) {
    if (asset.parent_asset_id)
      addUse(asset.parent_asset_id, {
        type: "variant",
        parentId: asset.id,
        parentLabel: asset.title,
        detail: `“${asset.title || asset.id}” was saved from this asset`,
        href: assetHref(projectId, asset.id),
        savedAt: asset.created_at,
      });
  }

  // A generation result and its exact inputs.
  for (const generation of generationRows ?? []) {
    const request = safeJson(generation.request_json, {});
    if (generation.output_asset_id)
      addUse(generation.output_asset_id, {
        type: "generation_output",
        parentId: generation.id,
        parentLabel: generation.model,
        detail: `${generation.status} generation`,
        href: projectHref(projectId, "history"),
        savedAt: generation.created_at,
      });
    if (request.referenceAssetId)
      addUse(request.referenceAssetId, {
        type: "generation_reference",
        parentId: generation.id,
        parentLabel: generation.model,
        detail: "Read as the reference for a saved generation",
        href: projectHref(projectId, "history"),
        savedAt: generation.created_at,
      });
    if (request.maskAssetId)
      addUse(request.maskAssetId, {
        type: "generation_mask",
        parentId: generation.id,
        parentLabel: generation.model,
        detail: "Mask for a saved generation",
        href: projectHref(projectId, "history"),
        savedAt: generation.created_at,
      });
    if (request.sourceAssetId)
      addUse(request.sourceAssetId, {
        type: "generation_source",
        parentId: generation.id,
        parentLabel: generation.model,
        detail: "Source asset for a saved restyle",
        href: projectHref(projectId, "history"),
        savedAt: generation.created_at,
      });
    const output = generation.output_asset_id ? assetById.get(generation.output_asset_id) : null;
    if (request.parentAssetId && output?.parent_asset_id !== request.parentAssetId)
      addUse(request.parentAssetId, {
        type: "generation_parent",
        parentId: generation.id,
        parentLabel: generation.model,
        detail: "Saved parent recorded by a generation",
        href: projectHref(projectId, "history"),
        savedAt: generation.created_at,
      });
  }

  // Storyboards keep shots, beds, tracks and slates as explicit asset ids.
  for (const composition of compositionRows ?? []) {
    const spec = safeJson(composition.spec_json, {});
    const storyboardHref = projectHref(projectId, "assemble");
    for (const shot of Array.isArray(spec.shots) ? spec.shots : [])
      addUse(shot?.assetId, {
        type: "storyboard_shot",
        parentId: composition.id,
        parentLabel: composition.title,
        detail: `Shot in “${composition.title}”`,
        href: storyboardHref,
        savedAt: composition.updated_at,
      });
    if (spec.audioAssetId)
      addUse(spec.audioAssetId, {
        type: "storyboard_audio",
        parentId: composition.id,
        parentLabel: composition.title,
        detail: `Mixed audio bed in “${composition.title}”`,
        href: storyboardHref,
        savedAt: composition.updated_at,
      });
    for (const track of Array.isArray(spec.audioTracks) ? spec.audioTracks : [])
      addUse(track?.assetId, {
        type: "storyboard_track",
        parentId: composition.id,
        parentLabel: composition.title,
        detail: `${track?.role ?? "audio"} track in “${composition.title}”`,
        href: storyboardHref,
        savedAt: composition.updated_at,
      });
    if (spec.slateAssetId)
      addUse(spec.slateAssetId, {
        type: "storyboard_slate",
        parentId: composition.id,
        parentLabel: composition.title,
        detail: `Slate still for “${composition.title}”`,
        href: storyboardHref,
        savedAt: composition.updated_at,
      });
    if (spec.slateVideoAssetId)
      addUse(spec.slateVideoAssetId, {
        type: "storyboard_slate_video",
        parentId: composition.id,
        parentLabel: composition.title,
        detail: `Slate clip for “${composition.title}”`,
        href: storyboardHref,
        savedAt: composition.updated_at,
      });
  }

  // Publications are a saved public dependency even after withdrawal.
  for (const publication of publicationRows ?? []) {
    addUse(publication.asset_id, {
      type: "publication",
      parentId: publication.id,
      parentLabel: publication.title,
      detail: publication.revoked_at ? `Withdrawn page /p/${publication.slug}` : `Public page /p/${publication.slug}`,
      href: publication.revoked_at ? projectHref(projectId, "publish") : `/p/${publication.slug}`,
      savedAt: publication.created_at,
      active: !publication.revoked_at,
    });
    if (publication.poster_asset_id)
      addUse(publication.poster_asset_id, {
        type: "publication_poster",
        parentId: publication.id,
        parentLabel: publication.title,
        detail: publication.revoked_at ? `Poster for withdrawn page /p/${publication.slug}` : `Poster for /p/${publication.slug}`,
        href: publication.revoked_at ? projectHref(projectId, "publish") : `/p/${publication.slug}`,
        savedAt: publication.created_at,
        active: !publication.revoked_at,
      });
  }

  for (const version of optional.subject_versions.rows)
    addUse(version.reference_asset_id, {
      type: "subject_version",
      parentId: `${version.subject_id}@${version.revision}`,
      parentLabel: `Subject ${version.subject_id} · version ${version.revision}`,
      detail: `Reference for subject version ${version.revision}`,
      href: projectHref(projectId, "assemble"),
      savedAt: version.created_at,
    });

  for (const plan of optional.song_plans.rows) {
    const spec = safeJson(plan.spec_json, {});
    addUse(plan.song_asset_id, {
      type: "song_plan_song",
      parentId: plan.id,
      parentLabel: spec.title ?? plan.id,
      detail: `Source song for song plan “${spec.title ?? plan.id}”`,
      href: projectHref(projectId, "assemble"),
      savedAt: plan.updated_at,
    });
    for (const scene of Array.isArray(spec.scenes) ? spec.scenes : []) {
      if (scene?.referenceAssetId)
        addUse(scene.referenceAssetId, {
          type: "song_plan_reference",
          parentId: plan.id,
          parentLabel: spec.title ?? plan.id,
          detail: `Reference for scene ${scene.id}`,
          href: projectHref(projectId, "assemble"),
          savedAt: plan.updated_at,
        });
      if (scene?.selectedTakeId)
        addUse(scene.selectedTakeId, {
          type: "song_plan_take",
          parentId: plan.id,
          parentLabel: spec.title ?? plan.id,
          detail: `Selected take for scene ${scene.id}`,
          href: projectHref(projectId, "assemble"),
          savedAt: plan.updated_at,
        });
    }
  }

  for (const plan of optional.footage_plans.rows) {
    const spec = safeJson(plan.spec_json, {});
    addUse(plan.source_asset_id, {
      type: "footage_plan_source",
      parentId: plan.id,
      parentLabel: spec.title ?? plan.id,
      detail: `Source footage for cut map “${spec.title ?? plan.id}”`,
      href: projectHref(projectId, "assemble"),
      savedAt: plan.updated_at,
    });
    for (const scene of Array.isArray(spec.scenes) ? spec.scenes : []) {
      if (scene?.referenceAssetId)
        addUse(scene.referenceAssetId, {
          type: "footage_plan_reference",
          parentId: plan.id,
          parentLabel: spec.title ?? plan.id,
          detail: `Reference for cut-map scene ${scene.id}`,
          href: projectHref(projectId, "assemble"),
          savedAt: plan.updated_at,
        });
      if (scene?.selectedTakeId)
        addUse(scene.selectedTakeId, {
          type: "footage_plan_take",
          parentId: plan.id,
          parentLabel: spec.title ?? plan.id,
          detail: `Selected take for cut-map scene ${scene.id}`,
          href: projectHref(projectId, "assemble"),
          savedAt: plan.updated_at,
        });
    }
  }

  // Browser-reported local renders keep their source ids in a private receipt.
  for (const receipt of optional.local_render_receipts.rows) {
    const snapshot = safeJson(receipt.snapshot_json, {});
    addUse(receipt.output_asset_id, {
      type: "render_receipt_output",
      parentId: receipt.id,
      parentLabel: "Local render",
      detail: "Saved output recorded by a private local render receipt",
      href: assetHref(projectId, receipt.output_asset_id),
      savedAt: receipt.created_at,
    });
    for (const shot of Array.isArray(snapshot.shots) ? snapshot.shots : [])
      addUse(shot?.assetId, {
        type: "render_receipt_shot",
        parentId: receipt.id,
        parentLabel: "Local render",
        detail: "Source shot in a local render receipt",
        href: projectHref(projectId, "assemble"),
        savedAt: receipt.created_at,
      });
    if (snapshot.soundtrack?.assetId)
      addUse(snapshot.soundtrack.assetId, {
        type: "render_receipt_soundtrack",
        parentId: receipt.id,
        parentLabel: "Local render",
        detail: "Mixed soundtrack in a local render receipt",
        href: projectHref(projectId, "assemble"),
        savedAt: receipt.created_at,
      });
    for (const track of Array.isArray(snapshot.tracks) ? snapshot.tracks : [])
      addUse(track?.assetId, {
        type: "render_receipt_track",
        parentId: receipt.id,
        parentLabel: "Local render",
        detail: `${track?.role ?? "audio"} source in a local render receipt`,
        href: projectHref(projectId, "assemble"),
        savedAt: receipt.created_at,
      });
    if (snapshot.captions?.songAssetId)
      addUse(snapshot.captions.songAssetId, {
        type: "render_receipt_song",
        parentId: receipt.id,
        parentLabel: "Local render",
        detail: "Song used for captions in a local render receipt",
        href: projectHref(projectId, "assemble"),
        savedAt: receipt.created_at,
      });
  }

  for (const receipt of optional.footage_export_receipts.rows) {
    addUse(receipt.output_asset_id, {
      type: "footage_export_output",
      parentId: receipt.id,
      parentLabel: "Source export",
      detail: "Saved output recorded by a source-scene export receipt",
      href: assetHref(projectId, receipt.output_asset_id),
      savedAt: receipt.created_at,
    });
    addUse(receipt.source_asset_id, {
      type: "footage_export_source",
      parentId: receipt.id,
      parentLabel: "Source export",
      detail: "Source footage for a source-scene export receipt",
      href: projectHref(projectId, "assemble"),
      savedAt: receipt.created_at,
    });
  }

  for (const room of optional.review_rooms.rows)
    addUse(room.asset_id, {
      type: "review_room",
      parentId: room.id,
      parentLabel: room.version_label,
      detail: room.revoked_at ? "Revoked private review room" : "Private review room",
      href: projectHref(projectId, "review"),
      savedAt: room.created_at,
      active: !room.revoked_at,
    });

  const byKind = Object.fromEntries(
    KINDS.map((kind) => [kind, { assets: 0, bytes: 0, originals: 0, derivatives: 0, unknown: 0 }]),
  );
  let originals = 0;
  let derivatives = 0;
  let unknownRole = 0;
  let publishedAssets = 0;
  let publishedBytes = 0;
  let protectedAssets = 0;
  let protectedBytes = 0;
  let liveBytes = 0;

  const assetEntries = live.slice(0, MAX_ASSETS).map((asset) => {
    const generation = asset.generation_id ? generationById.get(asset.generation_id) : null;
    const { role, legacyReasons } = normaliseLineage(asset, generation);
    const assetUses = uses.get(asset.id) ?? [];
    const published = assetUses.some((use) => use.type === "publication" || use.type === "publication_poster");
    const protectedAsset = assetUses.length > 0 || published;
    const referenceState = assetUses.length > 0 ? "used" : legacyReasons.length > 0 || !coverageComplete ? "unknown" : "unused";
    const bytes = asCount(asset.bytes);
    liveBytes += bytes;
    const bucket = byKind[asset.kind] ?? (byKind[asset.kind] = { assets: 0, bytes: 0, originals: 0, derivatives: 0, unknown: 0 });
    bucket.assets += 1;
    bucket.bytes += bytes;
    if (role === "original") {
      originals += 1;
      bucket.originals += 1;
    } else if (role === "derivative") {
      derivatives += 1;
      bucket.derivatives += 1;
    } else {
      unknownRole += 1;
      bucket.unknown += 1;
    }
    if (published) {
      publishedAssets += 1;
      publishedBytes += bytes;
    }
    if (protectedAsset) {
      protectedAssets += 1;
      protectedBytes += bytes;
    }
    return {
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      bytes,
      mime: asset.mime,
      sha256: asset.sha256,
      source: asset.source,
      role,
      referenceState,
      protected: protectedAsset,
      published,
      uses: assetUses.length,
      href: assetHref(projectId, asset.id),
      file: `/api/assets/${asset.id}/file`,
      legacyReasons,
    };
  });

  // Object checks are reads. A missing object is a real integrity finding, not
  // an inference from metadata.
  const objectChecks = [];
  const missingReferencedObjects = [];
  let objectChecksTruncated = false;
  if (checkObjects) {
    const checkable = live.slice(0, MAX_OBJECT_CHECKS);
    objectChecksTruncated = live.length > checkable.length;
    for (let index = 0; index < checkable.length; index += 25) {
      const batch = checkable.slice(index, index + 25);
      await Promise.all(
        batch.map(async (asset) => {
          if (!asset.r2_key) {
            missingReferencedObjects.push({ assetId: asset.id, key: null, reason: "r2_key_missing", bytes: asCount(asset.bytes) });
            objectChecks.push({ assetId: asset.id, status: "missing" });
            return;
          }
          try {
            const head = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(asset.r2_key) : null;
            if (!head) {
              missingReferencedObjects.push({ assetId: asset.id, key: asset.r2_key, reason: "object_missing", bytes: asCount(asset.bytes) });
              objectChecks.push({ assetId: asset.id, status: "missing" });
              return;
            }
            if (Number(head.size) !== asCount(asset.bytes)) {
              objectChecks.push({
                assetId: asset.id,
                status: "size_mismatch",
                storedBytes: Number(head.size),
                recordedBytes: asCount(asset.bytes),
              });
              return;
            }
            objectChecks.push({ assetId: asset.id, status: "present", storedBytes: Number(head.size) });
          } catch {
            objectChecks.push({ assetId: asset.id, status: "check_failed" });
          }
        }),
      );
    }
  }
  const objectStatusById = new Map(objectChecks.map((check) => [check.assetId, check.status]));
  for (const entry of assetEntries) {
    const status = objectStatusById.get(entry.id);
    entry.storage = status === "missing" ? "missing" : status === "present" ? "present" : status === "size_mismatch" ? "size_mismatch" : status === "check_failed" ? "unknown" : "not_checked";
  }

  // Duplicate content is exact bytes plus size and MIME, inside this project.
  const duplicateMap = new Map();
  for (const asset of live) {
    if (!SHA.test(String(asset.sha256 ?? "")) || !Number.isSafeInteger(Number(asset.bytes)) || Number(asset.bytes) <= 0) continue;
    const key = `${String(asset.sha256).toLowerCase()}\0${Number(asset.bytes)}\0${asset.mime}`;
    const group = duplicateMap.get(key) ?? { sha256: asset.sha256, bytes: Number(asset.bytes), mime: asset.mime, assetIds: [] };
    group.assetIds.push(asset.id);
    duplicateMap.set(key, group);
  }
  const duplicateContent = [...duplicateMap.values()]
    .filter((group) => group.assetIds.length > 1)
    .sort((left, right) => (right.assetIds.length - 1) * right.bytes - (left.assetIds.length - 1) * left.bytes)
    .slice(0, MAX_DUPLICATE_GROUPS)
    .map((group) => ({
      sha256: group.sha256,
      bytes: group.bytes,
      mime: group.mime,
      count: group.assetIds.length,
      extraBytes: group.bytes * (group.assetIds.length - 1),
      assetIds: group.assetIds,
      assets: group.assetIds.map((assetId) => {
        const asset = assetById.get(assetId);
        return { id: assetId, title: asset?.title ?? null, href: assetHref(projectId, assetId) };
      }),
    }));
  const duplicateExtraAssets = duplicateContent.reduce((sum, group) => sum + group.count - 1, 0);
  const duplicateWastedBytes = duplicateContent.reduce((sum, group) => sum + group.extraBytes, 0);

  // R2 objects under this project's own prefix without a matching asset row.
  let objectListing = { available: false, truncated: false, scanned: 0, unreferenced: 0, unreferencedBytes: 0, sample: [] };
  if (listObjects && typeof env.MEDIA.list === "function") {
    const referencedKeys = new Set(assets.map((asset) => asset.r2_key).filter(Boolean));
    const stagingKeys = new Set();
    for (const row of optionalImports.rows) {
      for (const key of safeJson(row.staged_keys_json, [])) if (typeof key === "string") stagingKeys.add(key);
    }
    const prefix = `projects/${projectId}/assets/`;
    const objects = [];
    let cursor = undefined;
    let truncated = false;
    try {
      do {
        const page = await env.MEDIA.list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 });
        for (const object of page?.objects ?? []) {
          if (objects.length >= MAX_LISTED_OBJECTS) {
            truncated = true;
            break;
          }
          objects.push({ key: object.key, size: Number(object.size) || 0 });
        }
        cursor = page?.truncated ? page.cursor : undefined;
        if (objects.length >= MAX_LISTED_OBJECTS) truncated = true;
      } while (cursor && !truncated);
      const unreferenced = objects.filter((object) => !referencedKeys.has(object.key));
      objectListing = {
        available: true,
        truncated,
        scanned: objects.length,
        unreferenced: unreferenced.length,
        unreferencedBytes: unreferenced.reduce((sum, object) => sum + object.size, 0),
        sample: unreferenced.slice(0, 50).map((object) => ({
          key: object.key,
          size: object.size,
          reason: stagingKeys.has(object.key) ? "restore_staging" : "no_asset_row",
        })),
      };
    } catch {
      objectListing = { available: false, truncated: false, scanned: 0, unreferenced: 0, unreferencedBytes: 0, sample: [] };
    }
  }

  const unknownLegacy = assets
    .map((asset) => {
      const generation = asset.generation_id ? generationById.get(asset.generation_id) : null;
      const { role, legacyReasons } = normaliseLineage(asset, generation);
      return {
        assetId: asset.id,
        title: asset.title,
        kind: asset.kind,
        source: asset.source,
        role,
        deletedAt: asset.deleted_at,
        reasons: legacyReasons,
      };
    })
    .filter((entry) => entry.reasons.length > 0);
  const unknownLegacyLive = unknownLegacy.filter((entry) => entry.deletedAt === null);

  const published = (publicationRows ?? [])
    .filter((publication) => !publication.revoked_at)
    .map((publication) => ({
      publicationId: publication.id,
      slug: publication.slug,
      title: publication.title,
      assetId: publication.asset_id,
      posterAssetId: publication.poster_asset_id,
      href: `/p/${publication.slug}`,
      createdAt: publication.created_at,
    }));

  const protectedList = assetEntries
    .filter((entry) => entry.protected)
    .map((entry) => ({ assetId: entry.id, title: entry.title, bytes: entry.bytes, uses: entry.uses, published: entry.published, href: entry.href }));

  const missingBytes = missingReferencedObjects.reduce((sum, entry) => sum + asCount(entry.bytes), 0);
  const storedBytes = objectChecks.reduce((sum, check) => sum + (check.status === "present" ? asCount(check.storedBytes) : 0), 0);
  const sizeMismatchObjects = objectChecks.filter((check) => check.status === "size_mismatch").length;
  const tombstonedBytes = tombstoned.reduce((sum, asset) => sum + asCount(asset.bytes), 0);

  return {
    format: "media-studio.storage-report/v1",
    readOnly: true,
    writes: 0,
    generatedAt: Date.now(),
    project: { id: project.id, name: project.name, slug: project.slug },
    coverage: {
      complete: coverageComplete,
      assetsScanned: assets.length,
      liveAssets: live.length,
      tombstonedAssets: tombstoned.length,
      objectChecks: checkObjects,
      objectChecksTruncated,
      usesTruncated,
      duplicateGroupsTruncated: duplicateContent.length >= MAX_DUPLICATE_GROUPS,
      sources: coverageSources,
      note: coverageComplete
        ? "All saved-reference sources in this Studio were scanned. External tools and records outside this installation are not visible."
        : "One or more saved-reference sources could not be read. Assets without a listed use are reported as unknown, not unused.",
    },
    totals: {
      liveAssets: live.length,
      liveBytes,
      storedBytes,
      sizeMismatchObjects,
      tombstonedAssets: tombstoned.length,
      tombstonedBytes,
      erasurePending: tombstoned.filter((asset) => Number(asset.erasure_pending) === 1).length,
      originals,
      derivatives,
      unknownRole,
      protectedAssets,
      protectedBytes,
      publishedAssets,
      publishedBytes,
      missingObjects: missingReferencedObjects.length,
      missingBytes,
      danglingReferences: danglingTotal,
      unknownLegacyRows: unknownLegacyLive.length,
      duplicateGroups: duplicateContent.length,
      duplicateExtraAssets,
      duplicateWastedBytes,
      unreferencedObjects: objectListing.unreferenced,
      unreferencedBytes: objectListing.unreferencedBytes,
    },
    byKind,
    assets: assetEntries,
    usedBy: Object.fromEntries([...uses.entries()].map(([assetId, entries]) => [assetId, entries])),
    missingReferencedObjects,
    danglingReferences: dangling,
    unknownLegacy,
    duplicateContent,
    published,
    protectedAssets: protectedList,
    objectListing,
    cleanup: {
      status: "read_only",
      destructiveActions: 0,
      note: "This report performs no deletes, moves, re-encodes, permission changes or provider calls. Reclaiming storage is a separate, explicitly approved follow-up.",
    },
  };
}

/** One asset's saved-reference view, used by the asset detail panel. */
export async function assetUsageReport(env, project, assetId) {
  const report = await projectStorageReport(env, project, { checkObjects: false, listObjects: false });
  const asset = report.assets.find((entry) => entry.id === assetId);
  if (!asset) {
    const row = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2").bind(assetId, project.id).first();
    if (!row) return null;
    const generation = row.generation_id ? await env.DB.prepare("SELECT * FROM generations WHERE id=?1 AND project_id=?2").bind(row.generation_id, project.id).first() : null;
    const { role, legacyReasons } = normaliseLineage(row, generation);
    const assetUses = report.usedBy[row.id] ?? [];
    return {
      readOnly: true,
      writes: 0,
      projectId: project.id,
      asset: {
        id: row.id,
        title: row.title,
        kind: row.kind,
        bytes: asCount(row.bytes),
        sha256: row.sha256,
        source: row.source,
        deletedAt: row.deleted_at,
        role,
        referenceState: row.deleted_at !== null ? "tombstoned" : "unknown",
        protected: assetUses.length > 0,
        published: assetUses.some((use) => use.type === "publication" || use.type === "publication_poster"),
        legacyReasons,
      },
      uses: assetUses,
      coverage: report.coverage,
      notes: [
        "Only saved references in this project are listed. Missing provenance is unknown, not unused.",
        "This is a read-only view. It does not delete, move or re-encode media.",
      ],
    };
  }
  return {
    readOnly: true,
    writes: 0,
    projectId: project.id,
    asset: {
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
      bytes: asset.bytes,
      sha256: asset.sha256,
      source: asset.source,
      deletedAt: null,
      role: asset.role,
      referenceState: asset.referenceState,
      protected: asset.protected,
      published: asset.published,
      legacyReasons: asset.legacyReasons,
    },
    uses: report.usedBy[assetId] ?? [],
    coverage: report.coverage,
    notes: [
      "Only saved references in this project are listed. Missing provenance is unknown, not unused.",
      "This is a read-only view. It does not delete, move or re-encode media.",
    ],
  };
}

/** Preflight lookup. Matching is exact SHA-256 + byte size + MIME, same project
 * and live only. A filename is never used to decide a duplicate. */
export async function findDuplicateOriginal(env, project, { sha256, size, mime }) {
  const hash = String(sha256 ?? "").trim().toLowerCase();
  const bytes = Number(size);
  const type = String(mime ?? "").trim().toLowerCase();
  if (!SHA.test(hash)) return { valid: false, reason: "sha256 must be 64 hexadecimal characters" };
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return { valid: false, reason: "size must be a positive whole number of bytes" };
  const mediaLimit = type.startsWith("image/") || type.startsWith("audio/") ? 32 * 1024 * 1024 : 64 * 1024 * 1024;
  if (bytes > mediaLimit) return { valid: false, reason: `size exceeds the ${mediaLimit / 1024 / 1024} MiB limit for this media type` };
  if (!type || type.length > 100 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type))
    return { valid: false, reason: "mime must be a media type such as image/png" };
  const duplicate = await env.DB.prepare(
    `SELECT * FROM assets
     WHERE project_id=?1 AND deleted_at IS NULL AND LOWER(sha256)=?2 AND bytes=?3 AND LOWER(mime)=?4
     ORDER BY created_at ASC,id ASC LIMIT 1`,
  )
    .bind(project.id, hash, bytes, type)
    .first();
  return { valid: true, duplicate, fingerprint: { sha256: hash, size: bytes, mime: type } };
}
