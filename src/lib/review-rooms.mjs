// MIT. Private, version-pinned review rooms.
//
// A room is a narrow capability: one saved asset, one pinned SHA-256, one
// expiring token. The token is only ever stored as a SHA-256 hash, and every
// read re-checks both the room and the asset it names. Review feedback is
// untrusted text and is never imported as instructions.

import { constantTimeEqual, HttpError, id, now, safeJson, sha256Hex, text } from "./util.mjs";

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

/** A 256-bit, URL-safe token. Only its hash is written to D1. */
export function generateReviewToken() {
  const bytes = new Uint8Array(REVIEW_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashReviewToken(token) {
  return sha256Hex(new TextEncoder().encode(token));
}

export function reviewRoomStatus(row, at = now()) {
  if (row.revoked_at) return "revoked";
  if (row.expires_at <= at) return "expired";
  return "open";
}

function feedbackView(row) {
  return {
    id: row.id,
    author: row.reviewer_name,
    body: row.body,
    atMs: row.at_ms,
    endMs: row.end_ms,
    region: safeJson(row.region_json, null),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function decisionView(row) {
  return {
    id: row.id,
    decision: row.decision,
    note: row.note,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
  };
}

/** Owner-facing room shape. It names the asset and hash but never the token. */
export function ownerReviewRoomView(row, { feedback = [], decisions = [] } = {}) {
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

/** Reviewer-facing shape: only the pinned version, its status and comments.
 * It deliberately omits project and asset IDs, prompts, captions, source
 * lineage and anything else from the wider Studio. */
export function publicReviewRoomView(row, feedback = []) {
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

async function loadRoomFeedback(env, room) {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_feedback WHERE room_id=?1 AND project_id=?2 ORDER BY created_at ASC LIMIT ?3",
  )
    .bind(room.id, room.project_id, REVIEW_MAX_FEEDBACK)
    .all();
  return rows.results;
}

async function loadRoomDecisions(env, room) {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_decisions WHERE room_id=?1 AND project_id=?2 ORDER BY created_at DESC LIMIT 20",
  )
    .bind(room.id, room.project_id)
    .all();
  return rows.results;
}

export async function reviewFeedbackForRoom(env, room) {
  return loadRoomFeedback(env, room);
}

async function loadRoom(env, project, roomId) {
  const row = await env.DB.prepare("SELECT * FROM review_rooms WHERE id=?1 AND project_id=?2")
    .bind(roomId, project.id)
    .first();
  if (!row) throw new HttpError(404, "Review room not found in this project", "review_room_not_found");
  return row;
}

/** Find a room by token hash, then refuse revoked/expired links before any
 * asset metadata or bytes are returned. */
export async function loadReviewRoomByToken(env, token) {
  if (typeof token !== "string" || !REVIEW_TOKEN_PATTERN.test(token))
    throw new HttpError(404, "This review link is not valid. Ask the creator for a current link.", "review_not_found");
  const tokenHash = await hashReviewToken(token);
  const row = await env.DB.prepare("SELECT * FROM review_rooms WHERE token_hash=?1").bind(tokenHash).first();
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
export async function openReviewRoom(env, token) {
  const room = await loadReviewRoomByToken(env, token);
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2")
    .bind(room.asset_id, room.project_id)
    .first();
  if (!asset || asset.deleted_at)
    throw new HttpError(410, "The saved version behind this review link is no longer available.", "review_asset_unavailable");
  if (!constantTimeEqual(asset.sha256, room.asset_sha256))
    throw new HttpError(409, "This review link no longer matches the saved version. Ask the creator for a new link.", "review_version_changed");
  if (asset.kind !== room.asset_kind || asset.mime !== room.asset_mime)
    throw new HttpError(409, "This review link no longer matches the saved version. Ask the creator for a new link.", "review_version_changed");
  return { room, asset };
}

async function pinSource(env, project, asset) {
  // A local render receipt records the storyboard revision that was actually
  // rendered. Prefer it over the current composition row, which may have moved
  // on since the saved asset was produced.
  const receipt = await env.DB.prepare(
    "SELECT snapshot_json FROM local_render_receipts WHERE output_asset_id=?1 AND project_id=?2",
  )
    .bind(asset.id, project.id)
    .first();
  const snapshot = safeJson(receipt?.snapshot_json, {});
  if (snapshot?.storyboard?.id && Number.isSafeInteger(snapshot.storyboard.updatedAt))
    return { sourceKind: "storyboard_render", compositionId: snapshot.storyboard.id, compositionRevision: snapshot.storyboard.updatedAt };
  const generation = await env.DB.prepare(
    "SELECT composition_id FROM generations WHERE project_id=?1 AND output_asset_id=?2 AND composition_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  )
    .bind(project.id, asset.id)
    .first();
  if (generation?.composition_id) {
    const composition = await env.DB.prepare("SELECT id FROM compositions WHERE id=?1 AND project_id=?2")
      .bind(generation.composition_id, project.id)
      .first();
    if (composition)
      // A paid render records the composition it belongs to, but not the
      // storyboard revision at render time. Do not present the current
      // composition revision as if it were the rendered one.
      return { sourceKind: "storyboard_render", compositionId: composition.id, compositionRevision: null };
  }
  return { sourceKind: "saved_asset", compositionId: null, compositionRevision: null };
}

export async function createReviewRoom(env, project, input) {
  const assetId = typeof input?.assetId === "string" ? input.assetId : "";
  if (!/^[a-z0-9_]{1,80}$/i.test(assetId))
    throw new HttpError(400, "Choose a saved image or film from this project", "review_asset_required");
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL")
    .bind(assetId, project.id)
    .first();
  if (!asset) throw new HttpError(404, "That saved asset is not in this project", "review_asset_not_found");
  if (asset.kind !== "image" && asset.kind !== "video")
    throw new HttpError(400, "Reviews pin a saved image or film, not an audio track", "review_kind_unsupported");

  const expiresInHours = input?.expiresInHours === undefined ? REVIEW_DEFAULT_TTL_HOURS : Number(input.expiresInHours);
  if (!Number.isSafeInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > REVIEW_MAX_TTL_HOURS)
    throw new HttpError(400, `Expiry must be between 1 and ${REVIEW_MAX_TTL_HOURS} hours`, "review_expiry_invalid");

  const versionLabel = text(
    input?.versionLabel === undefined || input.versionLabel === "" ? asset.title || "Saved version" : input.versionLabel,
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

export async function listReviewRooms(env, project) {
  const rows = await env.DB.prepare(
    "SELECT * FROM review_rooms WHERE project_id=?1 ORDER BY created_at DESC LIMIT 50",
  )
    .bind(project.id)
    .all();
  if (!rows.results.length) return [];
  const rooms = rows.results;
  const placeholders = rooms.map((_, index) => `?${index + 2}`).join(",");
  const feedbackRows = await env.DB.prepare(
    `SELECT * FROM review_feedback WHERE project_id=?1 AND room_id IN (${placeholders}) ORDER BY created_at ASC LIMIT 2000`,
  )
    .bind(project.id, ...rooms.map((room) => room.id))
    .all();
  const decisionRows = await env.DB.prepare(
    `SELECT * FROM review_decisions WHERE project_id=?1 AND room_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`,
  )
    .bind(project.id, ...rooms.map((room) => room.id))
    .all();
  const feedbackByRoom = new Map();
  for (const item of feedbackRows.results) {
    const list = feedbackByRoom.get(item.room_id) ?? [];
    list.push(item);
    feedbackByRoom.set(item.room_id, list);
  }
  const decisionsByRoom = new Map();
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

export async function revokeReviewRoom(env, project, roomId) {
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
export async function rotateReviewRoomToken(env, project, roomId) {
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

function parseRegion(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Send a point as an object with x and y", "review_region_invalid");
  const region = {};
  for (const key of ["x", "y", "w", "h"]) {
    if (value[key] === undefined) continue;
    const number = Number(value[key]);
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

function parseTime(value, label, maxMs) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maxMs)
    throw new HttpError(400, `${label} is outside this saved version`, "review_time_invalid");
  return number;
}

export async function addReviewFeedback(env, room, input) {
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
    .first();
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
    .first();
  return feedbackView(row);
}

export async function recordReviewDecision(env, room, input) {
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
    .first();
  return ownerReviewRoomView(updated, {
    feedback: await loadRoomFeedback(env, updated),
    decisions: await loadRoomDecisions(env, updated),
  });
}

export async function setFeedbackResolved(env, project, roomId, feedbackId, input) {
  if (typeof input?.resolved !== "boolean")
    throw new HttpError(400, "Send resolved as a boolean", "review_resolution_invalid");
  const row = await env.DB.prepare("SELECT * FROM review_feedback WHERE id=?1 AND room_id=?2 AND project_id=?3")
    .bind(feedbackId, roomId, project.id)
    .first();
  if (!row) throw new HttpError(404, "Feedback not found in this review room", "review_feedback_not_found");
  const timestamp = now();
  await env.DB.prepare("UPDATE review_feedback SET resolved_at=?2,resolved_by=?3 WHERE id=?1 AND room_id=?4 AND project_id=?5")
    .bind(feedbackId, input.resolved ? timestamp : null, input.resolved ? "studio-owner" : null, roomId, project.id)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM review_feedback WHERE id=?1 AND room_id=?2 AND project_id=?3")
    .bind(feedbackId, roomId, project.id)
    .first();
  return feedbackView(updated);
}

export async function compareReviewRooms(env, project, leftId, rightId) {
  if (leftId === rightId)
    throw new HttpError(400, "Choose two different saved versions", "review_compare_same");
  const left = await loadRoom(env, project, leftId);
  const right = await loadRoom(env, project, rightId);
  return {
    left: ownerReviewRoomView(left, { feedback: await loadRoomFeedback(env, left) }),
    right: ownerReviewRoomView(right, { feedback: await loadRoomFeedback(env, right) }),
  };
}

function clientKey(request) {
  return request?.headers?.get("cf-connecting-ip") || "local";
}

export async function assertReviewAttemptAllowed(env, request) {
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1")
    .bind(`token:${clientKey(request)}`)
    .first();
  if (row && row.reset_at > timestamp && Number(row.count) >= REVIEW_ATTEMPT_LIMIT)
    throw new HttpError(429, "Too many review link attempts. Wait a few minutes and try again.", "review_rate_limited");
}

export async function recordReviewFailure(env, request) {
  const key = `token:${clientKey(request)}`;
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1").bind(key).first();
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

export async function assertFeedbackAttemptAllowed(env, room, request) {
  const key = `feedback:${room.token_hash.slice(0, 16)}:${clientKey(request)}`;
  const timestamp = now();
  const row = await env.DB.prepare("SELECT count,reset_at FROM review_attempts WHERE key=?1").bind(key).first();
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

export async function pruneReviewAttempts(env) {
  await env.DB.prepare("DELETE FROM review_attempts WHERE reset_at < ?1")
    .bind(now() - 60 * 60 * 1000)
    .run();
}
