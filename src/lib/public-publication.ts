// MIT. The public publication branch: /p/<slug> and its media, download,
// caption, poster and thumb suffixes. Moved out of worker.mjs for #198 so the
// Worker delegates at the same point in its public router. The route regex,
// SQL strings, privacy checks, headers and cache behaviour are unchanged.
//
// Every downstream read is reused from its existing strict TypeScript module:
// byte ranges and media from public-media.ts, reviewed captions from
// public-captions.ts, related works from public-catalogue.ts, poster and thumb
// bytes from public-derivative-responses.ts, destinations from sharing.ts and
// the page renderer from public-piece.ts. The seams below describe only the
// members touched here; no Cloudflare types are imported and every annotation
// is erased at runtime.

import { FILM_EMBED_URL, PUBLIC_CAPTION_ROUTE, reviewedCaptionFor } from "./public-captions.ts";
import { relatedWorks } from "./public-catalogue.ts";
import { servePosterPreview, servePublicationThumb } from "./public-derivative-responses.ts";
import { servePublished } from "./public-media.ts";
import { publicPage } from "./public-piece.ts";
import { sharingDestinations, type SharingEnvironment } from "./sharing.ts";
import { HttpError, safeJson } from "./util.mjs";

// --- narrow, erased structural seams -------------------------------------

interface PublicationRequest {
  method: string;
  headers: { get(name: string): string | null };
}

interface PublicationStatement {
  bind(...values: unknown[]): PublicationStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
}

interface PublicationObject {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream;
}

interface PublicationEnv extends SharingEnvironment {
  DB: { prepare(query: string): PublicationStatement };
  MEDIA: {
    get(
      key: string,
      options?: { range?: { offset: number; length: number } },
    ): Promise<PublicationObject | null>;
  };
  PUBLIC_ORIGIN?: string;
}

interface PublicationUrl {
  pathname: string;
  origin: string;
  searchParams: URLSearchParams;
}

/** The columns the live-publication read actually uses (`p.*` plus `a`). */
interface PublicationRow {
  id: string;
  slug: string;
  project_id: string;
  asset_id: string;
  poster_asset_id: string | null;
  title: string;
  description: string;
  listed: number;
  hidden: number;
  created_at: number;
  attribution_json: string;
  asset_kind: string;
  asset_mime: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  bytes: number;
  asset_sha256: string;
  asset_deleted: number | null;
}

/** The poster row is trusted for the page only while it is a live image. */
interface PosterAssetRow {
  id: string;
  kind: string;
  mime: string;
  width: number | null;
  height: number | null;
  sha256: string;
  deleted_at: number | null;
}

interface PosterPreviewRow {
  width: number | null;
  height: number | null;
  source_sha256: string | null;
}

interface ThumbPreviewRow {
  mime: string;
  width: number | null;
  height: number | null;
}

/** The attribution fields the renderer may surface as a public source credit. */
interface PublicAttribution {
  credit?: unknown;
  sourceUrl?: unknown;
  reuse?: unknown;
  tablerMit?: unknown;
}

/**
 * Resolve one public page request. Returns null for every other path so the
 * Worker keeps the exact existing precedence: this runs after the signed
 * upload/render, review and owner routes and before /s and the public router.
 */
