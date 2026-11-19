// MIT. Short-lived, signed links the render provider can read for one job.
//
// The studio's media endpoints require the owner session, so a provider cannot
// fetch them. Rather than making a project public, the server signs one asset
// for one project with an expiry. The link grants read access to that asset's
// bytes until it expires and nothing else.

import { constantTimeEqual, HttpError, now } from "./util.mjs";

export const RENDER_LINK_TTL_MS = 30 * 60 * 1000;

/** The Worker env seam this module reads: the signing secret and the two
 * configured origins. Every field is optional because the module itself
 * refuses an unconfigured studio instead of assuming one. */
interface RenderLinkEnv {
  SESSION_SECRET?: string;
  RENDER_ORIGIN?: string;
  PUBLIC_ORIGIN?: string;
}

/** The one asset in one project a link is signed for. */
interface RenderLinkSubject {
  assetId: string;
  projectId: string;
}

/** The proof as it arrives from the `/render-input/:assetId` query: apart
 * from the asset id, every field may be missing, null or malformed, and
 * verification rejects all of those. */
interface RenderLinkProof {
  assetId: string;
  projectId?: string | null;
  expires?: string | null;
  signature?: string | null;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`render-link:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function originFor(env: RenderLinkEnv): string {
  // RENDER_ORIGIN is for provider fetches only. The custom domain can sit
  // behind edge bot/access rules that a server-side fetcher cannot satisfy;
  // the workers.dev hostname reaches the same Worker and the same signature
  // check without weakening the public address.
  const configured = String(env.RENDER_ORIGIN ?? "").trim();
  const origin = String(configured || env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (!origin.startsWith("https://"))
    throw new HttpError(503, "This studio does not know its public address", "not_configured");
  return origin;
}

export async function signRenderLink(env: RenderLinkEnv, { assetId, projectId }: RenderLinkSubject): Promise<string> {
  if (!env.SESSION_SECRET) throw new HttpError(503, "Studio session secret is not configured", "not_configured");
  const expires = now() + RENDER_LINK_TTL_MS;
  const payload = `${assetId}.${projectId}.${expires}`;
  const signature = await hmac(env.SESSION_SECRET, payload);
  const url = new URL(`/render-input/${assetId}`, originFor(env));
  url.searchParams.set("p", projectId);
  url.searchParams.set("e", String(expires));
  url.searchParams.set("s", signature);
  return url.href;
}

export async function verifyRenderLink(
  env: RenderLinkEnv,
  { assetId, projectId, expires, signature }: RenderLinkProof,
): Promise<boolean> {
  if (!env.SESSION_SECRET) return false;
  const expiry = Number(expires);
  if (!Number.isFinite(expiry) || expiry < now()) return false;
  if (!/^[a-z0-9_]{4,80}$/i.test(projectId ?? "")) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = await hmac(env.SESSION_SECRET, `${assetId}.${projectId}.${expiry}`);
  return constantTimeEqual(signature, expected);
}
