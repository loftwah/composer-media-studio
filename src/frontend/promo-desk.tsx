// The read-only promo desk (Studio #489 first delivery). Rendered inside the
// existing promo workbench section; it owns one small fetch of the project's
// review rooms and derives every other fact from props the Assemble surface
// already holds. It starts no job, spends nothing and publishes nothing.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  PROMO_DESK_READ_ONLY_STATUS,
  promoDesk,
  promoDeskHandoffKey,
  promoDeskHandoffText,
  type PromoBriefLite,
  type PromoReviewRoomLite,
} from "./promo-desk";
import type { CompositionV1, ComposeGenerationV1, MediaAssetV1 } from "./contracts";

const roomLite = (room: Record<string, unknown>): PromoReviewRoomLite => ({
  id: String(room.id ?? ""),
  assetId: String(room.assetId ?? ""),
  versionLabel: String(room.versionLabel ?? room.assetTitle ?? ""),
  status: String(room.status ?? ""),
  decision: typeof room.decision === "string" ? room.decision : null,
  unresolvedCount: Number(room.unresolvedCount ?? 0) || 0,
  feedbackCount: Number(room.feedbackCount ?? 0) || 0,
});

const sceneList = (indexes: number[]) => {
  if (indexes.length === 0) return "";
  if (indexes.length === 1) return `Scene ${indexes[0] + 1} has no spoken words`;
  const all = indexes.map((index) => index + 1);
  return `Scenes ${all.slice(0, -1).join(", ")} and ${all[all.length - 1]} have no spoken words`;
};

const truncate = (value: string, max = 140) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

type DeskCopyFeedback = { key: string; message: string; fallback: string | null; busy: boolean };

