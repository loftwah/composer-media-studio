// MIT. Private review room: token-scoped feedback and a deliberate decision.
// Every value from the API is inserted as text, never as markup.
//
// Authored here; public/review.js is emitted by scripts/launcher-assets.mjs.

/** A feedback row as the guest review API returns it. */
interface ReviewFeedbackItem {
  author: string;
  body: string;
  atMs: number | null;
  endMs: number | null;
  region: { x: number; y: number; w?: number; h?: number } | null;
  createdAt: number;
  resolvedAt: number | null;
}

/** The guest-safe room the page renders; tokens and lineage never appear. */
interface ReviewRoomView {
  version?: { label?: string; kind?: string } | null;
  decision?: string;
  decisionNote?: string;
  canComment?: boolean;
  feedback?: ReviewFeedbackItem[];
}

interface ReviewApiPayload {
  room?: ReviewRoomView;
  error?: { message?: string };
}

interface FeedbackSubmission {
  reviewerName: string;
  body: string;
  atMs?: number;
  endMs?: number;
  region?: { x: number; y: number };
}

interface DecisionSubmission {
  decision: "approved" | "changes_requested";
  reviewerName: string;
  note: string;
}

/** The named controls this script reads from the two plain forms. */
interface ReviewFormControls {
  reviewerName?: HTMLInputElement;
  body?: HTMLTextAreaElement;
  atSeconds?: HTMLInputElement;
  endSeconds?: HTMLInputElement;
  regionX?: HTMLInputElement;
  regionY?: HTMLInputElement;
  note?: HTMLTextAreaElement;
  decision?: HTMLInputElement;
}

type ReviewForm = HTMLFormElement & { elements: ReviewFormControls };

const tokenMatch = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{43})(?:\/media)?$/);
const token = tokenMatch?.[1] ?? "";
const feedbackForm = document.querySelector<ReviewForm>("[data-review-form]");
const decisionForm = document.querySelector<ReviewForm>("[data-review-decision]");
const feedbackList = document.querySelector<HTMLElement>("#review-feedback");
const feedbackStatus = document.querySelector<HTMLElement>("#review-feedback-status");
const decisionBanner = document.querySelector<HTMLElement>("#review-decision-banner");
const decisionNote = document.querySelector<HTMLElement>("#review-decision-note");
const decisionConfirm = document.querySelector<HTMLElement>("[data-decision-confirm]");
const decisionCopy = document.querySelector<HTMLElement>("[data-decision-copy]");
const nameKey = "studio-review-name";
let room: ReviewRoomView | null = null;
let busy = false;

function setStatus(message: string, tone = ""): void {
  if (!feedbackStatus) return;
  feedbackStatus.textContent = message;
  feedbackStatus.dataset.tone = tone;
}

function timecode(ms: number | null | undefined): string {
  const total = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function rememberName(value: string): void {
  try { sessionStorage.setItem(nameKey, value); } catch { /* Storage can be unavailable. */ }
}

function storedName(): string {
  try { return sessionStorage.getItem(nameKey) ?? ""; } catch { return ""; }
}

function prefillNames(): void {
  const names = [...document.querySelectorAll<HTMLInputElement>('input[name="reviewerName"]')];
  const name = storedName();
  if (name) for (const input of names) if (!input.value) input.value = name;
  for (const input of names) {
    input.addEventListener("input", () => {
      rememberName(input.value);
      for (const other of names) if (other !== input) other.value = input.value;
    });
  }
}

function renderFeedback(items: readonly ReviewFeedbackItem[]): void {
  if (!feedbackList) return;
  feedbackList.textContent = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "No feedback yet. Comments are bound to this exact saved version.";
    feedbackList.append(empty);
    return;
  }
  const list = document.createElement("ol");
  list.className = "review-feedback";
  list.setAttribute("aria-label", "Feedback on this saved version");
  for (const item of items) {
    const entry = document.createElement("li");
    entry.className = `review-feedback-item${item.resolvedAt ? " resolved" : ""}`;
    const head = document.createElement("div");
    head.className = "review-feedback-head";
    const author = document.createElement("strong");
    author.textContent = item.author;
    const when = document.createElement("span");
    when.className = "small";
    when.textContent = new Date(item.createdAt).toUTCString();
    head.append(author, when);
    if (item.resolvedAt) {
      const tag = document.createElement("span");
      tag.className = "review-tag";
      tag.textContent = "Resolved";
      head.append(tag);
    }
    entry.append(head);
    if (Number.isFinite(item.atMs)) {
      const seek = document.createElement("button");
      seek.type = "button";
      seek.className = "review-timecode";
      seek.dataset.reviewSeek = String(item.atMs);
      const range = Number.isFinite(item.endMs) ? `${timecode(item.atMs)}–${timecode(item.endMs)}` : timecode(item.atMs);
      seek.textContent = range;
      seek.setAttribute("aria-label", `Play from ${timecode(item.atMs)}`);
      entry.append(seek);
    } else if (item.region) {
      const point = document.createElement("span");
      point.className = "review-point";
      point.textContent = `Point ${Math.round(Number(item.region.x) * 100)}% across, ${Math.round(Number(item.region.y) * 100)}% down`;
      entry.append(point);
    }
    const body = document.createElement("p");
    body.className = "review-feedback-body";
    body.textContent = item.body;
    entry.append(body);
    list.append(entry);
  }
  feedbackList.append(list);
}

