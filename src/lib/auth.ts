// MIT. Sessions for an independent studio.
//
// Standalone installations keep the owner passphrase and a long-lived HttpOnly
// session. An installation opened from App Composer accepts a short-lived
// signed handoff carrying the current actor, workspace, selected project and
// action grants. Privileged actions re-check those grants with Composer's
// server endpoint, so a revoked member stops dispatching work even if their
// studio cookie has not expired yet.
//
// This is the strict TypeScript source: auth.mjs re-exports these same names
// so the Worker, MCP server, scripts and tests keep their original import
// path. Every annotation is erased at runtime, so cookie bytes, session
// lifetimes, issuer and identity claims, grant caches and failure behaviour
// stay exactly as they were.

import { constantTimeEqual, HttpError, now, text } from "./util.mjs";

const COOKIE = "studio_session";
const OWNER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const BRIDGE_SESSION_MS = 30 * 60 * 1000;
const ACTIONS: readonly string[] = ["read", "edit", "generate", "publish", "admin"];
const PRIVILEGED = new Set(["edit", "generate", "publish", "admin"]);

/** How long a private read may reuse one Composer grant check. A revoked
 * member loses private reads within this window, not at cookie expiry. */
export const GRANT_CACHE_MS = 60 * 1000;

/** The Worker env seam this module reads: the session, handoff and owner
 * secrets and the D1 binding. Optional values are optional because the
 * routes themselves refuse an unconfigured studio; DB is described by only
 * the members this module touches. */
interface StudioAuthEnv {
  SESSION_SECRET?: string;
  BRIDGE_SECRET?: string;
  COMPOSER_ORIGIN?: string;
  OWNER_PASSPHRASE?: string;
  DB: { prepare(query: string): AuthStatement };
}

/** The D1 statement seam this module uses: bound writes and single-row reads. */
interface AuthStatement {
  bind(...values: unknown[]): AuthStatement;
  first<Row = unknown>(): Promise<Row | null>;
  run(): Promise<unknown>;
}

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): unknown {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normaliseActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: unknown[] = value;
  return [...new Set(items.filter((action): action is string => typeof action === "string" && ACTIONS.includes(action)))];
}

/** Number.isSafeInteger as a narrowing guard; the check itself is unchanged. */
function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

/** The session fields the import binding signs; every claim is read exactly as
 * it arrives, unvalidated, and only committed to the signature. */
interface ImportBindingSession {
  mode?: unknown;
  actor?: unknown;
  workspace?: unknown;
  project?: unknown;
  actions?: unknown;
  revision?: unknown;
  issued?: unknown;
  expires?: unknown;
}

/** The session fields the project resume binding signs. */
interface ResumeBindingSession {
  mode?: unknown;
  actor?: unknown;
  workspace?: unknown;
  project?: unknown;
}

// Opaque context binding for an explicit local import; it is not a credential.
export async function sessionBinding(
  env: StudioAuthEnv,
  session: ImportBindingSession | null | undefined,
): Promise<string | null> {
  if (!session || !env.SESSION_SECRET) return null;
  const fields = [session.mode, session.actor, session.workspace, session.project, session.actions, session.revision, session.issued, session.expires];
  return sign(env.SESSION_SECRET, `local-import-session:${JSON.stringify(fields)}`);
}

// Stable across sign-in handoffs for one actor and access scope.
export async function projectResumeBinding(
  env: StudioAuthEnv,
  session: ResumeBindingSession | null | undefined,
): Promise<string | null> {
  if (!session || !env.SESSION_SECRET) return null;
  return sign(env.SESSION_SECRET, `project-resume:${JSON.stringify([session.mode, session.actor, session.workspace, session.project])}`);
}

/** Unvalidated caller claims createSession reads; only these fields matter. */
export interface SessionClaims {
  mode?: unknown;
  actor?: unknown;
  actorName?: unknown;
  workspace?: unknown;
  workspaceName?: unknown;
  project?: unknown;
  projectClaimExplicit?: unknown;
  actions?: unknown;
  revision?: unknown;
}

