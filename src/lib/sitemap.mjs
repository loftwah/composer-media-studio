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
// timestamp is needed before these URLs can include lastmod.

import { escapeHtml } from "./util.mjs";

export const SITEMAP_LIMIT = 5000;
export const PUBLIC_CACHE_SECONDS = 60;

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

/** Rebuild sitemap.xml from the publications whose state is public. */
export async function publicSitemap(env, origin) {
  const rows = await env.DB.prepare(
    `SELECT p.slug
     FROM publications p JOIN assets a ON a.id=p.asset_id AND a.project_id=p.project_id
     WHERE p.listed=1 AND p.hidden=0 AND p.revoked_at IS NULL AND a.deleted_at IS NULL
     ORDER BY p.created_at DESC,p.id DESC LIMIT ?1`,
  )
    .bind(SITEMAP_LIMIT)
    .all();
  const urls = [
    `${origin}/`,
    `${origin}/gallery`,
    ...rows.results.map((row) => `${origin}/p/${encodeURIComponent(row.slug)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((loc) => `  <url><loc>${escapeHtml(loc)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
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
