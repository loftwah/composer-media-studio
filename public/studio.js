import { mergeHistoryRead } from "./restyle-history-refresh.js";
import { mergeRestyleResponse } from "./restyle-history.js";
import { encodeWav } from "./wav.js";
import { isLocalRenderProvenance, publicCaption, shareImportProvenance } from "./asset-caption.js";
import { shotRange } from "./shot-trims.js";
import { recipeModelCompatible, recipeModelSettings } from "./recipe-selection.js";
import { prepareVoiceDraft, restoreCreateDraft, switchCreateProject, createEventBelongsToProject, hasCreateDraftChanges, shouldWarnCreateDrafts } from "./voice-handoff.js";
import { derivativeSize } from "./derivative-size.js";
import { PROJECT_TABS, nextProjectTab, parseStudioHash } from "./studio-route.js";
// MIT. Media Studio client. Vanilla, same-origin, no build step.

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const confirmDialog = document.querySelector("#confirm");
let creativeHome = null;
let homeMounted = false;
let mediaMounted = false;
let bootReady = false;
// The route that opened the viewer. It carries the tab, the control and the
// scroll offset so Close can return to a History result or an Assemble still,
// not only to the library grid.
let viewerReturn = null;
let pendingProjectTabFocus = null;
let viewerFocusFallback = null;
let mixPreviewUrl = null;
let mixPreviewVersion = 0;
function clearMixPreview() {
  mixPreviewVersion++;
  const player = document.querySelector('#mix-preview-player');
  if (player) { player.onerror = null; player.pause(); player.removeAttribute('src'); player.hidden = true; player.load(); }
  if (mixPreviewUrl) URL.revokeObjectURL(mixPreviewUrl);
  mixPreviewUrl = null;
}
window.addEventListener('pagehide', clearMixPreview);
const shareImportDrafts = new Map();
// A lost admission response can hide a job that was nevertheless created.
const uncertainRestyleProjects = new Map();
const historyReadErrors = new Set();
const historyReadSerial = new Map();
// Displaced Create drafts stay project-scoped and recoverable for this tab's lifetime.
const priorCreateDrafts = new Map();
const projectCreateDrafts = new Map();
const projectCreateDefaults = new Map();
let createProjectId = null;
window.addEventListener("beforeunload", (event) => {
  if (shouldWarnCreateDrafts(projectCreateDrafts, priorCreateDrafts, state.create, projectCreateDefaults.get(createProjectId))) event.preventDefault();
});
// Comparison is an in-memory view of existing same-project images, not a saved collection.
const comparisons = new Map();

const state = {
  view: "home",
  projectId: null,
  tab: "library",
  projects: [],
  project: null,
  models: [],
  recipes: [],
  videosConfigured: false,
  destinations: {},
  woodhouseShare: false,
  showcase: [],
  session: null,
  filter: "all",
  query: "",
  create: null,
  reviewRooms: null,
  reviewCompare: null,
  reviewLinks: new Map(),
  reviewPresetAssetId: null,
  compose: { shotIds: [], shotTrims: {}, audioAssetId: null, audioTracks: [], slateAssetId: null, title: "", editingId: null },
  busy: false,
  polling: null,
  mask: null,
};

// A missing bundle falls back to the existing workbench rather than hiding it.
// Upgrade a deep-linked library, viewer or untouched assembly once loading completes.
const creativeModuleReady = import(`/creative/home.js${new URL(import.meta.url).search}`)
  .then((module) => { creativeHome = module; if (bootReady && state.view === "home") render(); else upgradeFallbackWhenIdle(); })
  .catch(() => console.warn("Creative home unavailable; using the existing project browser."));

function upgradeFallbackWhenIdle() {
  if (!bootReady || !creativeHome || mediaMounted || !state.project) return;
  const assemblyUntouched = state.view === "project" && state.tab === "assemble" && !state.compose.title && !state.compose.shotIds.length && !state.compose.audioTracks.length && !state.compose.editingId;
  if (!(state.view === "asset" || (state.view === "project" && state.tab === "library") || assemblyUntouched)) return;
  // Keep a focused control, open dialog, playing preview or selected file intact.
  if (app.contains(document.activeElement) || document.querySelector("dialog[open]") ||
      [...app.querySelectorAll("video, audio")].some((media) => !media.paused) ||
      [...app.querySelectorAll('input[type="file"]')].some((input) => input.files?.length)) return;
  const scrollY = window.scrollY;
  render(); // Saves and restores any Share import draft and the library query.
  window.scrollTo(0, scrollY);
}
// Focus can move within the app on focusout, so check after the new focus settles.
document.addEventListener("focusout", () => setTimeout(upgradeFallbackWhenIdle, 0));
app.addEventListener("pause", upgradeFallbackWhenIdle, true);

// The no-bundle library grid loads the owner-only preview first and falls back
// to the original exactly once. `error` does not bubble, so listen in capture;
// removing the attribute before the swap is what makes it one-shot.
app.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const fallback = image.dataset.previewFallback;
  if (!fallback) return;
  delete image.dataset.previewFallback;
  image.src = fallback;
}, true);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === '"' ? "&quot;" : "&#39;",
  );

function notify(message, tone = "ok") {
  toast.textContent = message;
  toast.hidden = false;
  toast.dataset.tone = tone;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.hidden = true;
  }, 5200);
}

async function api(path, options = {}) {
  const { preserveOnUnauthorized = false, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...requestOptions,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 401 && !preserveOnUnauthorized && !path.startsWith("/api/login")) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function money(micro) {
  const value = Number(micro ?? 0) / 1_000_000;
  return value === 0 ? "$0.00" : value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

function bytesLabel(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp));
}

function stillExtension(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function timeLabel(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function statusChip(status) {
  const map = {
    saved: ["ok", "Saved"],
    admitted: ["", "Prepared"],
    submitting: ["run", "Submitting"],
    submitted: ["run", "Submitted"],
    running: ["run", "Generating"],
    provider_complete: ["run", "Copying result"],
    saving: ["run", "Saving"],
    failed: ["bad", "Failed"],
    cancel_requested: ["unknown", "Cancel requested"],
    cancelled: ["", "Cancelled"],
    unknown: ["unknown", "Outcome unknown"],
    discarded_after_delete: ["bad", "Discarded after delete"],
  };
  const [tone, label] = map[status] ?? ["", status];
  return `<span class="status ${tone}">${esc(label)}</span>`;
}

function parseHash() {
  return parseStudioHash(location.hash);
}

// The viewer is a route, not a page replacement for a modal task. It is still
// marked as a modal dialog while open: the header and skip link become inert,
// Tab stays inside, and Escape/Close leave one coherent history pair intact.
let viewerClosing = false;

function viewerOriginMatches() {
  return viewerReturn?.projectId === state.projectId && viewerReturn.assetId === state.assetId;
}

function closeViewer() {
  if (state.view !== "asset" || viewerClosing) return;
  if (viewerOriginMatches()) {
    viewerClosing = true;
    history.back();
    setTimeout(() => { viewerClosing = false; }, 1200);
    return;
  }
  // A deep link or reload has no same-document origin to go back to. Open the
  // library as the stable destination and move focus somewhere usable there.
  viewerFocusFallback = "library";
  location.hash = `#/p/${encodeURIComponent(state.projectId)}/library`;
}

function focusViewerFallback() {
  if (state.view !== "project" || !viewerFocusFallback) return;
  const target = viewerFocusFallback === "library" ? document.querySelector("#search") : null;
  viewerFocusFallback = null;
  (target ?? document.getElementById(`project-tab-${state.tab}`) ?? app.querySelector("button, a[href], input"))?.focus({ preventScroll: true });
}

let viewerFocusKey = null;
function focusViewerOnOpen() {
  const key = `${state.projectId ?? ""}/${state.assetId ?? ""}`;
  if (viewerFocusKey === key) return;
  viewerFocusKey = key;
  // The library may have been scrolled far down. Start the viewer at its
  // controls so the focused Close is visible, not above the viewport.
  window.scrollTo(0, 0);
  const root = app.querySelector("[data-viewer]");
  const target = root?.querySelector('[data-action="close-viewer"]') ?? root?.querySelector("[data-viewer-back]");
  target?.focus({ preventScroll: true });
}

// The route is rendered in #app; the site header and skip link sit outside it.
// Mark those background surfaces inert for assistive technology and pointer
// input without replacing the hash router or hiding the live toast region.
function syncViewerRouteChrome() {
  const open = state.view === "asset" && Boolean(app.querySelector("[data-viewer]"));
  for (const element of [document.querySelector(".skip"), document.querySelector(".site-header")]) {
    if (!element) continue;
    if (open) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    }
  }
  document.body.classList.toggle("viewer-route", open);
}

function originCandidates(action, assetId) {
  return [...app.querySelectorAll(`[data-action="${action}"]`)].filter((element) => element.dataset.id === assetId);
}

// Remember the tab, exact control and scroll offset that opened the viewer.
// A History result and a Create result can both name the same asset, so the
// ordinal index distinguishes their identical controls.
function recordViewerOrigin(element, assetId, action) {
  if (state.view !== "project" || !state.projectId) return;
  const candidates = originCandidates(action, assetId);
  viewerReturn = {
    projectId: state.projectId,
    assetId,
    tab: state.tab,
    action,
    index: Math.max(0, candidates.indexOf(element)),
    via: element?.classList.contains("thumb") ? "thumb" : action === "open-asset-link" ? "link" : "open",
    scrollY: window.scrollY,
  };
}

// Restore the originating tab's control and scroll position after Close or
// Escape. React mounts synchronously here; the second attempt covers a tab
// whose content paints on the next frame.
function restoreViewerOrigin() {
  const previous = viewerReturn;
  if (!previous || state.view !== "project" || state.projectId !== previous.projectId || state.tab !== previous.tab) return false;
  viewerReturn = null;
  const restore = (final = false) => {
    if (state.view !== "project" || state.projectId !== previous.projectId || state.tab !== previous.tab) return true;
    const candidates = originCandidates(previous.action, previous.assetId);
    let item = candidates[previous.index] ?? null;
    if (previous.via === "thumb") item = candidates.find((element) => element.classList.contains("thumb")) ?? item;
    item ??= candidates[0];
    if (!item && !final) return false;
    if (!item) {
      // The tab rebuilt without the original control (for example a job row
      // whose result was withdrawn). Keep the tab and scroll, but put focus on
      // a stable control there rather than leaving it on the document body.
      const fallback = document.querySelector("#search") ?? document.getElementById(`project-tab-${state.tab}`);
      fallback?.focus({ preventScroll: true });
      window.scrollTo(0, previous.scrollY);
      return true;
    }
    item.focus({ preventScroll: true });
    // Programmatic focus can skip the browser's focus-visible heuristic.
    // Show the same ring explicitly until the control loses focus.
    item.classList.add("viewer-return-focus");
    item.addEventListener("blur", () => item.classList.remove("viewer-return-focus"), { once: true });
    window.scrollTo(0, previous.scrollY);
    return true;
  };
  requestAnimationFrame(() => { if (!restore()) setTimeout(() => restore(true), 180); });
  return true;
}

function stableHash() {
  if (state.view === "asset" && state.projectId && state.assetId) {
    return `#/a/${encodeURIComponent(state.projectId)}/${encodeURIComponent(state.assetId)}`;
  }
  if (state.view === "project" && state.projectId) {
    return `#/p/${encodeURIComponent(state.projectId)}/${encodeURIComponent(state.tab || "library")}`;
  }
  return "#/";
}

// Replace the malformed hash with the route that is actually on screen so a
// reload or a copied URL no longer repeats the mistake.
function rejectMalformedHash() {
  try { history.replaceState(history.state, "", stableHash()); } catch { /* Keep the current page and the message. */ }
  notify("That Studio link wasn't recognised, so this page stayed open.", "bad");
}

// An unknown project section is still a usable project. Library is selected,
// the hash is replaced and the message names what happened instead of showing
// an unexplained empty panel.
function rejectUnknownTab() {
  try { history.replaceState(history.state, "", stableHash()); } catch { /* Keep the current page and the message. */ }
  notify("That studio section doesn't exist, so Library is open.", "bad");
}

function activateProjectTab(tab) {
  if (!PROJECT_TABS.includes(tab) || state.view !== "project" || !state.projectId) return;
  pendingProjectTabFocus = tab;
  if (state.tab === tab) {
    document.getElementById(`project-tab-${tab}`)?.focus();
    pendingProjectTabFocus = null;
    return;
  }
  state.tab = tab;
  location.hash = `#/p/${encodeURIComponent(state.projectId)}/${tab}`;
}


// The open viewer keeps Tab inside its own route. This covers the React viewer
// and the no-bundle fallback with one rule instead of duplicating a trap.
const viewerFocusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], summary, [tabindex]:not([tabindex="-1"])';
function viewerFocusables(root) {
  return [...root.querySelectorAll(viewerFocusableSelector)].filter((element) => element.getClientRects().length > 0);
}

document.addEventListener("keydown", (event) => {
  if (state.view !== "asset" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  // A native dialog owns Escape and Tab while it is open.
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "Escape") {
    // A fullscreen film also owns Escape.
    if (document.fullscreenElement) return;
    event.preventDefault();
    closeViewer();
    return;
  }
  if (event.key !== "Tab") return;
  const root = app.querySelector("[data-viewer]");
  if (!root) return;
  const focusables = viewerFocusables(root);
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables.at(-1);
  if (!root.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

// Horizontal project tabs follow the ARIA tabs pattern: only the selected tab
// is in the Tab order, and Left/Right/Home/End move selection and focus.
app.addEventListener("keydown", (event) => {
  if (state.view !== "project" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const tab = event.target.closest?.('[role="tab"][data-action="tab"]');
  if (!tab) return;
  const next = nextProjectTab(tab.dataset.tab, event.key);
  if (!next) return;
  event.preventDefault();
  activateProjectTab(next);
});


function projectResumeKey() {
  const binding = state.session?.projectResumeBinding;
  return binding ? `studio.project-resume.v1.${binding}` : null;
}

function rememberedProjectId() {
  const key = projectResumeKey();
  try { return key ? localStorage.getItem(key) : null; }
  catch { return null; }
}

function rememberOpenedProject(route) {
  if (route.view !== "project" || route.unknownTab || state.view !== "project" ||
      state.projectId !== route.projectId || state.project?.id !== route.projectId) return;
  const key = projectResumeKey();
  try { if (key) localStorage.setItem(key, route.projectId); }
  catch { /* Project browsing still works when storage is unavailable. */ }
}

async function boot() {
  const session = await api("/api/session");
  if (!session.signedIn) {
    location.href = "/login";
    return;
  }
  state.session = session;
  if (!session.actions?.includes("read")) {
    app.innerHTML = `<div class="card"><h1>This studio is not open to this account.</h1><p>The handoff did not include a current read grant. Ask the workspace owner for access, or read the public story.</p><div class="row">${session.composerOrigin ? `<a class="button" href="${esc(session.composerOrigin)}/">Return to App Composer</a>` : ""}${session.storyUrl ? `<a class="button secondary" href="${esc(session.storyUrl)}">Read the story</a>` : ""}</div></div>`;
    return;
  }
  const data = await api("/api/state");
  state.projects = data.projects;
  state.models = data.models;
  state.retiredModels = data.retiredModels ?? [];
  state.recipes = data.recipes;
  state.videosConfigured = data.videosConfigured;
  state.destinations = data.destinations ?? {};
  state.woodhouseShare = data.woodhouseShare === true;
  state.showcase = data.showcase ?? [];
  const route = parseHash();
  const invalidRoute = route.view === "invalid";
  const unknownTab = route.unknownTab ?? null;
  if (!invalidRoute) {
    state.view = route.view;
    state.projectId = route.projectId ?? null;
    state.tab = PROJECT_TABS.includes(route.tab) ? route.tab : "library";
    if (state.view === "project" || state.view === "asset") {
      if (state.view === "asset") state.assetId = route.assetId;
      await loadProject(state.projectId);
      rememberOpenedProject(route);
    }
    if (state.view === "project" && state.tab === "review") await loadReviewRooms(state.projectId).catch((error) => { state.reviewRooms = []; notify(error.message, "bad"); });
    if (state.view === "home") await creativeModuleReady;
  }
  bootReady = true;
  render();
  startPolling();
  // Boot lands on the stable studio home with an explanation, not a silent
  // redirect that makes the bad link look like it worked.
  if (invalidRoute) rejectMalformedHash();
  else if (unknownTab) rejectUnknownTab();
}

async function loadProject(id) {
  const data = await api(`/api/projects/${id}`);
  if (state.projectId !== id) return data;
  if (state.project && state.project.id !== id) {
    state.reviewRooms = null;
    state.reviewCompare = null;
    state.reviewLinks?.clear();
    state.reviewPresetAssetId = null;
  }
  state.project = data.project;
  state.project.assets = data.assets;
  state.project.generations = data.generations;
  state.project.recipes = data.recipes;
  state.project.publications = data.publications;
  state.project.compositions = data.compositions ?? [];
  state.project.budget = data.budget;
  state.create = switchCreateProject(projectCreateDrafts, projectCreateDefaults, createProjectId, state.create, id, defaultCreate);
  createProjectId = id;
  return data;
}

async function loadReviewRooms(projectId) {
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}/review-rooms`);
  if (state.projectId !== projectId || state.project?.id !== projectId) return null;
  state.reviewRooms = data.rooms ?? [];
  return state.reviewRooms;
}

function defaultCreate() {
  const defaults = state.project?.defaults ?? {};
  const recipe = recipeBySlug("editorial-print");
  const controls = {};
  const aspectControl = recipe?.controls.find((control) => control.key === "aspect");
  return {
    recipeSlug: recipe?.slug ?? "editorial-print",
    kind: recipe?.kind ?? "image",
    model: recipe?.model ?? defaults.imageModel ?? "studio-print",
    prompt: recipe ? promptFromRecipe(recipe, controls) : "",
    aspect: aspectControl?.default ?? defaults.aspect ?? "portrait",
    durationSeconds: defaults.durationSeconds ?? 6,
    referenceAssetId: null,
    maskAssetId: null,
    parentAssetId: null,
    controls,
  };
}

function modelById(id) {
  return state.models.find((model) => model.id === id) ?? state.retiredModels?.find((model) => model.id === id) ?? null;
}

function recipeBySlug(slug) {
  return state.project?.recipes?.find((recipe) => recipe.slug === slug) ?? state.recipes.find((recipe) => recipe.slug === slug) ?? null;
}

function estimate() {
  const model = modelById(state.create?.model);
  if (!model) return 0;
  if (model.kind === "audio" && model.audio?.mode === "music") {
    const seconds = Number(state.create.durationSeconds ?? model.audio.maxSeconds);
    return Math.max(1, Math.round((model.costMicro * seconds) / model.audio.maxSeconds));
  }
  if (model.kind === "video" && model.durationCostsMicro?.[state.create.durationSeconds] != null)
    return model.durationCostsMicro[state.create.durationSeconds];
  if (model.kind === "video" && model.costPerSecondMicro)
    return model.costPerSecondMicro * Number(state.create.durationSeconds ?? 6);
  return model.costMicro;
}

function promptFromRecipe(recipe, values) {
  return recipe.promptTemplate.replace(/\{(\w+)\}/g, (_, key) => {
    const control = recipe.controls.find((item) => item.key === key);
    return String(values[key] ?? control?.default ?? "").slice(0, 600);
  });
}

const settingsDrafts = new Map();
function saveSettingsDraft() {
  const form = app.querySelector('[data-form="settings"][data-project-id]');
  if (!form) return;
  settingsDrafts.set(form.dataset.projectId, Object.fromEntries(["name", "creativeDirection", "visibility", "referenceTitle", "referenceUrl"].map(key => [key, form.elements[key].value])));
}

// Keep the header's comparison entry on the studio the owner is actually in.
// The session claim can be absent on a bridged visit, so the project travels in
// the URL instead of being guessed from "newest project".
function syncCompareLink() {
  const link = document.querySelector('.header-nav a[href^="/compare"]');
  if (!link) return;
  link.setAttribute("href", state.projectId ? `/compare?project=${encodeURIComponent(state.projectId)}` : "/compare");
}

function render() {
  syncCompareLink();
  clearMixPreview();
  saveShareImportDraft();
  saveSettingsDraft();
  if (mediaMounted) { creativeHome.unmountMedia(); mediaMounted = false; }
  if (state.view === "home") {
    if (creativeHome) {
      if (!homeMounted) {
        app.innerHTML = '<div id="creative-home"></div>';
        homeMounted = true;
      }
      creativeHome.renderHome(app.querySelector("#creative-home"), {
        projects: state.projects,
        resumeProjectId: rememberedProjectId(),
        videosConfigured: state.videosConfigured,
        woodhouseShare: state.woodhouseShare,
        showcase: state.showcase, canEdit: state.session?.actions.includes("edit") ?? false,
        // Restoring a portable bundle is installation-owner only; a Composer
        // bridge session keeps its project scope and sees the explanation.
        canRestore: state.session?.mode === "owner",
      });
    } else app.innerHTML = homeView();
  } else if (state.view === "asset") {
    if (homeMounted) { creativeHome.unmountHome(); homeMounted = false; }
    if (!state.project || state.project.id !== state.projectId) { app.innerHTML = '<p class="notice">Loading…</p>'; syncViewerRouteChrome(); return; }
    if (creativeHome) {
      app.innerHTML = '<div id="creative-media"></div>';
      const asset = state.project?.assets.find((item) => item.id === state.assetId) ?? null;
      const still = asset?.reuseStillId ? state.project.assets.find((item) => item.id === asset.reuseStillId) ?? null : null;
      creativeHome.renderViewer(app.querySelector("#creative-media"), {
        projectId: state.projectId, asset, still, launchKitUrl: state.destinations?.launchKitUrl ?? null, reentryUrl: studioReentry(state.session),
      });
      mediaMounted = true;
    } else app.innerHTML = assetView();
    syncViewerRouteChrome();
    focusViewerOnOpen();
  } else {
    if (homeMounted) { creativeHome.unmountHome(); homeMounted = false; }
    app.innerHTML = projectView();
    if (creativeHome && state.tab === "library" && state.project?.id === state.projectId) {
      renderReactLibrary();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "create" && state.project?.id === state.projectId) {
      renderReactCreate();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "assemble" && state.project?.id === state.projectId) {
      renderReactAssemble();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "settings" && state.project?.id === state.projectId) {
      creativeHome.renderSettings(app.querySelector("#creative-media"), { project: state.project, draft: settingsDrafts.get(state.projectId) });
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "history" && state.project?.id === state.projectId) {
      renderReactHistory();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "publish" && state.project?.id === state.projectId) {
      creativeHome.renderPublish(app.querySelector("#creative-media"), { publications: state.project.publications, origin: location.origin });
      mediaMounted = true;
    }
    attachDropzone();
    if (state.tab === "library") restoreShareImportDraft();
    if (state.tab === "create") attachMask();
    if (restoreViewerOrigin()) {
      // The originating control takes focus; no tab-level focus fallback is
      // needed on this render.
    } else if (pendingProjectTabFocus) {
      const tab = pendingProjectTabFocus;
      pendingProjectTabFocus = null;
      requestAnimationFrame(() => document.getElementById(`project-tab-${tab}`)?.focus());
    } else {
      focusViewerFallback();
    }
  }
  syncViewerRouteChrome();
  drawWaveforms();
}

function renderReactLibrary() {
  const comparison = comparisons.get(state.projectId) ?? { active: false, ids: [] };
  comparison.ids = comparison.ids.filter((id) => state.project.assets.some((asset) => asset.id === id && asset.kind === "image"));
  comparisons.set(state.projectId, comparison);
  creativeHome.renderLibrary(app.querySelector("#creative-media"), {
    projectId: state.projectId, assets: state.project.assets, query: state.query, filter: state.filter, comparing: comparison.active, compareIds: comparison.ids,
    canImportShare: state.woodhouseShare && state.session?.actions.includes("edit"),
    canViewStorage: state.session?.actions.includes("admin") ?? false,
  });
}

function draftShots() {
  return state.compose.shotIds.map((assetId) => ({ assetId, ...(state.compose.shotTrims[assetId] ?? {}) }));
}

function draftDuration() {
  return draftShots().reduce((sum, shot) => {
    const asset = state.project?.assets.find((item) => item.id === shot.assetId);
    return sum + (shotRange(shot, asset)?.durationMs ?? 0);
  }, 0);
}

function staleMixedBed() {
  if (!state.compose.audioAssetId) return false;
  const bed = state.project?.assets.find((asset) => asset.id === state.compose.audioAssetId);
  return !bed?.durationMs || Math.abs(bed.durationMs - draftDuration()) > 100;
}

function comparableShots(shots) {
  return shots.map((shot) => {
    const asset = state.project?.assets.find((item) => item.id === shot.assetId);
    const range = shotRange(shot, asset);
    return range && (range.start !== 0 || range.end !== asset.durationMs)
      ? { assetId: shot.assetId, trimStartMs: range.start, trimEndMs: range.end }
      : { assetId: shot.assetId };
  });
}

function hasUnsavedStoryboard() {
  const draft = state.compose;
  const saved = (state.project?.compositions ?? []).find((item) => item.id === draft.editingId);
  if (!saved) return Boolean(draft.title.trim() || draft.shotIds.length || draft.audioTracks.length || draft.audioAssetId || draft.slateAssetId);
  const comparable = (value) => JSON.stringify(value);
  return draft.title !== saved.title || comparable(comparableShots(draftShots())) !== comparable(comparableShots(saved.shots)) ||
    comparable(draft.audioTracks) !== comparable(saved.audioTracks ?? []) ||
    (draft.audioAssetId ?? null) !== (saved.audioAssetId ?? null) || (draft.slateAssetId ?? null) !== (saved.slateAssetId ?? null);
}

function studioReentry(session) {
  if (session?.mode === "bridge") {
    try {
      const origin = new URL(session.composerOrigin);
      if (origin.protocol === "https:" && !origin.username && !origin.password) return `${origin.origin}/media-studio/studio`;
    } catch { /* Use standalone sign-in if no valid Composer origin was configured. */ }
  }
  return "/studio";
}

function renderReactAssemble() {
  const projectId = state.projectId;
  creativeHome.renderAssemble(app.querySelector("#creative-media"), { projectId, onVoiceDraft: (script) => {
    if (!state.project || state.project.id !== projectId || state.projectId !== projectId || createProjectId !== projectId || state.view !== "project" || state.tab !== "assemble" || !state.session?.actions.includes("edit")) return "Reopen this studio before preparing narration.";
    try {
      const { previous, voice } = prepareVoiceDraft(state.create, script, modelById("studio-voice"));
      if (hasCreateDraftChanges(previous, projectCreateDefaults.get(projectId))) {
        const drafts = priorCreateDrafts.get(projectId) ?? [];
        drafts.push(previous); priorCreateDrafts.set(projectId, drafts);
      }
      state.create = voice;
      location.hash = `#/p/${projectId}/create`;
      notify(priorCreateDrafts.get(projectId)?.length ? "Narration draft prepared. Earlier Create drafts are available above; no request was sent." : "Narration draft prepared. No request was sent.");
      return null;
    } catch (error) { return error.message; }
  }, onAssetSaved: (asset) => {
    if (!state.project || state.project.id !== projectId) return;
    state.project.assets = [asset, ...state.project.assets.filter((item) => item.id !== asset.id)];
    if (asset.kind === "audio" && state.view === "project" && state.tab === "assemble") renderReactAssemble();
  }, canEdit: Boolean(state.session?.actions.includes("edit")), onSongStoryboard: (composition) => {
    if (!state.project || state.project.id !== composition.projectId || state.view !== "project" || state.tab !== "assemble") return;
    state.project.compositions = [composition, ...(state.project.compositions ?? []).filter((item) => item.id !== composition.id)];
    // A new storyboard is the revision the creator just approved. Load it so
    // the soundtrack mix and "Save changes" cannot silently target the older
    // revision that was already open in the editor.
    state.compose = {
      shotIds: composition.shots.map((shot) => shot.assetId),
      shotTrims: Object.fromEntries(composition.shots.filter((shot) => shot.trimStartMs !== undefined && shot.trimEndMs !== undefined).map((shot) => [shot.assetId, { trimStartMs: shot.trimStartMs, trimEndMs: shot.trimEndMs }])),
      audioAssetId: composition.audioAssetId ?? null,
      audioTracks: structuredClone(composition.audioTracks ?? []),
      slateAssetId: composition.slateAssetId ?? null,
      title: composition.title,
      editingId: composition.id,
      expectedUpdatedAt: composition.updatedAt,
    };
    renderReactAssemble();
  }, compose: state.compose, assets: state.project.assets, compositions: state.project.compositions ?? [], generations: state.project.generations, assemblyCost: renderEstimate("assembly"), socialCost: renderEstimate("social") });
}

