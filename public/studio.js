import { encodeWav } from "./wav.js";
// MIT. Media Studio client. Vanilla, same-origin, no build step.

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const confirmDialog = document.querySelector("#confirm");
let creativeHome = null;
let homeMounted = false;
let mediaMounted = false;
let bootReady = false;
let libraryReturn = null;
const shareImportDrafts = new Map();
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
  compose: { shotIds: [], audioAssetId: null, audioTracks: [], slateAssetId: null, title: "", editingId: null },
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
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 401 && !path.startsWith("/api/login")) {
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
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { view: "home" };
  const [segment, id, tab] = hash.split("/");
  if (segment === "p" && id) return { view: "project", projectId: id, tab: tab || "library" };
  if (segment === "a" && id && tab) return { view: "asset", projectId: id, assetId: tab };
  return { view: "home" };
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
  state.recipes = data.recipes;
  state.videosConfigured = data.videosConfigured;
  state.destinations = data.destinations ?? {};
  state.woodhouseShare = data.woodhouseShare === true;
  state.showcase = data.showcase ?? [];
  const route = parseHash();
  state.view = route.view;
  state.projectId = route.projectId ?? null;
  state.tab = route.tab ?? "library";
  if (state.view === "project" || state.view === "asset") {
    if (state.view === "asset") state.assetId = route.assetId;
    await loadProject(state.projectId);
  }
  if (state.view === "home") await creativeModuleReady;
  bootReady = true;
  render();
  startPolling();
}

async function loadProject(id) {
  const data = await api(`/api/projects/${id}`);
  if (state.projectId !== id) return data;
  state.project = data.project;
  state.project.assets = data.assets;
  state.project.generations = data.generations;
  state.project.recipes = data.recipes;
  state.project.publications = data.publications;
  state.project.compositions = data.compositions ?? [];
  state.project.budget = data.budget;
  if (!state.create)
    state.create = defaultCreate();
  return data;
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
  return state.models.find((model) => model.id === id) ?? null;
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

function render() {
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
        videosConfigured: state.videosConfigured,
        woodhouseShare: state.woodhouseShare,
        showcase: state.showcase, canEdit: state.session?.actions.includes("edit") ?? false,
      });
    } else app.innerHTML = homeView();
  } else if (state.view === "asset") {
    if (homeMounted) { creativeHome.unmountHome(); homeMounted = false; }
    if (creativeHome) {
      app.innerHTML = '<div id="creative-media"></div>';
      const asset = state.project?.assets.find((item) => item.id === state.assetId) ?? null;
      const still = asset?.reuseStillId ? state.project.assets.find((item) => item.id === asset.reuseStillId) ?? null : null;
      creativeHome.renderViewer(app.querySelector("#creative-media"), {
        projectId: state.projectId, asset, still, launchKitUrl: state.destinations?.launchKitUrl ?? null,
      });
      mediaMounted = true;
    } else app.innerHTML = assetView();
  } else {
    if (homeMounted) { creativeHome.unmountHome(); homeMounted = false; }
    app.innerHTML = projectView();
    if (creativeHome && state.tab === "library" && state.project) {
      renderReactLibrary();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "create" && state.project) {
      renderReactCreate();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "assemble" && state.project) {
      renderReactAssemble();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "settings" && state.project) {
      creativeHome.renderSettings(app.querySelector("#creative-media"), { project: state.project, draft: settingsDrafts.get(state.projectId) });
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "history" && state.project) {
      renderReactHistory();
      mediaMounted = true;
    }
    if (creativeHome && state.tab === "publish" && state.project) {
      creativeHome.renderPublish(app.querySelector("#creative-media"), { publications: state.project.publications, origin: location.origin });
      mediaMounted = true;
    }
    attachDropzone();
    if (state.tab === "library") restoreShareImportDraft();
    if (state.tab === "create") attachMask();
    if (state.tab === "library" && libraryReturn?.projectId === state.projectId) {
      const previous = libraryReturn;
      libraryReturn = null;
      requestAnimationFrame(() => {
        if (state.view !== "project" || state.tab !== "library" || state.projectId !== previous.projectId) return;
        const item = [...app.querySelectorAll('[data-action="open-asset"]')].find((button) => button.dataset.id === previous.assetId);
        item?.focus({ preventScroll: true });
        window.scrollTo(0, previous.scrollY);
      });
    }
  }
  drawWaveforms();
}

