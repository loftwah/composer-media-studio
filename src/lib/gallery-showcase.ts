// MIT. Configured showcase reads and the public /gallery route. Moved out of
// worker.mjs for #198 so the public gallery/showcase read path is checked under
// strict TypeScript. The SQL strings, slug bounds, listed-only featured gating,
// JSON shape, response status/headers/cache and binding flags are unchanged.
// Only erased annotations are added: callers keep passing the same Worker env
// and URL parameters they always did.

import { publicCatalogue } from "./public-catalogue.ts";
import { publicGallery, type PublicGalleryFilm } from "./public-gallery.ts";
import { PUBLIC_CACHE_SECONDS } from "./sitemap.ts";

// --- narrow, erased structural seams -------------------------------------

interface ShowcaseStatement {
  bind(...values: unknown[]): ShowcaseStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
}

export interface ShowcaseEnv {
  DB: { prepare(query: string): ShowcaseStatement };
  PUBLIC_SHOWCASE_SLUGS?: unknown;
  WOODHOUSE_SHARE?: unknown;
}

/** Only `get` is needed from the route's URLSearchParams. */
interface GalleryParams {
  get(name: string): string | null;
}

interface SharedShowcaseFilmRow {
  slug: string;
  title: string;
}

/** The row homeShowcase() selects for each configured slug. */
interface HomeShowcaseRow {
  slug: string;
  title: string;
  description: string | null;
  mime: string | null;
  poster_asset_id: unknown;
  poster_preview_id: unknown;
  poster_preview_width: number | null;
  poster_preview_height: number | null;
  thumb_id: unknown;
  thumb_width: number | null;
  thumb_height: number | null;
}

/** One film in the /share-films.json feed. */
export interface SharedShowcaseFilm {
  slug: string;
  title: string;
}

export interface HomeShowcaseOptions {
  listedOnly?: boolean;
}

/** The validated public filters and the derived featured-strip decision. */
export interface GalleryQueryParams {
  page: number;
  query: string;
  kind: string;
  project: string;
  capability: string;
  order: string;
  showFeatured: boolean;
}

const SHOWCASE_SLUG = /^[A-Za-z0-9_-]{1,80}$/;

// Both reads trim and bound the configured list the same way; only the share
// feed de-duplicates before its own cap, so keep that difference at the call.
function configuredSlugs(env: ShowcaseEnv): string[] {
  return String(env.PUBLIC_SHOWCASE_SLUGS ?? "").split(",")
    .map((value) => value.trim())
    .filter((value) => SHOWCASE_SLUG.test(value));
}

/** The films explicitly selected for the Portfolio showcase. The showcase is
 *  independent of a film's inclusion in the general Gallery. */
export async function shareShowcaseFilms(env: ShowcaseEnv): Promise<SharedShowcaseFilm[]> {
  const slugs = [...new Set(configuredSlugs(env))].slice(0, 24);
  if (!slugs.length) return [];
  const films = await env.DB.prepare(`SELECT p.slug,p.title
    FROM publications p JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
    WHERE p.slug IN (${slugs.map(() => "?").join(",")}) AND p.revoked_at IS NULL
      AND p.hidden=0 AND a.deleted_at IS NULL AND a.kind='video'`).bind(...slugs).all<SharedShowcaseFilmRow>();
  const bySlug = new Map(films.results.map((film) => [film.slug, { slug: film.slug, title: film.title }]));
  return slugs.flatMap((slug) => {
    const film = bySlug.get(slug);
    return film ? [film] : [];
  });
}

/** Only explicitly configured, still-published films are safe for the home
 *  gallery. `listedOnly` adds the Gallery's listing gate for the featured strip. */
export async function homeShowcase(
  env: ShowcaseEnv,
  { listedOnly = false }: HomeShowcaseOptions = {},
): Promise<PublicGalleryFilm[]> {
  const slugs = configuredSlugs(env).slice(0, 8);
  const rows = await Promise.all(slugs.map((value) => env.DB.prepare(`SELECT p.slug,p.title,p.description,poster.id AS poster_asset_id,a.mime,
    d.publication_id AS poster_preview_id,d.width AS poster_preview_width,d.height AS poster_preview_height,
    t.publication_id AS thumb_id,t.width AS thumb_width,t.height AS thumb_height
    FROM publications p JOIN assets a ON a.id=p.asset_id
    LEFT JOIN assets poster ON poster.id=p.poster_asset_id AND poster.project_id=p.project_id AND poster.kind='image' AND poster.deleted_at IS NULL
    LEFT JOIN publication_derivatives d ON d.publication_id=p.id AND d.kind='poster' AND d.source_sha256=poster.sha256
    LEFT JOIN publication_derivatives t ON t.publication_id=p.id AND t.kind='thumb'
    WHERE p.slug=?1 AND p.revoked_at IS NULL AND p.hidden=0 AND a.deleted_at IS NULL AND a.kind='video'
      ${listedOnly ? 'AND p.listed=1' : ''}`).bind(value).first<HomeShowcaseRow>()));
  return rows.filter((row): row is HomeShowcaseRow => Boolean(row)).slice(0, 3).map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    mime: row.mime,
    hasPoster: Boolean(row.poster_asset_id),
    ...(row.thumb_id ? { thumb_id: row.thumb_id, thumb_width: row.thumb_width, thumb_height: row.thumb_height } : {}),
    ...(row.poster_preview_id
      ? {
          poster_preview_id: row.poster_preview_id,
          poster_preview_width: row.poster_preview_width,
          poster_preview_height: row.poster_preview_height,
        }
      : {}),
  }));
}

/** Validate the public /gallery URL values with the Worker's existing bounds. */
export function parseGalleryQuery(params: GalleryParams): GalleryQueryParams {
  const rawPage = params.get("page") ?? "1";
  const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
  const query = (params.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  const requestedKind = params.get("kind") ?? "";
  const kind = ["image", "video", "audio"].includes(requestedKind) ? requestedKind : "";
  const requestedProject = (params.get("project") ?? "").slice(0, 80);
  const project = /^[A-Za-z0-9_-]+$/.test(requestedProject) ? requestedProject : "";
  const requestedCapability = params.get("capability") ?? "";
  const capability = ["original", "variation", "refinement", "assembled"].includes(requestedCapability) ? requestedCapability : "";
  const order = params.get("order") === "oldest" ? "oldest" : "newest";
  const showFeatured = page === 1 && order === "newest" && !query && !kind && !project && !capability;
  return { page, query, kind, project, capability, order, showFeatured };
}

/** The whole public /gallery read and response: catalogue, listed-only featured
 *  films on the unfiltered first page, and the same public cache header. The
 *  Worker keeps route dispatch, so other paths are untouched. */
export async function handleGallery(env: ShowcaseEnv, params: GalleryParams): Promise<Response> {
  const { page, query, kind, project, capability, order, showFeatured } = parseGalleryQuery(params);
  const [catalogue, featured] = await Promise.all([
    publicCatalogue(env, page, 24, { query, kind, order, project, capability }),
    showFeatured ? homeShowcase(env, { listedOnly: true }) : [],
  ]);
  return new Response(publicGallery({ ...catalogue, featured, page, query, kind, order, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}` },
  });
}
