// MIT. The private review room, reviewer comparison and refusal page
// renderers. Moved verbatim out of ui.mjs for #198; the rendered bytes,
// escaping, branches, dates, expiry and safety copy are unchanged. ui.mjs
// re-exports the three public names, so the Worker and focused tests keep the
// same import path. page-head.ts owns the document chrome, util.mjs supplies
// escapeHtml, and review-rooms.ts owns the saved room, feedback and
// compare-side shapes this module only reads.

import { escapeHtml } from "./util.mjs";
import { head } from "./page-head.ts";
import type {
  ReviewFeedbackRow,
  ReviewRegion,
  ReviewRoomRow,
  ReviewerCompareSideView,
} from "./review-rooms.ts";

/** The already-loaded room, its feedback and the rendered media path. */
export interface ReviewRoomPageOptions {
  room: ReviewRoomRow;
  feedback?: readonly ReviewFeedbackRow[];
  mediaPath: string;
  reviewPath?: string;
  kind: string;
  title: string;
  expiresAt: number;
}

/** Two reviewer-safe compare sides plus the token that owns this page. */
export interface ReviewComparePageOptions {
  left: ReviewerCompareSideView;
  right: ReviewerCompareSideView;
  primaryToken?: string;
}

/** The refusal copy the Worker chooses for a bad, expired or revoked link. */
export interface ReviewRefusalPageOptions {
  title?: string;
  message?: string;
  code?: string;
}