function renderDecision(next: ReviewRoomView): void {
  if (!decisionBanner) return;
  decisionBanner.textContent = "";
  const p = document.createElement("p");
  p.className = "review-verdict";
  const strong = document.createElement("strong");
  if (next.decision === "approved") {
    p.classList.add("approved");
    strong.textContent = "Reviewer approved this saved version.";
    p.append(strong, document.createTextNode(" Approval here is feedback only. It does not publish, schedule, spend or change project permissions."));
  } else if (next.decision === "changes_requested") {
    p.classList.add("changes");
    strong.textContent = "Changes requested.";
    p.append(strong, document.createTextNode(" This decision applies to this saved version only. A new render starts a new review."));
  } else {
    p.classList.add("waiting");
    strong.textContent = "Awaiting review.";
    p.append(strong, document.createTextNode(" Leave specific feedback or record a decision for this saved version."));
  }
  decisionBanner.append(p);
  if (decisionNote) {
    decisionNote.textContent = next.decisionNote ? `Decision note: ${next.decisionNote}` : "";
  }
}

function render(next: ReviewRoomView): void {
  room = next;
  renderFeedback(next.feedback ?? []);
  renderDecision(next);
  const open = next.canComment === true;
  if (feedbackForm) feedbackForm.hidden = !open;
  if (decisionForm) decisionForm.hidden = !open;
  if (!open) setStatus("This review link is no longer open. No further feedback can be submitted.", "warn");
}

