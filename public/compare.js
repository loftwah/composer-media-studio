// Generated from src/browser/compare.ts; edit that source.
"use strict";
// MIT. The model chooser's review controls.
//
// A review is private by default: the pick, the short note and the timestamp live
// in this browser and are never sent to the worker. Nothing here can create a
// take, call a provider or spend money — the page is built from work already
// saved, and this script only records what the owner thought of it.
//
// A vote belongs to one exact saved take, not to a model name. Each entry is
// keyed by job + generation, so a newer take is reviewed on its own and an old
// note cannot silently follow a model into a different run.
//
// Authored here; public/compare.js is emitted by scripts/launcher-assets.mjs.
const KEY = "media-studio:compare-review:v2";
const LEGACY_KEY = "media-studio:compare-review:v1";
/** The stored review is only ever this script's own object; a foreign or
 *  unreadable value is treated as empty, exactly like the earlier hand-written
 *  script did, so a broken localStorage cannot stop the takes from showing. */
function isReview(value) {
    return typeof value === "object" && value !== null;
}
function read(key = KEY) {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        return isReview(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function write(value) {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(value));
    }
    catch {
        /* a browser with no storage still shows the takes */
    }
}
function currentJob() {
    return new URLSearchParams(window.location.search).get("job") ?? "default";
}
function modelOf(take) {
    return take.getAttribute("data-take") ?? "";
}
function keyFor(take) {
    const generation = take.getAttribute("data-generation") ?? "";
    return `${currentJob()}::${generation || "unknown"}::${modelOf(take)}`;
}
/**
 * The exact take's note. A note saved by the earlier model-keyed version is
 * still shown for the same model and job so an existing private review is not
 * lost; the next edit writes the generation-scoped record.
 */
