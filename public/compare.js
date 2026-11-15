// MIT. The model chooser's review controls.
//
// A review is private by default: the pick, the short note and the timestamp live
// in this browser and are never sent to the worker. Nothing here can create a
// take, call a provider or spend money — the page is built from work already
// saved, and this script only records what the owner thought of it.

const KEY = "media-studio:compare-review:v1";

/** @returns {Record<string, {pick?: boolean, reject?: boolean, reason?: string, at?: string}>} */
function read() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} value */
function write(value) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* a browser with no storage still shows the takes */
  }
}

/** @param {string} id */
function scope(id) {
  const job = new URLSearchParams(window.location.search).get("job") ?? "default";
  return `${job}::${id}`;
}

function paint() {
  const review = read();
  const takes = [...document.querySelectorAll("[data-take]")];
  for (const take of takes) {
    const id = take.getAttribute("data-take") ?? "";
    const entry = review[scope(id)] ?? {};
    const pick = take.querySelector("[data-pick]");
    const reject = take.querySelector("[data-reject]");
    const badge = take.querySelector("[data-take-badge]");
    const reason = take.querySelector("[data-reason]");
    const at = take.querySelector("[data-at]");
    if (pick) pick.setAttribute("aria-pressed", entry.pick ? "true" : "false");
    if (reject) reject.setAttribute("aria-pressed", entry.reject ? "true" : "false");
    if (badge) badge.hidden = !entry.pick;
    if (reason instanceof HTMLInputElement && document.activeElement !== reason) reason.value = entry.reason ?? "";
    if (at instanceof HTMLInputElement && document.activeElement !== at) at.value = entry.at ?? "";
  }
  const status = document.getElementById("cmp-status");
  const picked = takes.filter((take) => review[scope(take.getAttribute("data-take") ?? "")]?.pick);
  if (status) {
    status.textContent =
      picked.length === 0
        ? "No pick recorded on this device yet."
        : `${picked.length} take${picked.length === 1 ? "" : "s"} picked on this device. Your notes stay here until you copy them.`;
  }
}

/** @param {string} id @param {string} field @param {boolean} value */
function setFlag(id, field, value) {
  const review = read();
  const key = scope(id);
  const entry = review[key] ?? {};
  // One pick per job: choosing a take clears every other pick, and choosing one
  // that was rejected clears the rejection instead of holding both.
  if (field === "pick" && value) {
    for (const other of Object.keys(review)) {
      if (other.endsWith(`::${id}`)) continue;
      if (review[other]?.pick) review[other] = { ...review[other], pick: false };
    }
  }
  if (field === "pick" && value) entry.reject = false;
  if (field === "reject" && value) entry.pick = false;
  entry[field] = value;
  review[key] = entry;
  write(review);
  paint();
}

function main() {
  for (const take of document.querySelectorAll("[data-take]")) {
    const id = take.getAttribute("data-take") ?? "";
    take.querySelector("[data-pick]")?.addEventListener("click", () => {
      const current = read()[scope(id)]?.pick === true;
      setFlag(id, "pick", !current);
    });
    take.querySelector("[data-reject]")?.addEventListener("click", () => {
      const current = read()[scope(id)]?.reject === true;
      setFlag(id, "reject", !current);
    });
    for (const field of ["reason", "at"]) {
      const input = take.querySelector(field === "reason" ? "[data-reason]" : "[data-at]");
      input?.addEventListener("change", () => {
        const review = read();
        const key = scope(id);
        const entry = review[key] ?? {};
        entry[field] = input instanceof HTMLInputElement ? input.value.trim() : "";
        review[key] = entry;
        write(review);
        paint();
      });
    }
  }

  document.getElementById("cmp-copy")?.addEventListener("click", async () => {
    const review = read();
    const job = new URLSearchParams(window.location.search).get("job") ?? "default";
    const payload = {
      schema: "media-studio-comparison-review/v1",
      job,
      recordedAt: new Date().toISOString(),
      takes: [...document.querySelectorAll("[data-take]")].map((take) => {
        const id = take.getAttribute("data-take") ?? "";
        const entry = review[scope(id)] ?? {};
        return { model: id, pick: Boolean(entry.pick), reject: Boolean(entry.reject), reason: entry.reason ?? "", at: entry.at ?? "" };
      }),
    };
    const text = JSON.stringify(payload, null, 2);
    const status = document.getElementById("cmp-status");
    try {
      await navigator.clipboard.writeText(text);
      if (status) status.textContent = "Review copied to the clipboard as JSON.";
    } catch {
      if (status) status.textContent = "The clipboard was unavailable. Select the review text from the page instead.";
      window.prompt("Copy this review:", text);
    }
  });

  paint();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
else main();