async function readRoom(): Promise<ReviewRoomView> {
  const response = await fetch(`/api/review/${encodeURIComponent(token)}`, {
    credentials: "omit",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as ReviewApiPayload;
  if (!response.ok) throw new Error(payload?.error?.message ?? "This review link is no longer available.");
  return payload.room as ReviewRoomView;
}

async function post(path: string, body: unknown): Promise<ReviewApiPayload> {
  if (busy) throw new Error("A submission is already in progress.");
  busy = true;
  try {
    const response = await fetch(`/api/review/${encodeURIComponent(token)}${path}`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as ReviewApiPayload;
    if (!response.ok) throw new Error(payload?.error?.message ?? "That could not be saved.");
    return payload;
  } finally {
    busy = false;
  }
}

function syncFeedbackAnchorInputs(): void {
  if (!feedbackForm) return;
  const name = feedbackForm.elements.reviewerName;
  if (name) name.addEventListener("input", () => rememberName(name.value));
  const video = document.querySelector<HTMLVideoElement>("video[data-review-media]");
  const useCurrent = document.querySelector("[data-use-current-time]");
  if (video && useCurrent) {
    useCurrent.addEventListener("click", () => {
      const seconds = Math.max(0, video.currentTime);
      feedbackForm.elements.atSeconds!.value = seconds.toFixed(1);
      setStatus(`Timecode set to ${timecode(seconds * 1000)}.`);
    });
  }
  const frame = document.querySelector<HTMLElement>("[data-review-image]");
  const marker = document.querySelector<HTMLElement>("[data-review-marker]");
  const image = document.querySelector<HTMLImageElement>("[data-review-image-target]");
  if (frame && marker) {
    frame.addEventListener("click", (event) => {
      const target = event.target as Element;
      const targetImage = target.closest<HTMLImageElement>("img");
      if (!targetImage) return;
      const rect = targetImage.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      if (feedbackForm.elements.regionX) feedbackForm.elements.regionX.value = String(Math.round(x * 100));
      if (feedbackForm.elements.regionY) feedbackForm.elements.regionY.value = String(Math.round(y * 100));
      marker.hidden = false;
      marker.style.left = `${x * 100}%`;
      marker.style.top = `${y * 100}%`;
      setStatus(`Point set to ${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down.`);
    });
  }
  if (image) image.alt = image.alt || "Saved version under review";
}

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const seek = target.closest<HTMLElement>("[data-review-seek]");
  if (seek) {
    const video = document.querySelector<HTMLVideoElement>("video[data-review-media]");
    if (!video) return;
    video.currentTime = Number(seek.dataset.reviewSeek) / 1000;
    video.play().catch(() => {});
    video.focus({ preventScroll: false });
  }
  const choice = target.closest<HTMLElement>("[data-decision-choice]");
  if (choice && decisionForm) {
    const decision = choice.dataset.decisionChoice;
    const label = decision === "approved" ? "approval" : "a change request";
    decisionForm.elements.decision!.value = decision!;
    if (decisionCopy)
      decisionCopy.textContent = `Record ${label} for “${room?.version?.label ?? "this saved version"}”? This is feedback for this exact version only.`;
    if (decisionConfirm) decisionConfirm.hidden = false;
    if (decisionCopy) decisionCopy.scrollIntoView({ block: "nearest" });
  }
  const cancel = target.closest("[data-decision-cancel]");
  if (cancel && decisionForm) {
    decisionForm.elements.decision!.value = "";
    if (decisionConfirm) decisionConfirm.hidden = true;
    if (decisionCopy) decisionCopy.textContent = "";
  }
});

if (feedbackForm) {
  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(feedbackForm);
    const payload: FeedbackSubmission = {
      reviewerName: String(data.get("reviewerName") ?? ""),
      body: String(data.get("body") ?? ""),
    };
    if (room?.version?.kind === "video") {
      const seconds = data.get("atSeconds");
      const end = data.get("endSeconds");
      if (seconds !== "" && seconds !== null) payload.atMs = Math.round(Number(seconds) * 1000);
      if (end !== "" && end !== null) payload.endMs = Math.round(Number(end) * 1000);
    } else {
      const x = data.get("regionX");
      const y = data.get("regionY");
      if (x !== "" && y !== "" && x !== null && y !== null)
        payload.region = { x: Number(x) / 100, y: Number(y) / 100 };
    }
    rememberName(payload.reviewerName);
    setStatus("Saving feedback…");
    try {
      const result = await post("/feedback", payload);
      render(result.room as ReviewRoomView);
      feedbackForm.elements.body!.value = "";
      setStatus("Feedback saved against this exact saved version.", "ok");
    } catch (error) {
      setStatus((error as Error).message, "bad");
    }
  });
}

if (decisionForm) {
  decisionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(decisionForm);
    const decision = String(data.get("decision") ?? "");
    if (decision !== "approved" && decision !== "changes_requested") return;
    const payload: DecisionSubmission = {
      decision,
      reviewerName: String(data.get("reviewerName") ?? ""),
      note: String(data.get("note") ?? ""),
    };
    rememberName(payload.reviewerName);
    setStatus("Recording decision…");
    try {
      const result = await post("/decision", payload);
      render(result.room as ReviewRoomView);
      if (decisionConfirm) decisionConfirm.hidden = true;
      decisionForm.elements.decision!.value = "";
      setStatus(decision === "approved" ? "Approval recorded for this version." : "Change request recorded.", "ok");
    } catch (error) {
      setStatus((error as Error).message, "bad");
    }
  });
}

prefillNames();
syncFeedbackAnchorInputs();
if (!token) {
  setStatus("This review link is not valid.", "bad");
} else {
  readRoom()
    .then((next) => {
      render(next);
      setStatus("This private review is ready.", "ok");
    })
    .catch((error) => {
      setStatus((error as Error).message, "bad");
    });
}
