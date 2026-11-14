// MIT. Sessions for an independent studio.
//
// Standalone installations keep the owner passphrase and a long-lived HttpOnly
// session. An installation opened from App Composer accepts a short-lived
// signed handoff carrying the current actor, workspace, selected project and
// action grants. Privileged actions re-check those grants with Composer's
// server endpoint, so a revoked member stops dispatching work even if their
// studio cookie has not expired yet.

import { constantTimeEqual, HttpError, now, text } from "./util.mjs";

const COOKIE = "studio_session";
const OWNER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const BRIDGE_SESSION_MS = 30 * 60 * 1000;
const ACTIONS = ["read", "edit", "generate", "publish", "admin"];
const PRIVILEGED = new Set(["edit", "generate", "publish", "admin"]);

function encode(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
}

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(secret, payload) {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normaliseActions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((action) => ACTIONS.includes(action)))];
}

// Opaque context binding for an explicit local import; it is not a credential.
export async function sessionBinding(env, session) {
  if (!session || !env.SESSION_SECRET) return null;
  const fields = [session.mode, session.actor, session.workspace, session.project, session.actions, session.revision, session.issued, session.expires];
  return sign(env.SESSION_SECRET, `local-import-session:${JSON.stringify(fields)}`);
}

export async function createSession(env, claims = {}) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(500, "Studio session secret is not configured", "not_configured");
  const mode = claims.mode === "bridge" ? "bridge" : "owner";
  const session = {
    actor: typeof claims.actor === "string" ? claims.actor.slice(0, 128) : "owner",
    actorName: typeof claims.actorName === "string" ? claims.actorName.slice(0, 120) : null,
    mode,
    workspace: typeof claims.workspace === "string" ? claims.workspace.slice(0, 64) : null,
    workspaceName: typeof claims.workspaceName === "string" ? claims.workspaceName.slice(0, 80) : null,
    project: typeof claims.project === "string" ? claims.project.slice(0, 64) : null,
    projectClaimExplicit: mode === "bridge" && claims.projectClaimExplicit === true,
    actions: mode === "owner" ? [...ACTIONS] : normaliseActions(claims.actions),
    revision: Number.isSafeInteger(claims.revision) ? claims.revision : 0,
    issued: now(),
    expires: now() + (mode === "bridge" ? BRIDGE_SESSION_MS : OWNER_SESSION_MS),
  };
  const payload = encode(session);
  return `${payload}.${await sign(env.SESSION_SECRET, payload)}`;
}