function renderReactHistory() {
  creativeHome.renderHistory(app.querySelector("#creative-media"), {
    generations: state.project.generations, assets: state.project.assets, models: state.models,
  });
}

// The import form is intentionally local and unsaved. Keep it per project
// across polling, navigation and other workbench rerenders on this device.
function saveShareImportDraft() {
  const details = app.querySelector("details.share-import[data-project-id]");
  if (!details) return;
  const form = details.querySelector('[data-form="woodhouse-import"]');
  if (!form) return;
  shareImportDrafts.set(details.dataset.projectId, {
    open: details.open,
    assetId: form.elements.assetId.value,
    reuseConfirmed: form.elements.reuseConfirmed.checked,
  });
}

function restoreShareImportDraft() {
  const details = app.querySelector("details.share-import[data-project-id]");
  const draft = details && shareImportDrafts.get(details.dataset.projectId);
  const form = details?.querySelector('[data-form="woodhouse-import"]');
  if (!draft || !form) return;
  details.open = draft.open;
  form.elements.assetId.value = draft.assetId;
  form.elements.reuseConfirmed.checked = draft.reuseConfirmed;
}

function renderReactCreate() {
  const create = state.create;
  const models = state.models.filter((model) => model.kind === create.kind);
  const model = modelById(create.model);
  const images = state.project.assets.filter((asset) => asset.kind === "image");
  creativeHome.renderCreate(app.querySelector("#creative-media"), {
    create, models, model, images,
    recipes: state.project.recipes.filter((recipe) => recipe.kind === create.kind),
    recipe: recipeBySlug(create.recipeSlug),
    selectedReference: images.find((asset) => asset.id === create.referenceAssetId) ?? null,
    maskAsset: state.project.assets.find((asset) => asset.id === create.maskAssetId) ?? null,
    estimateMicro: estimate(),
    fundingBlocked: state.project.generations.some((job) => job.error?.code === "provider_funding"),
    permissionBlocked: state.project.generations.some((job) => ["provider_permission", "provider_auth"].includes(job.error?.code)),
    executionFailed: state.project.generations.some((job) => job.error?.code === "provider_execution"),
  });
}

function homeView() {
  return `
    <section class="hero-strip">
      <div>
        <p class="eyebrow">Make · keep · publish</p>
        <h1>Images and video, owned here.</h1>
        <p style="max-width:62ch">Start a studio for an idea, upload what you already have, and make new work with a funded model when it helps. Nothing is published by accident.</p>
      </div>
      <div class="card">
        <h2 style="font-size:1.1rem">What works without AI</h2>
        <p class="small">Uploads, project collections, search, download, deletion, provenance and the library itself. Generation is a separate capability with an estimate before every paid request.</p>
        <p class="small">Video generation: ${state.videosConfigured ? "configured with fal.ai; the provider checks funding on submit" : "<strong>needs a fal.ai key on this studio</strong>"}.</p>
      </div>
    </section>
    <div class="spread"><h2 style="margin:0">Your studios</h2><button class="button" data-action="new-project">New studio</button></div>
    <div class="project-grid" style="margin-top:1rem">
      ${state.projects.map(projectCard).join("")}
      <button class="project-card new-project" data-action="new-project">
        <div class="cover"><span class="empty">+</span></div>
        <div class="body"><h3>Start something new</h3><span class="small">Name it, set a direction, upload later.</span></div>
      </button>
    </div>`;
}

function projectCard(project) {
  return `<button class="project-card" data-action="open-project" data-id="${esc(project.id)}">
    <div class="cover">${project.cover ? `<img src="${esc(project.cover)}" alt="" loading="lazy">` : `<span class="empty">${esc(project.name.slice(0, 1).toUpperCase())}</span>`}</div>
    <div class="body">
      <h3>${esc(project.name)}</h3>
      <span class="small">${project.counts.image} images · ${project.counts.video} videos</span>
      <span class="small">${money(project.budget.spentMicro)} of ${money(project.budget.allowanceMicro)} allocated this month (estimated)</span>
    </div>
  </button>`;
}

function createDraftRecovery() {
  const drafts = priorCreateDrafts.get(state.projectId) ?? [];
  if (!drafts.length) return "";
  return `<div class="card stack"><strong>Earlier Create drafts</strong><p class="small">These drafts are kept in this tab for this session. Reloading or closing the tab clears them.</p><div class="row"><label>Choose a draft<select id="prior-create-draft">${drafts.map((draft,index)=>`<option value="${index}">Draft ${index + 1} · ${esc(draft.kind ?? "create")}</option>`).join("")}</select></label><button type="button" class="secondary" data-action="restore-create-draft">Restore draft</button><button type="button" class="quiet" data-action="discard-create-drafts">Discard earlier drafts</button></div></div>`;
}

async function refreshUncertainHistory(projectId) {
  const serial = (historyReadSerial.get(projectId) ?? 0) + 1;
  historyReadSerial.set(projectId, serial);
  try {
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    if (state.projectId !== projectId || state.project?.id !== projectId || state.view !== "project" || state.tab !== "history" || historyReadSerial.get(projectId) !== serial) return false;
    mergeHistoryRead(state.project, data);
    historyReadErrors.delete(projectId);
    return true;
  } catch {
    if (state.projectId === projectId && historyReadSerial.get(projectId) === serial) historyReadErrors.add(projectId);
    return false;
  }
}

function projectView() {
  const project = state.project;
  if (!project || project.id !== state.projectId) return `<p class="notice">Loading…</p>`;
  return `
    <div class="spread">
      <div>
        <p class="eyebrow">${esc(project.visibility === "unlisted" ? "Unlisted studio" : "Private studio")}</p>
        <h1 style="margin-bottom:0.2rem">${esc(project.name)}</h1>
        <p class="small" style="margin:0">${esc(project.creativeDirection || "No creative direction saved yet.")}</p>
      </div>
      <div class="row">
        <div><a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Export project</a><p class="small">Includes private lyrics and subject history; not a restore.</p></div>
        <button class="button" data-action="tab" data-tab="create">Create</button>
      </div>
    </div>
    ${budgetStrip(project.budget)}
    <nav class="tabs" role="tablist" aria-label="Studio sections" data-project-tabs>
      ${PROJECT_TABS
        .map((tab) => `<button type="button" role="tab" id="project-tab-${tab}" data-action="tab" data-tab="${tab}" aria-selected="${state.tab === tab}" aria-controls="project-panel" tabindex="${state.tab === tab ? 0 : -1}">${tab[0].toUpperCase() + tab.slice(1)}${tab === "history" && project.generations.some(isPending) ? " ·" : ""}</button>`)
        .join("")}
    </nav>
    <section class="project-panel" id="project-panel" role="tabpanel" aria-labelledby="project-tab-${state.tab}" tabindex="0">
      ${state.tab === "library" ? (creativeHome ? '<div id="creative-media"></div>' : libraryView()) : ""}
      ${state.tab === "create" ? `${createDraftRecovery()}<div data-create-project="${esc(project.id)}">${creativeHome ? '<div id="creative-media"></div>' : createView()}</div>` : ""}
      ${state.tab === "assemble" ? (creativeHome ? '<div id="creative-media"></div>' : composeView()) : ""}
      ${state.tab === "history" ? `${uncertainRestyleProjects.has(project.id) ? `<div class="notice" role="status">${historyReadErrors.has(project.id) ? "Could not refresh History. The list may be out of date." : "A recent request may take time to appear. Check History again before starting another."} <button class="secondary" data-action="refresh-uncertain-history">Refresh History</button></div>` : ""}${creativeHome ? '<div id="creative-media"></div>' : historyView()}` : ""}
      ${state.tab === "publish" ? (creativeHome ? '<div id="creative-media"></div>' : publishView()) : ""}
      ${state.tab === "review" ? reviewView() : ""}
      ${state.tab === "settings" ? (creativeHome ? '<div id="creative-media"></div>' : settingsView()) : ""}
    </section>`;
}

function budgetStrip(budget) {
  const used = budget.spentMicro + budget.reservedMicro;
  const percent = budget.allowanceMicro > 0 ? Math.min(100, Math.round((used / budget.allowanceMicro) * 100)) : 0;
  return `<div class="card" data-budget-strip style="margin:1rem 0;padding:0.8rem 1rem">
    <div class="spread" style="margin-bottom:0.4rem">
      <span class="small"><strong>${money(budget.spentMicro)}</strong> allocated (estimated) · ${money(budget.reservedMicro)} reserved · ${money(budget.allowanceMicro)} monthly allowance</span>
      <span class="small">${esc(budget.period)} · ${percent}%</span>
    </div>
    <div class="meter" role="img" aria-label="${money(used)} of ${money(budget.allowanceMicro)} allocated or reserved (estimated)"><span style="width:${percent}%"></span></div>
    <p class="small" style="margin:0.4rem 0 0">Allocations are estimates; provider invoices are not linked. Unknown outcomes keep their reservation until the provider is reconciled.</p>
  </div>`;
}

function isPending(generation) {
  return ["admitted", "submitting", "submitted", "running", "provider_complete", "saving", "cancel_requested"].includes(generation.status);
}

function visibleAssets() {
  const query = state.query.trim().toLowerCase();
  return state.project.assets.filter((asset) => {
    if (state.filter !== "all" && asset.kind !== state.filter) return false;
    if (!query) return true;
    return `${asset.title} ${asset.caption} ${asset.mime} ${asset.source}`.toLowerCase().includes(query);
  });
}