export async function createSession(env: StudioAuthEnv, claims: SessionClaims = {}): Promise<string> {
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
    revision: safeInteger(claims.revision) ? claims.revision : 0,
    issued: now(),
    expires: now() + (mode === "bridge" ? BRIDGE_SESSION_MS : OWNER_SESSION_MS),
  };
  const payload = encode(session);
  return `${payload}.${await sign(env.SESSION_SECRET, payload)}`;
}

/** The studio session read back from a signed cookie: the claims every
 * createSession writes, with the optionality legacy sessions are read with.
 * Legacy owner sessions may omit the revision and the explicit project claim;
 * both are treated as absent. */
export interface StudioSession {
  mode: string;
  actor: string;
  actorName?: string | null;
  workspace: string | null;
  workspaceName?: string | null;
  project: string | null;
  projectClaimExplicit?: boolean;
  actions: string[];
  revision?: number;
  issued?: number;
  expires?: number;
}

export async function readSession(env: StudioAuthEnv, request: Request): Promise<StudioSession | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return null;
  if (!env.SESSION_SECRET) return null;
  const expected = await sign(env.SESSION_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    // The signature above proved this payload was minted with the studio
    // secret, so it carries the claims createSession (or an earlier release
    // of it) wrote; the guards below still read them loosely.
    const session = decode(payload) as StudioSession;
    // Falsy and primitive payloads cannot carry claims; the strict-mode
    // original reached the same null through its own property reads.
    if (!session || typeof session !== "object") return null;
    // Legacy tolerance: a claim minted before the scoped-entry release may
    // read undefined here, and undefined < now() is false, so the session
    // survives exactly as before. The cast only names that comparison.
    if ((session.expires as number) < now()) return null;
    // Owner sessions minted before the scoped-entry release have no mode. They
    // are still the standalone owner, not an empty bridge grant.
    if (!session.mode && session.actor === "owner") session.mode = "owner";
    session.actions = session.mode === "owner" ? [...ACTIONS] : normaliseActions(session.actions);
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, mode: "owner" | "bridge" = "owner"): string {
  const maxAge = Math.floor((mode === "bridge" ? BRIDGE_SESSION_MS : OWNER_SESSION_MS) / 1000);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** A validated Composer handoff. Claims this module does not read (jti, aud,
 * sub, ...) pass through unchanged for the caller. */
export interface BridgeClaim {
  [key: string]: unknown;
  exp: number;
  actor: string;
  /** Composer may attach a non-string display name on the nested actor;
   * createSession re-validates it, so it passes through exactly as read. */
  actorName: unknown;
  workspace: string | null;
  workspaceName: string | null;
  project: string | null;
  actions: string[];
  revision: number;
}

/** A short-lived handoff from App Composer's authenticated session. */
export async function readBridgeToken(env: StudioAuthEnv, token: unknown): Promise<BridgeClaim | null> {
  if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) return null;
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(env.BRIDGE_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    // Decoded handoff JSON: every claim below is read defensively, so the
    // view only names the field reads, it does not validate them.
    const claim = decode(payload) as Record<string, unknown>;
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
      // The nested actor display name keeps the loose optional chain the
      // original used; the cast only names it for the type checker.
      actorName: typeof claim.actorName === "string" ? claim.actorName : (claim.actor as { name?: unknown } | null | undefined)?.name ?? null,
      workspace: typeof claim.workspace === "string" ? claim.workspace : null,
      workspaceName: typeof claim.workspaceName === "string" ? claim.workspaceName : null,
      project: typeof claim.project === "string" ? claim.project : null,
      actions: actions.length ? actions : ["read"],
      revision: safeInteger(claim.revision) ? claim.revision : 0,
    };
  } catch {
    return null;
  }
}

/** Record a handoff's jti before a session is minted. Returns false when the
 * same handoff was already consumed. */
