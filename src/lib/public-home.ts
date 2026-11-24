// MIT. Signed-out public homepage and help response assembly, moved out of
// worker.mjs for #198 so both public responses are checked under strict
// TypeScript. The Worker keeps request/session branching, the /studio login
// branch and the authenticated shell; these helpers only take over the two
// public response bodies. Renderers, data reads, headers and cache are unchanged.

import { homeShowcase, type ShowcaseEnv } from "./gallery-showcase.ts";
import { publicCatalogue } from "./public-catalogue.ts";
import { publicGallery } from "./public-gallery.ts";
import { helpPage } from "./public-tool-pages.ts";
import { PUBLIC_CACHE_SECONDS } from "./sitemap.ts";
import { sharingDestinations, type SharingEnvironment } from "./sharing.ts";

/**
 * The bindings these two public responses read. Compose the existing data
 * helper environment seams and add only the two configuration strings that the
 * help renderer needs; every annotation here is erased at runtime.
 */
type PublicHomeEnv = ShowcaseEnv & SharingEnvironment & {
  COMPOSER_ORIGIN?: string | null;
  PUBLIC_STORY_URL?: string | null;
};

/** The current signed-out `/` catalogue response, including the public cache. */
export async function publicHomeResponse(env: PublicHomeEnv): Promise<Response> {
  const catalogue = await publicCatalogue(env, 1, 6, { withFacets: false });
  const featured = catalogue.items.length ? [] : await homeShowcase(env);
  return new Response(publicGallery({ ...catalogue, ...sharingDestinations(env), featured, page: 1, home: true, woodhouseShare: env.WOODHOUSE_SHARE === "true" }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}` },
  });
}

/** `/help`: the same renderer, body and one-hour public cache as before. */
export function publicHelpResponse(env: PublicHomeEnv): Response {
  return new Response(helpPage({ composerOrigin: env.COMPOSER_ORIGIN, storyUrl: env.PUBLIC_STORY_URL }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