function libraryView() {
  const assets = visibleAssets();
  const total = state.project.assets.length;
  return `
    <div class="spread">
      <div class="row">
        <label class="sr-only" for="search">Search media</label>
        <input id="search" type="search" placeholder="Search titles, captions, types…" value="${esc(state.query)}" data-input="search" style="min-width:min(320px,60vw)">
        <div class="row" role="group" aria-label="Filter">
          ${["all", "image", "video", "audio"].map((value) => `<button class="quiet" data-action="filter" data-filter="${value}" aria-pressed="${state.filter === value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join("")}
        </div>
      </div>
      <label class="button secondary" for="upload" style="cursor:pointer">Upload media<input id="upload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" hidden data-input="upload"></label>
    </div>
    ${state.woodhouseShare && state.session?.actions.includes("edit") ? `
      <details class="share-import" data-project-id="${esc(state.projectId)}">
        <summary>Import from Woodhouse Share</summary>
        <form class="stack" data-form="woodhouse-import">
          <p class="small">Find the asset ID in <a href="https://composer.loftwah.com/share" target="_blank" rel="noopener">Share artwork</a>. The original and source credit are saved to this project.</p>
          <label>Share asset ID <input name="assetId" required maxlength="128" pattern="[a-z0-9][a-z0-9\\-]{0,127}"></label>
          <label><span><input name="reuseConfirmed" type="checkbox" required> I have permission to reuse this original.</span></label>
          <div><button class="button secondary" type="submit">Import original</button></div>
        </form>
      </details>` : ""}
    <div class="dropzone" id="dropzone" style="margin:1rem 0">
      <p style="margin:0"><strong>Drop files here</strong> or use Upload media.</p>
      <p class="small" style="margin:0.3rem 0 0">JPEG, PNG, WebP, MP4, WebM, WAV, MP3 or M4A. Images and audio up to 32 MB, video up to 64 MB.</p>
    </div>
    ${total === 0 ? `<div class="card"><h2>Nothing here yet.</h2><p>Upload a photo or a clip to start the library. You can generate new stills once uploads work.</p><button class="button" data-action="tab" data-tab="create">Make the first image</button></div>` : ""}
    ${total > 0 && assets.length === 0 ? `<p class="notice">No media matches that filter. <button class="quiet" data-action="filter" data-filter="all">Show all</button></p>` : ""}
    <div class="asset-grid">
      ${assets.map(assetCard).join("")}
    </div>`;
}

function assetCard(asset) {
  const media =
    asset.kind === "video"
      ? `<span class="video-card" aria-hidden="true"><span class="play-mark"></span><span class="video-time">${asset.durationMs ? (asset.durationMs / 1000).toFixed(1) + "s" : "video"}</span></span>`
      : asset.kind === "audio"
        ? `<span class="audio-card"><canvas width="240" height="64" data-waveform="${esc(asset.file)}" aria-hidden="true"></canvas><span class="audio-time">${asset.durationMs ? (asset.durationMs / 1000).toFixed(1) + "s" : "audio"}</span></span>`
        : `<img src="/api/studio/assets/${encodeURIComponent(asset.id)}/preview" alt="${esc(asset.title)}" loading="lazy" decoding="async"${asset.width && asset.height ? ` width="${Number(asset.width)}" height="${Number(asset.height)}"` : ""} data-preview-fallback="${esc(asset.file)}">`;
  return `<article class="asset">
    <button class="thumb" data-action="open-asset" data-id="${esc(asset.id)}" aria-label="Open ${esc(asset.title)}">${media}<span class="badge">${esc(asset.kind)}</span></button>
    <div class="meta">
      <strong title="${esc(asset.title)}">${esc(asset.title)}</strong>
      <small>${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}${bytesLabel(asset.bytes)} · ${esc(asset.source)}</small>
    </div>
    <button data-action="open-asset" data-id="${esc(asset.id)}">Open</button>
  </article>`;
}

function reviewStatusLabel(room) {
  if (room.status === "revoked") return "Link revoked";
  if (room.status === "expired") return "Link expired";
  if (room.decision === "approved") return "Approved";
  if (room.decision === "changes_requested") return "Changes requested";
  return "Awaiting review";
}

function reviewStatusClass(room) {
  if (room.status !== "open") return room.status;
  if (room.decision === "approved") return "approved";
  if (room.decision === "changes_requested") return "changes";
  return "open";
}

function reviewWhen(timestamp) {
  return timestamp ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)) : "";
}

function reviewTimecode(ms) {
  const total = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function reviewFeedbackItems(room) {
  if (!room.feedback?.length) return '<p class="small">No feedback on this version yet.</p>';
  return `<ul class="review-feedback-owner">${room.feedback.map((item) => `
    <li${item.resolvedAt ? ' class="resolved"' : ""}>
      <div class="spread"><strong>${esc(item.author)}</strong><span class="small">${esc(reviewWhen(item.createdAt))}${item.resolvedAt ? " · resolved" : ""}</span></div>
      ${Number.isFinite(item.atMs)
        ? `<button type="button" class="review-timecode" data-action="review-seek" data-room="${esc(room.id)}" data-ms="${Number(item.atMs)}" aria-label="Play this version from ${esc(reviewTimecode(item.atMs))}">${esc(reviewTimecode(item.atMs))}${Number.isFinite(item.endMs) ? `–${esc(reviewTimecode(item.endMs))}` : ""}</button>`
        : item.region
          ? `<span class="review-point">Point ${Math.round(Number(item.region.x) * 100)}% across, ${Math.round(Number(item.region.y) * 100)}% down</span>`
          : ""}
      <p>${esc(item.body)}</p>
      <button type="button" class="quiet" data-action="review-resolve" data-room="${esc(room.id)}" data-id="${esc(item.id)}" data-resolved="${item.resolvedAt ? "1" : "0"}">${item.resolvedAt ? "Reopen note" : "Mark resolved"}</button>
    </li>`).join("")}</ul>`;
}

function reviewRoomCard(room) {
  const link = state.reviewLinks.get(room.id);
  const dimensions = room.width && room.height ? `${room.width} × ${room.height}` : "";
  const duration = room.durationMs ? `${(room.durationMs / 1000).toFixed(1)}s` : "";
  const meta = [room.kind, dimensions, duration, room.sourceKind === "storyboard_render" ? (room.compositionRevision ? `storyboard revision ${reviewWhen(room.compositionRevision)}` : "storyboard render") : "saved asset", room.decision === "approved" ? "Reviewer approved" : room.decision === "changes_requested" ? "Changes requested" : "Awaiting review", `SHA-256 ${room.sha256.slice(0, 12)}…`, `Expires ${reviewWhen(room.expiresAt)}`].filter(Boolean).join(" · ");
  const preview = room.kind === "video"
    ? `<video controls playsinline preload="metadata" data-review-video="${esc(room.id)}" src="/api/assets/${encodeURIComponent(room.assetId)}/file" aria-label="Saved version: ${esc(room.versionLabel)}"></video>`
    : `<img src="/api/assets/${encodeURIComponent(room.assetId)}/file" alt="Saved version: ${esc(room.versionLabel)}" loading="lazy">`;
  return `<article class="review-room-card" data-review-room="${esc(room.id)}">
    <div class="review-version-head"><div><h3>${esc(room.versionLabel)}</h3><p class="small" style="margin:0">${esc(room.assetTitle)}</p></div><span class="review-badge ${reviewStatusClass(room)}">${esc(reviewStatusLabel(room))}</span></div>
    <p class="review-version-meta">${esc(meta)}</p>
    ${room.status === "open" ? `<label class="review-compare-choice small"><input type="checkbox" data-review-compare value="${esc(room.id)}" aria-label="Select ${esc(room.versionLabel)} for comparison"> Select for comparison</label>` : ""}
    ${link ? `<div class="review-link"><label class="sr-only" for="review-link-${esc(room.id)}">Private review link</label><input id="review-link-${esc(room.id)}" readonly value="${esc(link)}"><button type="button" class="button secondary" data-action="review-copy-link" data-id="${esc(room.id)}">Copy link</button><span class="small">Shown once. Replacing it invalidates this one.</span></div>` : `<p class="small">The private link is shown only when created. Use “Replace link” to issue a new one.</p>`}
    <div class="review-room-actions">
      ${room.status === "open" ? `<button type="button" class="secondary" data-action="review-rotate" data-id="${esc(room.id)}">Replace link</button>` : ""}
      ${room.status === "open" ? `<button type="button" class="quiet" data-action="review-revoke" data-id="${esc(room.id)}">Revoke link</button>` : ""}
      <a class="quiet" href="#/a/${encodeURIComponent(state.projectId)}/${encodeURIComponent(room.assetId)}">Open version in studio</a>
    </div>
    <details class="asset-technical"><summary>Preview version and ${room.feedbackCount} note${room.feedbackCount === 1 ? "" : "s"}</summary>${preview}${reviewFeedbackItems(room)}</details>
    ${room.decisionNote ? `<p class="small">Decision note: ${esc(room.decisionNote)}</p>` : ""}
  </article>`;
}

function reviewCompareView() {
  const comparison = state.reviewCompare;
  if (!comparison) return "";
  const side = (room, label) => {
    const media = room.kind === "video"
      ? `<video controls playsinline preload="metadata" src="/api/assets/${encodeURIComponent(room.assetId)}/file" aria-label="${label}: ${esc(room.versionLabel)}"></video>`
      : `<img src="/api/assets/${encodeURIComponent(room.assetId)}/file" alt="${label}: ${esc(room.versionLabel)}">`;
    return `<figure><figcaption><strong>${esc(label)} · ${esc(room.versionLabel)}</strong><span class="review-badge ${reviewStatusClass(room)}">${esc(reviewStatusLabel(room))}</span><br>${esc(room.kind)} · SHA-256 ${esc(room.sha256.slice(0, 12))}… · ${room.feedbackCount} note${room.feedbackCount === 1 ? "" : "s"}</figcaption>${media}<p class="small">${room.decisionNote ? esc(room.decisionNote) : "No decision note."}</p></figure>`;
  };
  return `<section class="review-compare" aria-labelledby="review-compare-title">
    <div class="spread"><div><h2 id="review-compare-title">Saved versions side by side</h2><p class="small">Both versions are read from this project's saved assets. A decision on one does not carry to the other.</p></div><button type="button" class="quiet" data-action="review-compare-clear">Close comparison</button></div>
    <div class="review-compare-grid">${side(comparison.left, "Version A")}${side(comparison.right, "Version B")}</div>
  </section>`;
}

function reviewView() {
  const canEdit = state.session?.actions.includes("edit") ?? false;
  const assets = (state.project?.assets ?? []).filter((asset) => asset.kind === "image" || asset.kind === "video");
  if (!state.reviewRooms) return '<p class="notice">Loading review rooms…</p>';
  const groups = new Map();
  for (const room of state.reviewRooms) {
    const key = `${room.assetId}:${room.sha256}`;
    const group = groups.get(key) ?? { title: room.assetTitle, sha256: room.sha256, rooms: [] };
    group.rooms.push(room);
    groups.set(key, group);
  }
  return `<div class="review-owner">
    <section class="review-create" aria-labelledby="review-create-title">
      <h2 id="review-create-title">Create a private review link</h2>
      <p class="small">A room pins one exact saved image or film at its SHA-256. The reviewer sees only that version and the feedback on it. Nothing is copied, generated or published.</p>
      ${canEdit ? `<form data-form="review-create">
        <label>Saved version
          <select name="assetId" required>
            <option value="">Choose an image or film in this studio</option>
            ${assets.map((asset) => `<option value="${esc(asset.id)}" ${state.reviewPresetAssetId === asset.id ? "selected" : ""}>${esc(asset.title)} · ${esc(asset.kind)}${asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""}</option>`).join("")}
          </select>
        </label>
        <label>Version label <input name="versionLabel" maxlength="80" placeholder="Defaults to the saved asset title"></label>
        <label>Link expires
          <select name="expiresInHours">
            <option value="24">In 1 day</option>
            <option value="72">In 3 days</option>
            <option value="168" selected>In 7 days</option>
            <option value="336">In 14 days</option>
            <option value="720">In 30 days</option>
          </select>
        </label>
        <div><button type="submit" class="button" ${assets.length ? "" : "disabled"}>Create private review link</button>${assets.length ? "" : '<p class="small">Upload or save an image or film first.</p>'}</div>
      </form>` : '<p class="notice">Your studio session can read reviews but does not include edit permission, so it cannot create or revoke links.</p>'}
    </section>
    ${reviewCompareView()}
    <section aria-labelledby="review-inbox-title">
      <div class="spread"><div><h2 id="review-inbox-title">Review inbox</h2><p class="small">Feedback is grouped by the exact saved version. Outside comments are untrusted text; Studio never treats them as instructions.</p></div><button type="button" class="secondary" data-action="review-compare-run" ${state.reviewRooms.filter((room) => room.status === "open").length < 2 ? "disabled" : ""}>Compare two versions</button></div>
      ${groups.size === 0 ? '<div class="card"><h2>No review rooms yet.</h2><p>Create one from a saved still or film to collect focused feedback without exporting the media.</p></div>' : ""}
      ${[...groups.values()].map((group) => `<section class="review-version" aria-label="Version ${esc(group.title)}">
        <div class="review-version-head"><div><h2>${esc(group.title)}</h2><p class="small review-hash" style="margin:0">SHA-256 ${esc(group.sha256)}</p></div><span class="small">${group.rooms.length} review room${group.rooms.length === 1 ? "" : "s"}</span></div>
        ${group.rooms.map(reviewRoomCard).join("")}
      </section>`).join("")}
    </section>
    <p class="small">Reviewer approval is feedback, not permission to publish, schedule, spend, delete or promote a revision. Publish the intended final version separately from the asset. When you do publish a version that was approved, the publication records that approval and the exact hash it applies to. A new render never inherits an earlier approval.</p>
  </div>`;
}

function createView() {
  const create = state.create;
  const recipes = state.project.recipes.filter((recipe) => recipe.kind === create.kind);
  const models = state.models.filter((model) => model.kind === create.kind && (model.references > 0 ? true : true));
  const model = modelById(create.model);
  const recipe = recipeBySlug(create.recipeSlug);
  const images = state.project.assets.filter((asset) => asset.kind === "image");
  const selectedReference = images.find((asset) => asset.id === create.referenceAssetId);
  const needsReference = (model?.references ?? 0) > 0;
  const needsMask = Boolean(model?.mask);
  const maskAsset = create.maskAssetId ? state.project.assets.find((asset) => asset.id === create.maskAssetId) : null;
  const promptRequired = model?.promptRequired !== false;
  const fundingBlocked = state.project.generations.some((generation) => generation.error?.code === "provider_funding");
  const permissionBlocked = state.project.generations.some((generation) => generation.error?.code === "provider_permission" || generation.error?.code === "provider_auth");
  const executionFailed = state.project.generations.some((generation) => generation.error?.code === "provider_execution");
  return `
    ${fundingBlocked ? `<p class="notice warn">The studio's video provider refused the last request for funding. Image work and the library still work; add credit to the studio's own provider account before starting another clip.</p>` : ""}
    ${permissionBlocked ? `<p class="notice warn">The provider refused this account access to a request or result. Nothing was regenerated. Fix the studio's provider key or endpoint permission, then use Reconcile on the job; the saved request id is kept.</p>` : ""}
    ${executionFailed ? `<p class="notice warn">The last render failed. The provider's message is saved with the job. A new render is a separate request and will not be sent automatically.</p>` : ""}
    <div class="grid two">
      <div class="card">
        <p class="eyebrow">1 · Choose a starting point</p>
        <div class="row" style="margin-bottom:0.8rem" role="group" aria-label="Media kind">
          <button class="secondary" data-action="kind" data-kind="image" aria-pressed="${create.kind === "image"}">Create image</button>
          <button class="secondary" data-action="kind" data-kind="video" aria-pressed="${create.kind === "video"}">Animate a still</button>
          <button class="secondary" data-action="kind" data-kind="audio" aria-pressed="${create.kind === "audio"}">Make sound</button>
        </div>
        <div class="recipe-grid">
          ${recipes.map((item) => `<button class="recipe" data-action="recipe" data-slug="${esc(item.slug)}" aria-pressed="${create.recipeSlug === item.slug}"><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span><span class="small">${esc(item.kind === "video" ? "Image → video" : "Still image")}</span></button>`).join("")}
        </div>
        <div class="row" style="margin-top:0.6rem" role="group" aria-label="Still edits">
          <button class="secondary" data-action="edit-model" data-model="studio-fill" aria-pressed="${create.model === "studio-fill"}">Masked fill</button>
          <button class="secondary" data-action="edit-model" data-model="studio-cutout" aria-pressed="${create.model === "studio-cutout"}">Remove background</button>
          <button class="secondary" data-action="edit-model" data-model="studio-upscale" aria-pressed="${create.model === "studio-upscale"}">Upscale ×2</button>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
        <div class="stack">
          <label>Model
            <select data-input="model">${model ? "" : '<option value="" selected disabled>No compatible model</option>'}${models.map((item) => `<option value="${esc(item.id)}" ${item.id === create.model ? "selected" : ""}>${esc(item.label)} — ${esc(item.provider)}</option>`).join("")}</select>
          </label>
          <p class="small" style="margin:0">${esc(model?.description ?? "")}<br>${esc(model?.costBasis ?? "")}</p>
        </div>
      </div>
      <div class="card">
        <p class="eyebrow">2 · Direct the work</p>
        ${recipe ? recipeControls(recipe, create) : ""}
        <label style="margin-top:0.7rem">${model?.kind === "audio" ? (model.audio?.mode === "speech" ? "Narration script" : model.audio?.mode === "effect" ? "Describe the effect" : "Describe the sound") : model?.edit ? (promptRequired ? "What belongs in the masked area?" : "Optional guidance") : "Prompt"}
          <textarea data-input="prompt" maxlength="1800" rows="6" ${promptRequired ? "" : "placeholder=\"Optional\""}>${esc(create.prompt)}</textarea>
        </label>
        ${model?.kind === "audio" ? `<p class="small" style="margin:0.3rem 0 0">${model.audio?.mode === "speech" ? "Use words you wrote or have the rights to. Narration is generated once and saved as audio you can publish or assemble." : model.audio?.mode === "effect" ? "One short cue, saved separately so it can sit beside music and narration in the mix." : "Instrumental music or atmosphere. The clip is saved as an audio asset with its duration and provenance."}</p>` : ""}
        ${model?.kind === "image" && !model.edit ? `<label style="margin-top:0.6rem">Frame
          <select data-input="aspect">${model.aspects.map((aspect) => `<option value="${esc(aspect)}" ${create.aspect === aspect ? "selected" : ""}>${esc(aspect === "square" && model.references > 0 ? "Square variation" : aspect)}</option>`).join("")}</select>
        </label>` : ""}
        ${model?.edit ? `<p class="small" style="margin:0.6rem 0 0"><strong>${esc(model.edit === "fill" ? "Masked fill or outpaint" : model.edit === "cutout" ? "Background removal" : "Two-times upscale")}</strong> · the result is saved as a separate variant; the source stays untouched.</p>` : ""}
        ${model?.kind === "video" ? `<label style="margin-top:0.6rem">Clip length
          <select data-input="duration">${model.durations.map((seconds) => `<option value="${seconds}" ${Number(create.durationSeconds) === seconds ? "selected" : ""}>${seconds} seconds</option>`).join("")}</select>
        </label>` : ""}
        ${model?.kind === "audio" && (model.audio?.mode === "music" || model.audio?.mode === "effect") ? `<label style="margin-top:0.6rem">Length
          <select data-input="audioDuration">${[10, 15, 20, 25, 30].filter((seconds) => seconds >= (model.audio.minSeconds ?? 1) && seconds <= (model.audio.maxSeconds ?? 30)).map((seconds) => `<option value="${seconds}" ${Number(create.durationSeconds) === seconds ? "selected" : ""}>${seconds} seconds</option>`).join("")}</select>
        </label>` : ""}
        ${needsReference ? `<div style="margin-top:0.8rem">
          <p class="small" style="margin-bottom:0.4rem"><strong>Reference still</strong> ${selectedReference ? `· ${esc(selectedReference.title)}` : "· none selected"}</p>
          <div class="row">${images.slice(0, 8).map((asset) => `<button class="quiet" data-action="pick-reference" data-id="${esc(asset.id)}" aria-pressed="${create.referenceAssetId === asset.id}" title="${esc(asset.title)}" style="padding:0;border:${create.referenceAssetId === asset.id ? "2px solid var(--accent)" : "2px solid transparent"};border-radius:8px;width:64px;height:64px;overflow:hidden"><img src="${esc(asset.file)}" alt="${esc(asset.title)}" style="width:100%;height:100%;object-fit:cover"></button>`).join("") || `<span class="small">Upload a still first.</span>`}</div>
        </div>` : ""}
        ${needsMask && selectedReference ? `<div class="mask-editor" style="margin-top:1rem">
          <div class="spread"><p class="small" style="margin:0"><strong>Mask</strong> ${maskAsset ? `· ${esc(maskAsset.title)}` : "· paint the area to change"}</p><span class="small">White = replace</span></div>
          <canvas id="mask-canvas" width="640" height="440" aria-label="Paint the area to change"></canvas>
          <div class="row">
            <label class="small" style="flex:1">Brush <input id="mask-brush" type="range" min="8" max="140" value="48"></label>
            <button class="quiet" type="button" data-action="mask-clear">Clear</button>
            <button class="secondary" type="button" data-action="mask-save" data-id="${esc(selectedReference.id)}">${maskAsset ? "Save new mask" : "Save mask"}</button>
          </div>
          <div class="row">
            <button class="quiet" type="button" data-action="outpaint" data-id="${esc(selectedReference.id)}">Extend the frame instead</button>
            ${maskAsset ? `<span class="small">Mask saved · ${esc(maskAsset.width)} × ${esc(maskAsset.height)}</span>` : ""}
          </div>
          <p class="small" style="margin:0">The studio scales the source and mask together before upload, so their dimensions always match. The original still remains in the library.</p>
        </div>` : ""}
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      ${recipe && !recipeModelCompatible(recipe, model) ? '<p class="notice warn">This recipe needs a model that accepts a reference still. Choose a compatible model or another recipe.</p>' : ""}
      <div class="spread">
        <div>
          <p class="eyebrow" style="margin-bottom:0.2rem">3 · Review and submit</p>
          <p class="small" style="margin:0">${esc(model?.label ?? "No model")} · ${create.kind === "video" ? `${esc(String(create.durationSeconds))}s` : create.kind === "audio" ? (model?.audio?.mode === "speech" ? "narration" : `${esc(String(create.durationSeconds))}s`) : esc(create.aspect)} · estimated <strong>${money(estimate())}</strong></p>
        </div>
        <button class="button" data-action="submit-create" ${!recipeModelCompatible(recipe, model) || (needsReference && !create.referenceAssetId) || (needsMask && !create.maskAssetId) || (promptRequired && !create.prompt.trim()) ? "disabled" : ""}>${create.kind === "video" ? "Animate this still" : create.kind === "audio" ? "Generate sound" : model?.edit === "fill" ? "Apply fill" : model?.edit === "cutout" ? "Remove background" : model?.edit === "upscale" ? "Upscale still" : "Create image"} · ${money(estimate())}</button>
      </div>
      <p class="small" style="margin:0.6rem 0 0">Each submit starts one new request. A repeat with the same request id is replayed without another submission. Video runs asynchronously; you can leave this page and come back.</p>
    </div>`;
}

function recipeControls(recipe, create) {
  return recipe.controls
    .filter((control) => control.type !== "reference" && control.application !== "provider-native")
    .map((control) => {
      const value = create.controls[control.key] ?? control.default ?? "";
      if (control.type === "select")
        return `<label>${esc(control.label)}
          <select data-input="control" data-key="${esc(control.key)}">${control.options.map((option) => `<option value="${esc(option)}" ${String(value) === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>
        </label>`;
      if (control.type === "hidden") return "";
      return `<label>${esc(control.label)}
        <input data-input="control" data-key="${esc(control.key)}" value="${esc(value)}" maxlength="200">
      </label>`;
    })
    .join("");
}