export async function handlePublicPublication(
  request: PublicationRequest,
  env: PublicationEnv,
  url: PublicationUrl,
): Promise<Response | null> {
  const publicationMatch = url.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/poster-preview|\/poster|\/download|\/media|\/thumb|\/captions\.vtt)?$/);
  if (!publicationMatch) return null;
  const [, publicSlug, extra] = publicationMatch;
  const publication = await env.DB.prepare(
    `SELECT p.*, a.kind AS asset_kind, a.mime AS asset_mime, a.width, a.height, a.duration_ms, a.bytes, a.sha256 AS asset_sha256, a.deleted_at AS asset_deleted
     FROM publications p JOIN assets a ON a.id=p.asset_id
     WHERE p.slug=?1 AND p.revoked_at IS NULL`,
  )
    .bind(publicSlug)
    .first<PublicationRow>();
  if (!publication || publication.asset_deleted)
    throw new HttpError(404, "This page is not published", "not_found");

  if (extra === "/download") return servePublished(request, env, publication.asset_id, true);
  if (extra === "/media") return servePublished(request, env, publication.asset_id, false);
  const caption = publication.asset_kind === "video"
    ? reviewedCaptionFor(publicSlug, publication.asset_sha256)
    : null;
  if (extra === PUBLIC_CAPTION_ROUTE) {
    if (!caption) throw new HttpError(404, "No captions for this page", "not_found");
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    return new Response(request.method === "HEAD" ? null : caption, {
      headers: {
        "content-type": "text/vtt; charset=utf-8",
        "cache-control": "public, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (extra === "/thumb") return servePublicationThumb(request, env, publication);
  if (extra === "/poster-preview") return servePosterPreview(request, env, publication);
  if (extra === "/poster") {
    if (!publication.poster_asset_id) throw new HttpError(404, "No poster for this page", "not_found");
    return servePublished(request, env, publication.poster_asset_id, false);
  }
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed", "method_not_allowed");

  let posterAsset: PosterAssetRow | null = null;
  if (publication.poster_asset_id) {
    posterAsset = await env.DB.prepare(
      "SELECT id,kind,mime,width,height,sha256,deleted_at FROM assets WHERE id=?1",
    )
      .bind(publication.poster_asset_id)
      .first<PosterAssetRow>();
  }
  const usablePoster = posterAsset && !posterAsset.deleted_at && posterAsset.kind === "image" ? posterAsset : null;
  // The page-size derivative only stands in for first paint when it was rendered
  // from the poster the page currently names.
  const posterPreview = usablePoster
    ? await env.DB.prepare(
        "SELECT width,height,source_sha256 FROM publication_derivatives WHERE publication_id=?1 AND kind='poster'",
      )
        .bind(publication.id)
        .first<PosterPreviewRow>()
    : null;
  const usablePosterPreview =
    usablePoster && posterPreview && posterPreview.source_sha256 === usablePoster.sha256 ? posterPreview : null;
  // A published film with no chosen poster still has a stored preview from the
  // gallery pipeline. Use it for the video poster and the share image so a
  // shared link keeps its thumbnail instead of falling back to text-only.
  const preview = !usablePoster && publication.asset_kind === "video"
    ? await env.DB.prepare(
        "SELECT mime,width,height FROM publication_derivatives WHERE publication_id=?1 AND kind='thumb'",
      )
        .bind(publication.id)
        .first<ThumbPreviewRow>()
    : null;
  const poster =
    publication.asset_kind === "image"
      ? `/p/${publication.slug}/download`
      : usablePoster
        ? `/p/${publication.slug}/poster`
        : preview
          ? `/p/${publication.slug}/thumb`
          : null;
  // The share image above stays the full poster. Only the first paint of the
  // film element earns a smaller still.
  const videoPoster =
    publication.asset_kind !== "video"
      ? null
      : usablePoster
        ? usablePosterPreview
          ? `/p/${publication.slug}/poster-preview`
          : `/p/${publication.slug}/poster`
        : preview
          ? `/p/${publication.slug}/thumb`
          : null;
  const destinations = sharingDestinations(env);
  // Only permit a local gallery return; never turn a public link into an open redirect.
  let galleryBack = "/gallery";
  const requestedBack = url.searchParams.get("back");
  if (requestedBack && requestedBack.length <= 2048 && requestedBack.startsWith("/gallery?")) {
    const backUrl = new URL(requestedBack, url.origin);
    if (backUrl.origin === url.origin && backUrl.pathname === "/gallery") {
      const params = new URLSearchParams();
      const query = (backUrl.searchParams.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
      const kind = backUrl.searchParams.get("kind") ?? "";
      const project = (backUrl.searchParams.get("project") ?? "").slice(0, 80);
      const capability = backUrl.searchParams.get("capability") ?? "";
      const order = backUrl.searchParams.get("order");
      const page = backUrl.searchParams.get("page");
      if (query) params.set("q", query);
      if (["image", "video", "audio"].includes(kind)) params.set("kind", kind);
      if (/^[A-Za-z0-9_-]+$/.test(project)) params.set("project", project);
      if (["original", "variation", "refinement", "assembled"].includes(capability)) params.set("capability", capability);
      if (order === "oldest") params.set("order", order);
      if (page && /^[1-9][0-9]{0,4}$/.test(page)) params.set("page", page);
      if (params.size) galleryBack += `?${params}#gallery-results`;
    }
  }
  // Bounded, same-project public continuations. Uses the gallery's own public
  // read boundary and card renderer; nothing is listed, published or changed.
  const listed = Boolean(publication.listed) && !publication.hidden;
  const related = listed
    ? await relatedWorks(env, publication.project_id, publication.id)
    : [];
  const html = publicPage({
    galleryBack,
    related,
    title: publication.title,
    description: publication.description,
    listed,
    // First playable publication instant, not the asset's own created_at.
    publishedAt: publication.created_at,
    attribution: safeJson<PublicAttribution[]>(publication.attribution_json, []),
    kind: publication.asset_kind,
    mime: publication.asset_mime,
    width: publication.width,
    height: publication.height,
    durationMs: publication.duration_ms,
    bytes: publication.bytes,
    media: `/p/${publication.slug}/media`,
    download: `/p/${publication.slug}/download`,
    captionSrc: caption ? `/p/${publicSlug}${PUBLIC_CAPTION_ROUTE}` : null,
    embedUrl: caption ? FILM_EMBED_URL : null,
    poster,
    videoPoster,
    posterMime: usablePoster?.mime ?? preview?.mime ?? null,
    posterWidth: usablePoster?.width ?? preview?.width ?? null,
    posterHeight: usablePoster?.height ?? preview?.height ?? null,
    buildUrl: destinations.buildUrl,
    storyUrl: destinations.storyUrl,
    origin: env.PUBLIC_ORIGIN || url.origin,
    slug: publication.slug,
  });
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}