function renderReactLibrary() {
  const comparison = comparisons.get(state.projectId) ?? { active: false, ids: [] };
  comparison.ids = comparison.ids.filter((id) => state.project.assets.some((asset) => asset.id === id && asset.kind === "image"));
  comparisons.set(state.projectId, comparison);
  creativeHome.renderLibrary(app.querySelector("#creative-media"), {
    projectId: state.projectId, assets: state.project.assets, query: state.query, filter: state.filter, comparing: comparison.active, compareIds: comparison.ids,
    canImportShare: state.woodhouseShare && state.session?.actions.includes("edit"),
  });
}

function hasUnsavedStoryboard() {
  const draft = state.compose;
  const saved = (state.project?.compositions ?? []).find((item) => item.id === draft.editingId);
  if (!saved) return Boolean(draft.title.trim() || draft.shotIds.length || draft.audioTracks.length || draft.audioAssetId || draft.slateAssetId);
  const comparable = (value) => JSON.stringify(value);
  return draft.title !== saved.title || comparable(draft.shotIds) !== comparable(saved.shots.map((shot) => shot.assetId)) ||
    comparable(draft.audioTracks) !== comparable(saved.audioTracks ?? []) ||
    (draft.audioAssetId ?? null) !== (saved.audioAssetId ?? null) || (draft.slateAssetId ?? null) !== (saved.slateAssetId ?? null);
}

