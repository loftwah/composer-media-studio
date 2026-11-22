// Narrow, type-only declarations for the session helpers the strict TypeScript
// MCP OAuth lane calls. Runtime behaviour stays in auth.mjs; this file names
// only the claims and helpers that lane reads so it can be checked in strict TS
// without changing session handling.

/** The session claims the OAuth routes read. Legacy owner sessions may omit
 * the revision and explicit project claim; both are treated as absent. */
export interface StudioSession {
  mode: string;
  actor: string;
  workspace: string | null;
  project: string | null;
  projectClaimExplicit?: boolean;
  revision?: number;
  actions: string[];
}

/** One project row, as far as the access check reads it. */
export interface StudioSessionProject {
  id: string;
  workspace_id?: string | null;
}

export function readSession(env: unknown, request: Request): Promise<StudioSession | null>;
export function can(session: StudioSession | null | undefined, action: string): boolean;
export function projectAccessible(
  session: StudioSession | null | undefined,
  project: StudioSessionProject | null,
): boolean;
export function verifyComposerGrant(
  env: unknown,
  session: StudioSession,
  action?: string,
): Promise<boolean>;