function composeView() {
  const project = state.project;
  const compose = state.compose;
  // Assembled results are exports, not takes: keep them out of the shot picker
  // so a cut is never built from another cut by accident.
  const clips = project.assets.filter((asset) => asset.kind === "video" && asset.source !== "assembled");
  const audio = project.assets.filter((asset) => asset.kind === "audio");
  const chosen = compose.shotIds.map((shotId) => clips.find((asset) => asset.id === shotId)).filter(Boolean);
  const totalMs = draftDuration();
  const compositions = project.compositions ?? [];
  const overLimit = totalMs > 60000;
  return `
    <div class="spread"><h2 style="margin:0">Storyboard and assembly</h2><span class="small">${chosen.length} shot${chosen.length === 1 ? "" : "s"} · ${(totalMs / 1000).toFixed(1)}s assembled</span></div>
    <p class="small">Order saved clips, add one audio bed, then render a bounded export. The composition stays editable; rendering again creates a new result and keeps the earlier one.</p>
    <div class="grid two" style="margin-top:1rem">
      <div class="card stack">
        <p class="eyebrow">The cut</p>
        ${compose.editingId ? `<p class="notice calm" style="margin:0">Editing a saved storyboard. Saving updates it in place and keeps every earlier render.</p>` : ""}
        <label>Title<input data-compose="title" maxlength="80" value="${esc(compose.title)}" placeholder="Field notes, cut one"></label>
        <div>
          <p class="small" style="margin:0 0 0.4rem"><strong>Shots in order</strong></p>
          ${chosen.length === 0 ? `<p class="small" style="margin:0">Add at least two saved clips.</p>` : ""}
          <ol class="shot-list">
            ${chosen.map((asset, index) => `<li>
              <span class="shot-index">${index + 1}</span>
              <span class="shot-title">${esc(asset.title)}<br><span class="small">${compose.shotTrims[asset.id] ? `Using ${compose.shotTrims[asset.id].trimStartMs}–${compose.shotTrims[asset.id].trimEndMs} ms of original` : `${((asset.durationMs || 0) / 1000).toFixed(1)}s`} · ${asset.width}×${asset.height}</span></span>
              <span class="row">
                <button type="button" class="secondary" data-action="compose-trim" data-id="${esc(asset.id)}" aria-label="Trim ${esc(asset.title)}" ${!asset.durationMs || !state.session?.actions.includes("edit") ? "disabled" : ""}>Trim</button>
                <button class="quiet" data-action="compose-up" data-id="${esc(asset.id)}" aria-label="Move ${esc(asset.title)} earlier" ${index === 0 ? "disabled" : ""}>↑</button>
                <button class="quiet" data-action="compose-down" data-id="${esc(asset.id)}" aria-label="Move ${esc(asset.title)} later" ${index === chosen.length - 1 ? "disabled" : ""}>↓</button>
                <button class="quiet" data-action="compose-remove" data-id="${esc(asset.id)}">Remove</button>
              </span>
            </li>`).join("")}
          </ol>
        </div>
        <div class="mixer">
          <div class="spread"><p class="small" style="margin:0"><strong>Soundtrack</strong> · up to four saved tracks</p><span class="small">${compose.audioAssetId ? "mixed bed saved" : "not mixed yet"}</span></div>
          ${compose.audioTracks.length === 0 ? `<p class="small" style="margin:0.4rem 0">Add music, narration or an effect. Trim, gain and fades are applied once in the browser and saved as a new WAV. The original tracks and settings remain in the storyboard.</p>` : ""}
          ${compose.audioTracks.map((track, index) => {
            const asset = audio.find((item) => item.id === track.assetId);
            return `<div class="mix-row" data-mix-row="${index}">
              <div class="spread">
                <strong class="small">${index + 1}. ${esc(asset?.title ?? "Missing track")}</strong>
                <button class="quiet" type="button" data-action="mix-remove" data-index="${index}">Remove</button>
              </div>
              <div class="mix-fields">
                <label>Role<select data-mix="role" data-index="${index}">${["music", "voice", "effect"].map((role) => `<option value="${role}" ${track.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></label>
                <label>Start (ms)<input type="number" min="0" step="100" data-mix="startMs" data-index="${index}" value="${Number(track.startMs) || 0}"></label>
                <label>Trim start (ms)<input type="number" min="0" step="100" data-mix="trimStartMs" data-index="${index}" value="${Number(track.trimStartMs) || 0}"></label>
                <label>Trim end (ms)<input type="number" min="0" step="100" data-mix="trimEndMs" data-index="${index}" value="${Number(track.trimEndMs) || asset?.durationMs || 0}"></label>
                <label>Gain (dB)<input type="range" min="-24" max="12" step="1" data-mix="gainDb" data-index="${index}" value="${Number(track.gainDb) || 0}"><span class="small">${Number(track.gainDb) || 0} dB</span></label>
                <label>Fade in (ms)<input type="number" min="0" max="3000" step="100" data-mix="fadeInMs" data-index="${index}" value="${Number(track.fadeInMs) || 0}"></label>
                <label>Fade out (ms)<input type="number" min="0" max="3000" step="100" data-mix="fadeOutMs" data-index="${index}" value="${Number(track.fadeOutMs) || 0}"></label>
              </div>
            </div>`;
          }).join("")}
          <p class="small">Preview is temporary and stays in your browser. Mix soundtrack saves a new WAV.</p>
          <div class="row" style="margin-top:0.6rem">
            <select id="mix-add" aria-label="Add an audio track"><option value="">Choose a saved audio asset</option>${audio.map((asset) => `<option value="${esc(asset.id)}">${esc(asset.title)} · ${asset.durationMs ? (asset.durationMs / 1000).toFixed(0) + "s" : "audio"}</option>`).join("")}</select>
            <button class="secondary" type="button" data-action="mix-add" ${compose.audioTracks.length >= 4 ? "disabled" : ""}>Add track</button>
            <button class="secondary" type="button" data-action="mix-preview" ${compose.audioTracks.length === 0 ? "disabled" : ""}>Preview mix</button><audio id="mix-preview-player" controls hidden aria-label="Unsaved soundtrack preview"></audio>
            <button class="button" type="button" data-action="mix-render" ${compose.audioTracks.length === 0 ? "disabled" : ""}>Mix soundtrack</button>
          </div>
          ${compose.audioAssetId ? `<p class="small" style="margin:0.4rem 0 0">Mixed bed: ${esc(audio.find((item) => item.id === compose.audioAssetId)?.title ?? compose.audioAssetId)}. Rendering uses this saved WAV; the individual tracks stay linked to the composition.</p><button class="quiet" type="button" data-action="mix-clear">Remove mixed bed</button>${staleMixedBed() ? `<p class="notice warn">The mixed bed does not match the shot durations. Mix again or remove the bed before saving.</p>` : ""}` : ""}
        </div>
        ${audio.length === 0 ? `<p class="small" style="margin:0">Upload or generate sound in Create to add music, narration or an effect.</p>` : ""}
        <div class="row">
          <button class="button" data-action="compose-save" ${chosen.length < 2 || overLimit || staleMixedBed() ? "disabled" : ""}>${compose.editingId ? "Save changes" : "Save storyboard"}</button>
          ${compose.editingId ? `<button class="quiet" data-action="compose-new">Start a new storyboard</button>` : ""}
        </div>
        ${overLimit ? `<p class="small" style="margin:0;color:var(--bad)">Keep the cut under 60 seconds to stay inside the bounded render.</p>` : ""}
      </div>
      <div class="card stack">
        <p class="eyebrow">Saved clips</p>
        ${clips.length === 0 ? `<p class="small" style="margin:0">No clips yet. Animate a still or upload an MP4 first.</p>` : ""}
        <ul class="clip-picker">
          ${clips.map((asset, index) => {
            const used = compose.shotIds.includes(asset.id);
            return `<li><div class="clip-picker-info"><span>Clip ${index + 1} · ${esc(asset.title)} <span class="small">${((asset.durationMs || 0) / 1000).toFixed(1)}s</span></span><details class="clip-picker-preview" name="clip-picker-preview"><summary>Preview clip ${index + 1}</summary><video src="${esc(asset.file)}" controls playsinline preload="none" aria-label="Preview clip ${index + 1}: ${esc(asset.title)}"></video></details></div>
              <button class="${used ? "quiet" : "secondary"}" data-action="${used ? "compose-remove" : "compose-add"}" data-id="${esc(asset.id)}">${used ? "Added" : "Add shot"}</button></li>`;
          }).join("")}
        </ul>
      </div>
    </div>
    <h3 style="margin-top:1.6rem">Saved storyboards</h3>
    ${compositions.length === 0 ? `<div class="card"><p style="margin:0">No storyboard saved yet.</p></div>` : ""}
    <div class="stack">
      ${compositions.map((composition) => compositionCard(composition)).join("")}
    </div>`;
}

function compositionCard(composition) {
  const renders = state.project.generations.filter((generation) => generation.compositionId === composition.id);
  const master = renders.filter((generation) => generation.variant === "assembly" && generation.status === "saved" && generation.assetId).at(-1);
  const social = renders.filter((generation) => generation.variant === "social");
  const pending = renders.some(isPending);
  const hasTrims = composition.shots.some((shot) => shot.trimStartMs !== undefined || shot.trimEndMs !== undefined);
  return `<article class="job">
    <header>
      <div class="row"><strong>${esc(composition.title)}</strong><span class="small">${composition.shots.length} shots · ${(composition.totalMs / 1000).toFixed(1)}s${composition.audioAssetId ? " · mixed bed" : ""}${composition.audioTracks?.length ? ` · ${composition.audioTracks.length} source tracks` : ""}</span></div>
      <span class="small">${dateLabel(composition.createdAt)}</span>
    </header>
    ${changedSinceRender(composition, renders) ? `<p class="small" style="margin:0"><strong>Changed since the last render.</strong> Render again to include the latest edits; earlier results are kept.</p>` : ""}
    <details><summary>Review saved shot timings</summary><ol>${composition.shots.map((shot) => { const asset = state.project.assets.find((item) => item.id === shot.assetId); const range = shotRange(shot, asset); return `<li>${esc(asset?.title ?? "Unavailable clip")}: ${range ? `${range.start}–${range.end} ms of ${asset.durationMs} ms` : "unavailable or invalid range"}</li>`; }).join("")}</ol></details>
    <div class="row">
      <button class="button secondary" data-action="compose-render" data-variant="assembly" data-id="${esc(composition.id)}" ${pending || hasTrims ? "disabled" : ""}>Render master · ${money(renderEstimate("assembly"))}</button>
      <button class="button secondary" data-action="compose-render" data-variant="social" data-id="${esc(composition.id)}" ${pending || hasTrims ? "disabled" : ""} title="The selected order, composed into a 720 × 1280 (9:16) master with the saved sound, after a one-second vertical slate">Make 9:16 cut · ${money(renderEstimate("social"))}</button>
      <button class="quiet" data-action="compose-load" data-id="${esc(composition.id)}">Edit shots</button>
    </div>
    ${hasTrims ? `<p class="small">Paid provider rendering cannot preserve these trims. The local MP4 renderer requires the current Studio interface.</p>` : ""}
    <div class="render-list">
      ${renders.length === 0 ? `<p class="small" style="margin:0">No render yet. Rendering copies the participating clips and audio to the render provider for this job only.</p>` : ""}
      ${renders.map((generation) => {
        const asset = state.project.assets.find((item) => item.id === generation.assetId);
        return `<div class="render-row" data-job="${esc(generation.id)}">
          <div class="row">${statusChip(generation.status)}<strong>${esc(generation.variant === "social" ? "9:16 cut" : "Assembled master")}</strong><span class="small">Estimated allocation: ${money(generation.costAllocatedMicro ?? generation.costEstimateMicro)}</span></div>
          ${asset ? `<video src="${esc(asset.file)}" controls playsinline preload="metadata"></video><p class="small" style="margin:0">${asset.width} × ${asset.height} · ${(asset.durationMs / 1000).toFixed(2)}s · ${bytesLabel(asset.bytes)} · assembled from ${esc(String(composition.shots.length))} shots</p>` : `<p class="small" style="margin:0">${generation.error ? esc(generation.error.message) : "Provider is rendering."}</p>`}
          <div class="row">
            ${asset ? `<a class="button secondary" href="${esc(asset.download)}" download>Download</a><button class="secondary" data-action="open-asset" data-id="${esc(asset.id)}">Open</button><button class="secondary" data-action="publish-asset" data-id="${esc(asset.id)}">Publish</button>` : ""}
            ${isPending(generation) ? `<button class="quiet" data-action="refresh-job" data-id="${esc(generation.id)}">Refresh</button>` : ""}
            ${generation.status === "unknown" ? `<button class="secondary" data-action="reconcile-job" data-id="${esc(generation.id)}">Reconcile</button>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
    ${social.length ? `<p class="small" style="margin:0">The 9:16 cut keeps the selected shot order and uses the same sound. It opens with a deterministic 1080 × 1920 slate, then composes the takes into a 720 × 1280 master. It is not a rename or a stretch of the 16:9 cut.</p>` : ""}
  </article>`;
}

function changedSinceRender(composition, renders) {
  if (!renders.length) return false;
  const latest = Math.max(...renders.map((generation) => generation.createdAt ?? 0));
  return Number(composition.updatedAt ?? composition.createdAt ?? 0) > latest;
}

function renderEstimate(variant) {
  const model = state.models.find((item) => item.id === (variant === "social" ? "studio-social" : "studio-assembly"));
  return model?.costMicro ?? 0;
}

function historyView() {
  const generations = state.project.generations;
  return `
    <div class="spread"><h2 style="margin:0">Generation history</h2><button class="button secondary" data-action="tab" data-tab="create">New request</button></div>
    <p class="small">Saved results live in the library. Failed and unknown outcomes keep their exact request, cost state and recovery options.</p>
    <div class="stack" style="margin-top:0.8rem">
      ${generations.length === 0 ? `<div class="card"><p style="margin:0">No requests yet.</p></div>` : ""}
      ${generations.map(jobCard).join("")}
    </div>`;
}

function jobCard(generation) {
  const model = modelById(generation.model);
  const label = generation.modelLabel ?? model?.label ?? (generation.model === "kling-o1-restyle" ? "Kling O1 footage edit" : generation.model);
  const asset = state.project.assets.find((item) => item.id === generation.assetId);
  const pending = isPending(generation);
  const canCancel = ["admitted", "submitting", "submitted", "running"].includes(generation.status);
  const canRetrySave = ["provider_complete", "saving"].includes(generation.status);
  return `<article class="job" data-job="${esc(generation.id)}">
    <header>
      <div class="row">${statusChip(generation.status)}<strong>${esc(label)}</strong><span class="small">${esc(generation.kind)} · ${dateLabel(generation.createdAt)} ${timeLabel(generation.createdAt)}</span></div>
      <span class="small">Estimated allocation: ${money(generation.costAllocatedMicro ?? generation.costEstimateMicro)}</span>
    </header>
    ${generation.modelRetired ? `<p class="small">This saved job used a retired model. Its record and result are unchanged. Choose a current model for new work.</p>` : ""}
    <p class="prompt">${esc(generation.prompt)}</p>
    <p class="small">${esc(generation.aspect ?? "")} ${generation.durationSeconds ? `· ${generation.durationSeconds}s` : ""} ${generation.error ? `· ${esc(generation.error.message)}` : ""}</p>
    ${asset ? `<div class="result">${["audio", "video"].includes(asset.kind) && asset.durationMs != null ? `<p class="small">Saved file: ${(asset.durationMs / 1000).toFixed(2)}s</p>` : ""}${asset.kind === "video" ? `<video src="${esc(asset.file)}" controls playsinline preload="none" aria-label="Play ${esc(asset.title)}"></video>` : asset.kind === "audio" ? `<audio src="${esc(asset.file)}" controls preload="none" aria-label="Play ${esc(asset.title)}" style="width:100%"></audio>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}" loading="lazy">`}</div>` : ""}
    <div class="row">
      ${asset ? `<button class="secondary" data-action="open-asset-link" data-id="${esc(asset.id)}">Open result</button>${generation.model !== "kling-o1-restyle" && !generation.modelRetired ? `<button class="secondary" data-action="reuse-job" data-id="${esc(generation.id)}">Reuse settings</button>` : ""}` : ""}
      ${pending && generation.kind === "video" ? `<button class="secondary" data-action="refresh-job" data-id="${esc(generation.id)}">Refresh</button>` : ""}
      ${canCancel ? `<button class="secondary" data-action="cancel-job" data-id="${esc(generation.id)}">Cancel</button>` : ""}
      ${canRetrySave ? `<button data-action="save-retry" data-id="${esc(generation.id)}">Retry saving</button>` : ""}
      ${generation.status === "unknown" ? `<button class="secondary" data-action="reconcile-job" data-id="${esc(generation.id)}">Reconcile</button>` : ""}
      ${!pending && !asset ? `<button class="quiet" data-action="delete-job" data-id="${esc(generation.id)}">Remove from history</button>` : ""}
    </div>
  </article>`;
}

function publishView() {
  const publications = state.project.publications;
  return `
    <div class="spread"><h2 style="margin:0">Published pages</h2><button class="button" data-action="choose-publish">Publish a piece</button></div>
    <p class="small">A published page includes its title, description, media, download link and any eligible public source credits and links. Prompts, other projects and private filenames stay private. Withdrawal stops new visits; downloads already taken cannot be recalled.</p>
    <div class="row"><button class="secondary" data-action="publication-policy">First-party publishing settings</button><button class="secondary" data-action="publication-inventory">Review publication inventory</button></div>
    ${publications.length ? `<div class="stack" data-bulk-publications>
      <p class="small" style="margin:0">Select published pages, then change their visibility in one action. Every change is recorded with who made it, when, and the state before and after. A failure names the exact items that changed and the ones that did not.</p>
      <div class="row"><button class="secondary" type="button" data-action="bulk-publish">Add selected to gallery</button><button class="secondary" type="button" data-action="bulk-unlist">Unlist selected</button><button class="quiet" type="button" data-action="bulk-withdraw">Withdraw selected</button></div>
    </div>` : ""}
    ${publications.length ? `<div class="stack" style="margin-top:0.7rem">
      <button class="secondary" type="button" data-action="backfill-thumbs">Make public previews faster</button>
      <p class="small" style="margin:0">Adds a small gallery preview and a page-size poster preview where one is missing. Originals and published pages stay unchanged; running it again only fills gaps.</p>
      <p class="small" style="margin:0" data-thumb-progress role="status" aria-live="polite"></p>
    </div>` : ""}
    <div class="stack" style="margin-top:0.8rem">
      ${publications.length === 0 ? `<div class="card"><p style="margin:0">Nothing published yet.</p></div>` : ""}
      ${publications
        .map((publication) => `<article class="job">
          <header><label class="small"><input type="checkbox" data-bulk-publication="${esc(publication.id)}"> Select</label><strong>${esc(publication.title)}</strong><span class="small">${dateLabel(publication.createdAt)}</span></header>
          <p class="small"><a href="${esc(publication.path)}" target="_blank" rel="noopener">${esc(location.origin + publication.path)}</a></p>
          <p class="small">${publication.hidden ? "Hidden from gallery · anyone with the link can view" : publication.listed ? "Listed in the public gallery" : "Unlisted · anyone with the link can view"}</p>
          ${publication.review ? `<p class="small">Approved in a private review for this exact version · ${esc(String(publication.review.assetSha256 ?? "").slice(0, 12))}…</p>` : ""}
          <div class="row"><button class="secondary" data-action="edit-publication" data-id="${esc(publication.id)}">Edit page details</button><button class="secondary" data-action="toggle-listing" data-id="${esc(publication.id)}">${publication.listed && !publication.hidden ? "Remove from gallery" : "Add to public gallery"}</button><a class="button secondary" href="${esc(publication.path)}" target="_blank" rel="noopener">Open page</a><button class="quiet" data-action="revoke" data-id="${esc(publication.id)}">Withdraw</button></div>
        </article>`)
        .join("")}
    </div>`;
}

function settingsView() {
  const project = state.project;
  const references = project.references ?? [];
  return `
    <form class="grid two" data-form="settings">
      <div class="card stack">
        <p class="eyebrow">Studio</p>
        <label>Name<input name="name" value="${esc(project.name)}" maxlength="80" required></label>
        <label>Creative direction<textarea name="creativeDirection" maxlength="600" rows="4">${esc(project.creativeDirection)}</textarea></label>
        <label>Visibility
          <select name="visibility">
            <option value="private" ${project.visibility === "private" ? "selected" : ""}>Private — only this studio</option>
            <option value="unlisted" ${project.visibility === "unlisted" ? "selected" : ""}>Unlisted — reachable with its link</option>
          </select>
        </label>
        <p class="small">Visibility applies to the studio itself, not to published pieces. Published pages are public until withdrawn.</p>
        <button class="button" type="submit">Save studio</button>
      </div>
      <div class="card stack">
        <p class="eyebrow">Creative references</p>
        <p class="small" style="margin:0">Save links that inform this studio. They are notes for you and your agent; the studio does not fetch or execute them.</p>
        <div id="references">
          ${references.length === 0 ? `<p class="small">No references yet.</p>` : ""}
          ${references.map((reference) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:0.5rem"><span><strong>${esc(reference.title)}</strong><br><a href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer" class="small">${esc(reference.url)}</a></span><button class="quiet" data-action="remove-reference" data-id="${esc(reference.id)}" type="button">Remove</button></div>`).join("")}
        </div>
        <div class="row"><input name="referenceTitle" placeholder="Reference title" maxlength="100"><input name="referenceUrl" type="url" placeholder="https://…"><button class="secondary" type="button" data-action="add-reference">Add</button></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:0.5rem 0">
        <p class="small">The export includes private prompts, lyrics, scene directions and subject and reference history. Text and links may contain sensitive information; Studio provider keys and session cookies are excluded. Share it carefully. It is not a restorable archive; download media files separately while they still exist. To restore a studio with its media, export a portable bundle with the owner CLI and use the restore panel on <a href="#/">the studio home screen</a>.</p>
        <a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Download project export</a>
      </div>
    </form>`;
}

function assetView() {
  const asset = state.project?.assets.find((item) => item.id === state.assetId);
  if (!asset) return `<div class="asset-viewer" data-viewer role="dialog" aria-modal="true" aria-labelledby="viewer-missing-title"><h1 id="viewer-missing-title">Asset unavailable</h1><p class="notice">That asset is no longer in the library. <a data-viewer-back href="#/p/${esc(state.projectId)}/library">Back to the library</a> <button type="button" class="quiet" data-action="close-viewer" aria-label="Close the viewer">Close</button></p></div>`;
  const isVideo = asset.kind === "video";
  const isAudio = asset.kind === "audio";
  const localRender = isLocalRenderProvenance(asset.caption);
  const shareProvenance = shareImportProvenance(asset.caption);
  // The server resolves this from stored same-project relationships; the client
  // never guesses a poster from a filename or title.
  const still = asset.reuseStillId ? state.project.assets.find((item) => item.id === asset.reuseStillId) : null;
  const launchKitUrl = state.destinations?.launchKitUrl ?? null;
  const launchKitSource = still
    ? `<div class="stack" style="border-top:1px solid var(--line);padding-top:0.8rem">
        <p class="eyebrow" style="margin:0">Launch Kit source</p>
        <div class="row">
          <a class="button secondary" href="${esc(still.download)}" download="launch-kit-source-${esc(still.id)}.${esc(stillExtension(still.mime))}">${isVideo ? "Download poster for Launch Kit" : "Download for Launch Kit"}</a>
          ${launchKitUrl ? `<a class="button secondary" href="${esc(launchKitUrl)}" target="_blank" rel="noopener noreferrer">Open Launch Kit</a>` : ""}
        </div>
        <p class="small" style="margin:0">${
          isVideo
            ? `1. Download the retained still${still.title ? ` “${esc(still.title)}”` : ""}. 2. Import that still into Launch Kit. The clip stays here; only the still becomes the source artwork.`
            : "1. Download the still. 2. Import it into Launch Kit as the source artwork. Finishing and export stay in Launch Kit."
        }${launchKitUrl ? "" : " Open your own Launch Kit installation to import it."}</p>
      </div>`
    : `<p class="notice" style="font-size:0.84rem">${
        isVideo
          ? "This clip has no retained poster or source still, so it cannot supply Launch Kit artwork or a variation reference. Choose a still in the library instead."
          : "This file type cannot be imported into Launch Kit or used as a variation reference. Upload a JPEG, PNG or WebP still."
      }${isVideo ? ` <button class="quiet" data-action="choose-still">Choose a still</button>` : ""}</p>`;
  return `
    <div class="asset-viewer" data-viewer role="dialog" aria-modal="true" aria-labelledby="viewer-title">
    <p class="row"><a class="button secondary" data-viewer-back href="#/p/${esc(state.projectId)}/library">← Back to library</a><button class="button secondary" type="button" data-action="close-viewer" aria-label="Close the viewer">Close</button></p>
    <div class="viewer">
      <div class="stage">${isVideo ? `<video src="${esc(asset.file)}" controls playsinline preload="metadata"></video>` : isAudio ? `<div class="audio-stage"><canvas width="840" height="200" data-waveform="${esc(asset.file)}" aria-hidden="true"></canvas><audio src="${esc(asset.file)}" controls preload="metadata"></audio></div>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}">`}</div>
      <aside class="card stack">
        <div><p class="eyebrow">${esc(asset.kind)} · ${esc(asset.source)}</p><h1 id="viewer-title" style="font-size:1.7rem">${esc(asset.title)}</h1></div>
        ${shareProvenance ? `<p>Imported from Woodhouse Share.</p>` : localRender ? `<p>MP4 rendered on this device from a saved storyboard${asset.caption.includes("; owner-confirmed captions") ? ", with saved captions" : ""}.</p>` : asset.caption ? `<p>${esc(asset.caption)}</p>` : ""}
        <dl class="kv">
          <dt>Size</dt><dd>${bytesLabel(asset.bytes)}</dd>
          ${asset.width ? `<dt>Frame</dt><dd>${asset.width} × ${asset.height}</dd>` : ""}
          ${asset.durationMs ? `<dt>Duration</dt><dd>${(asset.durationMs / 1000).toFixed(1)}s</dd>` : ""}
          ${isAudio && asset.sampleRate ? `<dt>Audio</dt><dd>${asset.sampleRate} Hz · ${asset.channels ?? "—"} channel${asset.channels === 1 ? "" : "s"}</dd>` : ""}
          <dt>Type</dt><dd>${esc(asset.mime)}</dd>
          <dt>Added</dt><dd>${dateLabel(asset.createdAt)}</dd>
        </dl>
        <details class="asset-technical"><summary>Technical details</summary><dl class="kv"><dt>SHA-256</dt><dd>${esc(asset.sha256)}</dd></dl>${localRender ? `<p>${esc(asset.caption)}</p>` : ""}${shareProvenance ? `<div><p>${esc(shareProvenance.credit)}</p><p><a href="${esc(shareProvenance.catalogue)}" target="_blank" rel="noopener noreferrer">Share catalogue record</a>${shareProvenance.source ? ` · <a href="${esc(shareProvenance.source)}" target="_blank" rel="noopener noreferrer">Source notes</a>` : ""}</p></div>` : ""}</details>
        <div class="row">
          <a class="button secondary" href="${esc(asset.download)}" download>Download</a>
          <button class="secondary" data-action="rename-asset" data-id="${esc(asset.id)}">Rename</button>
          ${still ? `<button class="secondary" data-action="vary-asset" data-id="${esc(still.id)}">${isVideo ? "Make a variation of its still" : "Make a variation"}</button>` : ""}
        </div>
        <div class="row">
          <button class="secondary" data-action="animate-asset" data-id="${esc(asset.id)}" ${asset.kind === "image" ? "" : "disabled"}>Animate this still</button>
          <button class="secondary" data-action="publish-asset" data-id="${esc(asset.id)}">Publish page</button>
          <button class="secondary" data-action="review-asset" data-id="${esc(asset.id)}" ${isAudio ? "disabled" : ""}>Review privately</button>
        </div>
        ${asset.kind === "image" ? `<div class="row">
          <button class="secondary" data-action="edit-asset" data-mode="fill" data-id="${esc(asset.id)}">Masked fill / outpaint</button>
          <button class="secondary" data-action="edit-asset" data-mode="cutout" data-id="${esc(asset.id)}">Remove background</button>
          <button class="secondary" data-action="edit-asset" data-mode="upscale" data-id="${esc(asset.id)}">Upscale ×2</button>
        </div>` : ""}
        ${launchKitSource}
        ${isVideo && still ? `<p class="small" style="margin:0">A variation uses “${esc(still.title)}”, the still, not this clip.</p>` : ""}
        <button class="quiet" data-action="delete-asset" data-id="${esc(asset.id)}">Delete from library</button>
      </aside>
    </div>
    </div>`;
}

/* ---------- dialogs ---------- */

function ask({ title, copy, fields = [], submit = "Continue", cancelLabel = "Cancel", media = "" }) {
  return new Promise((resolve) => {
    confirmDialog.querySelector("#confirm-title").textContent = title;
    confirmDialog.querySelector("#confirm-copy").innerHTML = `
      ${media}
      <p class="small">${copy}</p>
      ${fields
        .map(
          (field) =>
            `<label style="margin-top:0.6rem">${esc(field.label)}${field.type === "textarea" ? `<textarea name="${esc(field.name)}" maxlength="${field.maxlength ?? 400}" rows="3">${esc(field.value ?? "")}</textarea>` : `<input name="${esc(field.name)}" type="${esc(field.type ?? "text")}" value="${esc(field.value ?? "")}" maxlength="${field.maxlength ?? 200}" ${field.required ? "required" : ""} ${field.min !== undefined ? `min="${esc(field.min)}"` : ""} ${field.max !== undefined ? `max="${esc(field.max)}"` : ""} ${field.step !== undefined ? `step="${esc(field.step)}"` : ""}>`}</label>`,
        )
        .join("")}`;
    const form = confirmDialog.querySelector("#confirm-form");
    form.querySelector('button[value="ok"]').textContent = submit;
    form.querySelector('button[value="cancel"]').textContent = cancelLabel;
    // A previous submission must not turn an Escape or backdrop dismissal into OK.
    confirmDialog.returnValue = "";
    const isEdited = () => [...form.querySelectorAll("input, textarea")].some((input) => input.value !== input.defaultValue);
    const explainDraft = () => {
      let message = form.querySelector("[data-dialog-draft-status]");
      if (!message) {
        message = document.createElement("p");
        message.dataset.dialogDraftStatus = "";
        message.setAttribute("role", "status");
        message.className = "small";
        message.style.marginTop = "0.6rem";
        form.querySelector("#confirm-copy").append(message);
      }
      message.textContent = "Your edits are still here. Choose Cancel to discard them.";
    };
    const onBackdrop = (event) => {
      if (event.target !== confirmDialog) return;
      const rect = confirmDialog.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
      // Do not silently discard anything typed into a form.
      if (isEdited()) explainDraft();
      else confirmDialog.close("cancel");
    };
    const onCancel = (event) => {
      if (!isEdited()) return;
      event.preventDefault();
      explainDraft();
    };
    const finish = (value) => {
      confirmDialog.removeEventListener("close", onClose);
      confirmDialog.removeEventListener("click", onBackdrop);
      confirmDialog.removeEventListener("cancel", onCancel);
      resolve(value);
    };
    const onClose = () => {
      const data = new FormData(form);
      if (confirmDialog.returnValue === "ok") {
        const values = {};
        for (const field of fields) values[field.name] = String(data.get(field.name) ?? "");
        finish(values);
      } else finish(null);
    };
    confirmDialog.addEventListener("close", onClose);
    confirmDialog.addEventListener("click", onBackdrop);
    confirmDialog.addEventListener("cancel", onCancel);
    confirmDialog.showModal();
  });
}

async function confirmAction(title, copy, label = "Continue", dangerous = false) {
  const ok = await ask({ title, copy, submit: label });
  return Boolean(ok);
}

/* ---------- actions ---------- */

// Create controls are rebuilt when their selection changes. Keep keyboard
// users on the same control instead of returning focus to the document body.
function renderKeepingCreateFocus(element) {
  const wasFocused = document.activeElement === element;
  const keys = ["action", "kind", "slug", "model", "id"];
  const identity = keys.filter((key) => element.dataset[key] !== undefined)
    .map((key) => [key, element.dataset[key]]);
  render();
  if (!wasFocused) return;
  const replacement = [...app.querySelectorAll("[data-action]")].find((candidate) =>
    identity.every(([key, value]) => candidate.dataset[key] === value));
  replacement?.focus({ preventScroll: true });
}

async function handleAction(action, element, keyboard = false) {
  const id = element.dataset.id;
  switch (action) {
    case "refresh-uncertain-history": {
      const projectId = state.projectId;
      await refreshUncertainHistory(projectId);
      if (state.projectId === projectId && state.view === "project" && state.tab === "history") render();
      return;
    }
    case "new-project": {
      const values = await ask({
        title: "Start a studio",
        copy: "Name it and give it a direction. You can change both later.",
        fields: [
          { name: "name", label: "Studio name", value: "", required: true, maxlength: 80 },
          { name: "creativeDirection", label: "Creative direction", type: "textarea", value: "", maxlength: 600 },
        ],
        submit: "Create studio",
      });
      if (!values) return;
      const result = await api("/api/projects", { method: "POST", body: JSON.stringify(values) });
      state.projects.unshift(result.project);
      location.hash = `#/p/${result.project.id}/library`;
      return;
    }
    case "open-project":
      location.hash = `#/p/${id}/library`;
      return;
    case "tab":
      activateProjectTab(element.dataset.tab);
      return;
    case "compare-mode": {
      const comparison = comparisons.get(state.projectId) ?? { active: false, ids: [] };
      comparison.active = !comparison.active;
      comparisons.set(state.projectId, comparison);
      renderReactLibrary();
      drawWaveforms();
      return;
    }
    case "compare-toggle": {
      const comparison = comparisons.get(state.projectId);
      const asset = state.project.assets.find((item) => item.id === id && item.kind === "image");
      if (!comparison || !asset) return;
      if (comparison.ids.includes(id)) comparison.ids = comparison.ids.filter((item) => item !== id);
      else if (comparison.ids.length < 2) comparison.ids.push(id);
      renderReactLibrary();
      drawWaveforms();
      return;
    }
    case "compare-clear": {
      const comparison = comparisons.get(state.projectId);
      if (comparison) comparison.ids = [];
      renderReactLibrary();
      drawWaveforms();
      return;
    }
    case "filter":
      state.filter = element.dataset.filter;
      if (mediaMounted && state.view === "project" && state.tab === "library") {
        renderReactLibrary();
        drawWaveforms();
      } else render();
      return;
    case "clear-library":
      state.filter = "all";
      state.query = "";
      if (mediaMounted && state.view === "project" && state.tab === "library") {
        const search = app.querySelector('[data-input="search"]');
        if (search) search.value = "";
        renderReactLibrary();
        drawWaveforms();
      } else render();
      return;
    case "restore-create-draft": {
      if (!state.project || state.project.id !== state.projectId || createProjectId !== state.projectId) return;
      const drafts = priorCreateDrafts.get(state.projectId) ?? [];
      const value = document.querySelector("#prior-create-draft")?.value;
      if (value === undefined) return;
      const preserveCurrent = hasCreateDraftChanges(state.create, projectCreateDefaults.get(state.projectId));
      const { restored, remaining } = restoreCreateDraft(drafts, Number(value), state.create, preserveCurrent);
      if (remaining.length) priorCreateDrafts.set(state.projectId, remaining); else priorCreateDrafts.delete(state.projectId);
      state.create = restored;
      render();
      notify(preserveCurrent ? "Draft restored. The draft you just left is also available above." : "Draft restored.");
      return;
    }
    case "discard-create-drafts": {
      const projectId = state.projectId;
      const confirmed = await confirmAction("Discard earlier Create drafts?", "These session-only drafts will be lost. The draft currently open will remain.", "Discard drafts");
      if (confirmed && state.projectId === projectId) { priorCreateDrafts.delete(projectId); render(); notify("Earlier session drafts discarded."); }
      return;
    }
    case "kind": {
      state.create.kind = element.dataset.kind;
      if (state.create.kind === "audio") {
        state.create.model = state.project.defaults.audioModel ?? "studio-score";
        state.create.recipeSlug = "";
        state.create.prompt = "";
        state.create.referenceAssetId = null;
        state.create.durationSeconds = 15;
        renderKeepingCreateFocus(element);
        return;
      }
      if (state.create.kind === "video") state.create.durationSeconds = 6;
      const recipes = state.project.recipes.filter((recipe) => recipe.kind === state.create.kind);
      state.create.recipeSlug = recipes[0]?.slug ?? state.create.recipeSlug;
      const recipe = recipeBySlug(state.create.recipeSlug);
      if (recipe) {
        state.create.controls = {};
        state.create.prompt = promptFromRecipe(recipe, {});
        Object.assign(state.create, recipeModelSettings(recipe, state.models, state.create, recipe.kind === "video" ? state.project.defaults.videoModel : null));
      }
      renderKeepingCreateFocus(element);
      return;
    }
    case "recipe": {
      const recipe = recipeBySlug(element.dataset.slug);
      if (!recipe) return;
      state.create.recipeSlug = recipe.slug;
      state.create.kind = recipe.kind;
      state.create.controls = {};
      state.create.prompt = promptFromRecipe(recipe, {});
      Object.assign(state.create, recipeModelSettings(recipe, state.models, state.create));
      renderKeepingCreateFocus(element);
      return;
    }
    case "edit-model": {
      const model = element.dataset.model;
      state.create = {
        ...defaultCreate(),
        kind: "image",
        model,
        aspect: "match-reference",
        recipeSlug: "",
        prompt: model === "studio-fill" ? "" : model === "studio-upscale" ? "masterpiece, best quality, highres" : "",
        controls: {},
      };
      renderKeepingCreateFocus(element);
      return;
    }
    case "pick-reference":
      state.create.referenceAssetId = id;
      if (state.create.maskAssetId) state.create.maskAssetId = null;
      renderKeepingCreateFocus(element);
      return;
    case "toggle-references":
      state.create.showAllReferences = !state.create.showAllReferences;
      renderKeepingCreateFocus(element);
      return;
    case "mask-clear": {
      if (!maskPainter) return;
      const { maskCanvas, canvas, sourceCanvas } = maskPainter;
      maskCanvas.getContext("2d").fillStyle = "#000";
      maskCanvas.getContext("2d").fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      canvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
      return;
    }
    case "mask-save": {
      if (!maskPainter) {
        notify("Choose a still and let the mask canvas load first.", "bad");
        return;
      }
      const { sourceCanvas, maskCanvas, sourceAsset } = maskPainter;
      const sourceBlob = await maskedCanvasBlob(sourceCanvas);
      const maskBlob = await maskedCanvasBlob(maskCanvas);
      if (!sourceBlob || !maskBlob) {
        notify("The mask could not be encoded. Try again.", "bad");
        return;
      }
      try {
        const scaled = await uploadBlob(
          sourceBlob,
          `Edit source — ${sourceAsset.title}`.slice(0, 100),
          `Scaled to ${sourceCanvas.width} × ${sourceCanvas.height} for a same-size mask. Original ${sourceAsset.id} retained.`,
        );
        const mask = await uploadBlob(
          maskBlob,
          `Mask — ${sourceAsset.title}`.slice(0, 100),
          `Painted in the studio. White marks the area to replace; black stays. Source ${sourceAsset.id}; ${sourceCanvas.width} × ${sourceCanvas.height}.`,
        );
        state.create.referenceAssetId = scaled.id;
        state.create.maskAssetId = mask.id;
        notify("Mask saved as its own asset. The fill will use it at the same dimensions.");
        render();
      } catch (error) {
        notify(error.message, "bad");
      }
      return;
    }
    case "outpaint": {
      const sourceAsset = state.project.assets.find((item) => item.id === id);
      if (!sourceAsset) return;
      const ok = await confirmAction(
        "Extend the frame by 25%?",
        "The studio will build a larger canvas with the original centred and a same-size mask around it, then FLUX Fill will invent the new border. The original still stays untouched.",
        "Build the extended frame",
      );
      if (!ok) return;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = async () => {
        const max = 768;
        const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(64, Math.round(image.naturalWidth * scale));
        const height = Math.max(64, Math.round(image.naturalHeight * scale));
        const padX = Math.round(width * 0.25);
        const padY = Math.round(height * 0.25);
        const outWidth = Math.min(2048, width + padX * 2);
        const outHeight = Math.min(2048, height + padY * 2);
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = outWidth;
        sourceCanvas.height = outHeight;
        const sourceContext = sourceCanvas.getContext("2d");
        sourceContext.fillStyle = "#000";
        sourceContext.fillRect(0, 0, outWidth, outHeight);
        sourceContext.drawImage(image, padX, padY, width, height);
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = outWidth;
        maskCanvas.height = outHeight;
        const maskContext = maskCanvas.getContext("2d");
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(0, 0, outWidth, outHeight);
        maskContext.fillStyle = "#000";
        maskContext.fillRect(padX, padY, width, height);
        try {
          const scaled = await uploadBlob(
            await maskedCanvasBlob(sourceCanvas),
            `Outpaint source — ${sourceAsset.title}`.slice(0, 100),
            `Centred with a 25% border for a real outpaint. Original ${sourceAsset.id} retained.`,
          );
          const mask = await uploadBlob(
            await maskedCanvasBlob(maskCanvas),
            `Outpaint mask — ${sourceAsset.title}`.slice(0, 100),
            `White border marks the new area; the original centre is black and preserved. Source ${sourceAsset.id}.`,
          );
          state.create.referenceAssetId = scaled.id;
          state.create.maskAssetId = mask.id;
          notify("Extended frame prepared. Prompt what belongs in the new border, then apply the fill.");
          render();
        } catch (error) {
          notify(error.message, "bad");
        }
      };
      image.onerror = () => notify("That still could not be opened for outpainting.", "bad");
      image.src = sourceAsset.file;
      return;
    }
    case "submit-create":
      await submitCreate();
      return;
    case "open-asset":
      recordViewerOrigin(element, id, "open-asset");
      location.hash = `#/a/${state.projectId}/${id}`;
      return;
    case "close-viewer":
      closeViewer();
      return;
    case "refresh-job":
      await refreshGeneration(id, true);
      return;
    case "cancel-job": {
      if (!(await confirmAction("Cancel this request?", "The provider must confirm. A local cancellation is not a refund; work already running can still finish or remain billable.", "Ask the provider to cancel"))) return;
      await api(`/api/generations/${id}/cancel`, { method: "POST", body: "{}" });
      await refreshGeneration(id, true);
      notify("Cancellation requested. The status shows what the provider confirmed.");
      return;
    }
    case "save-retry": {
      const result = await api(`/api/generations/${id}/save-retry`, { method: "POST", body: "{}" });
      replaceGeneration(result.generation);
      notify("Saved the retained result without generating again.");
      await loadProject(state.projectId);
      render();
      return;
    }
    case "reconcile-job": {
      const result = await api(`/api/generations/${id}/reconcile`, { method: "POST", body: "{}" });
      replaceGeneration(result.generation);
      notify(result.generation.status === "unknown" ? "Still unknown. No new request was sent." : `Provider status: ${result.generation.status}.`);
      render();
      return;
    }
    case "delete-job": {
      if (!(await confirmAction("Remove this request from history?", "The record is kept as a tombstone so a late provider result cannot reappear. Retained bytes are deleted.", "Remove", true))) return;
      await api(`/api/generations/${id}`, { method: "DELETE" });
      state.project.generations = state.project.generations.filter((item) => item.id !== id);
      render();
      return;
    }
    case "reuse-job": {
      const generation = state.project.generations.find((item) => item.id === id);
      if (!generation) return;
      state.create = {
        ...state.create,
        kind: generation.kind,
        model: generation.model,
        prompt: generation.prompt,
        aspect: generation.aspect ?? state.create.aspect,
        durationSeconds: generation.durationSeconds ?? state.create.durationSeconds,
        referenceAssetId: generation.referenceAssetId,
        maskAssetId: generation.maskAssetId ?? null,
        parentAssetId: null,
      };
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "rename-asset": {
      const asset = state.project.assets.find((item) => item.id === id);
      const values = await ask({
        title: "Rename this media",
        copy: "The file name and hash stay the same.",
        fields: [
          { name: "title", label: "Title", value: asset.title, required: true, maxlength: 100 },
          { name: "caption", label: "Caption", type: "textarea", value: asset.caption, maxlength: 400 },
        ],
        submit: "Save",
      });
      if (!values) return;
      const result = await api(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(values) });
      Object.assign(asset, result.asset);
      render();
      return;
    }
    case "vary-asset": {
      const source = state.project.assets.find((item) => item.id === id);
      if (!source || source.kind !== "image") {
        notify("A variation needs a still reference.", "bad");
        return;
      }
      state.create = {
        ...defaultCreate(),
        kind: "image",
        model: "studio-detail",
        aspect: "square",
        recipeSlug: "reference-variation",
        referenceAssetId: source.id,
        parentAssetId: source.id,
        controls: {},
      };
      const recipe = recipeBySlug("reference-variation");
      state.create.prompt = promptFromRecipe(recipe, {});
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "edit-asset": {
      const mode = element.dataset.mode;
      const source = state.project.assets.find((item) => item.id === id);
      if (!source || source.kind !== "image") {
        notify("Choose a still to edit.", "bad");
        return;
      }
      const model = mode === "cutout" ? "studio-cutout" : mode === "upscale" ? "studio-upscale" : "studio-fill";
      state.create = {
        ...defaultCreate(),
        kind: "image",
        model,
        aspect: "match-reference",
        recipeSlug: "",
        referenceAssetId: source.id,
        maskAssetId: null,
        parentAssetId: source.id,
        prompt: mode === "fill" ? "" : mode === "cutout" ? "" : "masterpiece, best quality, highres",
        controls: {},
      };
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "animate-asset": {
      const source = state.project.assets.find((item) => item.id === id);
      if (!source || source.kind !== "image") {
        notify("Choose a still to animate.", "bad");
        return;
      }
      state.create = {
        ...defaultCreate(),
        kind: "video",
        model: state.project.defaults.videoModel ?? "hailuo-standard",
        recipeSlug: "animate-a-still",
        referenceAssetId: source.id,
        durationSeconds: 6,
        controls: { motion: "slow push in" },
      };
      const recipe = recipeBySlug("animate-a-still");
      state.create.prompt = promptFromRecipe(recipe, state.create.controls);
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "choose-still":
      state.filter = "image";
      state.query = "";
      state.tab = "library";
      location.hash = `#/p/${state.projectId}/library`;
      return;
    case "publish-asset":
      await publishAsset(id);
      return;
    case "review-asset":
      state.reviewPresetAssetId = id;
      state.tab = "review";
      location.hash = `#/p/${state.projectId}/review`;
      return;
    case "review-copy-link": {
      const url = state.reviewLinks.get(id);
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        notify("Private review link copied. It is shown only in this tab.");
      } catch {
        const input = document.getElementById(`review-link-${id}`);
        if (input) { input.focus(); input.select(); document.execCommand("copy"); }
        notify("Private review link selected. Copy it from the field.");
      }
      return;
    }
    case "review-rotate": {
      if (!(await confirmAction("Replace this private review link?", "The current link stops working immediately. Feedback and decisions already recorded stay with this exact version.", "Replace link"))) return;
      const result = await api(`/api/projects/${state.projectId}/review-rooms/${encodeURIComponent(id)}/rotate`, { method: "POST", body: "{}" });
      replaceReviewRoom(result.room);
      state.reviewLinks.set(result.room.id, new URL(result.reviewUrl, location.origin).href);
      render();
      notify("New private review link created. Copy it now; it is shown once.");
      return;
    }
    case "review-revoke": {
      if (!(await confirmAction("Revoke this review link?", "The reviewer loses access to the media and feedback immediately. The feedback already recorded stays with the creator. This cannot be undone for this link.", "Revoke link"))) return;
      const result = await api(`/api/projects/${state.projectId}/review-rooms/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" });
      replaceReviewRoom(result.room);
      state.reviewLinks.delete(result.room.id);
      render();
      notify("Review link revoked. Media and feedback are no longer served through it.");
      return;
    }
    case "review-resolve": {
      const resolved = element.dataset.resolved !== "1";
      const result = await api(`/api/projects/${state.projectId}/review-rooms/${encodeURIComponent(element.dataset.room)}/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ resolved }) });
      const room = state.reviewRooms?.find((item) => item.id === element.dataset.room);
      const feedback = room?.feedback?.find((item) => item.id === id);
      if (feedback) Object.assign(feedback, result.feedback);
      render();
      notify(resolved ? "Feedback marked resolved." : "Feedback reopened.");
      return;
    }
    case "review-seek": {
      const card = element.closest(".review-room-card");
      if (!card) return;
      const details = card.querySelector("details");
      if (details) details.open = true;
      const video = card.querySelector("video[data-review-video]");
      if (!video) {
        notify("This version has no playable film in this panel.", "bad");
        return;
      }
      video.currentTime = Number(element.dataset.ms) / 1000;
      video.play().catch(() => {});
      video.focus();
      return;
    }
    case "review-compare-run": {
      const selected = [...app.querySelectorAll("input[data-review-compare]:checked")].map((input) => input.value);
      if (selected.length !== 2) {
        notify("Select exactly two saved versions to compare.", "bad");
        return;
      }
      const comparison = await api(`/api/projects/${state.projectId}/review-rooms/compare?left=${encodeURIComponent(selected[0])}&right=${encodeURIComponent(selected[1])}`);
      state.reviewCompare = comparison;
      render();
      return;
    }
    case "review-compare-clear":
      state.reviewCompare = null;
      render();
      return;
    case "choose-publish": {
      const assets = state.project.assets;
      if (!assets.length) {
        notify("Upload or generate something first.");
        return;
      }
      const values = await ask({
        title: "Publish a piece",
        copy: "The public page includes the title, description, media, download link and any eligible public source credits and links. Choose an asset by its title.",
        fields: [
          { name: "assetTitle", label: `Asset (one of: ${assets.slice(0, 6).map((asset) => asset.title).join(" · ")})`, value: assets[0].title, required: true },
          { name: "title", label: "Public title", value: assets[0].title, required: true, maxlength: 100 },
          { name: "description", label: "Public description", type: "textarea", value: "", maxlength: 300 },
        ],
        submit: "Publish",
      });
      if (!values) return;
      const asset = assets.find((item) => item.title === values.assetTitle);
      if (!asset) {
        notify("That title did not match an asset. Open the asset and use Publish page.", "bad");
        return;
      }
      await publishAsset(asset.id, values.title, values.description);
      return;
    }
    case "publication-policy": {
      const path = `/api/projects/${state.projectId}/publication-policy`;
      const policy = await api(path);
      if (!policy.installationAllowed) {
        await ask({ title: "First-party publishing", copy: "This installation has not enabled first-party publishing for this project. Existing published pages are unchanged.", submit: "Close" });
        return;
      }
      if (policy.enabled) {
        if (!(await confirmAction("Turn off automatic publishing?", "Future results will stay private. Published pages and listings remain as they are.", "Turn off"))) return;
        await api(path, { method: "PUT", body: JSON.stringify({ enabled: false }) });
        notify("Automatic publishing turned off.");
      } else {
        if (!(await confirmAction("Enable first-party publishing?", "New explicitly reference-free generated results from supported models in this project will be publicly listed. Direct Share-derived results require verified source credit; bounded generated-only or Share-rooted reference chains are checked at every step. Masked edits, unverified inputs and assemblies require attribution review and are skipped. Only enable this if you have the rights to publish the outputs and their reference material, and have checked they are suitable for public sharing. Uploads and reference files are not published directly. Existing results require a separate inventory review.", "I confirm rights and enable"))) return;
        await api(path, { method: "PUT", body: JSON.stringify({ enabled: true, rightsConfirmed: true }) });
        notify("Automatic publishing enabled for this project.");
      }
      return;
    }
    case "publication-inventory": {
      const projectId = state.projectId;
      let after = "";
      do {
        const result = await api(`/api/projects/${projectId}/publication-inventory${after ? `?after=${encodeURIComponent(after)}` : ""}`);
        const candidates = result.items.filter((item) => item.status === "candidate" || item.status === "existing" || item.status === "source_verification_available");
        const rows = result.items.map((item) => `<a href="#/a/${encodeURIComponent(projectId)}/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">${esc(item.title)}</a> — ${esc(item.kind)}, ${esc(item.source)}, ${esc(item.status === "attribution_review_required" ? "attribution review required" : item.status === "source_verification_available" ? "Share source verification available" : item.status)} <code>${esc(item.id)}</code>`).join("<br>") || "No assets on this page.";
        const viewed = await ask({ title: "Publication inventory", copy: `Dry run: ${rows}<br><br>${candidates.length} eligible item(s) on this page. Withdrawn, hidden and ineligible items are excluded. Share sources are checked against the original bytes when you apply this page. Generated-only and Share-rooted chains are checked at every step. Masked edits, assemblies, unknown sources or unavailable credits remain held for attribution review. ${!result.policy.installationAllowed || !result.policy.enabled ? "First-party publishing is off; enable it before applying." : ""} ${result.nextAfter ? "More assets follow." : ""}`, submit: "Continue" });
        if (!viewed) return;
        if (result.policy.installationAllowed && result.policy.enabled && candidates.length) {
          const apply = await confirmAction("Publish the eligible items on this page?", `This will publish or list ${candidates.length} item(s). Confirm you have rights to publish these outputs and their references and that they are suitable for public sharing. Choose Cancel to skip this page.`, "Confirm rights and publish");
          if (apply) {
            const reconciled = await api(`/api/projects/${projectId}/publication-reconcile`, { method: "POST", body: JSON.stringify({ assetIds: candidates.map((item) => item.id), confirm: true, rightsConfirmed: true }) });
            await loadProject(projectId);
            render();
            const done = reconciled.results.filter((item) => item.result === "created" || item.result === "existing").length;
            notify(`${done} reconciled; ${reconciled.results.length - done} held or skipped.`);
          }
        }
        after = result.nextAfter;
      } while (after);
      return;
    }
    case "backfill-thumbs":
      await makePublicPreviewsFaster();
      return;
    case "edit-publication": {
      const projectId = state.projectId;
      const publication = state.project.publications.find((item) => item.id === id);
      if (!publication) return;
      const expectedTitle = publication.title, expectedDescription = publication.description;
      let draft = { title: expectedTitle, description: expectedDescription };
      let copy = "Changes appear on this public page and in the gallery. Its link and visibility stay the same; cached pages may take a minute to update.";
      while (true) {
        const values = await ask({ title: "Edit public page", copy, fields: [
          { name: "title", label: "Public title", value: draft.title, required: true, maxlength: 100 },
          { name: "description", label: "Public description", type: "textarea", value: draft.description, maxlength: 300 },
        ], submit: "Save public details" });
        if (!values) return;
        draft = values;
        if (state.projectId !== projectId) { notify("Studio changed. Your edit was not saved."); return; }
        try {
          const updated = await api(`/api/publications/${id}`, { method: "PATCH", preserveOnUnauthorized: true, body: JSON.stringify({ ...draft, expectedTitle, expectedDescription }) });
          const current = state.projectId === projectId && state.project?.publications.find((item) => item.id === id);
          if (current) Object.assign(current, { title: updated.title, description: updated.description });
          render();
          notify("Public details saved. Cached pages may take a minute to update.");
          return;
        } catch (error) {
          copy = error.status === 401
            ? `Your session expired. Your text is still here. <a href="${esc(studioReentry(state.session))}" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a>, then return and save again; you can also copy your text.`
            : error.code === "revision_conflict"
            ? "This page changed or was withdrawn elsewhere. Your edit was not saved. Copy your text before cancelling, then reload the studio to review the latest page."
            : "The details could not be saved. Your text is still here; check it or copy it before cancelling and trying again.";
        }
      }
    }
    case "bulk-publish":
    case "bulk-unlist":
    case "bulk-withdraw": {
      const bulkAction = action.slice("bulk-".length);
      const publicationIds = [...document.querySelectorAll("[data-bulk-publication]:checked")]
        .map((input) => input.dataset.bulkPublication)
        .filter(Boolean);
      if (!publicationIds.length) {
        notify("Select at least one published page first.", "bad");
        return;
      }
      if (publicationIds.length > 100) {
        notify("Choose at most 100 pages in one action.", "bad");
        return;
      }
      const label = bulkAction === "publish" ? "Add to gallery" : bulkAction === "unlist" ? "Unlist" : "Withdraw";
      const copy = bulkAction === "withdraw"
        ? `Withdraw ${publicationIds.length} selected page(s)? New visits stop immediately; copies already downloaded cannot be recalled. Each item is attempted separately and the result names what changed.`
        : `${label} ${publicationIds.length} selected page(s)? Every change records who made it, when, and the state before and after. Each item is attempted separately.`;
      if (!(await confirmAction(`${label} selected pages?`, copy, label, bulkAction === "withdraw"))) return;
      const result = await api(`/api/projects/${state.projectId}/publications/bulk`, {
        method: "POST",
        body: JSON.stringify({ action: bulkAction, publicationIds, confirm: true }),
      });
      await loadProject(state.projectId);
      render();
      const problems = result.results.filter(
        (item) => item.result === "failed" || item.result === "not_found" || item.result === "asset_unavailable" || (bulkAction !== "withdraw" && item.result === "withdrawn"),
      );
      notify(`${result.changed} changed, ${result.unchanged} unchanged, ${result.blocked} blocked.`, problems.length ? "bad" : "ok");
      if (problems.length)
        await ask({
          title: "Bulk visibility result",
          copy: problems
            .map((item) => `${esc(item.publicationId)}: ${esc(item.result)}${item.detail ? ` — ${esc(item.detail)}` : ""}`)
            .join("<br>"),
          submit: "Close",
        });
      return;
    }
    case "toggle-listing": {
      const publication = state.project.publications.find((item) => item.id === id);
      if (!publication) return;
      const listed = !(publication.listed && !publication.hidden);
      if (listed && !(await confirmAction("Add to the public gallery?", "This published page will be discoverable by anyone visiting the gallery. Its title, description and media are already available to anyone with its link.", "Add to gallery"))) return;
      await api(`/api/publications/${id}`, { method: "PATCH", body: JSON.stringify(listed ? { listed, hidden: false } : { listed }) });
      publication.listed = listed;
      if (listed) publication.hidden = false;
      render();
      notify(listed ? "Added to the public gallery." : "Removed from the gallery; the public link still works.");
      return;
    }
    case "revoke": {
      if (!(await confirmAction("Withdraw this page?", "New visits stop immediately. Copies already downloaded cannot be recalled.", "Withdraw", true))) return;
      await api(`/api/publications/${id}`, { method: "DELETE" });
      state.project.publications = state.project.publications.filter((item) => item.id !== id);
      render();
      notify("Page withdrawn.");
      return;
    }
    case "delete-asset": {
      if (!(await confirmAction("Delete this media?", "Published pages using it are withdrawn. The bytes are removed from this studio. A late generation result cannot bring it back.", "Delete", true))) return;
      await api(`/api/assets/${id}`, { method: "DELETE" });
      state.project.assets = state.project.assets.filter((item) => item.id !== id);
      state.project.publications = state.project.publications.filter((item) => item.assetId !== id);
      location.hash = `#/p/${state.projectId}/library`;
      notify("Media deleted.");
      return;
    }
    case "add-reference": {
      const form = document.querySelector('[data-form="settings"]');
      const title = form.querySelector('[name="referenceTitle"]').value.trim();
      const url = form.querySelector('[name="referenceUrl"]').value.trim();
      if (!title || !url) {
        notify("Give the reference a title and an HTTPS link.", "bad");
        return;
      }
      const references = [...(state.project.references ?? []), { id: `ref_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, title, url, note: "" }];
      await saveSettings({ references });
      form.elements.referenceTitle.value = "";
      form.elements.referenceUrl.value = "";
      notify("Reference added.");
      render();
      return;
    }
    case "remove-reference": {
      const references = (state.project.references ?? []).filter((reference) => reference.id !== id);
      await saveSettings({ references });
      render();
      return;
    }
    case "mix-add": {
      const select = document.querySelector("#mix-add");
      const assetId = select?.value;
      if (!assetId) {
        notify("Choose an audio asset to add.", "bad");
        return;
      }
      if (state.compose.audioTracks.some((track) => track.assetId === assetId)) {
        notify("That track is already in the mix.", "bad");
        return;
      }
      const asset = state.project.assets.find((item) => item.id === assetId);
      state.compose.audioTracks.push({
        assetId,
        role: "music",
        startMs: 0,
        trimStartMs: 0,
        trimEndMs: Number(asset?.durationMs) || 0,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
      });
      state.compose.audioAssetId = null;
      render();
      return;
    }
    case "mix-remove": {
      state.compose.audioTracks.splice(Number(element.dataset.index), 1);
      state.compose.audioAssetId = null;
      render();
      return;
    }
    case "mix-preview": {
      const button = element;
      button.disabled = true;
      try { await mixSoundtrack({ preview: true }); }
      catch (error) { notify(error.message, "bad"); }
      finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    case "mix-render": {
      try {
        await mixSoundtrack();
      } catch (error) {
        notify(error.message, "bad");
      }
      return;
    }
    case "mix-clear":
      state.compose.audioAssetId = null;
      notify("Mixed bed removed from this draft. Its saved audio and source tracks are unchanged.");
      render();
      return;
    case "compose-add":
      if (state.compose.shotIds.includes(id)) return;
      state.compose.shotIds = [...state.compose.shotIds, id];
      render();
      return;
    case "compose-trim": {
      const projectId = state.projectId;
      const draft = state.compose;
      const asset = state.project?.assets.find((item) => item.id === id && item.kind === "video");
      const range = asset && shotRange(draft.shotTrims[id] ?? {}, asset);
      if (!range || !draft.shotIds.includes(id)) { notify("This clip or its measured duration is unavailable.", "bad"); return; }
      let start = String(range.start / 1000), end = String(range.end / 1000), problem = "";
      while (true) {
        const values = await ask({
          title: `Trim ${asset.title}`,
          media: `<video class="trim-preview" src="${esc(asset.file)}" controls playsinline preload="metadata" aria-label="Preview original clip"></video>`,
          copy: `${problem ? `${esc(problem)}<br><br>` : ""}Preview the original clip, then choose the portion to keep. Times are seconds from the original start, to the nearest millisecond. The original and earlier renders stay unchanged. Changing the duration may require a new soundtrack mix; changing a song-linked shot can make its saved captions unavailable for this storyboard.`,
          fields: [
            { name: "start", label: "In point (seconds)", type: "number", value: start, required: true, min: 0, max: asset.durationMs / 1000, step: 0.001 },
            { name: "end", label: "Out point (seconds)", type: "number", value: end, required: true, min: 0, max: asset.durationMs / 1000, step: 0.001 },
          ],
          submit: "Use this portion",
        });
        if (!values) return;
        if (state.projectId !== projectId || state.view !== "project" || state.tab !== "assemble" || state.compose !== draft || !draft.shotIds.includes(id)) { notify("The storyboard changed while the trim was open. Review it before trying again.", "bad"); return; }
        start = values.start; end = values.end;
        const asMs = (value) => /^\d+(?:\.\d{1,3})?$/.test(value) ? Math.round(Number(value) * 1000) : NaN;
        const shot = { trimStartMs: asMs(start), trimEndMs: asMs(end) };
        if (!shotRange(shot, asset)) { problem = "Choose an in point before the out point within the original clip."; continue; }
        draft.shotTrims[id] = shot;
        render();
        if (keyboard) [...app.querySelectorAll('[data-action="compose-trim"]')].find((button) => button.dataset.id === id)?.focus({ preventScroll: true });
        notify("Trim applied to the storyboard draft. Save it when ready.");
        return;
      }
    }
    case "compose-remove":
      state.compose.shotIds = state.compose.shotIds.filter((shotId) => shotId !== id);
      delete state.compose.shotTrims[id];
      render();
      return;
    case "compose-up":
    case "compose-down": {
      const index = state.compose.shotIds.indexOf(id);
      const next = action === "compose-up" ? index - 1 : index + 1;
      if (index < 0 || next < 0 || next >= state.compose.shotIds.length) return;
      const shots = [...state.compose.shotIds];
      [shots[index], shots[next]] = [shots[next], shots[index]];
      state.compose.shotIds = shots;
      render();
      return;
    }
    case "compose-save": {
      if (staleMixedBed()) { notify("Mix again or remove the mismatched mixed bed before saving.", "bad"); return; }
      const title = state.compose.title.trim() || "Untitled storyboard";
      const payload = {
        title,
        shots: draftShots(),
        audioAssetId: state.compose.audioAssetId || null,
        audioTracks: state.compose.audioTracks,
        slateAssetId: state.compose.slateAssetId || null,
      };
      const editingId = state.compose.editingId;
      const projectId = state.projectId;
      if (editingId) {
        let result;
        try {
          result = await api(`/api/projects/${state.projectId}/compositions/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify({ ...payload, expectedUpdatedAt: state.compose.expectedUpdatedAt }),
          });
        } catch (error) {
          if (error.status === 409) {
            try {
              const latest = await api(`/api/projects/${projectId}`);
              if (state.projectId !== projectId || !state.project || !Array.isArray(latest.compositions) || !Array.isArray(latest.assets)) throw new Error("Could not refresh storyboard list");
              state.project.compositions = latest.compositions;
              state.project.assets = latest.assets;
              if (state.view === "project" && state.tab === "assemble") {
                if (mediaMounted) renderReactAssemble(); else render();
              }
              notify("This storyboard changed elsewhere. Your draft is still here. Review saved shot timings below; copy your edits before using Edit shots to load the latest version.", "bad");
            } catch {
              notify("This storyboard changed elsewhere. Your draft is still here; copy it before reloading to review the latest version.", "bad");
            }
            return;
          }
          throw error;
        }
        state.project.compositions = (state.project.compositions ?? []).map((item) =>
          item.id === editingId ? { ...item, ...result.composition } : item,
        );
        state.compose.editingId = editingId;
        state.compose.expectedUpdatedAt = result.composition.updatedAt;
        notify("Storyboard updated. Earlier renders still belong to it.");
      } else {
        const result = await api(`/api/projects/${state.projectId}/compositions`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.project.compositions = [result.composition, ...(state.project.compositions ?? [])];
        state.compose.editingId = result.composition.id;
        state.compose.expectedUpdatedAt = result.composition.updatedAt;
        notify("Storyboard saved. Render it when you are ready.");
      }
      render();
      return;
    }
    case "compose-new":
      state.compose = { shotIds: [], shotTrims: {}, audioAssetId: null, audioTracks: [], slateAssetId: null, title: "", editingId: null };
      render();
      return;
    case "compose-load": {
      if (hasUnsavedStoryboard() && !window.confirm("Discard unsaved storyboard changes and load the saved version?")) return;
      const composition = (state.project.compositions ?? []).find((item) => item.id === id);
      if (!composition) return;
      state.compose = {
        shotIds: composition.shots.map((shot) => shot.assetId),
        shotTrims: Object.fromEntries(composition.shots.filter((shot) => shot.trimStartMs !== undefined && shot.trimEndMs !== undefined).map((shot) => [shot.assetId, { trimStartMs: shot.trimStartMs, trimEndMs: shot.trimEndMs }])),
        audioAssetId: composition.audioAssetId ?? null,
        audioTracks: structuredClone(composition.audioTracks ?? []),
        slateAssetId: composition.slateAssetId ?? null,
        title: composition.title,
        editingId: composition.id,
        expectedUpdatedAt: composition.updatedAt,
      };
      render();
      notify("Loaded into the cut. Saving updates this storyboard and keeps its earlier renders.");
      return;
    }
    case "compose-render": {
      const variant = element.dataset.variant === "social" ? "social" : "assembly";
      const composition = (state.project.compositions ?? []).find((item) => item.id === id);
      if (!composition) return;
      if (composition.shots.some((shot) => shot.trimStartMs !== undefined || shot.trimEndMs !== undefined)) {
        notify("Paid provider rendering cannot preserve these trims. Use the local MP4 renderer.", "bad");
        return;
      }
      const master = state.project.generations
        .filter((generation) => generation.compositionId === composition.id && generation.variant === "assembly" && generation.status === "saved" && generation.assetId)
        .at(-1);
      const estimateMicro = renderEstimate(variant);
      const ok = await confirmAction(
        variant === "social" ? "Make a 9:16 cut?" : "Render this storyboard?",
        `${variant === "social" ? `A one-second 1080 × 1920 slate, then the same ${composition.shots.length} takes in the order you chose, composed into a 720 × 1280 master with the saved sound.` : `${composition.shots.length} clips, ${(composition.totalMs / 1000).toFixed(1)}s assembled.`} Estimated ${money(estimateMicro)}. The participating files are copied to the render provider for this job only.`,
        `Render · ${money(estimateMicro)}`,
      );
      if (!ok) return;
      if (variant === "social") await ensureSlate(composition);
      const result = await api(`/api/projects/${state.projectId}/compositions/${composition.id}/render`, {
        method: "POST",
        body: JSON.stringify({
          model: variant === "social" ? "studio-social" : "studio-assembly",
          clientRequestId: `req_${crypto.randomUUID().replaceAll("-", "")}`,
        }),
      });
      state.project.generations.unshift(result.generation);
      state.project.budget = result.budget;
      notify("Render submitted. You can leave this page; progress is saved.");
      render();
      startPolling();
      return;
    }
    case "open-asset-link":
      recordViewerOrigin(element, id, "open-asset-link");
      location.hash = `#/a/${state.projectId}/${id}`;
      return;
    default:
      return;
  }
}