export async function readSession(env, request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return null;
  if (!env.SESSION_SECRET) return null;
  const expected = await sign(env.SESSION_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const session = decode(payload);
    if (!session || session.expires < now()) return null;
    // Owner sessions minted before the scoped-entry release have no mode. They
    // are still the standalone owner, not an empty bridge grant.
    if (!session.mode && session.actor === "owner") session.mode = "owner";
    session.actions = session.mode === "owner" ? [...ACTIONS] : normaliseActions(session.actions);
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(token, mode = "owner") {
  const maxAge = Math.floor((mode === "bridge" ? BRIDGE_SESSION_MS : OWNER_SESSION_MS) / 1000);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** A short-lived handoff from App Composer's authenticated session. */
export async function readBridgeToken(env, token) {
  if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) return null;
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(env.BRIDGE_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const claim = decode(payload);
    if (!claim || claim.aud !== "media-studio") return null;
    if (typeof claim.sub !== "string" || !claim.sub) return null;
    if (!Object.hasOwn(claim, "project") || !(claim.project === null || (typeof claim.project === "string" && /^[a-z0-9_]{4,64}$/.test(claim.project)))) return null;
    if (typeof claim.exp !== "number") return null;
    // A handoff may express its expiry in seconds or milliseconds. Normalise
    // rather than reject a correct token minted by the other side.
    const expires = claim.exp < 1e12 ? claim.exp * 1000 : claim.exp;
    if (expires < now()) return null;
    const actions = normaliseActions(claim.actions);
    return {
      ...claim,
      exp: expires,
      actor: claim.sub,
      actorName: typeof claim.actorName === "string" ? claim.actorName : claim.actor?.name ?? null,
      workspace: typeof claim.workspace === "string" ? claim.workspace : null,
      workspaceName: typeof claim.workspaceName === "string" ? claim.workspaceName : null,
      project: typeof claim.project === "string" ? claim.project : null,
      actions: actions.length ? actions : ["read"],
      revision: Number.isSafeInteger(claim.revision) ? claim.revision : 0,
    };
  } catch {
    return null;
  }
}

/** Record a handoff's jti before a session is minted. Returns false when the
 * same handoff was already consumed. */
export async function claimHandoff(env, claim) {
  const jti = typeof claim?.jti === "string" ? claim.jti.slice(0, 90) : "";
  if (!jti) return false;
  const timestamp = now();
  try {
    await env.DB.prepare(
      "INSERT INTO bridge_handoffs(jti,expires,created_at) VALUES(?1,?2,?3)",
    )
      .bind(jti, claim.exp, timestamp)
      .run();
  } catch {
    return false;
  }
  await env.DB.prepare("DELETE FROM bridge_handoffs WHERE expires < ?1")
    .bind(timestamp)
    .run()
    .catch(() => {});
  return true;
}

export function allowedActions(session) {
  return session?.mode === "owner" ? [...ACTIONS] : normaliseActions(session?.actions);
}

export function can(session, action) {
  return allowedActions(session).includes(action);
}

/** Re-check the current Composer grant. Called for every privileged studio
 * action, so revoking a grant takes effect at the next dispatch even when the
 * browser still holds a studio session. Standalone owner sessions do not call
 * Composer and remain independent. */
export async function verifyComposerGrant(env, session, action = "read") {
  if (session.mode === "owner") return true;
  const origin = typeof env.COMPOSER_ORIGIN === "string" ? env.COMPOSER_ORIGIN : "";
  const secret = env.BRIDGE_SECRET;
  if (!/^https:\/\//.test(origin) || !secret)
    throw new HttpError(
      503,
      "Composer grant checks are not configured on this studio",
      "not_configured",
    );
  const timestamp = String(now());
  const body = JSON.stringify({
    actor: session.actor,
    workspace: session.workspace,
    project: session.project,
    revision: session.revision,
    actions: session.actions,
    at: timestamp,
  });
  let response;
  try {
    response = await fetch(`${origin.replace(/\/$/, "")}/api/studio/access`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-studio-signature": await sign(secret, `${timestamp}.${body}`),
        "x-studio-timestamp": timestamp,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(
      503,
      "Composer could not confirm this grant. Nothing was dispatched; try again when Composer is reachable.",
      "grant_unreachable",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true)
    throw new HttpError(
      403,
      "This account no longer has the current permission for this studio action. Nothing was dispatched.",
      "forbidden",
    );
  if (payload.actor !== session.actor || payload.workspace !== session.workspace)
    throw new HttpError(
      403,
      "The signed-in account or workspace changed. Reopen the studio from App Composer.",
      "forbidden",
    );
  const current = normaliseActions(payload.actions);
  if (!current.includes("read") || !current.includes(action))
    throw new HttpError(
      403,
      `This studio's current grant no longer includes ${action}. Reopen the studio from App Composer if access is restored.`,
      "forbidden",
    );
  return true;
}

export async function requireSession(env, request, action = "read") {
  const session = await readSession(env, request);
  if (!session)
    throw new HttpError(401, "Sign in to open the studio", "unauthorized");
  if (!can(session, action))
    throw new HttpError(
      403,
      `This studio session does not include the ${action} permission.`,
      "forbidden",
    );
  if (PRIVILEGED.has(action)) await verifyComposerGrant(env, session, action);
  return session;
}

export async function requireOwner(env, request) {
  return requireSession(env, request, "admin");
}

/** Bounded per-IP login attempts. D1 is the shared authority, not the isolate. */
export async function checkLoginRate(env, ip) {
  const timestamp = now();
  const resetAt = timestamp + 15 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO login_attempts(ip,count,reset_at) VALUES(?1,0,?2) ON CONFLICT(ip) DO NOTHING",
  )
    .bind(ip, resetAt)
    .run();
  const row = await env.DB.prepare("SELECT count,reset_at FROM login_attempts WHERE ip=?1")
    .bind(ip)
    .first();
  if (row && row.reset_at < timestamp) {
    await env.DB.prepare("UPDATE login_attempts SET count=0, reset_at=?2 WHERE ip=?1")
      .bind(ip, resetAt)
      .run();
    return { allowed: true };
  }
  if (row && row.count >= 10)
    throw new HttpError(429, "Too many attempts. Try again in a few minutes.", "rate_limited");
  return { allowed: true };
}

export async function recordLoginFailure(env, ip) {
  await env.DB.prepare(
    "UPDATE login_attempts SET count=count+1 WHERE ip=?1",
  )
    .bind(ip)
    .run();
}

export async function verifyPassphrase(env, input) {
  if (!env.OWNER_PASSPHRASE || env.OWNER_PASSPHRASE.length < 16)
    throw new HttpError(500, "Owner passphrase is not configured", "not_configured");
  const supplied = text(input, 200, "Passphrase");
  return constantTimeEqual(supplied, env.OWNER_PASSPHRASE);
}