function renderReactAssemble() {
  creativeHome.renderAssemble(app.querySelector("#creative-media"), { projectId: state.projectId, canEdit: Boolean(state.session?.actions.includes("edit")), onSongStoryboard: (composition) => {
    if (!state.project || state.project.id !== composition.projectId || state.view !== "project" || state.tab !== "assemble") return;
    state.project.compositions = [composition, ...(state.project.compositions ?? []).filter((item) => item.id !== composition.id)];
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
  const model = modelById(create.model) ?? models[0] ?? null;
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

function projectView() {
  const project = state.project;
  if (!project) return `<p class="notice">Loading…</p>`;
  return `
    <div class="spread">
      <div>
        <p class="eyebrow">${esc(project.visibility === "unlisted" ? "Unlisted studio" : "Private studio")}</p>
        <h1 style="margin-bottom:0.2rem">${esc(project.name)}</h1>
        <p class="small" style="margin:0">${esc(project.creativeDirection || "No creative direction saved yet.")}</p>
      </div>
      <div class="row">
        <a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Export</a>
        <button class="button" data-action="tab" data-tab="create">Create</button>
      </div>
    </div>
    ${budgetStrip(project.budget)}
    <nav class="tabs" aria-label="Studio sections">
      ${["library", "create", "assemble", "history", "publish", "settings"]
        .map((tab) => `<button role="tab" aria-selected="${state.tab === tab}" data-action="tab" data-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}${tab === "history" && project.generations.some(isPending) ? " ·" : ""}</button>`)
        .join("")}
    </nav>
    <section role="tabpanel" aria-label="${esc(state.tab)}">
      ${state.tab === "library" ? (creativeHome ? '<div id="creative-media"></div>' : libraryView()) : ""}
      ${state.tab === "create" ? (creativeHome ? '<div id="creative-media"></div>' : createView()) : ""}
      ${state.tab === "assemble" ? (creativeHome ? '<div id="creative-media"></div>' : composeView()) : ""}
      ${state.tab === "history" ? (creativeHome ? '<div id="creative-media"></div>' : historyView()) : ""}
      ${state.tab === "publish" ? (creativeHome ? '<div id="creative-media"></div>' : publishView()) : ""}
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
          <p class="small">Find the asset ID in <a href="/portfolio" target="_blank" rel="noopener">Share artwork</a>. The original and source credit are saved to this project.</p>
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
      ? `<video src="${esc(asset.file)}" preload="metadata" muted playsinline aria-label="${esc(asset.title)}"></video>`
      : asset.kind === "audio"
        ? `<span class="audio-card"><canvas width="240" height="64" data-waveform="${esc(asset.file)}" aria-hidden="true"></canvas><span class="audio-time">${asset.durationMs ? (asset.durationMs / 1000).toFixed(1) + "s" : "audio"}</span></span>`
        : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}" loading="lazy" decoding="async">`;
  return `<article class="asset">
    <button class="thumb" data-action="open-asset" data-id="${esc(asset.id)}" aria-label="Open ${esc(asset.title)}">${media}<span class="badge">${esc(asset.kind)}</span></button>
    <div class="meta">
      <strong title="${esc(asset.title)}">${esc(asset.title)}</strong>
      <small>${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}${bytesLabel(asset.bytes)} · ${esc(asset.source)}</small>
    </div>
    <button data-action="open-asset" data-id="${esc(asset.id)}">Open</button>
  </article>`;
}

function createView() {
  const create = state.create;
  const recipes = state.project.recipes.filter((recipe) => recipe.kind === create.kind);
  const models = state.models.filter((model) => model.kind === create.kind && (model.references > 0 ? true : true));
  const model = modelById(create.model) ?? models[0];
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
    ${executionFailed ? `<p class="notice warn">The provider finished the last render with an error. The provider's own message is recorded on the job; a new render is a separate request and is not sent automatically.</p>` : ""}
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
            <select data-input="model">${models.map((item) => `<option value="${esc(item.id)}" ${item.id === create.model ? "selected" : ""}>${esc(item.label)} — ${esc(item.provider)}</option>`).join("")}</select>
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
      <div class="spread">
        <div>
          <p class="eyebrow" style="margin-bottom:0.2rem">3 · Review and submit</p>
          <p class="small" style="margin:0">${esc(model?.label ?? "No model")} · ${create.kind === "video" ? `${esc(String(create.durationSeconds))}s` : create.kind === "audio" ? (model?.audio?.mode === "speech" ? "narration" : `${esc(String(create.durationSeconds))}s`) : esc(create.aspect)} · estimated <strong>${money(estimate())}</strong></p>
        </div>
        <button class="button" data-action="submit-create" ${(needsReference && !create.referenceAssetId) || (needsMask && !create.maskAssetId) || (promptRequired && !create.prompt.trim()) ? "disabled" : ""}>${create.kind === "video" ? "Animate this still" : create.kind === "audio" ? "Generate sound" : model?.edit === "fill" ? "Apply fill" : model?.edit === "cutout" ? "Remove background" : model?.edit === "upscale" ? "Upscale still" : "Create image"} · ${money(estimate())}</button>
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
  const totalMs = chosen.reduce((sum, asset) => sum + (asset.durationMs || 0), 0);
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
              <span class="shot-title">${esc(asset.title)}<br><span class="small">${((asset.durationMs || 0) / 1000).toFixed(1)}s · ${asset.width}×${asset.height}</span></span>
              <span class="row">
                <button class="quiet" data-action="compose-up" data-id="${esc(asset.id)}" aria-label="Move ${esc(asset.title)} earlier" ${index === 0 ? "disabled" : ""}>↑</button>
                <button class="quiet" data-action="compose-down" data-id="${esc(asset.id)}" aria-label="Move ${esc(asset.title)} later" ${index === chosen.length - 1 ? "disabled" : ""}>↓</button>
                <button class="quiet" data-action="compose-remove" data-id="${esc(asset.id)}">Remove</button>
              </span>
            </li>`).join("")}
          </ol>
        </div>
        <div class="mixer">
          <div class="spread"><p class="small" style="margin:0"><strong>Soundtrack</strong> · up to four saved tracks</p><span class="small">${compose.audioAssetId ? "mixed bed saved" : "not mixed yet"}</span></div>
          ${compose.audioTracks.length === 0 ? `<p class="small" style="margin:0.4rem 0">Add music, narration or an effect. Trim, gain and fades are applied once in the browser and saved as a new WAV; the separate tracks stay as lineage.</p>` : ""}
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
          <div class="row" style="margin-top:0.6rem">
            <select id="mix-add" aria-label="Add an audio track"><option value="">Choose a saved audio asset</option>${audio.map((asset) => `<option value="${esc(asset.id)}">${esc(asset.title)} · ${asset.durationMs ? (asset.durationMs / 1000).toFixed(0) + "s" : "audio"}</option>`).join("")}</select>
            <button class="secondary" type="button" data-action="mix-add" ${compose.audioTracks.length >= 4 ? "disabled" : ""}>Add track</button>
            <button class="button" type="button" data-action="mix-render" ${compose.audioTracks.length === 0 ? "disabled" : ""}>Mix soundtrack</button>
          </div>
          ${compose.audioAssetId ? `<p class="small" style="margin:0.4rem 0 0">Mixed bed: ${esc(audio.find((item) => item.id === compose.audioAssetId)?.title ?? compose.audioAssetId)}. Rendering uses this saved WAV; the separate tracks remain in the composition manifest.</p>` : ""}
        </div>
        ${audio.length === 0 ? `<p class="small" style="margin:0">Upload or generate sound in Create to add music, narration or an effect.</p>` : ""}
        <div class="row">
          <button class="button" data-action="compose-save" ${chosen.length < 2 || overLimit ? "disabled" : ""}>${compose.editingId ? "Save changes" : "Save storyboard"}</button>
          ${compose.editingId ? `<button class="quiet" data-action="compose-new">Start a new storyboard</button>` : ""}
        </div>
        ${overLimit ? `<p class="small" style="margin:0;color:var(--bad)">Keep the cut under 60 seconds to stay inside the bounded render.</p>` : ""}
      </div>
      <div class="card stack">
        <p class="eyebrow">Saved clips</p>
        ${clips.length === 0 ? `<p class="small" style="margin:0">No clips yet. Animate a still or upload an MP4 first.</p>` : ""}
        <ul class="clip-picker">
          ${clips.map((asset) => {
            const used = compose.shotIds.includes(asset.id);
            return `<li><span>${esc(asset.title)} <span class="small">${((asset.durationMs || 0) / 1000).toFixed(1)}s</span></span>
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
  return `<article class="job">
    <header>
      <div class="row"><strong>${esc(composition.title)}</strong><span class="small">${composition.shots.length} shots · ${(composition.totalMs / 1000).toFixed(1)}s${composition.audioAssetId ? " · mixed bed" : ""}${composition.audioTracks?.length ? ` · ${composition.audioTracks.length} source tracks` : ""}</span></div>
      <span class="small">${dateLabel(composition.createdAt)}</span>
    </header>
    ${changedSinceRender(composition, renders) ? `<p class="small" style="margin:0"><strong>Changed since the last render.</strong> Render again to include the latest edits; earlier results are kept.</p>` : ""}
    <div class="row">
      <button class="button secondary" data-action="compose-render" data-variant="assembly" data-id="${esc(composition.id)}" ${pending ? "disabled" : ""}>Render master · ${money(renderEstimate("assembly"))}</button>
      <button class="button secondary" data-action="compose-render" data-variant="social" data-id="${esc(composition.id)}" ${pending ? "disabled" : ""} title="The selected order, composed into a 720 × 1280 (9:16) master with the saved sound, after a one-second vertical slate">Make 9:16 cut · ${money(renderEstimate("social"))}</button>
      <button class="quiet" data-action="compose-load" data-id="${esc(composition.id)}">Edit shots</button>
    </div>
    <div class="render-list">
      ${renders.length === 0 ? `<p class="small" style="margin:0">No render yet. Rendering copies the participating clips and audio to the render provider for this job only.</p>` : ""}
      ${renders.map((generation) => {
        const asset = state.project.assets.find((item) => item.id === generation.assetId);
        return `<div class="render-row" data-job="${esc(generation.id)}">
          <div class="row">${statusChip(generation.status)}<strong>${esc(generation.variant === "social" ? "9:16 cut" : "Assembled master")}</strong><span class="small">Estimated allocation: ${money(generation.costObservedMicro ?? generation.costEstimateMicro)}</span></div>
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
  const asset = state.project.assets.find((item) => item.id === generation.assetId);
  const pending = isPending(generation);
  const canCancel = ["admitted", "submitting", "submitted", "running"].includes(generation.status);
  const canRetrySave = ["provider_complete", "saving"].includes(generation.status);
  return `<article class="job" data-job="${esc(generation.id)}">
    <header>
      <div class="row">${statusChip(generation.status)}<strong>${esc(model?.label ?? generation.model)}</strong><span class="small">${esc(generation.kind)} · ${dateLabel(generation.createdAt)} ${timeLabel(generation.createdAt)}</span></div>
      <span class="small">Estimated allocation: ${money(generation.costObservedMicro ?? generation.costEstimateMicro)}</span>
    </header>
    <p class="prompt">${esc(generation.prompt)}</p>
    <p class="small">${esc(generation.aspect ?? "")} ${generation.durationSeconds ? `· ${generation.durationSeconds}s` : ""} ${generation.error ? `· ${esc(generation.error.message)}` : ""}</p>
    ${asset ? `<div class="result">${asset.kind === "video" ? `<video src="${esc(asset.file)}" controls preload="metadata"></video>` : asset.kind === "audio" ? `<audio src="${esc(asset.file)}" controls preload="metadata" style="width:100%"></audio>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}" loading="lazy">`}</div>` : ""}
    <div class="row">
      ${asset ? `<button class="secondary" data-action="open-asset" data-id="${esc(asset.id)}">Open result</button><button class="secondary" data-action="reuse-job" data-id="${esc(generation.id)}">Reuse settings</button>` : ""}
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
    <p class="small">Publishing creates a public page with only the title, description and media. Prompts, other projects and private filenames stay private. Withdrawal stops new visits; downloads already taken cannot be recalled.</p>
    <div class="row"><button class="secondary" data-action="publication-policy">First-party publishing settings</button><button class="secondary" data-action="publication-inventory">Review publication inventory</button></div>
    <div class="stack" style="margin-top:0.8rem">
      ${publications.length === 0 ? `<div class="card"><p style="margin:0">Nothing published yet.</p></div>` : ""}
      ${publications
        .map((publication) => `<article class="job">
          <header><strong>${esc(publication.title)}</strong><span class="small">${dateLabel(publication.createdAt)}</span></header>
          <p class="small"><a href="${esc(publication.path)}" target="_blank" rel="noopener">${esc(location.origin + publication.path)}</a></p>
          <p class="small">${publication.hidden ? "Hidden from gallery · anyone with the link can view" : publication.listed ? "Listed in the public gallery" : "Unlisted · anyone with the link can view"}</p>
          <div class="row"><button class="secondary" data-action="toggle-listing" data-id="${esc(publication.id)}">${publication.listed && !publication.hidden ? "Remove from gallery" : "Add to public gallery"}</button><a class="button secondary" href="${esc(publication.path)}" target="_blank" rel="noopener">Open page</a><button class="quiet" data-action="revoke" data-id="${esc(publication.id)}">Withdraw</button></div>
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
        <p class="small" style="margin:0">Links to work that informs this studio. They are notes for you and your agent, never fetched or executed.</p>
        <div id="references">
          ${references.length === 0 ? `<p class="small">No references yet.</p>` : ""}
          ${references.map((reference) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:0.5rem"><span><strong>${esc(reference.title)}</strong><br><a href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer" class="small">${esc(reference.url)}</a></span><button class="quiet" data-action="remove-reference" data-id="${esc(reference.id)}" type="button">Remove</button></div>`).join("")}
        </div>
        <div class="row"><input name="referenceTitle" placeholder="Reference title" maxlength="100"><input name="referenceUrl" type="url" placeholder="https://…"><button class="secondary" type="button" data-action="add-reference">Add</button></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:0.5rem 0">
        <p class="small">Ownership: this studio owns its D1 metadata, R2 media and provider keys. Export downloads the project record, prompts and lineage without secrets. Media files download separately while they still exist.</p>
        <a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Download project export</a>
      </div>
    </form>`;
}

function assetView() {
  const asset = state.project?.assets.find((item) => item.id === state.assetId);
  if (!asset) return `<p class="notice">That asset is no longer in the library. <a href="#/p/${esc(state.projectId)}/library">Back to the library</a>.</p>`;
  const isVideo = asset.kind === "video";
  const isAudio = asset.kind === "audio";
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
    <p><a class="button secondary" href="#/p/${esc(state.projectId)}/library">← Back to library</a></p>
    <div class="viewer">
      <div class="stage">${isVideo ? `<video src="${esc(asset.file)}" controls playsinline preload="metadata"></video>` : isAudio ? `<div class="audio-stage"><canvas width="840" height="200" data-waveform="${esc(asset.file)}" aria-hidden="true"></canvas><audio src="${esc(asset.file)}" controls preload="metadata"></audio></div>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}">`}</div>
      <aside class="card stack">
        <div><p class="eyebrow">${esc(asset.kind)} · ${esc(asset.source)}</p><h1 style="font-size:1.7rem">${esc(asset.title)}</h1></div>
        ${asset.caption ? `<p>${esc(asset.caption)}</p>` : ""}
        <dl class="kv">
          <dt>Size</dt><dd>${bytesLabel(asset.bytes)}</dd>
          ${asset.width ? `<dt>Frame</dt><dd>${asset.width} × ${asset.height}</dd>` : ""}
          ${asset.durationMs ? `<dt>Duration</dt><dd>${(asset.durationMs / 1000).toFixed(1)}s</dd>` : ""}
          ${isAudio && asset.sampleRate ? `<dt>Audio</dt><dd>${asset.sampleRate} Hz · ${asset.channels ?? "—"} channel${asset.channels === 1 ? "" : "s"}</dd>` : ""}
          <dt>Type</dt><dd>${esc(asset.mime)}</dd>
          <dt>Added</dt><dd>${dateLabel(asset.createdAt)}</dd>
          <dt>SHA-256</dt><dd style="word-break:break-all;font-size:0.72rem">${esc(asset.sha256)}</dd>
        </dl>
        <div class="row">
          <a class="button secondary" href="${esc(asset.download)}" download>Download</a>
          <button class="secondary" data-action="rename-asset" data-id="${esc(asset.id)}">Rename</button>
          ${still ? `<button class="secondary" data-action="vary-asset" data-id="${esc(still.id)}">${isVideo ? "Make a variation of its still" : "Make a variation"}</button>` : ""}
        </div>
        <div class="row">
          <button class="secondary" data-action="animate-asset" data-id="${esc(asset.id)}" ${asset.kind === "image" ? "" : "disabled"}>Animate this still</button>
          <button class="secondary" data-action="publish-asset" data-id="${esc(asset.id)}">Publish page</button>
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
    </div>`;
}

/* ---------- dialogs ---------- */

function ask({ title, copy, fields = [], submit = "Continue" }) {
  return new Promise((resolve) => {
    confirmDialog.querySelector("#confirm-title").textContent = title;
    confirmDialog.querySelector("#confirm-copy").innerHTML = `
      <p class="small">${copy}</p>
      ${fields
        .map(
          (field) =>
            `<label style="margin-top:0.6rem">${esc(field.label)}${field.type === "textarea" ? `<textarea name="${esc(field.name)}" maxlength="${field.maxlength ?? 400}" rows="3">${esc(field.value ?? "")}</textarea>` : `<input name="${esc(field.name)}" type="${esc(field.type ?? "text")}" value="${esc(field.value ?? "")}" maxlength="${field.maxlength ?? 200}" ${field.required ? "required" : ""}>`}</label>`,
        )
        .join("")}`;
    const form = confirmDialog.querySelector("#confirm-form");
    form.querySelector('button[value="ok"]').textContent = submit;
    // A previous submission must not turn an Escape or backdrop dismissal into OK.
    confirmDialog.returnValue = "";
    const isEdited = () => [...form.querySelectorAll("input, textarea")].some((input) => input.value !== input.defaultValue);
    const onBackdrop = (event) => {
      if (event.target !== confirmDialog) return;
      const rect = confirmDialog.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
      // Do not silently discard anything typed into a form.
      if (!isEdited()) confirmDialog.close("cancel");
    };
    const onCancel = (event) => {
      if (!isEdited()) return;
      event.preventDefault();
      let message = form.querySelector("[data-dialog-draft-status]");
      if (!message) {
        message = document.createElement("p");
        message.dataset.dialogDraftStatus = "";
        message.setAttribute("role", "status");
        form.querySelector("#confirm-copy").append(message);
      }
      message.textContent = "Your edits are still here. Choose Cancel to discard them.";
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

async function handleAction(action, element) {
  const id = element.dataset.id;
  switch (action) {
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
      state.tab = element.dataset.tab;
      location.hash = `#/p/${state.projectId}/${state.tab}`;
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
    case "kind": {
      state.create.kind = element.dataset.kind;
      if (state.create.kind === "audio") {
        state.create.model = state.project.defaults.audioModel ?? "studio-score";
        state.create.recipeSlug = "";
        state.create.prompt = "";
        state.create.referenceAssetId = null;
        state.create.durationSeconds = 15;
        render();
        return;
      }
      if (state.create.kind === "video") state.create.durationSeconds = 6;
      const recipes = state.project.recipes.filter((recipe) => recipe.kind === state.create.kind);
      state.create.recipeSlug = recipes[0]?.slug ?? state.create.recipeSlug;
      const recipe = recipeBySlug(state.create.recipeSlug);
      if (recipe) {
        state.create.controls = {};
        state.create.prompt = promptFromRecipe(recipe, {});
        state.create.model = recipe.kind === "video" ? (state.project.defaults.videoModel ?? "hailuo-standard") : (recipe.model ?? "studio-draft");
      }
      render();
      return;
    }
    case "recipe": {
      const recipe = recipeBySlug(element.dataset.slug);
      if (!recipe) return;
      state.create.recipeSlug = recipe.slug;
      state.create.kind = recipe.kind;
      state.create.controls = {};
      state.create.prompt = promptFromRecipe(recipe, {});
      state.create.model = recipe.model ?? state.create.model;
      const aspectControl = recipe.controls.find((control) => control.key === "aspect");
      if (aspectControl?.default) state.create.aspect = aspectControl.default;
      const durationControl = recipe.controls.find((control) => control.key === "duration");
      if (durationControl?.default) state.create.durationSeconds = Number(durationControl.default);
      render();
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
      render();
      return;
    }
    case "pick-reference":
      state.create.referenceAssetId = id;
      if (state.create.maskAssetId) state.create.maskAssetId = null;
      render();
      return;
    case "toggle-references":
      state.create.showAllReferences = !state.create.showAllReferences;
      render();
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
      if (state.view === "project" && state.tab === "library") {
        libraryReturn = { projectId: state.projectId, assetId: id, scrollY: window.scrollY };
      }
      location.hash = `#/a/${state.projectId}/${id}`;
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
    case "choose-publish": {
      const assets = state.project.assets;
      if (!assets.length) {
        notify("Upload or generate something first.");
        return;
      }
      const values = await ask({
        title: "Publish a piece",
        copy: "Only the title, description and media become public. Choose an asset by its title.",
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
    case "mix-render": {
      try {
        await mixSoundtrack();
      } catch (error) {
        notify(error.message, "bad");
      }
      return;
    }
    case "compose-add":
      if (state.compose.shotIds.includes(id)) return;
      state.compose.shotIds = [...state.compose.shotIds, id];
      render();
      return;
    case "compose-remove":
      state.compose.shotIds = state.compose.shotIds.filter((shotId) => shotId !== id);
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
      const title = state.compose.title.trim() || "Untitled storyboard";
      const payload = {
        title,
        shots: state.compose.shotIds.map((shotId) => ({ assetId: shotId })),
        audioAssetId: state.compose.audioAssetId || null,
        audioTracks: state.compose.audioTracks,
        slateAssetId: state.compose.slateAssetId || null,
      };
      const editingId = state.compose.editingId;
      if (editingId) {
        const result = await api(`/api/projects/${state.projectId}/compositions/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        state.project.compositions = (state.project.compositions ?? []).map((item) =>
          item.id === editingId ? { ...item, ...result.composition } : item,
        );
        state.compose.editingId = editingId;
        notify("Storyboard updated. Earlier renders still belong to it.");
      } else {
        const result = await api(`/api/projects/${state.projectId}/compositions`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.project.compositions = [result.composition, ...(state.project.compositions ?? [])];
        state.compose.editingId = result.composition.id;
        notify("Storyboard saved. Render it when you are ready.");
      }
      render();
      return;
    }
    case "compose-new":
      state.compose = { shotIds: [], audioAssetId: null, audioTracks: [], slateAssetId: null, title: "", editingId: null };
      render();
      return;
    case "compose-load": {
      if (hasUnsavedStoryboard() && !window.confirm("Discard unsaved storyboard changes and load the saved version?")) return;
      const composition = (state.project.compositions ?? []).find((item) => item.id === id);
      if (!composition) return;
      state.compose = {
        shotIds: composition.shots.map((shot) => shot.assetId),
        audioAssetId: composition.audioAssetId ?? null,
        audioTracks: composition.audioTracks ?? [],
        slateAssetId: composition.slateAssetId ?? null,
        title: composition.title,
        editingId: composition.id,
      };
      render();
      notify("Loaded into the cut. Saving updates this storyboard and keeps its earlier renders.");
      return;
    }
    case "compose-render": {
      const variant = element.dataset.variant === "social" ? "social" : "assembly";
      const composition = (state.project.compositions ?? []).find((item) => item.id === id);
      if (!composition) return;
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
      location.hash = `#/a/${state.projectId}/${id}`;
      return;
    default:
      return;
  }
}

function replaceGeneration(generation) {
  const index = state.project.generations.findIndex((item) => item.id === generation.id);
  if (index >= 0) state.project.generations[index] = generation;
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

async function publishAsset(assetId, title, description) {
  const asset = state.project.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const values = await ask({
    title: "Publish this piece",
    copy: "A public page is created with only the title, description and media. You can withdraw it later.",
    fields: [
      { name: "title", label: "Public title", value: title ?? asset.title, required: true, maxlength: 100 },
      { name: "description", label: "Public description", type: "textarea", value: description ?? asset.caption, maxlength: 300 },
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

async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
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


async function mixSoundtrack() {
  const tracks = state.compose.audioTracks;
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
    1000,
    state.compose.shotIds.reduce((sum, id) => sum + (state.project.assets.find((asset) => asset.id === id)?.durationMs || 0), 0),
  );
  const sampleRate = 44100;
  const context = new OfflineAudioContext(2, Math.ceil((totalMs / 1000) * sampleRate), sampleRate);
  notify("Mixing the soundtrack…");
  for (const track of tracks) {
    const asset = state.project.assets.find((item) => item.id === track.assetId);
    if (!asset) continue;
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
  const wav = encodeWav(rendered);
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
      shots: composition.shots.map((shot) => ({ assetId: shot.assetId })),
      audioAssetId: composition.audioAssetId || null,
      audioTracks: composition.audioTracks ?? [],
      slateAssetId: asset.id,
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

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  try {
    await handleAction(target.dataset.action, target);
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
  const composeField = event.target.closest("[data-compose]");
  if (composeField) {
    if (composeField.dataset.compose === "title") state.compose.title = composeField.value;
    return;
  }
  const input = event.target.closest("[data-input]");
  if (!input) return;
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
  button.disabled = !model || (model.references > 0 && !state.create.referenceAssetId)
    || (model.mask && !state.create.maskAssetId)
    || (model.promptRequired !== false && !state.create.prompt.trim());
}

app.addEventListener("submit", async (event) => {
  const importForm = event.target.closest('[data-form="woodhouse-import"]');
  if (importForm) {
    event.preventDefault();
    const projectId = state.projectId;
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
  const route = parseHash();
  state.view = route.view;
  state.projectId = route.projectId ?? null;
  state.tab = route.tab ?? "library";
  if (route.view === "asset") state.assetId = route.assetId;
  if (route.view === "home") {
    const data = await api("/api/state");
    state.projects = data.projects;
    state.showcase = data.showcase ?? [];
    render();
    return;
  }
  if (!state.project || state.project.id !== state.projectId) await loadProject(state.projectId);
  render();
});

boot().catch((error) => {
  if (error.message === "Signed out") return;
  app.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div>`;
});
