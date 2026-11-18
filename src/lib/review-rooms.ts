// MIT. Private, version-pinned review rooms — typed view/DTO core.
//
// This is the typed core of the saved review-room views: room status/time,
// feedback and decision DTOs, the owner/private view, the guest-safe view and
// the guest-safe comparison side. It imports only the tiny, dependency-free
// util.mjs helpers (typed in util.d.mts), so review-rooms.mjs keeps every
// public name, import path, share auth, expiry, rate and write path unchanged.
//
// Guest-safe views deliberately name only the pinned version, its status and
// comments. Tokens, token hashes, snapshots, R2 keys, project/asset identity,
// prompts/captions and source lineage never enter these shapes. Annotations
// are erased at runtime, so the emitted objects are byte-for-byte the originals.

import { now, safeJson } from "./util.mjs";

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
