// MIT. Small, regenerable previews for public pages.
//
// A derivative belongs to one publication, never to the asset library. It is
// validated like any uploaded image but stored under its own key so deleting or
// rebuilding it cannot touch the original. Nothing here is needed to read a
// published page: the full media and poster routes stay authoritative.
//
// Two kinds share the table:
//   * `thumb` is the gallery card still, uploaded by the owner's browser;
//   * `poster` is a page-size WebP of the owner's chosen poster, rendered here
//     so a 3 MB original is not the first paint of a film page. The full poster
//     stays the share image and the download.

import { renderPreview, type RenderedPreview } from "./preview-rendition.mjs";
import { HttpError, extensionFor, imageSize, sha256Hex, sniffMedia } from "./util.mjs";

// Narrow structural seams. Only the binding members and row fields this module
// actually touches are described: no Cloudflare types are imported, and every
// annotation here is erased at runtime. Callers keep passing the same Worker
// env, publication rows and asset rows they always did.
interface DerivativeEnv {
  DB: {
    prepare(query: string): {
      bind(...values: unknown[]): {
        first(): Promise<DerivativeRow | null>;
        all(): Promise<{ results: DerivativeRow[] }>;
        run(): Promise<unknown>;
      };
    };
  };
  MEDIA: {
    put(
      key: string,
      value: Uint8Array,
      options: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ): Promise<unknown>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    delete(key: string): Promise<unknown>;
  };
  // Consumed only by renderPreview, which owns the Images binding.
  IMAGES: unknown;
}

interface DerivativeRow {
  r2_key: string;
  source_sha256?: string | null;
}

interface DerivativePublication {
  id: string;
  project_id: string;
  slug: string;
}

interface DerivativePosterAsset {
  kind: string;
  deleted_at?: number | null;
  r2_key: string;
  width: number;
  height: number;
  sha256?: string | null;
}

interface DerivativeInspection {
  mime: string;
  width: number;
  height: number;
}

interface StoredDerivative extends DerivativeInspection {
  bytes: number;
  sha256: string;
  path: "thumb";
}

interface StoredPosterDerivative {
  path: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

export const MAX_DERIVATIVE_BYTES = 1024 * 1024;
export const MAX_DERIVATIVE_EDGE = 800;
// A page-size poster is painted larger than a gallery card, so it may be a
// little wider. The thumb bound above stays where it was.
export const MAX_POSTER_DERIVATIVE_EDGE = 1024;
const DERIVATIVE_MIME = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

export function derivativeKey(projectId: string, publicationId: string, mime: string): string {
  return `projects/${projectId}/derivatives/${publicationId}/thumb.${extensionFor(mime)}`;
}

/** One fixed WebP key per publication, so a rebuild replaces its own bytes. */
export function posterDerivativeKey(projectId: string, publicationId: string): string {
  return `projects/${projectId}/derivatives/${publicationId}/poster.webp`;
}

/** Reject anything that is not a small, real JPEG, PNG or WebP still. */
export function inspectDerivative(
  bytes: Uint8Array | null | undefined,
  { maxEdge = MAX_DERIVATIVE_EDGE }: { maxEdge?: number } = {},
): DerivativeInspection {
  if (!bytes?.byteLength) throw new HttpError(400, "Choose a preview image to upload", "invalid");
  if (bytes.byteLength > MAX_DERIVATIVE_BYTES)
    throw new HttpError(413, "A fast preview must stay under 1 MiB", "too_large");
  const sniffed = sniffMedia(bytes);
  if (sniffed.kind !== "image" || !DERIVATIVE_MIME.has(sniffed.mime))
    throw new HttpError(415, "Upload a JPEG, PNG or WebP preview image", "unsupported_type");
  const size = imageSize(bytes);
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width! < 1 || size.height! < 1)
    throw new HttpError(415, "That preview image could not be read", "unsupported_type");
  if (Math.max(size.width!, size.height!) > maxEdge)
    throw new HttpError(
      400,
      `Fast previews must be ${maxEdge}px or smaller on the long edge`,
      "invalid_dimensions",
    );
  return { mime: sniffed.mime, width: size.width!, height: size.height! };
}