export async function claimHandoff(env: StudioAuthEnv, claim: BridgeClaim | null): Promise<boolean> {
  const jti = typeof claim?.jti === "string" ? claim.jti.slice(0, 90) : "";
  if (!jti) return false;
  const timestamp = now();
  try {
    await env.DB.prepare(
      "INSERT INTO bridge_handoffs(jti,expires,created_at) VALUES(?1,?2,?3)",
    )
      .bind(jti, claim?.exp, timestamp)
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

/** The session fields the action checks read; unvalidated. */
interface ActionsSubject {
  mode?: unknown;
  actions?: unknown;
}

export function allowedActions(session: ActionsSubject | null | undefined): string[] {
  return session?.mode === "owner" ? [...ACTIONS] : normaliseActions(session?.actions);
}

export function can(session: ActionsSubject | null | undefined, action: string): boolean {
  return allowedActions(session).includes(action);
}

/** The session fields the project access check reads; unvalidated. */
interface ProjectAccessSession {
  mode?: unknown;
  installationOwner?: unknown;
  workspace?: unknown;
  project?: unknown;
}

/** One project row, as far as the access check reads it. */
export interface StudioSessionProject {
  id: string;
  workspace_id?: string | null;
}

/** A project belongs to the workspace that created it.
 *
 * Projects created before workspace binding keep a NULL workspace, so they stay
 * installation-wide until an owner reviews and assigns them. A project claim in
 * the session can only narrow that access, never widen it. An MCP token issued
 * from a standalone owner session keeps that installation ownership. */
export function projectAccessible(
  session: ProjectAccessSession | null | undefined,
  project: StudioSessionProject | null,
): boolean {
  if (!project) return false;
  if (session?.mode === "owner" || session?.installationOwner === true) return true;
  if (!session?.workspace) return false;
  if (project.workspace_id && project.workspace_id !== session.workspace) return false;
  if (session.project && session.project !== project.id) return false;
  return true;
}

/** The 403 copy for a project this session may not open. An agent connection is
 * granted exactly one project, so send the agent to that project instead of
 * telling the owner to reopen Studio from a different workspace. */
export function projectAccessDeniedMessage(
  session: ProjectAccessSession | null | undefined,
  projectId: string,
): string {
  if (session?.mode === "agent" && session.project)
    return `This agent connection is granted to ${session.project} only. Ask for that project, or have the owner grant this connection ${projectId}. Nothing was changed.`;
  return "This project belongs to another workspace or to a different studio link. Reopen Media Studio from the workspace that owns it.";
}

/** The D1 grant-cache row as this module wrote it. */
interface GrantCacheRow {
  actions: string;
  expires_at: number;
}

/** The session claims the Composer grant check signs back to Composer. */
interface GrantSubject {
  mode?: unknown;
  actor: string;
  workspace: string | null;
  project: string | null;
  actions: string[];
  revision?: number;
}

async function grantCacheKey(env: StudioAuthEnv, session: GrantSubject): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  return sign(
    env.SESSION_SECRET,
    `studio-grant:${session.actor}|${session.workspace}|${session.revision}`,
  );
}

async function readCachedGrant(env: StudioAuthEnv, session: GrantSubject): Promise<string[] | null> {
  if (!env.DB) return null;
  const key = await grantCacheKey(env, session);
  if (!key) return null;
  const row = await env.DB.prepare(
    "SELECT actions,expires_at FROM grant_checks WHERE key=?1",
  )
    .bind(key)
    .first<GrantCacheRow>()
    .catch(() => null);
  if (!row || row.expires_at <= now()) return null;
  try {
    const actions: unknown = JSON.parse(row.actions);
    return normaliseActions(actions);
  } catch {
    return null;
  }
}

async function writeCachedGrant(env: StudioAuthEnv, session: GrantSubject, actions: string[]): Promise<void> {
  if (!env.DB) return;
  const key = await grantCacheKey(env, session);
  if (!key) return;
  const timestamp = now();
  await env.DB.prepare(
    "INSERT INTO grant_checks(key,actions,checked_at,expires_at) VALUES(?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET actions=?2,checked_at=?3,expires_at=?4",
  )
    .bind(key, JSON.stringify(actions), timestamp, timestamp + GRANT_CACHE_MS)
    .run()
    .catch(() => {});
}

/** Ask Composer for the current grant of this exact actor and workspace. */
async function composerGrant(env: StudioAuthEnv, session: GrantSubject): Promise<string[]> {
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
  let response: Response;
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
  // The Composer reply is untrusted JSON; every field below is read
  // defensively, so the view only names the reads, it does not validate them.
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
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
  return normaliseActions(payload.actions);
}

/** Re-check the current Composer grant. Called for every privileged studio
 * action, so revoking a grant takes effect at the next dispatch even when the
 * browser still holds a studio session. Standalone owner sessions do not call
 * Composer and remain independent. */
export async function verifyComposerGrant(
  env: StudioAuthEnv,
  session: GrantSubject,
  action = "read",
): Promise<boolean> {
  if (session.mode === "owner") return true;
  const current = await composerGrant(env, session);
  if (!current.includes("read") || !current.includes(action))
    throw new HttpError(
      403,
      `This studio's current grant no longer includes ${action}. Reopen the studio from App Composer if access is restored.`,
      "forbidden",
    );
  return true;
}

/** Re-check a current grant for a private read.
 *
 * Reads share one bounded check so a video can range through its bytes without
 * a Composer round trip per request. A cached grant still has to include the
 * action, so a revoked member is refused as soon as the check expires. */
export async function verifyComposerRead(
  env: StudioAuthEnv,
  session: GrantSubject,
  action = "read",
): Promise<boolean> {
  if (session.mode === "owner") return true;
  let current = await readCachedGrant(env, session);
  if (!current) {
    current = await composerGrant(env, session);
    await writeCachedGrant(env, session, current);
  }
  if (!current.includes("read") || !current.includes(action))
    throw new HttpError(
      403,
      `This studio's current grant no longer includes ${action}. Reopen the studio from App Composer if access is restored.`,
      "forbidden",
    );
  return true;
}

export async function requireSession(
  env: StudioAuthEnv,
  request: Request,
  action = "read",
): Promise<StudioSession> {
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
  else await verifyComposerRead(env, session, action);
  return session;
}

export async function requireOwner(env: StudioAuthEnv, request: Request): Promise<StudioSession> {
  return requireSession(env, request, "admin");
}

/** A login-attempt counter row as this module wrote it. */
interface LoginAttemptRow {
  count: number;
  reset_at: number;
}

/** Bounded per-IP login attempts. D1 is the shared authority, not the isolate. */
export async function checkLoginRate(env: StudioAuthEnv, ip: string): Promise<{ allowed: true }> {
  const timestamp = now();
  const resetAt = timestamp + 15 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO login_attempts(ip,count,reset_at) VALUES(?1,0,?2) ON CONFLICT(ip) DO NOTHING",
  )
    .bind(ip, resetAt)
    .run();
  const row = await env.DB.prepare("SELECT count,reset_at FROM login_attempts WHERE ip=?1")
    .bind(ip)
    .first<LoginAttemptRow>();
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

export async function recordLoginFailure(env: StudioAuthEnv, ip: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE login_attempts SET count=count+1 WHERE ip=?1",
  )
    .bind(ip)
    .run();
}

export async function verifyPassphrase(env: StudioAuthEnv, input: unknown): Promise<boolean> {
  if (!env.OWNER_PASSPHRASE || env.OWNER_PASSPHRASE.length < 16)
    throw new HttpError(500, "Owner passphrase is not configured", "not_configured");
  const supplied = text(input, 200, "Passphrase");
  return constantTimeEqual(supplied, env.OWNER_PASSPHRASE);
}