// React's restyle submit shares the same project cache as Create and History.
// Update only the matching project, without rerendering the active editor.
window.addEventListener("studio:restyle-attempted", (event) => {
  const { projectId, requestId } = event.detail ?? {};
  if (typeof projectId !== "string" || typeof requestId !== "string") return;
  const requests = uncertainRestyleProjects.get(projectId) ?? new Set();
  requests.add(requestId); uncertainRestyleProjects.set(projectId, requests);
});
window.addEventListener("studio:restyle-submitted", (event) => {
  const { projectId, requestId, result } = event.detail ?? {};
  const requests = uncertainRestyleProjects.get(projectId);
  if (requests && typeof requestId === "string" && typeof result?.generation?.id === "string") {
    requests.delete(requestId);
    if (!requests.size) { uncertainRestyleProjects.delete(projectId); historyReadErrors.delete(projectId); }
  }
  if (state.projectId !== projectId || !mergeRestyleResponse(state.project, projectId, result)) return;
  if (mediaMounted && state.view === "project" && state.tab === "history") renderReactHistory();
  // Poll for the current job and budget instead of applying an admission
  // snapshot that could be older than another request's budget update.
  startPolling();
});

function replaceGeneration(generation) {
  const index = state.project.generations.findIndex((item) => item.id === generation.id);
  if (index >= 0) state.project.generations[index] = generation;
}

