// MIT. Share-enabled public routes: the /share-films.json Composer film feed
// and the legacy /portfolio[/] redirect. Moved out of worker.mjs for #198 so
// their response assembly is checked under strict TypeScript. Only erased
// annotations are added: the flag value, exact route casts, place after /login,
// method handling, cache, query filtering and redirect validation/identity are
// unchanged, as is this group's place in the public router.

import { composerShare } from "./composer-share.ts";
import { shareShowcaseFilms, type ShowcaseEnv } from "./gallery-showcase.ts";
import { HttpError, json } from "./util.ts";

type ShareRoutesEnv = Pick<ShowcaseEnv, "DB"> & {
  WOODHOUSE_SHARE?: string;
};

/**
 * Resolve one share-enabled public route, or null to let the router continue.
 * Only the film feed yields a promise, matching the Worker's earlier await.
 */
export function shareRoutesResponse(
  path: string,
  request: Request,
  url: URL,
  env: ShareRoutesEnv,
): Response | Promise<Response> | null {
  if (path === "/share-films.json" && env.WOODHOUSE_SHARE === "true") {
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    return shareShowcaseFilms(env).then((films) =>
      json({ version: 1, films }, 200, { "cache-control": "no-store" }));
  }
  if (path.replace(/\/+$/, "") === "/portfolio" && env.WOODHOUSE_SHARE === "true") {
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const assetId = url.searchParams.get("asset");
    const validId = /^[a-z0-9][a-z0-9-]{0,127}$/;
    if (assetId && !validId.test(assetId)) throw new HttpError(400, "Enter a valid Share asset ID.");
    const target = new URL(assetId ? `${composerShare}/artwork/${assetId}` : composerShare);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (query) target.searchParams.set("art", query);
    for (const name of ["project", "after"]) {
      const value = url.searchParams.get(name);
      if (value && validId.test(value)) target.searchParams.set(name, value);
    }
    return Response.redirect(target, 308);
  }
  return null;
}
