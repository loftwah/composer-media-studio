// MIT. Private, version-pinned review rooms — strict TypeScript core.
//
// This is the one maintained source for saved review rooms: the view/DTO core
// (room status/time, feedback and decision DTOs, owner/private and guest-safe
// views) plus the review-room and feedback storage logic. It imports only the
// tiny, dependency-free util.mjs helpers (typed in util.d.mts), and the
// review-rooms.mjs shim preserves every public name and import path.
//
// Guest-safe views deliberately name only the pinned version, its status and
// comments. Tokens, token hashes, snapshots, R2 keys, project/asset identity,
// prompts/captions and source lineage never enter these shapes. Every
// annotation is erased at runtime, so the emitted statements are byte-for-byte
// the original JavaScript — auth, grants, token hashing, immutability, input
// limits, receipts and prior interfaces are all preserved.

import { constantTimeEqual, HttpError, id, now, safeJson, sha256Hex, text } from "./util.mjs";

/** The three states a saved room can be in, derived from stored time/revocation. */
export type ReviewRoomStatus = "open" | "expired" | "revoked";

/** A review point/region on an image, each coordinate within 0..1. */
export interface ReviewRegion {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** Narrow saved review_rooms row: only the columns these views read. */
export interface ReviewRoomRow {
  id: string;
  project_id: string;
  asset_id: string;
  asset_sha256: string;
  asset_kind: string;
  asset_mime: string;
  asset_title: string;
  asset_bytes: number;
  asset_width: number | null;
  asset_height: number | null;
  asset_duration_ms: number | null;
  version_label: string;
  source_kind: string;
  composition_id: string | null;
  composition_revision: number | null;
  decision: string;
  decided_at: number | null;
  decision_note: string;
  reviewer_name: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

/** Narrow saved review_feedback row: only the columns the DTO reads. */
export interface ReviewFeedbackRow {
  id: string;
  reviewer_name: string;
  body: string;
  at_ms: number | null;
  end_ms: number | null;
  region_json: string | null;
  created_at: number;
  resolved_at: number | null;
}

/** Narrow saved review_decisions row: only the columns the DTO reads. */
export interface ReviewDecisionRow {
  id: string;
  decision: string;
  note: string;
  reviewer_name: string;
  created_at: number;
}

/** Pinned-version metadata safe to show a reviewer. */
export interface ReviewVersionView {
  label: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Feedback as returned to both owners and reviewers. */
export interface ReviewFeedbackView {
  id: string;
  author: string;
  body: string;
  atMs: number | null;
  endMs: number | null;
  region: ReviewRegion | null;
  createdAt: number;
  resolvedAt: number | null;
}

/** A recorded decision as returned to owners. */
export interface ReviewDecisionView {
  id: string;
  decision: string;
  note: string;
  reviewerName: string;
  createdAt: number;
}

/** Owner/private room view: names the asset and hash but never the token. */
export interface OwnerReviewRoomView {
  id: string;
  projectId: string;
  assetId: string;
  assetTitle: string;
  versionLabel: string;
  sha256: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sourceKind: string;
  compositionId: string | null;
  compositionRevision: number | null;
  status: ReviewRoomStatus;
  decision: string;
  decidedAt: number | null;
  decisionNote: string;
  reviewerName: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  feedbackCount: number;
  unresolvedCount: number;
  feedback: ReviewFeedbackView[];
  decisions: ReviewDecisionView[];
}

/** Guest-safe room view: only the pinned version, status and comments. */
export interface PublicReviewRoomView {
  version: ReviewVersionView;
  status: ReviewRoomStatus;
  decision: string;
  decisionNote: string;
  decidedAt: number | null;
  reviewerName: string;
  expiresAt: number;
  canComment: boolean;
  approvalIsFeedbackOnly: boolean;
  feedback: ReviewFeedbackView[];
}

/** Guest-safe comparison side: no feedback, identity or lineage. */
export interface ReviewerCompareSideView {
  version: ReviewVersionView;
  status: ReviewRoomStatus;
  decision: string;
  decisionNote: string;
  decidedAt: number | null;
  reviewPath: string;
  mediaPath: string;
}

// --- narrow, erased structural seams for the saved-room storage logic ------
// The annotated seams below describe only what these storage paths read and
// write. Every annotation is erased at runtime, so the emitted statements are
// the original JavaScript and callers keep passing the same Worker env, D1
// rows and untrusted request bodies they always did.

/** The D1 statement methods the review storage paths actually call. */
interface ReviewStatement {
  bind(...values: unknown[]): ReviewStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number }; changes?: number }>;
}

/** The Worker env this module needs: D1 only. */
export interface ReviewStorageEnv {
  DB: {
    prepare(sql: string): ReviewStatement;
    batch(statements: ReviewStatement[]): Promise<Array<{ meta: { changes: number }; changes?: number }>>;
  };
}

/** Storage is always scoped by the owning project id. */
interface ProjectRef { id: string }

/** Token-loaded room: the capability hash is part of the checked row. */
interface ReviewRoomRecord extends ReviewRoomRow { token_hash: string }

/** Feedback rows carry room_id so a project listing can group them. */
interface FeedbackRecord extends ReviewFeedbackRow { room_id: string }

/** Decision rows carry room_id so a project listing can group them. */
interface DecisionRecord extends ReviewDecisionRow { room_id: string }

/** The exact saved asset a room pins. */
interface ReviewAssetRow {
  id: string;
  deleted_at: number | null;
  sha256: string;
  kind: string;
  mime: string;
}

/** The saved image/film selected when a room is created. */
interface CreateAssetRow {
  id: string;
  kind: string;
  title: string;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}

interface ReceiptRow { snapshot_json: string | null }
interface GenerationRow { composition_id: string | null }
interface CompositionRow { id: string }
interface AttemptRow { count: number; reset_at: number }
interface AttemptCountRow { n: number }

/** A local render snapshot; storyboard revision data is optional. */
interface RenderSnapshot {
  storyboard?: { id?: string; updatedAt?: number };
}

interface PinSourceResult {
  sourceKind: string;
  compositionId: string | null;
  compositionRevision: number | null;
}

/** Untrusted request bodies stay unknown until each field is validated. */
interface CreateReviewRoomInput {
  assetId?: unknown;
  expiresInHours?: unknown;
  versionLabel?: unknown;
}
interface FeedbackInput {
  reviewerName?: unknown;
  body?: unknown;
  atMs?: unknown;
  endMs?: unknown;
  region?: unknown;
}
interface DecisionInput {
  decision?: unknown;
  reviewerName?: unknown;
  note?: unknown;
}
interface ResolutionInput { resolved?: unknown }

/** Only the header read the rate-limit keys need. */
interface RequestWithHeaders {
  headers?: { get(name: string): string | null };
}

interface OpenReviewRoom {
  room: ReviewRoomRecord;
  asset: ReviewAssetRow;
}

export function reviewRoomStatus(row: ReviewRoomRow, at: number = now()): ReviewRoomStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at <= at) return "expired";
  return "open";
}