function entryFor(review, take) {
    return review[keyFor(take)] ?? read(LEGACY_KEY)[`${currentJob()}::${modelOf(take)}`] ?? {};
}
function payloadFor(take) {
    const entry = entryFor(read(), take);
    return {
        model: modelOf(take),
        generationId: take.getAttribute("data-generation") || null,
        briefKey: take.getAttribute("data-brief") || null,
        createdAt: Number(take.getAttribute("data-created")) || null,
        pick: Boolean(entry.pick),
        reject: Boolean(entry.reject),
        reason: entry.reason ?? "",
        at: entry.at ?? "",
    };
}
function applyBlind() {
    const grid = document.querySelector(".cmp-grid");
    if (!grid)
        return;
    const toggle = document.querySelector("[data-blind-mode]");
    const blind = toggle instanceof HTMLInputElement ? toggle.checked : grid.classList.contains("is-blind");
    grid.classList.toggle("is-blind", blind);
    let chosen = false;
    for (const take of grid.querySelectorAll("[data-take]")) {
        const entry = entryFor(read(), take);
        const revealed = Boolean(entry.pick || entry.reject);
        chosen ||= revealed;
        take.classList.toggle("is-revealed", revealed);
    }
    // The verdict names the models and their costs. Keep it out of sight until
    // the reviewer has made a choice, otherwise blind review would be a label
    // above a spoiler.
    const verdict = document.querySelector("[data-verdict]");
    if (verdict instanceof HTMLElement)
        verdict.hidden = blind && !chosen;
}
function paint() {
    const review = read();
    const takes = [...document.querySelectorAll("[data-take]")];
    for (const take of takes) {
        const entry = entryFor(review, take);
        const pick = take.querySelector("[data-pick]");
        const reject = take.querySelector("[data-reject]");
        const badge = take.querySelector("[data-take-badge]");
        const reason = take.querySelector("[data-reason]");
        const at = take.querySelector("[data-at]");
        if (pick)
            pick.setAttribute("aria-pressed", entry.pick ? "true" : "false");
        if (reject)
            reject.setAttribute("aria-pressed", entry.reject ? "true" : "false");
        if (badge)
            badge.hidden = !entry.pick;
        if (reason instanceof HTMLInputElement && document.activeElement !== reason)
            reason.value = entry.reason ?? "";
        if (at instanceof HTMLInputElement && document.activeElement !== at)
            at.value = entry.at ?? "";
    }
    const status = document.getElementById("cmp-status");
    const picked = takes.filter((take) => entryFor(review, take).pick);
    if (status) {
        status.textContent =
            picked.length === 0
                ? "No pick recorded on this device yet."
                : `${picked.length} take${picked.length === 1 ? "" : "s"} picked on this device. Your notes stay here until you copy them.`;
    }
    applyBlind();
    const verdict = document.querySelector("[data-verdict]");
    const title = verdict?.querySelector("[data-verdict-title]");
    const detail = verdict?.querySelector("[data-verdict-detail]");
    if (verdict && title && detail) {
        if (!verdict.dataset.recordedTitle) {
            verdict.dataset.recordedTitle = title.textContent ?? "";
            verdict.dataset.recordedDetail = detail.textContent ?? "";
        }
        if (picked.length > 0) {
            const label = picked[0].querySelector("h3")?.textContent?.trim() || modelOf(picked[0]);
            title.textContent = `You chose ${label} on this device`;
            detail.textContent =
                "The recorded costs stay exactly as shown. Your private note is bound to this exact saved take.";
        }
        else {
            title.textContent = verdict.dataset.recordedTitle ?? "";
            detail.textContent = verdict.dataset.recordedDetail ?? "";
        }
    }
}
function setFlag(take, field, value) {
    const review = read();
    const key = keyFor(take);
    const entry = review[key] ?? {};
    const jobPrefix = `${currentJob()}::`;
    // One pick per job, and one state per take. A pick in another job is left
    // alone: choosing a still does not erase the choice made for a motion take.
    if (field === "pick" && value) {
        for (const other of Object.keys(review)) {
            if (other !== key && other.startsWith(jobPrefix) && review[other]?.pick) {
                review[other] = { ...review[other], pick: false };
            }
        }
    }
    if (field === "pick" && value)
        entry.reject = false;
    if (field === "reject" && value)
        entry.pick = false;
    entry[field] = value;
    review[key] = entry;
    write(review);
    paint();
}
function main() {
    for (const take of document.querySelectorAll("[data-take]")) {
        take.querySelector("[data-pick]")?.addEventListener("click", () => {
            const current = entryFor(read(), take).pick === true;
            setFlag(take, "pick", !current);
        });
        take.querySelector("[data-reject]")?.addEventListener("click", () => {
            const current = entryFor(read(), take).reject === true;
            setFlag(take, "reject", !current);
        });
        for (const field of ["reason", "at"]) {
            const input = take.querySelector(field === "reason" ? "[data-reason]" : "[data-at]");
            input?.addEventListener("change", () => {
                const review = read();
                const key = keyFor(take);
                const entry = review[key] ?? {};
                entry[field] = input instanceof HTMLInputElement ? input.value.trim() : "";
                review[key] = entry;
                write(review);
                paint();
            });
        }
    }
    const blind = document.querySelector("[data-blind-mode]");
    blind?.addEventListener("change", applyBlind);
    document.getElementById("cmp-copy")?.addEventListener("click", async () => {
        const payload = {
            schema: "media-studio-comparison-review/v2",
            job: currentJob(),
            recordedAt: new Date().toISOString(),
            takes: [...document.querySelectorAll("[data-take]")].map(payloadFor),
        };
        const text = JSON.stringify(payload, null, 2);
        const status = document.getElementById("cmp-status");
        try {
            await navigator.clipboard.writeText(text);
            if (status)
                status.textContent = "Review copied to the clipboard as JSON, bound to these exact takes.";
        }
        catch {
            if (status)
                status.textContent = "The clipboard was unavailable. Select the review text from the page instead.";
            window.prompt("Copy this review:", text);
        }
    });
    paint();
}
if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", main, { once: true });
else
    main();
