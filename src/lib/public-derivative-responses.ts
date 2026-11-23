// MIT. Read-only public responses for publication derivative bytes.
//
// /p slug resolution and the publication privacy checks stay in the Worker. By
// the time these handlers run, the caller has already resolved a live page; this
// module only turns a stored derivative row into a conditional public response.
// Nothing here writes, and the two SQL strings are kept exactly as they were.

import { HttpError } from "./util.mjs";

// Narrow structural seams. Only the members these handlers touch are described:
// no Cloudflare types are imported, and every annotation here is erased at
// runtime. Callers keep passing the same Worker request, env and publication row.
interface DerivativeRequest {
  method: string;
  headers: { get(name: string): string | null };
}

interface DerivativePublication {
  id: string;
}

interface DerivativeStatement {
  bind(...values: unknown[]): {
    first<Row>(): Promise<Row | null>;
  };
}

interface DerivativeObject {
  body: ReadableStream;
}

interface DerivativeEnv {
  DB: { prepare(query: string): DerivativeStatement };
  MEDIA: { get(key: string): Promise<DerivativeObject | null> };
}

interface DerivativeRow {
  r2_key: string;
  mime: string;
  bytes: number;
  sha256: string;
}

/** A conditional request for published bytes: compare one strong tag per entry. */
export function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return String(header).split(",").some((entry) => {
    const tag = entry.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
}

export async function servePublicationThumb(
  request: DerivativeRequest,
  env: DerivativeEnv,
  publication: DerivativePublication,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  const derivative = await env.DB.prepare(
    "SELECT r2_key,mime,bytes,sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='thumb'",
  )
    .bind(publication.id)
    .first<DerivativeRow>();
  if (!derivative) throw new HttpError(404, "No fast preview for this page", "not_found");
  const etag = `"${derivative.sha256.slice(0, 32)}"`;
  if (matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  const object = await env.MEDIA.get(derivative.r2_key);
  if (!object) throw new HttpError(404, "No fast preview for this page", "not_found");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "content-type": derivative.mime,
      "content-length": String(derivative.bytes),
      etag,
      // A withdrawal must stop resolving quickly, so never cache for long.
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

export async function servePosterPreview(
  request: DerivativeRequest,
  env: DerivativeEnv,
  publication: DerivativePublication,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed", "method_not_allowed");
  // The chosen poster must still be a live image and the derivative must have
  // been rendered from exactly those bytes. There is deliberately no fallback to
  // the full poster on this path: it exists only to make first paint small.
  const derivative = await env.DB.prepare(
    `SELECT d.r2_key,d.mime,d.bytes,d.sha256
     FROM publication_derivatives d
     JOIN publications p ON p.id=d.publication_id
     JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id
       AND poster.kind='image' AND poster.deleted_at IS NULL
     WHERE d.publication_id=?1 AND d.kind='poster' AND d.source_sha256=poster.sha256`,
  )
    .bind(publication.id)
    .first<DerivativeRow>();
  if (!derivative) throw new HttpError(404, "No poster preview for this page", "not_found");
  const etag = `"${derivative.sha256.slice(0, 32)}"`;
  if (matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  const object = await env.MEDIA.get(derivative.r2_key);
  if (!object) throw new HttpError(404, "No poster preview for this page", "not_found");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "content-type": derivative.mime,
      "content-length": String(derivative.bytes),
      etag,
      // A withdrawal must stop resolving quickly, so never cache for long.
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
