// MIT. Public build/status JSON responses: /healthz, /build.json and
// /capabilities.json. Moved out of handlePublic for #198 so their response
// assembly is checked under strict TypeScript. Only erased annotations are
// added: the status, headers, cache, bound bridge flag, capability manifest
// read and JSON bytes are unchanged, as is this group's place in the route
// order. Every other path returns null and stays in the Worker.

import { readCapabilityManifest, type CapabilityBucket } from "./capabilities.ts";
import { json } from "./util.ts";

/** The only env members this group reads. Callers pass the real Worker env. */
interface DiagnosticsEnv {
  BRIDGE_SECRET?: string;
  MEDIA: CapabilityBucket;
}

/** The Worker's build constants, supplied unchanged by the caller. */
interface BuildInfo {
  revision: string;
  builtAt: string;
}

/**
 * Resolve one public diagnostic route, or null to let the router continue.
 * No method check is added: these routes answered every method before the
 * extraction and still do.
 */
export function publicDiagnosticsResponse(
  path: string,
  env: DiagnosticsEnv,
  build: BuildInfo,
): Response | Promise<Response> | null {
  if (path === "/healthz") {
    return json({
      ok: true,
      revision: build.revision,
      bridge: Boolean(env.BRIDGE_SECRET),
      builtAt: build.builtAt,
      time: new Date().toISOString(),
    });
  }
  if (path === "/build.json") return json({ revision: build.revision, builtAt: build.builtAt });
  if (path === "/capabilities.json") {
    return readCapabilityManifest(env).then(manifest =>
      json(manifest, 200, { "cache-control": "public, max-age=300, s-maxage=3600" }));
  }
  return null;
}
