// MIT. The public sitemap and robots policy.
//
// Only publications in the public state are enumerated: `listed=1`, not
// `hidden`, not revoked, with a live asset. Private assets have no publication
// row, unlisted pages keep `listed=0`, and withdrawn pages keep `revoked_at`, so
// none of them can reach this list. The list is rebuilt from D1 on every request
// rather than hand-maintained.
//
// The documented cache boundary for public pages, media and this sitemap is 60
// seconds (`public, max-age=60`): a withdrawal stops new reads at once, and a
// cache that already holds a copy may serve it for at most that window. Search
// engine de-indexing is outside this app's control.
//
// Publication copy can change after creation. A verified last-public-change
// timestamp is needed before these URLs can include lastmod, so none is emitted
// here (in the urlset or in a sitemap index).
//
// Overflow: while the catalogue fits in one file, /sitemap.xml is a plain
// urlset, unchanged. Past SITEMAP_LIMIT eligible publications, /sitemap.xml
// becomes a sitemap index of same-origin, same-directory numbered children
// (/sitemap-1.xml, ...), each within the same URL cap. Everything is derived
// from the same eligibility query on each read: no sitemap rows are stored.

import { escapeHtml } from "./util.mjs";

export const SITEMAP_LIMIT = 5000;
export const PUBLIC_CACHE_SECONDS = 60;

// The one predicate that decides whether a publication may be enumerated.
// Reused verbatim by the count and the paginated reads so an overflow page can
// never disagree with the file that indexes it.
const ELIGIBLE_PUBLICATIONS =
  `FROM publications p JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
   WHERE p.listed=1 AND p.hidden=0 AND p.revoked_at IS NULL AND a.deleted_at IS NULL`;
const PUBLICATION_ORDER = ` ORDER BY p.created_at DESC,p.id DESC`;
const STATIC_PATHS = ["/", "/gallery"];

/** The configured public origin, falling back to the request's own origin. */
export function publicOrigin(env, requestUrl) {
  const configured = env.PUBLIC_ORIGIN;
  if (typeof configured === "string") {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.origin;
    } catch {
      // Fall through to the observed request origin.
    }
  }
  return new URL(requestUrl).origin;
}

function urlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((loc) => `  <url><loc>${escapeHtml(loc)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

/** One page of eligible publication URLs, in the same order as the flat file. */
async function publicationUrls(env, origin, limit, offset) {
  const { results } = await env.DB.prepare(
    `SELECT p.slug ${ELIGIBLE_PUBLICATIONS}${PUBLICATION_ORDER} LIMIT ?1 OFFSET ?2`,
  )
    .bind(limit, offset)
    .all();
  return results.map((row) => `${origin}/p/${encodeURIComponent(row.slug)}`);
}

async function eligibleCount(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n ${ELIGIBLE_PUBLICATIONS}`).first();
  return Number(row?.n ?? 0);
}

/**
 * Rebuild a public sitemap document from the publications whose state is public.
 * With `child === null` this is /sitemap.xml: a urlset below the cap, a sitemap
 * index above it. A numbered child returns its urlset, or null if that child is
 * not part of the current index (the router answers 404).
 */
export async function publicSitemap(env, origin, child = null) {
  const count = await eligibleCount(env);
  const totalUrls = count + STATIC_PATHS.length;
  const overflow = count > SITEMAP_LIMIT;
  // No numbered children exist for a catalogue that fits in one file.
  const pageCount = overflow ? Math.ceil(totalUrls / SITEMAP_LIMIT) : 0;

  if (child === null) {
    if (!overflow) {
      return urlset([
        ...STATIC_PATHS.map((path) => `${origin}${path}`),
        ...await publicationUrls(env, origin, SITEMAP_LIMIT, 0),
      ]);
    }
    const locs = Array.from({ length: pageCount }, (_, index) => `${origin}/sitemap-${index + 1}.xml`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs
      .map((loc) => `  <sitemap><loc>${escapeHtml(loc)}</loc></sitemap>`)
      .join("\n")}\n</sitemapindex>\n`;
  }

  if (!Number.isInteger(child) || child < 1 || child > pageCount) return null;
  const start = (child - 1) * SITEMAP_LIMIT;
  const end = Math.min(start + SITEMAP_LIMIT, totalUrls);
  // The two static URLs live at the head of child 1; every publication keeps
  // one stable zero-based slot in the global ordering across all children.
  const publicationStart = Math.max(start, STATIC_PATHS.length) - STATIC_PATHS.length;
  const publicationCount = end - STATIC_PATHS.length - publicationStart;
  const urls = start === 0 ? STATIC_PATHS.map((path) => `${origin}${path}`) : [];
  if (publicationCount > 0) urls.push(...await publicationUrls(env, origin, publicationCount, publicationStart));
  return urlset(urls);
}

/** Point crawlers at the public catalogue and away from private surfaces. */
export function robotsTxt(origin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /studio",
    "Disallow: /api/",
    "Disallow: /login",
    "Disallow: /bridge",
    "Disallow: /compare",
    "Disallow: /r/",
    "Disallow: /s/",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
