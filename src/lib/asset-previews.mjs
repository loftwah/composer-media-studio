// MIT. Small private stills for the owner's library cards.
//
// One preview belongs to one stored image asset. It is derived with the same
// bounded Cloudflare Images rendition the public poster preview uses, written
// under the asset's own project prefix and referenced from `asset_previews`.
//
// A preview is not an asset: it never appears in the library, a portable export
// or a published page. Reading one requires an owner session, and deleting the
// asset deletes its preview in the same erasure step.

import { HttpError, sha256Hex } from "./util.mjs";
import { inspectDerivative } from "./publication-derivatives.ts";
import { renderPreview } from "./preview-rendition.ts";

/** Only a stored still can be previewed; a film's frame needs a different job. */
const PREVIEWABLE_KIND = "image";

export function assetPreviewKey(projectId, assetId) {
  return `projects/${projectId}/asset-previews/${assetId}.webp`;
}

/**
 * Render and store one preview. Re-running with the same source bytes is a
 * no-op so a backfill can be repeated safely.
 *
 * @returns {Promise<{assetId: string, bytes: number, width: number, height: number, sha256: string, unchanged: boolean}>}
 */
export async function storeAssetPreview(env, asset) {
  if (!asset?.id) throw new HttpError(400, "Choose an asset to preview", "invalid");
  if (asset.deleted_at) throw new HttpError(404, "Asset not found", "not_found");
  if (asset.kind !== PREVIEWABLE_KIND)
    throw new HttpError(415, "Only a stored still can have a library preview", "unsupported_type");
  const current = await env.DB.prepare(
    "SELECT asset_id,bytes,width,height,sha256,source_sha256 FROM asset_previews WHERE asset_id=?1",
  )
    .bind(asset.id)
    .first();
  if (current && current.source_sha256 === asset.sha256)
    return {
      assetId: asset.id,
      bytes: current.bytes,
      width: current.width,
      height: current.height,
      sha256: current.sha256,
      unchanged: true,
    };

  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
  const source = new Uint8Array(await object.arrayBuffer());
  const rendered = await renderPreview(env, source, { width: asset.width, height: asset.height });
  await writeAssetPreview(env, asset, rendered, current);
  return {
    assetId: asset.id,
    bytes: rendered.bytes.byteLength,
    width: rendered.width,
    height: rendered.height,
    sha256: rendered.sha256,
    unchanged: false,
  };
}

/**
 * Store the bytes first, then point D1 at them. Shared by the server rendition
 * and by the owner's browser upload, so one row shape serves both.
 */
async function writeAssetPreview(env, asset, rendered, current) {
  const key = assetPreviewKey(asset.project_id, asset.id);
  await env.MEDIA.put(key, rendered.bytes, {
    httpMetadata: { contentType: rendered.mime },
    customMetadata: {
      sha256: rendered.sha256,
      source: asset.sha256,
      project: asset.project_id,
      asset: asset.id,
    },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO asset_previews(asset_id,project_id,r2_key,mime,bytes,width,height,sha256,source_sha256,created_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
       ON CONFLICT(asset_id) DO UPDATE SET
         project_id=excluded.project_id,r2_key=excluded.r2_key,mime=excluded.mime,
         bytes=excluded.bytes,width=excluded.width,height=excluded.height,
         sha256=excluded.sha256,source_sha256=excluded.source_sha256,created_at=excluded.created_at`,
    )
      .bind(
        asset.id,
        asset.project_id,
        key,
        rendered.mime,
        rendered.bytes.byteLength,
        rendered.width,
        rendered.height,
        rendered.sha256,
        asset.sha256,
        Date.now(),
      )
      .run();
  } catch (error) {
    // Without a row nothing can serve these bytes, so do not leave them behind.
    if (!current) await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }
}

/**
 * Store a preview the owner's browser already rendered from the same asset.
 *
 * This exists because a Cloudflare Images binding on legacy billing refuses the
 * server rendition; the browser path is the same artwork, scaled down once, and
 * is validated exactly like an uploaded still.
 */
export async function storeAssetPreviewUpload(env, asset, bytes) {
  if (!asset?.id) throw new HttpError(400, "Choose an asset to preview", "invalid");
  if (asset.deleted_at) throw new HttpError(404, "Asset not found", "not_found");
  if (asset.kind !== PREVIEWABLE_KIND)
    throw new HttpError(415, "Only a stored still can have a library preview", "unsupported_type");
  const inspected = inspectDerivative(bytes, { maxEdge: 1024 });
  const current = await env.DB.prepare(
    "SELECT asset_id,bytes,width,height,sha256,source_sha256 FROM asset_previews WHERE asset_id=?1",
  )
    .bind(asset.id)
    .first();
  const rendered = {
    bytes,
    mime: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    sha256: await sha256Hex(bytes),
  };
  await writeAssetPreview(env, asset, rendered, current);
  return {
    assetId: asset.id,
    bytes: rendered.bytes.byteLength,
    width: rendered.width,
    height: rendered.height,
    sha256: rendered.sha256,
    unchanged: false,
  };
}

/** Return a stored preview and its object, or null when there is nothing to serve. */
export async function readAssetPreview(env, assetId) {
  const row = await env.DB.prepare(
    "SELECT asset_id,project_id,r2_key,mime,bytes,width,height,sha256,source_sha256,created_at FROM asset_previews WHERE asset_id=?1",
  )
    .bind(assetId)
    .first();
  if (!row) return null;
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) return null;
  return { ...row, object };
}

/**
 * Delete previews for the given assets, in the same bounded batches the
 * publication derivatives use. Rows go even if R2 refuses: an orphaned object is
 * preferable to a preview outliving its asset.
 */
export async function deleteAssetPreviews(env, assetIds) {
  const ids = [...new Set(assetIds.filter((value) => typeof value === "string" && value))];
  for (let start = 0; start < ids.length; start += 90) {
    const chunk = ids.slice(start, start + 90);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const rows = await env.DB.prepare(
      `SELECT r2_key FROM asset_previews WHERE asset_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all();
    for (const row of rows.results) {
      try {
        await env.MEDIA.delete(row.r2_key);
      } catch (error) {
        console.warn("Could not delete an asset preview", row.r2_key, error?.message);
      }
    }
    await env.DB.prepare(`DELETE FROM asset_previews WHERE asset_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }
}