export function feedbackView(row: ReviewFeedbackRow): ReviewFeedbackView {
  return {
    id: row.id,
    author: row.reviewer_name,
    body: row.body,
    atMs: row.at_ms,
    endMs: row.end_ms,
    region: safeJson<ReviewRegion | null>(row.region_json ?? "", null),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function decisionView(row: ReviewDecisionRow): ReviewDecisionView {
  return {
    id: row.id,
    decision: row.decision,
    note: row.note,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
  };
}

export function ownerReviewRoomView(
  row: ReviewRoomRow,
  { feedback = [], decisions = [] }: { feedback?: ReviewFeedbackRow[]; decisions?: ReviewDecisionRow[] } = {},
): OwnerReviewRoomView {
  const unresolved = feedback.filter((item) => !item.resolved_at).length;
  return {
    id: row.id,
    projectId: row.project_id,
    assetId: row.asset_id,
    assetTitle: row.asset_title,
    versionLabel: row.version_label,
    sha256: row.asset_sha256,
    kind: row.asset_kind,
    mime: row.asset_mime,
    bytes: row.asset_bytes,
    width: row.asset_width,
    height: row.asset_height,
    durationMs: row.asset_duration_ms,
    sourceKind: row.source_kind,
    compositionId: row.composition_id,
    compositionRevision: row.composition_revision,
    status: reviewRoomStatus(row),
    decision: row.decision,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    feedbackCount: feedback.length,
    unresolvedCount: unresolved,
    feedback: feedback.map(feedbackView),
    decisions: decisions.map(decisionView),
  };
}

export function publicReviewRoomView(
  row: ReviewRoomRow,
  feedback: ReviewFeedbackRow[] = [],
): PublicReviewRoomView {
  const status = reviewRoomStatus(row);
  return {
    version: {
      label: row.version_label,
      kind: row.asset_kind,
      mime: row.asset_mime,
      bytes: row.asset_bytes,
      width: row.asset_width,
      height: row.asset_height,
      durationMs: row.asset_duration_ms,
    },
    status,
    decision: row.decision,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    reviewerName: row.reviewer_name,
    expiresAt: row.expires_at,
    canComment: status === "open",
    approvalIsFeedbackOnly: true,
    feedback: feedback.map(feedbackView),
  };
}

export function reviewerCompareSideView(
  room: ReviewRoomRow,
  token: string,
): ReviewerCompareSideView {
  return {
    version: {
      label: room.version_label,
      kind: room.asset_kind,
      mime: room.asset_mime,
      bytes: room.asset_bytes,
      width: room.asset_width,
      height: room.asset_height,
      durationMs: room.asset_duration_ms,
    },
    status: reviewRoomStatus(room),
    decision: room.decision,
    decisionNote: room.decision_note,
    decidedAt: room.decided_at,
    reviewPath: `/r/${encodeURIComponent(token)}`,
    mediaPath: `/r/${encodeURIComponent(token)}/media`,
  };
}

// --- saved review-room and feedback storage --------------------------------

export const REVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const REVIEW_TOKEN_BYTES = 32;
export const REVIEW_DEFAULT_TTL_HOURS = 24 * 7;
export const REVIEW_MAX_TTL_HOURS = 24 * 30;
export const REVIEW_MAX_FEEDBACK = 200;
export const REVIEW_MAX_FEEDBACK_BODY = 2000;
export const REVIEW_MAX_REVIEWER_NAME = 60;
export const REVIEW_ATTEMPT_LIMIT = 30;
export const REVIEW_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const REVIEW_FEEDBACK_LIMIT = 60;
export const REVIEW_FEEDBACK_WINDOW_MS = 60 * 60 * 1000;
export const REVIEW_COMPARE_LIMIT = 20;
export const REVIEW_COMPARE_WINDOW_MS = 10 * 60 * 1000;

/** A 256-bit, URL-safe token. Only its hash is written to D1. */
export function generateReviewToken(): string {
  const bytes = new Uint8Array(REVIEW_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashReviewToken(token: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(token));
}

async function loadRoomFeedback(env: ReviewStorageEnv, room: ReviewRoomRow): Promise<FeedbackRecord[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_feedback WHERE room_id=?1 AND project_id=?2 ORDER BY created_at ASC LIMIT ?3",
  )
    .bind(room.id, room.project_id, REVIEW_MAX_FEEDBACK)
    .all<FeedbackRecord>();
  return rows.results;
}

async function loadRoomDecisions(env: ReviewStorageEnv, room: ReviewRoomRow): Promise<DecisionRecord[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_decisions WHERE room_id=?1 AND project_id=?2 ORDER BY created_at DESC LIMIT 20",
  )
    .bind(room.id, room.project_id)
    .all<DecisionRecord>();
  return rows.results;
}

export async function reviewFeedbackForRoom(env: ReviewStorageEnv, room: ReviewRoomRow): Promise<FeedbackRecord[]> {
  return loadRoomFeedback(env, room);
}

async function loadRoom(env: ReviewStorageEnv, project: ProjectRef, roomId: string): Promise<ReviewRoomRow> {
  const row = await env.DB.prepare("SELECT * FROM review_rooms WHERE id=?1 AND project_id=?2")
    .bind(roomId, project.id)
    .first<ReviewRoomRow>();
  if (!row) throw new HttpError(404, "Review room not found in this project", "review_room_not_found");
  return row;
}

/** Find a room by token hash, then refuse revoked/expired links before any
 * asset metadata or bytes are returned. */
export async function loadReviewRoomByToken(env: ReviewStorageEnv, token: unknown): Promise<ReviewRoomRecord> {
  if (typeof token !== "string" || !REVIEW_TOKEN_PATTERN.test(token))
    throw new HttpError(404, "This review link is not valid. Ask the creator for a current link.", "review_not_found");
  const tokenHash = await hashReviewToken(token);
  const row = await env.DB.prepare("SELECT * FROM review_rooms WHERE token_hash=?1").bind(tokenHash).first<ReviewRoomRecord>();
  if (!row)
    throw new HttpError(404, "This review link is not valid. Ask the creator for a current link.", "review_not_found");
  // A hash lookup is already the capability check; this constant-time compare
  // is a cheap defensive assertion that the row was not corrupted.
  if (!constantTimeEqual(tokenHash, row.token_hash))
    throw new HttpError(404, "This review link is not valid. Ask the creator for a current link.", "review_not_found");
  const status = reviewRoomStatus(row);
  if (status === "revoked")
    throw new HttpError(410, "This review link was revoked by the creator.", "review_revoked");
  if (status === "expired")
    throw new HttpError(410, "This review link expired. Ask the creator for a new link.", "review_expired");
  return row;
}

/** Load the exact saved asset a room pins, failing closed if it was removed or
 * its content hash no longer matches the pinned version. */
export async function openReviewRoom(env: ReviewStorageEnv, token: unknown): Promise<OpenReviewRoom> {
  const room = await loadReviewRoomByToken(env, token);
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2")
    .bind(room.asset_id, room.project_id)
    .first<ReviewAssetRow>();
  if (!asset || asset.deleted_at)
    throw new HttpError(410, "The saved version behind this review link is no longer available.", "review_asset_unavailable");
  if (!constantTimeEqual(asset.sha256, room.asset_sha256))
    throw new HttpError(409, "This review link no longer matches the saved version. Ask the creator for a new link.", "review_version_changed");
  if (asset.kind !== room.asset_kind || asset.mime !== room.asset_mime)
    throw new HttpError(409, "This review link no longer matches the saved version. Ask the creator for a new link.", "review_version_changed");
  return { room, asset };
}

/** Accept a bare 43-character token or a pasted private review link. Only the
 * token is extracted; the link is never fetched, followed or logged. */
export function reviewTokenFromInput(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (REVIEW_TOKEN_PATTERN.test(raw)) return raw;
  const match = raw.match(/^(?:https?:\/\/[^/\s]+)?\/?r\/([A-Za-z0-9_-]{43})(?:\/media)?\/?$/);
  return match ? match[1] : "";
}

function compareUnavailable(): HttpError {
  return new HttpError(
    404,
    "These private review links cannot be compared. Ask the creator for current links.",
    "review_compare_unavailable",
  );
}

/** Compare two private links the reviewer already holds. Both links must be
 * open and name the same project; every rejected case answers with the same
 * generic 404 so the endpoint is not an oracle for other people's links. Only
 * reviewer-safe fields are returned, never either room's feedback. */
export async function compareReviewRoomsForReviewer(
  env: ReviewStorageEnv,
  leftInput: unknown,
  rightInput: unknown,
): Promise<{ left: ReviewerCompareSideView; right: ReviewerCompareSideView }> {
  const leftToken = reviewTokenFromInput(leftInput);
  const rightToken = reviewTokenFromInput(rightInput);
  if (!leftToken || !rightToken) throw compareUnavailable();
  if (leftToken === rightToken)
    throw new HttpError(400, "Choose two different private review links", "review_compare_same");
  let access: OpenReviewRoom[];
  try {
    access = await Promise.all([openReviewRoom(env, leftToken), openReviewRoom(env, rightToken)]);
  } catch (error) {
    if (error instanceof HttpError) throw compareUnavailable();
    throw error;
  }
  const [left, right] = access;
  if (reviewRoomStatus(left.room) !== "open" || reviewRoomStatus(right.room) !== "open") throw compareUnavailable();
  // A reviewer may hold links from different studios. Refusing keeps each
  // project boundary intact and avoids confirming that the two are linked.
  if (left.room.project_id !== right.room.project_id) throw compareUnavailable();
  return {
    left: reviewerCompareSideView(left.room, leftToken),
    right: reviewerCompareSideView(right.room, rightToken),
  };
}

async function pinSource(env: ReviewStorageEnv, project: ProjectRef, asset: CreateAssetRow): Promise<PinSourceResult> {
  // A local render receipt records the storyboard revision that was actually
  // rendered. Prefer it over the current composition row, which may have moved
  // on since the saved asset was produced.
  const receipt = await env.DB.prepare(
    "SELECT snapshot_json FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2",
  )
    .bind(asset.id, project.id)
    .first<ReceiptRow>();
  const snapshot = safeJson<RenderSnapshot>(receipt?.snapshot_json as string, {});
  if (snapshot?.storyboard?.id && Number.isSafeInteger(snapshot.storyboard.updatedAt))
    return { sourceKind: "storyboard_render", compositionId: snapshot.storyboard.id!, compositionRevision: snapshot.storyboard.updatedAt! };
  const generation = await env.DB.prepare(
    "SELECT composition_id FROM generations WHERE project_id=?1 AND output_asset_id=?2 AND composition_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  )
    .bind(project.id, asset.id)
    .first<GenerationRow>();
  if (generation?.composition_id) {
    const composition = await env.DB.prepare("SELECT id FROM compositions WHERE id=?1 AND project_id=?2")
      .bind(generation.composition_id, project.id)
      .first<CompositionRow>();
    if (composition)
      // A paid render records the composition it belongs to, but not the
      // storyboard revision at render time. Do not present the current
      // composition revision as if it were the rendered one.
      return { sourceKind: "storyboard_render", compositionId: composition.id, compositionRevision: null };
  }
  return { sourceKind: "saved_asset", compositionId: null, compositionRevision: null };
}

export async function createReviewRoom(
  env: ReviewStorageEnv,
  project: ProjectRef,
  input: CreateReviewRoomInput | null | undefined,
): Promise<{ room: ReviewRoomRow; token: string }> {
  const assetId = typeof input?.assetId === "string" ? input!.assetId : "";
  if (!/^[a-z0-9_]{1,80}$/i.test(assetId))
    throw new HttpError(400, "Choose a saved image or film from this project", "review_asset_required");
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL")
    .bind(assetId, project.id)
    .first<CreateAssetRow>();
  if (!asset) throw new HttpError(404, "That saved asset is not in this project", "review_asset_not_found");
  if (asset.kind !== "image" && asset.kind !== "video")
    throw new HttpError(400, "Reviews pin a saved image or film, not an audio track", "review_kind_unsupported");

  const expiresInHours = input?.expiresInHours === undefined ? REVIEW_DEFAULT_TTL_HOURS : Number(input!.expiresInHours);
  if (!Number.isSafeInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > REVIEW_MAX_TTL_HOURS)
    throw new HttpError(400, `Expiry must be between 1 and ${REVIEW_MAX_TTL_HOURS} hours`, "review_expiry_invalid");

  const versionLabel = text(
    input?.versionLabel === undefined || input!.versionLabel === "" ? asset.title || "Saved version" : input!.versionLabel,
    80,
    "Version label",
  );
  const source = await pinSource(env, project, asset);
  const token = generateReviewToken();
  const tokenHash = await hashReviewToken(token);
  const roomId = id("rev");
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO review_rooms(
       id,project_id,asset_id,asset_sha256,asset_kind,asset_mime,asset_title,asset_bytes,
       asset_width,asset_height,asset_duration_ms,version_label,source_kind,composition_id,
       composition_revision,token_hash,expires_at,created_at,updated_at
     ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)`,
  )
    .bind(
      roomId,
      project.id,
      asset.id,
      asset.sha256,
      asset.kind,
      asset.mime,
      asset.title,
      asset.bytes,
      asset.width,
      asset.height,
      asset.duration_ms,
      versionLabel,
      source.sourceKind,
      source.compositionId,
      source.compositionRevision,
      tokenHash,
      timestamp + expiresInHours * 60 * 60 * 1000,
      timestamp,
    )
    .run();
  const row = await loadRoom(env, project, roomId);
  return { room: row, token };
}

export async function listReviewRooms(env: ReviewStorageEnv, project: ProjectRef): Promise<OwnerReviewRoomView[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_rooms WHERE project_id=?1 ORDER BY created_at DESC LIMIT 50",
  )
    .bind(project.id)
    .all<ReviewRoomRow>();
  if (!rows.results.length) return [];
  const rooms = rows.results;
  const placeholders = rooms.map((_, index) => `?${index + 2}`).join(",");
  const feedbackRows = await env.DB.prepare(
    `SELECT * FROM review_feedback WHERE project_id=?1 AND room_id IN (${placeholders}) ORDER BY created_at ASC LIMIT 2000`,
  )
    .bind(project.id, ...rooms.map((room) => room.id))
    .all<FeedbackRecord>();
  const decisionRows = await env.DB.prepare(
    `SELECT * FROM review_decisions WHERE project_id=?1 AND room_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`,
  )
    .bind(project.id, ...rooms.map((room) => room.id))
    .all<DecisionRecord>();
  const feedbackByRoom = new Map<string, FeedbackRecord[]>();
  for (const item of feedbackRows.results) {
    const list = feedbackByRoom.get(item.room_id) ?? [];
    list.push(item);
    feedbackByRoom.set(item.room_id, list);
  }
  const decisionsByRoom = new Map<string, DecisionRecord[]>();
  for (const item of decisionRows.results) {
    const list = decisionsByRoom.get(item.room_id) ?? [];
    list.push(item);
    decisionsByRoom.set(item.room_id, list);
  }
  return rooms.map((room) =>
    ownerReviewRoomView(room, {
      feedback: feedbackByRoom.get(room.id) ?? [],
      decisions: decisionsByRoom.get(room.id) ?? [],
    }),
  );
}

export async function revokeReviewRoom(env: ReviewStorageEnv, project: ProjectRef, roomId: string): Promise<OwnerReviewRoomView> {
  const room = await loadRoom(env, project, roomId);
  if (!room.revoked_at) {
    await env.DB.prepare("UPDATE review_rooms SET revoked_at=?2,updated_at=?2 WHERE id=?1 AND project_id=?3 AND revoked_at IS NULL")
      .bind(room.id, now(), project.id)
      .run();
  }
  const updated = await loadRoom(env, project, roomId);
  return ownerReviewRoomView(updated, {
    feedback: await loadRoomFeedback(env, updated),
    decisions: await loadRoomDecisions(env, updated),
  });
}

/** Replace a lost link without revoking the room. The previous token stops
 * working immediately. The new token is returned once and never stored raw. */
export async function rotateReviewRoomToken(env: ReviewStorageEnv, project: ProjectRef, roomId: string): Promise<{ room: OwnerReviewRoomView; token: string }> {
  const room = await loadRoom(env, project, roomId);
  const status = reviewRoomStatus(room);
  if (status === "revoked")
    throw new HttpError(410, "This review link was revoked. Create a new review room instead.", "review_revoked");
  if (status === "expired")
    throw new HttpError(410, "This review link expired. Create a new review room instead.", "review_expired");
  const token = generateReviewToken();
  const tokenHash = await hashReviewToken(token);
  await env.DB.prepare("UPDATE review_rooms SET token_hash=?2,updated_at=?3 WHERE id=?1 AND project_id=?4")
    .bind(room.id, tokenHash, now(), project.id)
    .run();
  const updated = await loadRoom(env, project, roomId);
  return { room: ownerReviewRoomView(updated, {
    feedback: await loadRoomFeedback(env, updated),
    decisions: await loadRoomDecisions(env, updated),
  }), token };
}

function parseRegion(value: unknown): ReviewRegion | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Send a point as an object with x and y", "review_region_invalid");
  const region: ReviewRegion & Record<string, number> = {} as ReviewRegion & Record<string, number>;
  for (const key of ["x", "y", "w", "h"]) {
    if ((value as Record<string, unknown>)[key] === undefined) continue;
    const number = Number((value as Record<string, unknown>)[key]);
    if (!Number.isFinite(number) || number < 0 || number > 1)
      throw new HttpError(400, "A review point must be between 0 and 1", "review_region_invalid");
    region[key] = Math.round(number * 10000) / 10000;
  }
  if (region.x === undefined || region.y === undefined)
    throw new HttpError(400, "A review point needs an x and a y", "review_region_invalid");
  if (region.w === undefined) region.w = 0;
  if (region.h === undefined) region.h = 0;
  return region;
}

function parseTime(value: unknown, label: string, maxMs: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maxMs)
    throw new HttpError(400, `${label} is outside this saved version`, "review_time_invalid");
  return number;
}

export async function addReviewFeedback(env: ReviewStorageEnv, room: ReviewRoomRecord, input: FeedbackInput | null | undefined): Promise<ReviewFeedbackView> {
  if (reviewRoomStatus(room) !== "open")
    throw new HttpError(410, "This review link is no longer open", "review_closed");
  const reviewerName = text(input?.reviewerName, REVIEW_MAX_REVIEWER_NAME, "Your name");
  const bodyText = text(input?.body, REVIEW_MAX_FEEDBACK_BODY, "Comment");
  const duration = Number(room.asset_duration_ms) || 0;
  const maxMs = room.asset_kind === "video" ? (duration > 0 ? duration : 24 * 60 * 60 * 1000) : 0;
  const atMs = parseTime(input?.atMs, "Timecode", maxMs);
  const endMs = parseTime(input?.endMs, "End timecode", maxMs);
  if (room.asset_kind === "video" && atMs === null && endMs !== null)
    throw new HttpError(400, "Send a start time with an end time", "review_time_invalid");
  if (endMs !== null && (atMs === null || endMs < atMs))
    throw new HttpError(400, "The end time must follow the start time", "review_time_invalid");
  if (room.asset_kind === "image" && atMs !== null)
    throw new HttpError(400, "Use a position for image feedback, not a timecode", "review_time_invalid");
  const region = room.asset_kind === "image" ? parseRegion(input?.region) : null;

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_feedback WHERE room_id=?1")
    .bind(room.id)
    .first<AttemptCountRow>();
  if (Number(count?.n ?? 0) >= REVIEW_MAX_FEEDBACK)
    throw new HttpError(429, "This review room has reached its feedback limit. Ask the creator for a fresh room.", "review_feedback_limit");

  const feedbackId = id("rvf");
  const timestamp = now();
  const [insert, update] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO review_feedback(id,room_id,project_id,version_sha256,reviewer_name,body,at_ms,end_ms,region_json,created_at)
       SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10
       WHERE EXISTS(SELECT 1 FROM review_rooms WHERE id=?2 AND project_id=?3 AND revoked_at IS NULL AND expires_at>?10)`,
    ).bind(
      feedbackId,
      room.id,
      room.project_id,
      room.asset_sha256,
      reviewerName,
      bodyText,
      atMs,
      endMs,
      region ? JSON.stringify(region) : null,
      timestamp,
    ),
    env.DB.prepare(
      "UPDATE review_rooms SET reviewer_name=CASE WHEN reviewer_name='' THEN ?2 ELSE reviewer_name END,updated_at=?3 WHERE id=?1 AND project_id=?4 AND revoked_at IS NULL AND expires_at>?3",
    ).bind(room.id, reviewerName, timestamp, room.project_id),
  ]);
  if (!insert.meta.changes || !update.meta.changes)
    throw new HttpError(410, "This review link closed before the comment was saved. Nothing was saved.", "review_closed");
  const row = await env.DB.prepare("SELECT * FROM review_feedback WHERE id=?1 AND room_id=?2 AND project_id=?3")
    .bind(feedbackId, room.id, room.project_id)
    .first<ReviewFeedbackRow>();
  return feedbackView(row!);
}