function replaceReviewRoom(room) {
  if (!state.reviewRooms) state.reviewRooms = [];
  const index = state.reviewRooms.findIndex((item) => item.id === room.id);
  if (index >= 0) state.reviewRooms[index] = room;
  else state.reviewRooms.unshift(room);
}

async function saveSettings(overrides = {}) {
  const form = document.querySelector('[data-form="settings"]');
  const payload = {
    name: form?.querySelector('[name="name"]')?.value ?? state.project.name,
    creativeDirection: form?.querySelector('[name="creativeDirection"]')?.value ?? state.project.creativeDirection,
    visibility: form?.querySelector('[name="visibility"]')?.value ?? state.project.visibility,
    references: state.project.references ?? [],
    ...overrides,
  };
  const result = await api(`/api/projects/${state.projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(state.project, result.project);
  state.projects = state.projects.map((project) => (project.id === state.project.id ? { ...project, ...result.project } : project));
}

async function submitCreate() {
  const create = state.create;
  const model = modelById(create.model);
  if (!model) {
    notify("Choose an available model before creating.", "bad");
    return;
  }
  if (!recipeModelCompatible(recipeBySlug(create.recipeSlug), model)) {
    notify("Choose a model that supports this recipe's reference, or choose another recipe.", "bad");
    return;
  }
  if (model?.promptRequired !== false && !create.prompt.trim()) {
    notify("Describe what you want to create.", "bad");
    return;
  }
  if ((model?.references ?? 0) > 0 && !create.referenceAssetId) {
    notify("Choose the reference still first.", "bad");
    return;
  }
  if (model?.mask && !create.maskAssetId) {
    notify("Save a mask before sending the fill. The studio will not guess which pixels to replace.", "bad");
    return;
  }
  const ok = await confirmAction(
    `Start one new ${create.kind === "video" ? "video" : create.kind === "audio" ? "audio" : model?.edit ? "edit" : "image"} request?`,
    `${model.label} · ${create.kind === "video" ? `${create.durationSeconds}s` : create.kind === "audio" ? (model.audio?.mode === "speech" ? "narration" : `${create.durationSeconds}s`) : model?.edit ? model.edit : create.aspect} · estimated ${money(estimate())}. This can incur provider charges. Repeating the same request replays it instead of billing twice.`,
    `Create · ${money(estimate())}`,
  );
  if (!ok) return;

  const clientRequestId = `req_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await api(`/api/projects/${state.projectId}/generations`, {
    method: "POST",
    body: JSON.stringify({
      kind: create.kind,
      model: create.model,
      recipeId: create.recipeSlug,
      prompt: create.prompt,
      aspect: create.kind === "image" ? (model?.edit ? "match-reference" : create.aspect) : create.kind === "video" ? "from-image" : undefined,
      durationSeconds: create.kind === "video" || (create.kind === "audio" && model?.audio?.mode !== "speech") ? Number(create.durationSeconds) : undefined,
      referenceAssetId: create.kind === "audio" ? undefined : create.referenceAssetId,
      maskAssetId: model?.mask ? create.maskAssetId : undefined,
      parentAssetId: create.parentAssetId,
      clientRequestId,
    }),
  });
  state.project.budget = result.budget;
  state.project.generations.unshift(result.generation);
  if (result.generation.status === "saved") await loadProject(state.projectId);
  state.tab = "history";
  location.hash = `#/p/${state.projectId}/history`;
  render();
  if (result.generation.status === "saved") notify("Created and saved. The result is in your library.");
  else notify("Request submitted. You can leave this page; progress is saved.");
  startPolling();
}

const DERIVATIVE_MAX_BYTES = 1024 * 1024;
const DERIVATIVE_TIMEOUT_MS = 15_000;
// The page-size poster is painted larger than a gallery card. The server
// refuses a poster preview above this long edge, and a thumb above 800.
const POSTER_DERIVATIVE_LONG_EDGE = 1024;
// One backfill pass does a bounded amount of work: a project with many old
// pages is filled over several presses instead of one long blocking run.
const POSTER_BACKFILL_LIMIT = 4;

function thumbProgress(message = "") {
  const node = document.querySelector("[data-thumb-progress]");
  if (node) node.textContent = message;
}

function mediaEvent(target, name, timeout = DERIVATIVE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const settle = (error) => {
      clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
      if (error) reject(error);
      else resolve();
    };
    const done = () => settle(null);
    const fail = () => settle(new Error("This media could not be read in the browser."));
    const timer = setTimeout(() => settle(new Error("Reading this media took too long.")), timeout);
    target.addEventListener(name, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

function derivativeCanvas(source, width, height, longEdge) {
  const size = derivativeSize(width, height, longEdge);
  if (!size) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // A JPEG fallback has no alpha; fill with paper white instead of black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

async function derivativeBlob(canvas, quality = 0.72) {
  if (!canvas) return null;
  let blob = await canvasBlob(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp" || blob.size > DERIVATIVE_MAX_BYTES)
    blob = await canvasBlob(canvas, "image/jpeg", 0.78);
  return blob && blob.size > 0 && blob.size <= DERIVATIVE_MAX_BYTES ? blob : null;
}

async function imageDerivativeBlob(asset, { longEdge, quality } = {}) {
  if (typeof createImageBitmap !== "function") return null;
  const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/file`, { credentials: "same-origin" });
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    return await derivativeBlob(derivativeCanvas(bitmap, bitmap.width, bitmap.height, longEdge), quality);
  } finally {
    bitmap.close?.();
  }
}

async function videoDerivativeBlob(asset) {
  // Detached and muted: this reads one frame without playing sound or adding UI.
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  const metadata = mediaEvent(video, "loadedmetadata");
  video.src = `/api/assets/${encodeURIComponent(asset.id)}/file`;
  try {
    await metadata;
    if (!video.videoWidth || !video.videoHeight) return null;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const seeked = mediaEvent(video, "seeked");
    video.currentTime = Math.min(1, duration * 0.1);
    await seeked;
    return await derivativeBlob(derivativeCanvas(video, video.videoWidth, video.videoHeight));
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

async function uploadDerivative(publication, blob) {
  const form = new FormData();
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  form.append("file", new File([blob], `thumb.${extension}`, { type: blob.type }));
  const result = await api(`/api/publications/${encodeURIComponent(publication.id)}/derivative`, {
    method: "POST",
    body: form,
  });
  return result?.thumb ?? null;
}

async function makePublicPreviewFaster(publication, asset) {
  if (!publication?.id || !asset || !["image", "video"].includes(asset.kind)) return false;
  const blob = asset.kind === "image" ? await imageDerivativeBlob(asset) : await videoDerivativeBlob(asset);
  if (!blob) return false;
  const thumb = await uploadDerivative(publication, blob);
  if (!thumb) return false;
  publication.hasThumb = true;
  return true;
}

/**
 * The page-size preview of the owner's chosen poster, rendered by this browser
 * from that poster's own bytes. Cloudflare Images is unavailable on some
 * accounts (9432, legacy billing), so the canvas is the only reliable path.
 * The poster asset is always an image: a video frame is never substituted here.
 */
async function makePosterPreviewFaster(publication, project = state.project) {
  if (!publication?.id || !publication.posterAssetId || !project) return false;
  const poster = project.assets.find((item) => item.id === publication.posterAssetId && item.kind === "image");
  if (!poster) return false;
  const blob = await imageDerivativeBlob(poster, {
    longEdge: POSTER_DERIVATIVE_LONG_EDGE,
    quality: 0.8,
  });
  if (!blob) return false;
  const form = new FormData();
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  form.append("file", new File([blob], `poster.${extension}`, { type: blob.type }));
  const result = await api(`/api/studio/publications/${encodeURIComponent(publication.id)}/poster-preview`, {
    method: "POST",
    body: form,
    preserveOnUnauthorized: true,
  });
  if (!result?.posterPreview) return false;
  publication.hasPosterPreview = true;
  return true;
}

/**
 * One bounded pass over the pages that have a chosen poster but no preview of
 * it. A page whose stored preview already names its current poster bytes is
 * never sent again, so pressing the button twice does not re-render anything.
 */
async function makePosterPreviewsFaster(project) {
  const pending = project.publications.filter((publication) => publicationHasPosterGap(publication, project));
  const batch = pending.slice(0, POSTER_BACKFILL_LIMIT);
  let made = 0;
  let failed = 0;
  for (const [index, publication] of batch.entries()) {
    if (state.project !== project) break;
    thumbProgress(`Making poster preview ${index + 1} of ${batch.length}…`);
    try {
      if (!(await makePosterPreviewFaster(publication, project)))
        throw new Error("This poster could not be previewed here.");
    } catch {
      failed += 1;
      continue;
    }
    made += 1;
  }
  return { made, failed, total: pending.length, remaining: pending.length - made - failed };
}

async function makePublicPreviewsFaster() {
  const project = state.project;
  if (!project) return;
  const pending = project.publications.filter((publication) => {
    if (publication.hasThumb) return false;
    const asset = project.assets.find((item) => item.id === publication.assetId);
    return asset && ["image", "video"].includes(asset.kind);
  });
  const posterGaps = project.publications.some((publication) => publicationHasPosterGap(publication, project));
  if (!pending.length && !posterGaps) {
    notify("Every image and film page already has a fast preview.");
    return;
  }
  const button = document.querySelector('[data-action="backfill-thumbs"]');
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  let made = 0;
  let failure = null;
  let posters = null;
  try {
    for (const [index, publication] of pending.entries()) {
      if (state.project !== project) {
        thumbProgress("Stopped because the studio changed.");
        return;
      }
      const asset = project.assets.find((item) => item.id === publication.assetId);
      thumbProgress(`Making fast preview ${index + 1} of ${pending.length}…`);
      try {
        if (!(await makePublicPreviewFaster(publication, asset)))
          throw new Error("This file could not be captured here.");
      } catch (error) {
        failure = { index, error };
        break;
      }
      made += 1;
      thumbProgress(`Made ${index + 1} of ${pending.length} fast previews.`);
    }
    // Poster previews are independent of the gallery thumbs: a refused still
    // here must not stop the other kind. The pass stays bounded either way.
    if (state.project === project) posters = await makePosterPreviewsFaster(project);
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
  const parts = [];
  if (pending.length)
    parts.push(`${made}/${pending.length} gallery preview${pending.length === 1 ? "" : "s"}`);
  if (posters?.total)
    parts.push(
      `${posters.made}/${posters.total} poster preview${posters.total === 1 ? "" : "s"}` +
        `${posters.remaining ? ` (${posters.remaining} still to make)` : ""}` +
        `${posters.failed ? ` (${posters.failed} refused)` : ""}`,
    );
  const summary = parts.join(", ");
  if (failure) {
    thumbProgress(`Stopped at ${failure.index + 1} of ${pending.length}: ${failure.error.message}${summary ? ` ${summary}.` : ""}`);
    notify(`Stopped after ${made} fast preview${made === 1 ? "" : "s"}. ${failure.error.message}`, "bad");
    return;
  }
  thumbProgress(`Preview pass finished: ${summary}.`);
  notify(`Preview pass finished: ${summary}.`);
}

function publicationHasPosterGap(publication, project = state.project) {
  if (!publication.posterAssetId || publication.hasPosterPreview) return false;
  return Boolean(project?.assets.find((item) => item.id === publication.posterAssetId && item.kind === "image"));
}

async function publishAsset(assetId, title, description) {
  const asset = state.project.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const values = await ask({
    title: "Publish this piece",
    copy: "The public page includes the title, description, media, download link and any eligible public source credits and links. You can withdraw it later.",
    fields: [
      { name: "title", label: "Public title", value: title ?? asset.title, required: true, maxlength: 100 },
      { name: "description", label: "Public description", type: "textarea", value: description ?? publicCaption(asset.caption), maxlength: 300 },
      ...(asset.kind === "video" && asset.parentAssetId
        ? [{ name: "posterAssetId", label: "Poster asset id (leave as is)", value: asset.parentAssetId, maxlength: 80 }]
        : []),
    ],
    submit: "Publish",
  });
  if (!values) return;
  const result = await api(`/api/assets/${assetId}/publish`, {
    method: "POST",
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      posterAssetId: values.posterAssetId || undefined,
    }),
  });
  await loadProject(state.projectId);
  state.tab = "publish";
  location.hash = `#/p/${state.projectId}/publish`;
  render();
  notify(`Published at ${result.publication.path}`);
  // The page is already live. A browser-captured preview is best effort: losing
  // it never blocks, retracts or delays the publication.
  const target = state.project?.publications?.find((item) => item.id === result.publication.id)
    ?? { id: result.publication.id, path: result.publication.path, hasThumb: false, posterAssetId: values.posterAssetId || null };
  makePublicPreviewFaster(target, asset)
    .then((ready) => {
      if (ready) {
        const live = state.project?.publications?.find((item) => item.id === target.id);
        if (live) live.hasThumb = true;
        return;
      }
      notify("Published. The fast preview will be added later.");
    })
    .catch(() => notify("Published. The fast preview will be added later."));
  // The page-size poster preview comes from the owner's chosen still, never a
  // video frame, and is best effort in the same way: losing it never blocks,
  // retracts or delays the publication.
  if (target.posterAssetId) {
    makePosterPreviewFaster(target)
      .then((ready) => {
        if (!ready) return notify("Published. The poster preview will be added later.");
        const live = state.project?.publications?.find((item) => item.id === target.id);
        if (live) live.hasPosterPreview = true;
      })
      .catch(() => notify("Published. The poster preview will be added later."));
  }
}

async function refreshGeneration(id, manual = false) {
  const projectId = state.projectId;
  const result = await api(`/api/generations/${id}`);
  if (state.projectId !== projectId || state.project?.id !== projectId) return result.generation;
  replaceGeneration(result.generation);
  state.project.budget = result.budget;
  if (mediaMounted && state.view === "project" && state.tab === "history") renderReactHistory();
  else if (mediaMounted && state.view === "project" && state.tab === "assemble") renderReactAssemble();
  else {
    const card = document.querySelector(`[data-job="${id}"]`);
    if (card) card.outerHTML = jobCard(result.generation);
  }
  const budget = app.querySelector("[data-budget-strip]");
  if (budget && state.view === "project") budget.outerHTML = budgetStrip(state.project.budget);
  if (manual) notify(`Status: ${result.generation.status}`);
  if (result.generation.status === "saved") {
    await loadProject(projectId);
    if (state.projectId !== projectId || state.project?.id !== projectId) return result.generation;
    if (mediaMounted && state.view === "project" && state.tab === "history") renderReactHistory();
    else if (mediaMounted && state.view === "project" && state.tab === "assemble") renderReactAssemble();
    else if (!isTyping()) render();
    notify("Result saved to the library.");
  }
  return result.generation;
}

function isTyping() {
  const active = document.activeElement;
  return active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function startPolling() {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    if (!state.project) return;
    const pending = state.project.generations.filter(isPending);
    if (!pending.length) return;
    for (const generation of pending.slice(0, 4)) {
      try {
        await refreshGeneration(generation.id);
      } catch {
        /* transient; next tick */
      }
    }
  }, 4000);
}

/* ---------- uploads ---------- */

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("title", file.name.replace(/\.[^.]+$/, "").slice(0, 100));
    const request = new XMLHttpRequest();
    request.open("POST", `/api/projects/${state.projectId}/assets`);
    request.withCredentials = true;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        notify(`Uploading ${Math.round((event.loaded / event.total) * 100)}%…`);
    });
    request.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* handled below */
      }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload?.error?.message ?? `Upload failed (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check the connection and try again.")));
    request.send(form);
  });
}

async function fileSha256(file) {
  if (!globalThis.crypto?.subtle) throw new Error("Browser hashing is unavailable");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function preflightUpload(projectId, file) {
  const mime = file.type || "";
  if (!mime) return null;
  const sha256 = await fileSha256(file);
  const result = await api(`/api/projects/${encodeURIComponent(projectId)}/assets/preflight`, {
    method: "POST",
    body: JSON.stringify({ sha256, size: file.size, mime }),
  });
  return result?.duplicate ? { ...result, fingerprint: { sha256, size: file.size, mime } } : null;
}

async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const projectId = state.projectId;
  for (const file of list) {
    if (state.projectId !== projectId) return;
    let existing = null;
    try {
      existing = await preflightUpload(projectId, file);
    } catch {
      // A hash or lookup failure must not block the existing upload path. The
      // duplicate offer is a convenience, not a new gate.
    }
    if (existing?.duplicate) {
      const choice = await ask({
        title: "This original is already here",
        copy: `“${esc(existing.duplicate.title)}” already has exactly these bytes, size and type. Reusing it keeps its current rights, lineage and history, and does not upload a second file.`,
        submit: "Reuse existing original",
        cancelLabel: "Upload another copy",
      });
      if (choice) {
        try {
          const reused = await api(`/api/projects/${encodeURIComponent(projectId)}/assets/reuse`, {
            method: "POST",
            body: JSON.stringify({ assetId: existing.duplicate.id, ...existing.fingerprint }),
          });
          if (state.projectId === projectId && !state.project.assets.some((asset) => asset.id === reused.asset.id))
            state.project.assets.unshift(reused.asset);
          notify(`Reused “${reused.asset.title}”. No new file was uploaded.`);
        } catch (error) {
          notify(error.message, "bad");
        }
        continue;
      }
    }
    try {
      const result = await uploadFile(file);
      state.project.assets.unshift(result.asset);
      notify(`Added ${result.asset.title}.`);
    } catch (error) {
      notify(error.message, "bad");
    }
  }
  render();
}

function attachDropzone() {
  const zone = document.querySelector("#dropzone");
  if (!zone) return;
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag");
    uploadFiles(event.dataTransfer.files);
  });
}

async function uploadBlob(blob, title, caption = "") {
  const form = new FormData();
  const extension = blob.type === "image/png" ? "png" : blob.type === "audio/wav" ? "wav" : "bin";
  form.set("file", new File([blob], `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${extension}`, { type: blob.type }));
  form.set("title", title.slice(0, 100));
  form.set("caption", caption.slice(0, 400));
  const response = await fetch(`/api/projects/${state.projectId}/assets`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `Upload failed (${response.status})`);
  state.project.assets.unshift(payload.asset);
  return payload.asset;
}

/* ---------- mask and outpaint ---------- */

let maskPainter = null;
const maskDrafts = new Map();

function attachMask() {
  maskPainter = null;
  const canvas = document.querySelector("#mask-canvas");
  const create = state.create;
  if (!canvas || !create?.referenceAssetId) return;
  const asset = state.project.assets.find((item) => item.id === create.referenceAssetId);
  if (!asset) return;
  const projectId = state.projectId;
  const draftKey = `${projectId}:${asset.id}`;
  const source = new Image();
  source.crossOrigin = "anonymous";
  source.onload = () => {
    if (!canvas.isConnected || state.projectId !== projectId || state.create?.referenceAssetId !== asset.id || !modelById(state.create.model)?.mask) return;
    const max = 1024;
    const scale = Math.min(1, max / Math.max(source.naturalWidth, source.naturalHeight));
    const width = Math.max(64, Math.round(source.naturalWidth * scale));
    const height = Math.max(64, Math.round(source.naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceCanvas.getContext("2d").drawImage(source, 0, 0, width, height);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext("2d");
    maskContext.fillStyle = "#000";
    maskContext.fillRect(0, 0, width, height);
    const savedDraft = maskDrafts.get(draftKey);
    if (savedDraft && savedDraft.width === width && savedDraft.height === height) {
      maskContext.drawImage(savedDraft, 0, 0);
      context.save();
      context.globalCompositeOperation = "screen";
      context.drawImage(maskCanvas, 0, 0);
      context.restore();
    }
    maskDrafts.set(draftKey, maskCanvas);

    let drawing = false;
    let brush = Number(document.querySelector("#mask-brush")?.value ?? 48);
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    const paint = (event) => {
      if (!drawing) return;
      const { x, y } = point(event);
      for (const context of [canvas.getContext("2d"), maskContext]) {
        context.save();
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(x, y, brush / 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      paint(event);
    });
    canvas.addEventListener("pointermove", paint);
    canvas.addEventListener("pointerup", () => {
      drawing = false;
    });
    canvas.addEventListener("pointercancel", () => {
      drawing = false;
    });
    document.querySelector("#mask-brush")?.addEventListener("input", (event) => {
      brush = Number(event.target.value);
    });
    maskPainter = { canvas, sourceCanvas, maskCanvas, sourceAsset: asset };
  };
  source.onerror = () => notify("That still could not be opened for masking.", "bad");
  source.src = asset.file;
}

function maskedCanvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* ---------- deterministic soundtrack mix ---------- */


async function mixSoundtrack({ preview = false } = {}) {
  clearMixPreview();
  const previewVersion = mixPreviewVersion;
  const projectId = state.projectId;
  const assets = [...(state.project?.assets ?? [])];
  const tracks = structuredClone(state.compose.audioTracks);
  if (state.compose.shotIds.length < 2) {
    notify("Add at least two shots before mixing to their duration.", "bad");
    return;
  }
  if (!tracks.length) {
    notify("Add at least one audio track first.", "bad");
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    notify("This browser cannot mix audio offline. Use a browser with the Web Audio API.", "bad");
    return;
  }
  const totalMs = Math.max(
    1,
    draftDuration(),
  );
  if (totalMs > 60000) throw new Error("Choose shots totalling no more than 60 seconds before mixing.");
  const sampleRate = 44100;
  const context = new OfflineAudioContext(2, Math.ceil((totalMs / 1000) * sampleRate), sampleRate);
  notify("Mixing the soundtrack…");
  for (const track of tracks) {
    if (mixPreviewVersion !== previewVersion || state.projectId !== projectId) throw new Error("The storyboard changed while mixing. Try again.");
    const asset = assets.find((item) => item.id === track.assetId);
    if (!asset || asset.kind !== "audio") throw new Error("A source track is no longer available. Choose another track.");
    const response = await fetch(asset.file, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Could not read ${asset.title} for the mix.`);
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    const trimStart = Math.max(0, Number(track.trimStartMs) || 0) / 1000;
    const trimEnd = Math.min(decoded.duration, (Number(track.trimEndMs) || decoded.duration * 1000) / 1000);
    const duration = Math.max(0.05, trimEnd - trimStart);
    const start = Math.max(0, Number(track.startMs) || 0) / 1000;
    const source = context.createBufferSource();
    source.buffer = decoded;
    const gain = context.createGain();
    const level = Math.pow(10, (Number(track.gainDb) || 0) / 20);
    const fadeIn = Math.min(duration, Math.max(0, Number(track.fadeInMs) || 0) / 1000);
    const fadeOut = Math.min(duration, Math.max(0, Number(track.fadeOutMs) || 0) / 1000);
    gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : level, start);
    if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, start + fadeIn);
    gain.gain.setValueAtTime(level, Math.max(start + fadeIn, start + duration - fadeOut));
    if (fadeOut > 0) gain.gain.linearRampToValueAtTime(0.0001, start + duration);
    source.connect(gain).connect(context.destination);
    source.start(start, trimStart, duration);
  }
  const rendered = await context.startRendering();
  if (mixPreviewVersion !== previewVersion || state.projectId !== projectId) throw new Error("The storyboard changed while mixing. Try again.");
  const wav = encodeWav(rendered);
  if (preview) {
    const player = document.querySelector('#mix-preview-player');
    if (!player) return;
    mixPreviewUrl = URL.createObjectURL(wav);
    player.src = mixPreviewUrl;
    player.hidden = false;
    player.onerror = () => { clearMixPreview(); notify("The browser could not play this preview. Try another browser.", "bad"); };
    notify("Preview ready. Play it below; nothing was saved.");
    return;
  }
  const title = `Mixed soundtrack — ${state.compose.title.trim() || "storyboard"}`.slice(0, 100);
  const asset = await uploadBlob(
    wav,
    title,
    `Deterministic browser mix of ${tracks.length} saved track${tracks.length === 1 ? "" : "s"} (${tracks.map((track) => track.role).join(", ")}). Sources and settings are kept in the composition.`,
  );
  state.compose.audioAssetId = asset.id;
  notify("Mixed bed saved as a new WAV. Rendering will use it; the separate tracks remain.");
  render();
}