function reviewTime(ms: number | null) {
  if (!Number.isFinite(Number(ms))) return "";
  const total = Math.max(0, Number(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function reviewFeedbackList(feedback: readonly ReviewFeedbackRow[]) {
  if (!feedback.length) return '<p class="small" id="review-feedback-empty">No feedback yet. Comments are bound to this exact saved version.</p>';
  return `<ol class="review-feedback" aria-label="Feedback on this saved version">${feedback.map((item) => {
    let region: ReviewRegion | null = null;
    try { region = item.region_json ? JSON.parse(item.region_json) : null; } catch { region = null; }
    const anchor = item.at_ms !== null && item.at_ms !== undefined
      ? `<button type="button" class="review-timecode" data-review-seek="${Number(item.at_ms)}" aria-label="Play from ${reviewTime(item.at_ms)}">${reviewTime(item.at_ms)}${item.end_ms !== null && item.end_ms !== undefined ? `–${reviewTime(item.end_ms)}` : ""}</button>`
      : region
        ? `<span class="review-point">Point ${Math.round(Number(region.x) * 100)}% across, ${Math.round(Number(region.y) * 100)}% down</span>`
        : "";
    return `<li class="review-feedback-item${item.resolved_at ? " resolved" : ""}">
      <div class="review-feedback-head"><strong>${escapeHtml(item.reviewer_name)}</strong><span class="small">${new Date(item.created_at).toUTCString()}</span>${item.resolved_at ? '<span class="review-tag">Resolved</span>' : ""}</div>
      ${anchor}
      <p class="review-feedback-body">${escapeHtml(item.body)}</p>
    </li>`;
  }).join("")}</ol>`;
}

function reviewDecisionCopy(room: Pick<ReviewRoomRow, "decision">) {
  if (room.decision === "approved")
    return `<p class="review-verdict approved"><strong>Reviewer approved this saved version.</strong> Approval here is feedback only. It does not publish, schedule, spend or change project permissions.</p>`;
  if (room.decision === "changes_requested")
    return `<p class="review-verdict changes"><strong>Changes requested.</strong> This decision applies to this saved version only. A new render starts a new review.</p>`;
  return `<p class="review-verdict waiting"><strong>Awaiting review.</strong> Leave specific feedback or record a decision for this saved version.</p>`;
}

function reviewFacts({ kind, width, height, durationMs, bytes, mime }: {
  kind: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number;
  mime: string;
}) {
  return [
    kind === "video" ? "film" : "image",
    width && height ? `${width} × ${height}` : null,
    durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null,
    bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null,
    mime,
  ].filter(Boolean).join(" · ");
}

function reviewCompareEntry(reviewPath: string) {
  return `<section class="review-panel review-compare-entry" aria-labelledby="review-compare-title">
    <h2 id="review-compare-title">Compare with another version</h2>
    <p class="small" id="review-compare-help">Paste the private review link for a second saved version you were given. Both pinned versions appear side by side, each with its own label, media and decision. Feedback is never copied between them.</p>
    <form class="review-form" method="post" action="${escapeHtml(reviewPath)}/compare" aria-describedby="review-compare-help">
      <label>Second private review link <input name="compareToken" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" required aria-describedby="review-compare-input-help" placeholder="https://…/r/… or just the token"></label>
      <p class="small" id="review-compare-input-help">Paste the whole link or only its token. It is sent only to this studio, never to another site. Both links must still be open.</p>
      <button type="submit" class="button">Compare these versions</button>
    </form>
  </section>`;
}

/** A private review page. It has no Open Graph, canonical or crawler metadata
 * and names only the pinned version, never the project or its source prompts.
 * On a wide screen the bounded media stage sticks beside the notes so a
 * portrait film and its feedback form are usable together. */
export function reviewRoomPage({ room, feedback = [], mediaPath, reviewPath = "", kind, title, expiresAt }: ReviewRoomPageOptions) {
  const isVideo = kind === "video";
  const facts = reviewFacts({
    kind,
    width: room.asset_width,
    height: room.asset_height,
    durationMs: room.asset_duration_ms,
    bytes: room.asset_bytes,
    mime: room.asset_mime,
  });
  const decisionNote = room.decision_note ? `<p class="small" id="review-decision-note">Decision note: ${escapeHtml(room.decision_note)}</p>` : `<p class="small" id="review-decision-note"></p>`;
  return `${head({
    title: `${title} — private review — Media Studio`,
    description: "A private, version-pinned review page from Media Studio.",
    private: true,
    extra: `<link rel="stylesheet" href="/review.css">`,
  })}
<body class="review-page">
<a class="skip" href="#review-main">Skip to content</a>
<header class="site-header review-header">
  <a class="wordmark" href="/" aria-label="Media Studio home"><img class="brand-mark" src="/brand/composer-icon-tile.svg" width="40" height="40" alt=""><span>Media Studio</span><span class="brand-by">Private review</span></a>
  <p class="review-privacy small">This link shows one saved version. Do not share it publicly.</p>
</header>
<main id="review-main" tabindex="-1">
  <div class="review-intro">
    <h1>${escapeHtml(room.version_label)}</h1>
    <p class="small">Private review · ${escapeHtml(facts)} · Link expires ${escapeHtml(new Date(expiresAt).toUTCString())}</p>
  </div>
  <div class="review-layout">
    <div class="review-media-column">
      <section class="review-stage" aria-labelledby="review-media-title">
        <h2 id="review-media-title" class="sr-only">Saved version under review</h2>
        ${isVideo
          ? `<video controls playsinline preload="metadata" data-review-media src="${escapeHtml(mediaPath)}" aria-describedby="review-media-help"></video>`
          : `<div class="review-image-frame" data-review-image><img data-review-image-target src="${escapeHtml(mediaPath)}" alt="${escapeHtml(room.version_label)}"><span class="review-marker" data-review-marker hidden aria-hidden="true"></span></div>`}
        <p class="small" id="review-media-help">${isVideo
          ? "Use the player controls or the keyboard to pause at the moment you mean. “Use current time” attaches that timecode to your comment."
          : "Select the image to pin a point, or type a position below. The point is saved with your comment."}</p>
      </section>
    </div>
    <div class="review-notes-column">
      <section class="review-panel" aria-labelledby="review-feedback-title">
        <h2 id="review-feedback-title">Feedback on this version</h2>
        <div id="review-feedback">${reviewFeedbackList(feedback)}</div>
        <p id="review-feedback-status" role="status" aria-live="polite" class="small"></p>
        <form class="review-form" data-review-form>
          <label>Your name <input name="reviewerName" maxlength="60" autocomplete="name" required></label>
          <label>Comment <textarea name="body" maxlength="2000" rows="5" required></textarea></label>
          ${isVideo
            ? `<div class="review-anchor"><label>Start timecode in seconds <input name="atSeconds" type="number" min="0" step="0.1" inputmode="decimal"></label><label>End timecode (optional) <input name="endSeconds" type="number" min="0" step="0.1" inputmode="decimal"></label><button type="button" class="secondary" data-use-current-time>Use current time</button></div>`
            : `<fieldset class="review-anchor"><legend>Pin this note to a point (optional)</legend><label>Across (%) <input name="regionX" type="number" min="0" max="100" step="1" inputmode="numeric"></label><label>Down (%) <input name="regionY" type="number" min="0" max="100" step="1" inputmode="numeric"></label></fieldset>`}
          <button type="submit" class="button">Post feedback</button>
          <p class="small">Feedback is saved against this exact version. It never edits, generates, publishes or charges anything.</p>
        </form>
        <noscript><p class="notice">Comments need JavaScript in this browser. The saved version and existing feedback still display without it.</p></noscript>
      </section>
      <section class="review-panel" aria-labelledby="review-decision-title">
        <h2 id="review-decision-title">Decision for this version</h2>
        <div id="review-decision-banner">${reviewDecisionCopy(room)}</div>
        ${decisionNote}
        <p class="small">The creator sees this decision against this exact saved version. A new render never inherits it.</p>
        <form class="review-form" data-review-decision>
          <label>Your name <input name="reviewerName" maxlength="60" autocomplete="name" required></label>
          <label>Decision note (optional) <textarea name="note" maxlength="500" rows="3"></textarea></label>
          <input type="hidden" name="decision" value="">
          <div class="row">
            <button type="button" class="secondary" data-decision-choice="changes_requested">Request changes</button>
            <button type="button" class="button" data-decision-choice="approved">Approve this version</button>
          </div>
          <div class="review-confirm" data-decision-confirm hidden>
            <p role="status" data-decision-copy></p>
            <p class="small">Approval is feedback, not permission to publish, schedule, spend or change the project.</p>
            <div class="row"><button type="submit" class="button">Record decision</button><button type="button" class="quiet" data-decision-cancel>Cancel</button></div>
          </div>
        </form>
      </section>
    </div>
  </div>
  ${reviewPath ? reviewCompareEntry(reviewPath) : ""}
  <p class="review-footer small">Private review room · the media bytes remain in the studio's private storage. This page is not a public gallery or a publication.</p>
</main>
<script type="module" src="/review.js"></script>
</body>
</html>`;
}

/** A reviewer-created comparison of two private links they already hold. It
 * renders each pinned version with its own media and decision, never the other
 * room's feedback, and links back to each token-scoped review page. */
export function reviewComparePage({ left, right, primaryToken = "" }: ReviewComparePageOptions) {
  const primaryPath = `/r/${encodeURIComponent(primaryToken)}`;
  const side = (view: ReviewerCompareSideView, position: string) => {
    const isPrimary = view.reviewPath === primaryPath;
    const label = view.version.label;
    const isVideo = view.version.kind === "video";
    const headingId = `review-compare-${position}-title`;
    const factsId = `review-compare-${position}-facts`;
    const decisionLabel =
      view.decision === "approved" ? "Reviewer approved this saved version" : view.decision === "changes_requested" ? "Changes requested" : "Awaiting a decision";
    return `<article class="review-compare-side" aria-labelledby="${headingId}">
      <p class="small review-compare-position">Version ${position.toUpperCase()}${isPrimary ? " · this page" : ""}</p>
      <h2 id="${headingId}">${escapeHtml(label)}</h2>
      <p class="small" id="${factsId}">${escapeHtml(reviewFacts(view.version))}</p>
      <div class="review-compare-media">
        ${isVideo
          ? `<video controls playsinline preload="metadata" src="${escapeHtml(view.mediaPath)}" aria-label="${escapeHtml(`Film: ${label}`)}" aria-describedby="${factsId}"></video>`
          : `<img src="${escapeHtml(view.mediaPath)}" alt="${escapeHtml(`${label} — pinned image under review`)}" loading="lazy" decoding="async">`}
      </div>
      <p class="review-compare-status">
        <span class="review-badge ${escapeHtml(view.status)}">${escapeHtml(view.status === "open" ? "link open" : view.status)}</span>
        <span class="review-compare-decision">${escapeHtml(decisionLabel)}</span>
      </p>
      ${view.decisionNote ? `<p class="small"><strong>Decision note:</strong> ${escapeHtml(view.decisionNote)}</p>` : `<p class="small">No decision note on this version.</p>`}
      ${isPrimary
        ? `<p class="small review-compare-primary"><span class="review-tag">Main review page</span> Comments and decisions belong to this version's own review page.</p>`
        : `<p class="review-compare-actions"><a class="button secondary" href="${escapeHtml(view.reviewPath)}" rel="noreferrer">Make this the main review page</a></p>`}
    </article>`;
  };
  return `${head({
    title: "Compare two saved versions — private review — Media Studio",
    description: "A private comparison of two version-pinned review links from Media Studio.",
    private: true,
    extra: `<link rel="stylesheet" href="/review.css">`,
  })}
<body class="review-page review-compare-page">
<a class="skip" href="#review-main">Skip to content</a>
<header class="site-header review-header">
  <a class="wordmark" href="/" aria-label="Media Studio home"><img class="brand-mark" src="/brand/composer-icon-tile.svg" width="40" height="40" alt=""><span>Media Studio</span><span class="brand-by">Private review</span></a>
  <p class="review-privacy small">This page shows two saved versions you were given links for. Do not share it publicly.</p>
</header>
<main id="review-main" tabindex="-1">
  <div class="review-intro">
    <h1>Two saved versions, side by side</h1>
    <p class="small" id="review-compare-summary">Both private links are open and pinned to their saved versions. Read each version with its own decision. Comparing is read-only: it does not copy feedback, change a decision, publish, spend or alter either saved file.</p>
  </div>
  <h2 id="review-compare-heading" class="sr-only">Saved versions under comparison</h2>
  <div class="review-compare-pair" role="group" aria-labelledby="review-compare-heading">
    ${side(left, "a")}
    ${side(right, "b")}
  </div>
  <p class="review-footer small"><a href="${escapeHtml(primaryPath)}" rel="noreferrer">Back to this version's review page</a> · Private comparison, not a public gallery or a publication.</p>
</main>
</body>
</html>`;
}

export function reviewRefusalPage({ title = "This review link is not available", message = "Ask the creator for a current private review link.", code = "review_unavailable" }: ReviewRefusalPageOptions = {}) {
  return `${head({
    title: `${title} — Media Studio`,
    description: "A private review link is not available.",
    private: true,
    extra: `<link rel="stylesheet" href="/review.css">`,
  })}
<body class="review-page review-refusal">
<main id="review-main">
  <div class="review-intro">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p class="small" data-refusal-code="${escapeHtml(code)}">No media or feedback was returned.</p>
    <p><a class="button secondary" href="/">Media Studio home</a></p>
  </div>
</main>
</body>
</html>`;
}