export function PromoDesk({
  projectId,
  brief,
  assets,
  compositions,
  generations,
}: {
  projectId: string;
  brief: PromoBriefLite | null;
  assets: MediaAssetV1[];
  compositions: CompositionV1[];
  generations: ComposeGenerationV1[];
}) {
  const [rooms, setRooms] = useState<PromoReviewRoomLite[] | null>(null);
  const [roomsFailed, setRoomsFailed] = useState(false);
  const [roomsBusy, setRoomsBusy] = useState(false);
  const abortRooms = useRef<AbortController | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<DeskCopyFeedback | null>(null);
  const copyRun = useRef(0);
  const handoffKeyRef = useRef("");
  const copyTrigger = useRef<HTMLButtonElement | null>(null);
  const copyFallback = useRef<HTMLTextAreaElement | null>(null);
  const copyStatusId = useId();
  const copyFallbackId = useId();

  // One rooms store, scoped to this project. A new project or an unmount aborts
  // the old read so a late response can never land under the wrong brief.
  const loadRooms = useCallback(async () => {
    abortRooms.current?.abort();
    const controller = new AbortController();
    abortRooms.current = controller;
    setRooms(null);
    setRoomsFailed(false);
    setRoomsBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/review-rooms`, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      if (controller.signal.aborted) return;
      setRooms((Array.isArray(data.rooms) ? data.rooms : []).map(roomLite));
    } catch {
      if (controller.signal.aborted) return;
      setRooms(null);
      setRoomsFailed(true);
    } finally {
      if (!controller.signal.aborted) setRoomsBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadRooms();
    return () => abortRooms.current?.abort();
  }, [loadRooms]);

  const desk = brief ? promoDesk(brief, assets, compositions, generations, rooms, roomsFailed, projectId) : null;
  const handoffText = brief && desk ? promoDeskHandoffText(brief, desk.next, window.location.origin) : "";
  const handoffKey = brief && desk ? promoDeskHandoffKey(brief, desk.next) : "";
  handoffKeyRef.current = handoffKey;
  const currentCopy = copyFeedback?.key === handoffKey ? copyFeedback : null;

  // A new saved brief, revision or derived action retires both an in-flight
  // native write and its manual-copy field. The same cleanup handles unmount.
  useEffect(() => {
    copyRun.current += 1;
    setCopyFeedback(null);
    return () => { copyRun.current += 1; };
  }, [handoffKey]);

  useEffect(() => {
    if (!currentCopy?.fallback) return;
    const field = copyFallback.current;
    if (field && document.activeElement === copyTrigger.current) {
      field.focus();
      field.select();
    }
  }, [currentCopy?.fallback, handoffKey]);

  if (!brief || !desk) return null;
  const assetHref = (assetId: string) => `#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;

  async function copyNextAction(): Promise<void> {
    if (currentCopy?.busy) return;
    const key = handoffKey;
    const text = handoffText;
    const run = ++copyRun.current;
    const current = () => copyRun.current === run && handoffKeyRef.current === key;
    setCopyFeedback({ key, message: "Copying next action…", fallback: null, busy: true });
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (!current()) return;
      setCopyFeedback({ key, message: "Next action copied to the clipboard.", fallback: null, busy: false });
    } catch {
      if (!current()) return;
      setCopyFeedback({
        key,
        message: "Copy the handoff text from the field below.",
        fallback: text,
        busy: false,
      });
    }
  }

  const pill: Record<string, [string, string]> = {
    "script-ready": ["ok", "Ready"],
    "script-missing": ["", "Missing input"],
    "narration-ready": ["ok", "Matched take"],
    "narration-missing": ["", "Missing"],
    "narration-waiting": ["run", "Waiting"],
    "narration-failed": ["bad", "Failed"],
    "narration-unknown": ["unknown", "Unknown"],
    "narration-not-applicable": ["", "Not applicable"],
    "storyboard-ready": ["ok", "Matched cut"],
    "storyboard-missing": ["", "Missing"],
    "storyboard-not-rendered": ["", "Not rendered"],
    "storyboard-waiting": ["run", "Waiting"],
    "storyboard-failed": ["bad", "Failed"],
    "storyboard-unknown": ["unknown", "Unknown"],
    "storyboard-blocked": ["", "Blocked"],
    "storyboard-unlinked": ["", "Not linked"],
    "review-approved": ["ok", "Approved"],
    "review-changes": ["bad", "Changes"],
    "review-unresolved": ["run", "In review"],
    "review-open": ["run", "In review"],
    "review-ambiguous": ["unknown", "Check match"],
    "review-stale": ["", "Stale cut"],
    "review-loading": ["run", "Loading"],
    "review-missing": ["", "Missing"],
    "review-blocked": ["", "Blocked"],
    "review-unavailable": ["unknown", "Unavailable"],
    "packaging-local": ["", "Local"],
  };

  const stage = (key: string, name: string, detail: ReactNode, link?: { href: string; label: string }) => {
    const [tone, label] = pill[key] ?? ["", key];
    return (
      <li>
        <span className={`status ${tone}`}>{label}</span>
        <strong>{name}</strong>
        <span className="promo-desk-detail">{detail}</span>
        {link && <a href={link.href}>{link.label}</a>}
      </li>
    );
  };

  const rows: ReactNode[] = [];
  if (desk.script.state === "ready") {
    rows.push(stage("script-ready", "Script", `Revision ${brief.revision} · ${brief.scenes.length} scene${brief.scenes.length === 1 ? "" : "s"} · about ${desk.script.seconds}s at 140 words per minute`));
  } else {
    rows.push(stage("script-missing", "Script", sceneList(desk.script.missingSpoken)));
  }
  if (desk.narration.state === "ready") {
    const ambiguous = desk.narration.ambiguous
      ? ` · newest of ${desk.narration.matchingSaved} saved takes with this exact script`
      : "";
    rows.push(
      stage(
        "narration-ready",
        "Narration (text match)",
        <>Saved take “{desk.narration.asset.title}” · matched by exact script text, not a saved link{ambiguous}</>,
        { href: assetHref(desk.narration.asset.id), label: "Open take" },
      ),
    );
  } else if (desk.narration.state === "waiting") {
    rows.push(stage("narration-waiting", "Narration", <>Job is {desk.narration.job.status}</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.narration.state === "failed") {
    rows.push(stage("narration-failed", "Narration", <>{truncate(desk.narration.job.error?.message || "The job failed")}</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.narration.state === "unknown") {
    rows.push(stage("narration-unknown", "Narration", <>No verifiable outcome saved</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.narration.state === "not-applicable") {
    rows.push(stage("narration-not-applicable", "Narration", <>No spoken words — this brief does not ask for narration</>));
  } else {
    rows.push(stage("narration-missing", "Narration (text match)", <>No saved Studio Voice job has this exact script; a match is inferred, not linked</>));
  }
  if (desk.storyboard.state === "ready") {
    const extras = desk.storyboard.extraCompositions ? ` · ${desk.storyboard.extraCompositions} more saved storyboard${desk.storyboard.extraCompositions === 1 ? "" : "s"} use this take` : "";
    const stale = desk.storyboard.stale ? " · storyboard changed after this cut" : "";
    rows.push(
      stage(
        "storyboard-ready",
        "Storyboard (inferred cut)",
        <>“{desk.storyboard.composition.title}” · cut rendered from the matched take{extras}{stale} · link inferred, not saved with this brief</>,
        { href: assetHref(desk.storyboard.cut.id), label: "Open cut" },
      ),
    );
  } else if (desk.storyboard.state === "not-rendered") {
    rows.push(stage("storyboard-not-rendered", "Storyboard", <>“{desk.storyboard.composition.title}” · saved, no render yet</>));
  } else if (desk.storyboard.state === "waiting") {
    rows.push(stage("storyboard-waiting", "Storyboard", <>“{desk.storyboard.composition.title}” · job is {desk.storyboard.job.status}</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.storyboard.state === "failed") {
    rows.push(stage("storyboard-failed", "Storyboard", <>“{desk.storyboard.composition.title}” · {truncate(desk.storyboard.job.error?.message || "the render failed")}</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.storyboard.state === "unknown") {
    rows.push(stage("storyboard-unknown", "Storyboard", <>“{desk.storyboard.composition.title}” · no verifiable outcome</>, { href: `#/p/${encodeURIComponent(projectId)}/history`, label: "Open History" }));
  } else if (desk.storyboard.state === "missing") {
    rows.push(stage("storyboard-missing", "Storyboard (inferred cut)", <>No saved storyboard uses the matched take yet</>));
  } else if (desk.storyboard.state === "unlinked") {
    rows.push(stage("storyboard-unlinked", "Storyboard", <>No narration take to anchor a storyboard</>));
  } else {
    rows.push(stage("storyboard-blocked", "Storyboard", <>Needs the narration first</>));
  }
  const reviewTab = { href: `#/p/${encodeURIComponent(projectId)}/review`, label: "Open Review" };
  if (desk.review.state === "approved") {
    rows.push(
      stage(
        "review-approved",
        "Review (cut review)",
        <>Approved in {desk.review.roomCount} room{desk.review.roomCount === 1 ? "" : "s"} for this exact cut · cut match is inferred · approval is feedback only, not permission to publish</>,
        reviewTab,
      ),
    );
  } else if (desk.review.state === "changes") {
    rows.push(stage("review-changes", "Review (cut review)", <>{desk.review.unresolvedCount ? `${desk.review.unresolvedCount} unresolved note${desk.review.unresolvedCount === 1 ? "" : "s"} · ` : ""}changes requested for this cut</>, reviewTab));
  } else if (desk.review.state === "unresolved") {
    rows.push(stage("review-unresolved", "Review (cut review)", <>{desk.review.unresolvedCount} unresolved note{desk.review.unresolvedCount === 1 ? "" : "s"} on this cut</>, reviewTab));
  } else if (desk.review.state === "open") {
    rows.push(stage("review-open", "Review (cut review)", <>{desk.review.roomCount} room{desk.review.roomCount === 1 ? "" : "s"} open, no feedback yet</>, reviewTab));
  } else if (desk.review.state === "ambiguous") {
    rows.push(
      stage(
        "review-ambiguous",
        "Review (inferred cut)",
        <>{desk.review.roomCount} room{desk.review.roomCount === 1 ? "" : "s"} recorded a decision for the matched cut, but the cut is one of several possible matches. This is not treated as approval for this brief.</>,
        reviewTab,
      ),
    );
  } else if (desk.review.state === "stale") {
    rows.push(stage("review-stale", "Review (stale cut)", <>This cut predates later storyboard edits; its review is not approval for the current edit</>, reviewTab));
  } else if (desk.review.state === "loading") {
    rows.push(stage("review-loading", "Review (cut review)", <>Loading saved review rooms — no decision has been read yet</>));
  } else if (desk.review.state === "missing") {
    const revoked = desk.review.revokedCount
      ? ` · ${desk.review.revokedCount} revoked room${desk.review.revokedCount === 1 ? "" : "s"} ignored`
      : "";
    rows.push(stage("review-missing", "Review (cut review)", <>No active review room pins this cut yet{revoked}</>, reviewTab));
  } else if (desk.review.state === "unavailable") {
    rows.push(stage("review-unavailable", "Review (cut review)", <>Could not load review rooms <button type="button" className="quiet promo-desk-retry" onClick={() => void loadRooms()} disabled={roomsBusy}>Retry</button></>));
  } else {
    rows.push(stage("review-blocked", "Review", <>Waiting on a current saved cut</>));
  }
  // Packaging happens in the signed-out, browser-local Image Tools, not in
  // Studio: the link carries no project, brief or owner data, and nothing here
  // claims a packaging status the desk cannot verify.
  rows.push(
    stage(
      "packaging-local",
      "Packaging (device-local)",
      <>Title and thumbnail cards are built in Image Tools from files on this device and export as a ZIP — nothing is uploaded, and nothing is saved with this brief</>,
      { href: "/tools/images#image-title-compare-heading", label: "Open Title + thumbnail compare" },
    ),
  );

  return (
    <section className="promo-desk" aria-label={`Promo desk for ${brief.title}`}>
      <div className="promo-desk-head">
        <h3 id="promo-desk-title">Where this promo stands</h3>
        <span className="small">{PROMO_DESK_READ_ONLY_STATUS}</span>
      </div>
      <ol className="promo-desk-stages">{rows}</ol>
      <p className="promo-desk-next">
        <strong>Next:</strong> {desk.next.text}
        {desk.next.link && <a href={desk.next.link.href}>{desk.next.link.label}</a>}
        <button
          ref={copyTrigger}
          type="button"
          className="quiet promo-desk-copy"
          aria-disabled={currentCopy?.busy === true}
          aria-describedby={currentCopy?.message ? copyStatusId : undefined}
          onClick={() => void copyNextAction()}
        >
          Copy next action
        </button>
      </p>
      {currentCopy && <p id={copyStatusId} className="small promo-desk-copy-status" role="status" aria-live="polite" aria-atomic="true">{currentCopy.message}</p>}
      {currentCopy && currentCopy.fallback !== null && (
        <label className="promo-desk-copy-fallback" htmlFor={copyFallbackId}>
          Next action handoff text — select and copy
          <textarea
            id={copyFallbackId}
            ref={copyFallback}
            readOnly
            rows={6}
            value={currentCopy.fallback}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      <p className="small promo-desk-note">
        Narration and storyboard rows are inferred matches, not links saved with this brief revision. A Studio Voice job matches only when
        its saved request prompt exactly equals this script (newest saved take if several match), and a storyboard matches when it uses that
        take (newest if several). Editing either side or saving a new revision changes the evidence. A cut rendered before later storyboard
        edits, a revoked review room, or a cut chosen from several candidates is never read as approval for this brief.
      </p>
    </section>
  );
}
