// MIT. Small, regenerable previews for public gallery cards.
//
// A derivative belongs to one publication, never to the asset library. It is
// validated like any uploaded image but stored under its own key so deleting or
// rebuilding it cannot touch the original. Nothing here is needed to read a
// published page: the full media and poster routes stay authoritative.

import { HttpError, extensionFor, imageSize, sha256Hex, sniffMedia } from "./util.mjs";

export const MAX_DERIVATIVE_BYTES = 1024 * 1024;
export const MAX_DERIVATIVE_EDGE = 800;
const DERIVATIVE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function derivativeKey(projectId, publicationId, mime) {
  return `projects/${projectId}/derivatives/${publicationId}/thumb.${extensionFor(mime)}`;
}

/** Reject anything that is not a small, real JPEG, PNG or WebP still. */
export function inspectDerivative(bytes) {
  if (!bytes?.byteLength) throw new HttpError(400, "Choose a preview image to upload", "invalid");
  if (bytes.byteLength > MAX_DERIVATIVE_BYTES)
    throw new HttpError(413, "A fast preview must stay under 1 MiB", "too_large");
  const sniffed = sniffMedia(bytes);
  if (sniffed.kind !== "image" || !DERIVATIVE_MIME.has(sniffed.mime))
    throw new HttpError(415, "Upload a JPEG, PNG or WebP preview image", "unsupported_type");
  const size = imageSize(bytes);
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width < 1 || size.height < 1)
    throw new HttpError(415, "That preview image could not be read", "unsupported_type");
  if (Math.max(size.width, size.height) > MAX_DERIVATIVE_EDGE)
    throw new HttpError(
      400,
      `Fast previews must be ${MAX_DERIVATIVE_EDGE}px or smaller on the long edge`,
      "invalid_dimensions",
    );
  return { mime: sniffed.mime, width: size.width, height: size.height };
}

/** Store bytes first, then point D1 at them; a failed write leaves no row. */
export async function storeDerivative(env, publication, bytes) {
  const inspected = inspectDerivative(bytes);
  const key = derivativeKey(publication.project_id, publication.id, inspected.mime);
  const previous = await env.DB.prepare(
    "SELECT r2_key FROM publication_derivatives WHERE publication_id=?1 AND kind='thumb'",
  )
    .bind(publication.id)
    .first();
  const hash = await sha256Hex(bytes);
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: inspected.mime },
    customMetadata: { sha256: hash, project: publication.project_id, publication: publication.id },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at)
       VALUES(?1,'thumb',?2,?3,?4,?5,?6,?7,?8)
       ON CONFLICT(publication_id,kind) DO UPDATE SET
         r2_key=excluded.r2_key,mime=excluded.mime,bytes=excluded.bytes,width=excluded.width,
         height=excluded.height,sha256=excluded.sha256,created_at=excluded.created_at`,
    )
      .bind(publication.id, key, inspected.mime, bytes.byteLength, inspected.width, inspected.height, hash, Date.now())
      .run();
  } catch (error) {
    // The previous row still describes the old bytes when the key was reused.
    if (!previous || previous.r2_key !== key) await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }
  if (previous && previous.r2_key !== key) await env.MEDIA.delete(previous.r2_key).catch(() => {});
  return { ...inspected, bytes: bytes.byteLength, sha256: hash, path: "thumb" };
}

/** Withdrawal wins over cached previews, so drop both the row and its bytes. */
export async function deletePublicationDerivatives(env, publicationIds) {
  const ids = [...new Set(publicationIds.filter((value) => typeof value === "string" && value))];
  // D1 allows 100 bound parameters per query. An asset can back more
  // publications than that, so clean in bounded batches.
  for (let start = 0; start < ids.length; start += 90) {
    const chunk = ids.slice(start, start + 90);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(",");
    const rows = await env.DB.prepare(
      `SELECT r2_key FROM publication_derivatives WHERE publication_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all();
    for (const row of rows.results) {
      // The row is removed even if R2 refuses: a withdrawn page must never serve
      // its preview again. An orphaned object can be cleaned up later.
      try {
        await env.MEDIA.delete(row.r2_key);
      } catch (error) {
        console.warn("Could not delete a publication derivative", row.r2_key, error?.message);
      }
    }
    await env.DB.prepare(`DELETE FROM publication_derivatives WHERE publication_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }
}