/* ---------- deterministic 9:16 slate ---------- */

async function ensureSlate(composition) {
  if (composition.slateAssetId) return composition.slateAssetId;
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f4f0e8";
  context.fillRect(0, 0, 1080, 1920);
  context.fillStyle = "#fc5b05";
  context.fillRect(80, 170, 920, 10);
  context.fillStyle = "#17181b";
  context.font = '600 92px "Space Grotesk", system-ui, sans-serif';
  const words = String(composition.title || "A studio cut").split(/\s+/);
  let line = "";
  let y = 330;
  for (const word of words) {
    const next = `${line} ${word}`.trim();
    if (context.measureText(next).width > 900 && line) {
      context.fillText(line, 80, y);
      y += 110;
      line = word;
    } else line = next;
  }
  if (line) context.fillText(line, 80, y);
  context.fillStyle = "#5c616a";
  context.font = '500 30px ui-monospace, monospace';
  context.fillText("A 9:16 CUT", 80, 1690);
  context.fillText("Selected order · contained frame", 80, 1740);
  context.fillStyle = "#fc5b05";
  context.fillRect(80, 1800, 180, 10);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const asset = await uploadBlob(
    blob,
    `9:16 slate — ${composition.title}`.slice(0, 100),
    "Deterministic 1080 × 1920 opening slate. The selected takes follow in their chosen order; the master is composed at 720 × 1280, not stretched.",
  );
  const result = await api(`/api/projects/${state.projectId}/compositions/${composition.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: composition.title,
      shots: composition.shots.map(({ assetId, trimStartMs, trimEndMs }) => ({ assetId, ...(trimStartMs !== undefined && trimEndMs !== undefined ? { trimStartMs, trimEndMs } : {}) })),
      audioAssetId: composition.audioAssetId || null,
      audioTracks: composition.audioTracks ?? [],
      slateAssetId: asset.id,
      expectedUpdatedAt: composition.updatedAt,
    }),
  });
  state.project.compositions = (state.project.compositions ?? []).map((item) =>
    item.id === composition.id ? { ...item, ...result.composition } : item,
  );
  composition.slateAssetId = asset.id;
  notify("9:16 slate created and saved to the storyboard.");
  return asset.id;
}

/* ---------- audio waveforms ---------- */

const waveformCache = new Map();

function paintWaveform(canvas, peaks) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#d95022";
  const line = getComputedStyle(canvas).getPropertyValue("--line").trim() || "#d8d0c2";
  context.fillStyle = line;
  context.fillRect(0, height / 2, width, 1);
  const bars = peaks.length;
  const gap = 1;
  const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
  context.fillStyle = accent;
  peaks.forEach((peak, index) => {
    const barHeight = Math.max(1.5, peak * (height - 6));
    context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  });
}

async function drawWaveforms() {
  const canvases = Array.from(document.querySelectorAll("canvas[data-waveform]"));
  if (!canvases.length) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  for (const canvas of canvases) {
    const url = canvas.dataset.waveform;
    if (!url) continue;
    try {
      let peaks = waveformCache.get(url);
      if (!peaks) {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) continue;
        const buffer = await response.arrayBuffer();
        const audio = await context.decodeAudioData(buffer.slice(0));
        const channel = audio.getChannelData(0);
        const bucketCount = 120;
        const size = Math.max(1, Math.floor(channel.length / bucketCount));
        peaks = Array.from({ length: bucketCount }, (_, bucket) => {
          let peak = 0;
          for (let index = bucket * size; index < (bucket + 1) * size && index < channel.length; index += 1) {
            const value = Math.abs(channel[index]);
            if (value > peak) peak = value;
          }
          return peak;
        });
        const ceiling = Math.max(...peaks, 0.001);
        peaks = peaks.map((peak) => Math.min(1, peak / ceiling));
        waveformCache.set(url, peaks);
      }
      paintWaveform(canvas, peaks);
    } catch {
      /* An unreadable waveform must not break the studio. */
    }
  }
  context.close().catch(() => {});
}

/* ---------- events ---------- */

// A collapsed clip preview must not keep playing behind the storyboard.
app.addEventListener("toggle", (event) => {
  const details = event.target;
  if (details instanceof HTMLDetailsElement && details.classList.contains("clip-picker-preview") && !details.open) {
    details.querySelector("video")?.pause();
  }
}, true);

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  try {
    await handleAction(target.dataset.action, target, event.detail === 0);
  } catch (error) {
    if (error.message !== "Signed out") notify(error.message, "bad");
  }
});

app.addEventListener("change", async (event) => {
  const mix = event.target.closest("[data-mix]");
  if (mix) {
    const index = Number(mix.dataset.index);
    const track = state.compose.audioTracks[index];
    if (!track) return;
    const key = mix.dataset.mix;
    track[key] = key === "role" ? mix.value : Number(mix.value);
    state.compose.audioAssetId = null;
    render();
    return;
  }
  const composeField = event.target.closest("[data-compose]");
  if (composeField) {
    if (composeField.dataset.compose === "audio") {
      state.compose.audioAssetId = composeField.value || null;
      render();
    }
    return;
  }
  const input = event.target.closest("[data-input]");
  if (!input) return;
  const createOwner = input.closest("[data-create-project]")?.dataset.createProject;
  if (!createEventBelongsToProject(createOwner, state.projectId, createProjectId)) return;
  const kind = input.dataset.input;
  if (kind === "upload") {
    await uploadFiles(input.files);
    return;
  }
  if (kind === "search") return;
  if (kind === "model") {
    state.create.model = input.value;
    const model = modelById(input.value);
    if (model.kind === "image" && !model.aspects.includes(state.create.aspect))
      state.create.aspect = model.aspects[0];
    if (model.kind === "video" && !model.durations.includes(Number(state.create.durationSeconds)))
      state.create.durationSeconds = model.durations[0];
    if ((model.references ?? 0) === 0) state.create.referenceAssetId = null;
    if (!model.mask) state.create.maskAssetId = null;
    render();
    return;
  }
  if (kind === "aspect") {
    state.create.aspect = input.value;
    // The review line names the selected frame and estimate. Without a render
    // the select changes while the summary keeps claiming the old frame.
    render();
    return;
  }
  if (kind === "duration") {
    state.create.durationSeconds = Number(input.value);
    render();
    return;
  }
  if (kind === "audioDuration") {
    state.create.durationSeconds = Number(input.value);
    render();
    return;
  }
  if (kind === "prompt") {
    state.create.prompt = input.value;
    return;
  }
  if (kind === "control") {
    state.create.controls[input.dataset.key] = input.value;
    const recipe = recipeBySlug(state.create.recipeSlug);
    if (recipe) state.create.prompt = promptFromRecipe(recipe, state.create.controls);
    const prompt = document.querySelector('[data-input="prompt"]');
    if (prompt) prompt.value = state.create.prompt;
    return;
  }
});

app.addEventListener("input", (event) => {
  const editedShareId = event.target.closest('[data-form="woodhouse-import"] input[name="assetId"]');
  if (editedShareId) {
    editedShareId.form.elements.reuseConfirmed.checked = false;
    return;
  }
  const composeField = event.target.closest("[data-compose]");
  if (composeField) {
    if (composeField.dataset.compose === "title") state.compose.title = composeField.value;
    return;
  }
  const input = event.target.closest("[data-input]");
  if (!input) return;
  const createOwner = input.closest("[data-create-project]")?.dataset.createProject;
  if (!createEventBelongsToProject(createOwner, state.projectId, createProjectId)) return;
  if (input.dataset.input === "search") {
    state.query = input.value;
    if (mediaMounted) {
      renderReactLibrary();
      drawWaveforms();
    } else {
      const grid = document.querySelector(".asset-grid");
      if (grid) grid.innerHTML = visibleAssets().map(assetCard).join("");
    }
  }
  if (input.dataset.input === "prompt") {
    state.create.prompt = input.value;
    updateCreateSubmit();
  }
  if (input.dataset.input === "control") {
    state.create.controls[input.dataset.key] = input.value;
    const recipe = recipeBySlug(state.create.recipeSlug);
    if (recipe) {
      state.create.prompt = promptFromRecipe(recipe, state.create.controls);
      const prompt = document.querySelector('[data-input="prompt"]');
      if (prompt) prompt.value = state.create.prompt;
      updateCreateSubmit();
    }
  }
});

function updateCreateSubmit() {
  const button = app.querySelector('[data-action="submit-create"]');
  if (!button || !state.create) return;
  const model = modelById(state.create.model);
  button.disabled = !recipeModelCompatible(recipeBySlug(state.create.recipeSlug), model) || (model.references > 0 && !state.create.referenceAssetId)
    || (model.mask && !state.create.maskAssetId)
    || (model.promptRequired !== false && !state.create.prompt.trim());
}

app.addEventListener("submit", async (event) => {
  const importForm = event.target.closest('[data-form="woodhouse-import"]');
  if (importForm) {
    event.preventDefault();
    const projectId = importForm.closest("details.share-import")?.dataset.projectId;
    if (!projectId || projectId !== state.projectId) return;
    const values = new FormData(importForm);
    const submit = importForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { asset } = await api(`/api/projects/${projectId}/assets/woodhouse`, {
        method: "POST",
        body: JSON.stringify({
          assetId: values.get("assetId").trim(),
          reuseConfirmed: values.has("reuseConfirmed"),
        }),
      });
      if (state.project?.id === projectId) {
        if (!state.project.assets.some((entry) => entry.id === asset.id))
          state.project.assets.unshift(asset);
        state.query = "";
        state.filter = "all";
        importForm.reset();
        const details = importForm.closest("details.share-import");
        if (details) details.open = false;
        shareImportDrafts.delete(projectId);
        render();
      }
      notify(`Saved ${asset.title}.`);
    } catch (error) {
      notify(error.message, "bad");
    } finally {
      submit.disabled = false;
    }
    return;
  }
  const reviewCreate = event.target.closest('[data-form="review-create"]');
  if (reviewCreate) {
    event.preventDefault();
    if (!state.session?.actions.includes("edit") || !state.projectId) return;
    const values = new FormData(reviewCreate);
    const submit = reviewCreate.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(state.projectId)}/review-rooms`, {
        method: "POST",
        body: JSON.stringify({
          assetId: String(values.get("assetId") ?? ""),
          versionLabel: String(values.get("versionLabel") ?? ""),
          expiresInHours: Number(values.get("expiresInHours") ?? 168),
        }),
      });
      replaceReviewRoom(result.room);
      state.reviewLinks.set(result.room.id, new URL(result.reviewUrl, location.origin).href);
      state.reviewCompare = null;
      render();
      notify("Private review link created. Copy it now; this is the only time it is shown.");
    } catch (error) {
      notify(error.message, "bad");
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }
  const form = event.target.closest('[data-form="settings"]');
  if (!form) return;
  event.preventDefault();
  try {
    await saveSettings();
    await loadProject(state.projectId);
    settingsDrafts.set(state.projectId, { name: state.project.name, creativeDirection: state.project.creativeDirection, visibility: state.project.visibility, referenceTitle: form.elements.referenceTitle.value, referenceUrl: form.elements.referenceUrl.value });
    form.removeAttribute("data-project-id");
    render();
    notify("Studio saved.");
  } catch (error) {
    notify(error.message, "bad");
  }
});