export async function recordReviewDecision(env: ReviewStorageEnv, room: ReviewRoomRecord, input: DecisionInput | null | undefined): Promise<OwnerReviewRoomView> {
  if (reviewRoomStatus(room) !== "open")
    throw new HttpError(410, "This review link is no longer open", "review_closed");
  const decision = input?.decision === "approved" ? "approved" : input?.decision === "changes_requested" ? "changes_requested" : null;
  if (!decision)
    throw new HttpError(400, "Choose approved or changes_requested", "review_decision_invalid");
  const reviewerName = text(input?.reviewerName, REVIEW_MAX_REVIEWER_NAME, "Your name");
  const note = text(input?.note ?? "", 500, "Decision note", { required: false });
  const decisionId = id("rvd");
  const timestamp = now();
  const [insert, update] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO review_decisions(id,room_id,project_id,decision,note,reviewer_name,created_at)
       SELECT ?1,?2,?3,?4,?5,?6,?7
       WHERE EXISTS(SELECT 1 FROM review_rooms WHERE id=?2 AND project_id=?3 AND revoked_at IS NULL AND expires_at>?7)`,
    ).bind(decisionId, room.id, room.project_id, decision, note, reviewerName, timestamp),
    env.DB.prepare(
      "UPDATE review_rooms SET decision=?2,decided_at=?3,decision_note=?4,reviewer_name=?5,updated_at=?3 WHERE id=?1 AND project_id=?6 AND revoked_at IS NULL AND expires_at>?3",
    ).bind(room.id, decision, timestamp, note, reviewerName, room.project_id),
  ]);
  if (!insert.meta.changes || !update.meta.changes)
    throw new HttpError(410, "This review link closed before the decision was recorded. Nothing was saved.", "review_closed");
  const updated = await env.DB.prepare("SELECT * FROM review_rooms WHERE id=?1 AND project_id=?2")
    .bind(room.id, room.project_id)
    .first<ReviewRoomRow>();
  return ownerReviewRoomView(updated!, {
    feedback: await loadRoomFeedback(env, updated!),
    decisions: await loadRoomDecisions(env, updated!),
  });
}

export async function setFeedbackResolved(env: ReviewStorageEnv, project: ProjectRef, roomId: string, feedbackId: string, input: ResolutionInput | null | undefined): Promise<ReviewFeedbackView> {
  if (typeof input?.resolved !== "boolean")
    throw new HttpError(400, "Send resolved as a boolean", "review_resolution_invalid");
  const row = await env.DB.prepare("SELECT * FROM review_feedback WHERE id=?1 AND room_id=?2 AND project_id=?3")
    .bind(feedbackId, roomId, project.id)
    .first<ReviewFeedbackRow>();
  if (!row) throw new HttpError(404, "Feedback not found in this review room", "review_feedback_not_found");
  const timestamp = now();
  await env.DB.prepare("UPDATE review_feedback SET resolved_at=?2,resolved_by=?3 WHERE id=?1 AND room_id=?4 AND project_id=?5")
    .bind(feedbackId, input!.resolved ? timestamp : null, input!.resolved ? "studio-owner" : null, roomId, project.id)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM review_feedback WHERE id=?1 AND room_id=?2 AND project_id=?3")
    .bind(feedbackId, roomId, project.id)
    .first<ReviewFeedbackRow>();
  return feedbackView(updated!);
}

export async function compareReviewRooms(env: ReviewStorageEnv, project: ProjectRef, leftId: string, rightId: string): Promise<{ left: OwnerReviewRoomView; right: OwnerReviewRoomView }> {
  if (leftId === rightId)
    throw new HttpError(400, "Choose two different saved versions", "review_compare_same");
  const left = await loadRoom(env, project, leftId);
  const right = await loadRoom(env, project, rightId);
  return {
    left: ownerReviewRoomView(left, { feedback: await loadRoomFeedback(env, left) }),
    right: ownerReviewRoomView(right, { feedback: await loadRoomFeedback(env, right) }),
  };
}

function clientKey(request: RequestWithHeaders | null | undefined): string {
  return request?.headers?.get("cf-connecting-ip") || "local";
}

export async function assertReviewAttemptAllowed(env: ReviewStorageEnv, request: RequestWithHeaders | null | undefined): Promise<void> {
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1")
    .bind(`token:${clientKey(request)}`)
    .first<AttemptRow>();
  if (row && row.reset_at > timestamp && Number(row.count) >= REVIEW_ATTEMPT_LIMIT)
    throw new HttpError(429, "Too many review link attempts. Wait a few minutes and try again.", "review_rate_limited");
}

export async function recordReviewFailure(env: ReviewStorageEnv, request: RequestWithHeaders | null | undefined): Promise<void> {
  const key = `token:${clientKey(request)}`;
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1").bind(key).first<AttemptRow>();
  if (!row) {
    await env.DB.prepare("INSERT INTO review_attempts(key,count,reset_at) VALUES(?1,1,?2)")
      .bind(key, timestamp + REVIEW_ATTEMPT_WINDOW_MS)
      .run();
    return;
  }
  if (row.reset_at <= timestamp) {
    await env.DB.prepare("UPDATE review_attempts SET count=1,reset_at=?2 WHERE key=?1")
      .bind(key, timestamp + REVIEW_ATTEMPT_WINDOW_MS)
      .run();
    return;
  }
  await env.DB.prepare("UPDATE review_attempts SET count=count+1 WHERE key=?1").bind(key).run();
}

export async function assertFeedbackAttemptAllowed(env: ReviewStorageEnv, room: ReviewRoomRecord, request: RequestWithHeaders | null | undefined): Promise<void> {
  const key = `feedback:${room.token_hash.slice(0, 16)}:${clientKey(request)}`;
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1").bind(key).first<AttemptRow>();
  if (row && row.reset_at > timestamp && Number(row.count) >= REVIEW_FEEDBACK_LIMIT)
    throw new HttpError(429, "Too much feedback from this connection. Try again later.", "review_rate_limited");
  if (!row) {
    await env.DB.prepare("INSERT INTO review_attempts(key,count,reset_at) VALUES(?1,1,?2)")
      .bind(key, timestamp + REVIEW_FEEDBACK_WINDOW_MS)
      .run();
  } else if (row.reset_at <= timestamp) {
    await env.DB.prepare("UPDATE review_attempts SET count=1,reset_at=?2 WHERE key=?1")
      .bind(key, timestamp + REVIEW_FEEDBACK_WINDOW_MS)
      .run();
  } else {
    await env.DB.prepare("UPDATE review_attempts SET count=count+1 WHERE key=?1").bind(key).run();
  }
}

/** Count every comparison attempt per connection, whether it succeeds or not,
 * so a reviewer can compare a handful of versions and nobody can brute-force
 * other tokens through this endpoint. The key never contains a token. */
export async function assertCompareAttemptAllowed(env: ReviewStorageEnv, request: RequestWithHeaders | null | undefined): Promise<void> {
  const key = `compare:${clientKey(request)}`;
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1").bind(key).first<AttemptRow>();
  if (row && row.reset_at > timestamp && Number(row.count) >= REVIEW_COMPARE_LIMIT)
    throw new HttpError(429, "Too many version comparisons. Wait a few minutes and try again.", "review_rate_limited");
  if (!row) {
    await env.DB.prepare("INSERT INTO review_attempts(key,count,reset_at) VALUES(?1,1,?2)")
      .bind(key, timestamp + REVIEW_COMPARE_WINDOW_MS)
      .run();
  } else if (row.reset_at <= timestamp) {
    await env.DB.prepare("UPDATE review_attempts SET count=1,reset_at=?2 WHERE key=?1")
      .bind(key, timestamp + REVIEW_COMPARE_WINDOW_MS)
      .run();
  } else {
    await env.DB.prepare("UPDATE review_attempts SET count=count+1 WHERE key=?1").bind(key).run();
  }
}

export async function pruneReviewAttempts(env: ReviewStorageEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM review_attempts WHERE reset_at < ?1")
    .bind(now() - 60 * 60 * 1000)
    .run();
}