/** Store bytes first, then point D1 at them; a failed write leaves no row. */
export async function storeDerivative(
  env: DerivativeEnv,
  publication: DerivativePublication,
  bytes: Uint8Array,
): Promise<StoredDerivative> {
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
export async function deletePublicationDerivatives(env: DerivativeEnv, publicationIds: readonly unknown[]): Promise<void> {
  const ids = [...new Set(publicationIds.filter((value) => typeof value === "string" && value))];
  // D1 allows 100 bound parameters per query. An asset can back more
  // publications than that, so clean in bounded batches. The select has no kind
  // filter: every kind a publication owns must stop with the page.
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
        console.warn("Could not delete a publication derivative", row.r2_key, (error as { message?: string } | undefined)?.message);
      }
    }
    await env.DB.prepare(`DELETE FROM publication_derivatives WHERE publication_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }
}

/** Remove one publication's poster derivative before it can describe old artwork. */
export async function deletePublicationPosterDerivative(env: DerivativeEnv, publicationId: string): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT r2_key FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publicationId)
    .all();
  for (const row of rows.results) {
    try {
      await env.MEDIA.delete(row.r2_key);
    } catch (error) {
      console.warn("Could not delete a poster derivative", row.r2_key, (error as { message?: string } | undefined)?.message);
    }
  }
  await env.DB.prepare("DELETE FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'")
    .bind(publicationId)
    .run();
}

/**
 * Point the publication's one poster row at `rendered`, which already came from
 * the poster's current bytes. A poster that changed since the last render must
 * not leave its old artwork addressable, even for the moment between the delete
 * and the new row.
 */
async function writePosterDerivative(
  env: DerivativeEnv,
  publication: DerivativePublication,
  sourceSha: string,
  rendered: RenderedPreview,
): Promise<StoredPosterDerivative> {
  const key = posterDerivativeKey(publication.project_id, publication.id);
  const previous = await env.DB.prepare(
    "SELECT r2_key,source_sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
  )
    .bind(publication.id)
    .first();
  let hasRow = Boolean(previous);
  if (previous && previous.source_sha256 && previous.source_sha256 !== sourceSha) {
    await deletePublicationPosterDerivative(env, publication.id);
    hasRow = false;
  }
  await env.MEDIA.put(key, rendered.bytes, {
    httpMetadata: { contentType: rendered.mime },
    customMetadata: {
      sha256: rendered.sha256,
      source: sourceSha,
      project: publication.project_id,
      publication: publication.id,
    },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO publication_derivatives(publication_id,kind,r2_key,mime,bytes,width,height,sha256,source_sha256,created_at)
       VALUES(?1,'poster',?2,?3,?4,?5,?6,?7,?8,?9)
       ON CONFLICT(publication_id,kind) DO UPDATE SET
         r2_key=excluded.r2_key,mime=excluded.mime,bytes=excluded.bytes,width=excluded.width,
         height=excluded.height,sha256=excluded.sha256,source_sha256=excluded.source_sha256,
         created_at=excluded.created_at`,
    )
      .bind(
        publication.id,
        key,
        rendered.mime,
        rendered.bytes.byteLength,
        rendered.width,
        rendered.height,
        rendered.sha256,
        sourceSha,
        Date.now(),
      )
      .run();
  } catch (error) {
    // The fixed key may already hold usable bytes for a previous row. Removing
    // it leaves the page on its full-poster fallback rather than a broken image.
    if (!hasRow) await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }
  return {
    path: `/p/${publication.slug}/poster-preview`,
    bytes: rendered.bytes.byteLength,
    width: rendered.width,
    height: rendered.height,
    sha256: rendered.sha256,
  };
}

/**
 * Render the page-size WebP of a publication's chosen poster from the stored
 * still itself. `posterAsset` is the live image row the publication names.
 *
 * The render happens before anything is replaced: if Images refuses, the old
 * derivative (or the full-poster fallback) keeps working.
 */
export async function storePosterDerivative(
  env: DerivativeEnv,
  publication: DerivativePublication,
  posterAsset: DerivativePosterAsset | null | undefined,
): Promise<StoredPosterDerivative> {
  if (!posterAsset || posterAsset.kind !== "image" || posterAsset.deleted_at)
    throw new HttpError(404, "No poster for this page", "not_found");
  const object = await env.MEDIA.get(posterAsset.r2_key);
  if (!object) throw new HttpError(410, "The stored poster is unavailable", "unavailable");
  const source = new Uint8Array(await object.arrayBuffer());
  const rendered = await renderPreview(env, source, {
    width: posterAsset.width,
    height: posterAsset.height,
  });
  const sourceSha = posterAsset.sha256 || (await sha256Hex(source));
  return writePosterDerivative(env, publication, sourceSha, rendered);
}

/**
 * Accept the page-size still the owner's browser already rendered from the
 * chosen poster. This exists because the Cloudflare Images binding is not
 * available on every account (9432 on legacy billing), while a canvas in the
 * owner's browser always is.
 *
 * The row records the poster's own sha256 as `source_sha256`, so the public
 * route serves it only while the chosen poster is still exactly those bytes.
 */
export async function storePosterUpload(
  env: DerivativeEnv,
  publication: DerivativePublication,
  posterAsset: DerivativePosterAsset | null | undefined,
  bytes: Uint8Array,
): Promise<StoredPosterDerivative> {
  if (!posterAsset || posterAsset.kind !== "image" || posterAsset.deleted_at)
    throw new HttpError(404, "No poster for this page", "not_found");
  const sourceSha = posterAsset.sha256;
  if (typeof sourceSha !== "string" || !sourceSha)
    throw new HttpError(409, "The chosen poster has no recorded bytes to preview", "source_unavailable");
  const inspected = inspectDerivative(bytes, { maxEdge: MAX_POSTER_DERIVATIVE_EDGE });
  const hash = await sha256Hex(bytes);
  return writePosterDerivative(env, publication, sourceSha, {
    bytes,
    mime: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    sha256: hash,
  });
}
