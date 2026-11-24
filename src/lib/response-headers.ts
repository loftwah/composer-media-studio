// MIT. Worker response header assembly and the regular route's path-based
// choices. Request admission, the OAuth internal callback, route execution,
// error classification and permissions stay in the Worker.
import { COMPOSER_ARTWORK_DOWNLOAD_API } from "../frontend/composer-artwork.ts";
import { shareOrigin } from "./woodhouse-share.ts";

interface SecurityHeaderOptions {
  noReferrer?: boolean;
  composerArtwork?: boolean;
}

/** Narrow view of the Worker env: only the Woodhouse opt-in is read here. */
interface ResponseHeaderEnv {
  WOODHOUSE_SHARE?: string;
}

export function securityHeaders(
  response: Response,
  woodhouse = false,
  { noReferrer = false, composerArtwork = false }: SecurityHeaderOptions = {},
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", noReferrer ? "no-referrer" : "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    `default-src 'self'; img-src 'self' data: blob:${woodhouse ? " " + shareOrigin : ""}; media-src 'self' blob:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self'${composerArtwork ? " " + COMPOSER_ARTWORK_DOWNLOAD_API : ""}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  return new Response(response.body, { status: response.status, headers });
}

/** Apply the regular response path's review, Woodhouse and artwork choices. */
export function studioResponseHeaders(response: Response, pathname: string, env: ResponseHeaderEnv): Response {
  const reviewPath = /^\/r\/[A-Za-z0-9_-]{1,128}(?:\/(?:media|compare))?\/?$/.test(pathname) || pathname.startsWith("/api/review/");
  const pagePath = pathname.replace(/\/+$/, "") || "/";
  const studioShell = (pagePath === "/" || pagePath === "/studio") &&
    response.headers.get("cache-control") === "private, no-store";
  const shareImages = env.WOODHOUSE_SHARE === "true" && studioShell;
  return securityHeaders(response, shareImages, {
    noReferrer: reviewPath,
    composerArtwork: pagePath === "/tools/images",
  });
}