document.querySelector("#signout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.href = "/login";
});

window.addEventListener("hashchange", async () => {
  viewerClosing = false;
  const route = parseHash();
  if (route.view === "invalid") {
    rejectMalformedHash();
    return;
  }
  const unknownTab = route.unknownTab ?? null;
  state.view = route.view;
  state.projectId = route.projectId ?? null;
  state.tab = PROJECT_TABS.includes(route.tab) ? route.tab : "library";
  if (route.view === "asset") state.assetId = route.assetId;
  else viewerFocusKey = null;
  // Keep a return record only for the tab that is actually returning; a
  // manual navigation elsewhere must not inherit someone else's scroll/focus.
  if (route.view !== "asset" && viewerReturn && (route.view !== "project" || viewerReturn.projectId !== state.projectId || viewerReturn.tab !== state.tab)) viewerReturn = null;
  if (route.view === "home") {
    const data = await api("/api/state");
    state.projects = data.projects;
    state.showcase = data.showcase ?? [];
    render();
    return;
  }
  if (!state.project || state.project.id !== state.projectId) {
    const requestedProject = state.projectId;
    state.reviewRooms = null;
    state.reviewCompare = null;
    state.reviewLinks?.clear();
    render(); // Remove the previous project's private UI while access is checked.
    try { await loadProject(requestedProject); }
    catch (error) {
      if (state.projectId === requestedProject && error.message !== "Signed out") app.innerHTML = '<div class="card"><h1>Could not open this studio</h1><p>Check your access and try again.</p><a href="#/">Back to studios</a></div>';
      return;
    }
    if (state.projectId !== requestedProject) return;
  }
  rememberOpenedProject(route);
  if (route.view === "project" && route.tab === "review") {
    try { await loadReviewRooms(route.projectId); }
    catch (error) { if (state.projectId === route.projectId) { state.reviewRooms = []; notify(error.message, "bad"); } }
  }
  if (route.view === "project" && route.tab === "history" && uncertainRestyleProjects.has(route.projectId)) {
    await refreshUncertainHistory(route.projectId);
    if (state.projectId !== route.projectId || state.view !== "project" || state.tab !== "history") return;
  }
  render();
  if (unknownTab) rejectUnknownTab();
});

boot().catch((error) => {
  if (error.message === "Signed out") return;
  app.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div>`;
});
