// MIT. Read-only public media responses and the shared byte-range helpers.
//
// This is a faithful move of the Worker's `servePublished`, `parseRange` and
// `rangeHeaders` into strict TypeScript. The SQL, the public-image privacy
// check, the range algorithm, the conditional/cache/security headers and the
// disposition and HEAD handling are unchanged. Only erased annotations are
// added, so every existing private and public Worker caller keeps working with
// the same request, env and asset rows it always did.

import { checkPublicImage, type PublicImageAsset, type PublicImageEnv } from "./public-image-privacy.ts";
import { matchesEtag } from "./public-derivative-responses.ts";
import { extensionFor, HttpError } from "./util.mjs";

// Narrow, erased structural seams. Only the binding members and request/asset
// fields these functions touch are described: no Cloudflare types are imported.
interface PublishedRequest {
  method: string;
  headers: { get(name: string): string | null };
}

interface PublishedStatement {
  bind(...values: unknown[]): {
    first<Row>(): Promise<Row | null>;
  };
}

// The public-image check reads `size`/`arrayBuffer`; the R2 fallback streams
// `body`. Intersect the read binding with that stream seam instead of naming a
// Cloudflare type.
interface RangedObject {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream;
}

interface RangeOptions {
  range?: { offset: number; length: number };
}

export interface PublishedMediaEnv extends PublicImageEnv {
  DB: { prepare(query: string): PublishedStatement };
  MEDIA: { get(key: string, options?: RangeOptions): Promise<RangedObject | null> };
}

/** The asset columns the published-media response reads, plus the check's seam. */
interface PublishedAsset extends PublicImageAsset {
  id: string;
  deleted_at: number | null;
}

/** A usable byte range, the only shape `rangeHeaders` ever receives. */
interface ByteRange {
  offset: number;
  length: number;
  start: number;
  end: number;
}

/** No header, an invalid header, or a resolved range — matching the present objects. */
export type ParsedRange = null | { invalid: true } | (ByteRange & { invalid?: false });

export function rangeHeaders(range: ByteRange | null, size: number): Record<string, string> {
  return {
    "accept-ranges": "bytes",
    "content-length": String(range ? range.length : size),
    ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
  };
}

/** Parse one byte range. Range playback is a real media feature, not a label. */
export function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { invalid: true };
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    if (end === null) return { invalid: true };
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end)
    return { invalid: true };
  return { offset: start, length: end - start + 1, start, end };
}

/**
 * Serve the exact stored bytes for a live publication: re-validate public-image
 * metadata, honour ranges and conditional tags, and keep public media only
 * briefly cacheable so a withdrawn page stops resolving at the next check.
 */
export async function servePublished(
  request: PublishedRequest,
  env: PublishedMediaEnv,
  assetId: string,
  download: boolean,
): Promise<Response> {
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first<PublishedAsset>();
  if (!asset || asset.deleted_at) throw new HttpError(404, "Not found", "not_found");
  const inspected = await checkPublicImage(env, asset).catch((error) => {
    if (error.code !== "publication_metadata_unverified") throw error;
    throw new HttpError(404, "This media is not available for public sharing", "not_found");
  });
  const range = parseRange(request.headers.get("range"), asset.bytes);
  if (range?.invalid)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${asset.bytes}`, "accept-ranges": "bytes" },
    });
  const etag = `"${asset.sha256.slice(0, 32)}"`;
  // The tag comes from the stored bytes and the caller already resolved a live
  // publication, so an unchanged copy can be reused without sending it again.
  // The short max-age stays: a withdrawn page stops resolving at the next check.
  if (!range && matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=60" },
    });
  let body: BodyInit | null = inspected;
  if (inspected) {
    if (range) body = inspected.subarray(range.start, range.end + 1);
  } else {
    const object = await env.MEDIA.get(
      asset.r2_key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined,
    );
    if (!object) throw new HttpError(410, "This media is no longer available", "unavailable");
    body = object.body;
  }
  const headers: Record<string, string> = {
    "content-type": asset.mime,
    ...rangeHeaders(range, asset.bytes),
    // A withdrawn publication must stop resolving quickly, so public media is
    // only briefly cacheable rather than cached for a day.
    "cache-control": "public, max-age=60",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "cross-origin",
    etag,
  };
  if (download)
    headers["content-disposition"] = `attachment; filename="published-${asset.id}.${extensionFor(asset.mime)}"`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: range ? 206 : 200,
    headers,
  });
}
