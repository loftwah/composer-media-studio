// MIT. The signed-in studio shell, the owner login page and the header they
// share with the private Compare page. Moved verbatim out of ui.mjs for #198;
// rendered bytes, URLs, security metadata and session handling are unchanged.
// page-head.ts owns the document chrome, and util.mjs supplies escapeHtml.

import { escapeHtml } from "./util.mjs";
import { composerShare } from "./composer-share.ts";
import { head, brandMark as mark, brandByline } from "./page-head.ts";
import type { StudioSession } from "./auth.ts";

/** Only the signed-in fields the shell displays. The signed StudioSession is
 *  wider; legacy and synthetic sessions may carry fewer claims, so every
 *  displayed field is optional here. Nothing else is read from the session. */
export type StudioShellSession = Partial<Pick<StudioSession, "mode" | "actorName" | "workspaceName" | "project">>;

/** A Node-compatible process global may be present at runtime. A narrow local
 *  declaration keeps the original guard and import graph: no node: module is
 *  imported into the Worker bundle. */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** Optional installation identity for the Director. This is public display copy,
 * never a secret. An unset or blank value keeps the neutral "Creative Director";
 * the Worker shell publishes it for the browser without changing any prompt. */
function normalizeDirectorName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const plain = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const name = Array.from(plain).slice(0, 40).join("").trim();
  if (!name || ["undefined", "null", "false", "none"].includes(name.toLowerCase())) return null;
  return name;
}

function directorNameFromEnv(): string | null {
  try {
    return typeof process !== "undefined" ? normalizeDirectorName(process.env?.DIRECTOR_NAME) : null;
  } catch {
    return null;
  }
}

export interface StudioHeaderOptions {
  session?: StudioShellSession | null;
  composerOrigin?: string | null;
  storyUrl?: string | null;
  buildUrl?: string | null;
  woodhouseShare?: boolean;
  helpHref?: string;
}

/** Shared header. Compare (in ui.mjs) renders the same bytes as the studio shell. */
export function studioHeader({ session, composerOrigin, storyUrl, buildUrl, woodhouseShare, helpHref = "/help" }: StudioHeaderOptions): string {
  const bridged = session?.mode === "bridge";
  let launcherHome: string | null = null;
  try {
    const candidate = new URL(composerOrigin ?? "");
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) {
      launcherHome = candidate.origin + "/";
    }
  } catch { /* The launcher is optional when no valid Composer origin is configured. */ }
  const context = session
    ? `<p class="session-context"><span>${bridged ? "Opened from App Composer" : "Standalone owner session"}</span>${
        session.actorName ? ` · ${escapeHtml(session.actorName)}` : ""
      }${session.workspaceName && session.workspaceName !== session.actorName ? ` · ${escapeHtml(session.workspaceName)}` : ""}${
        session.project ? ` · project ${escapeHtml(session.project)}` : ""
      }</p>`
    : "";
  return `<header class="site-header">
  <a class="wordmark" href="#/" aria-label="Media Studio home">${mark}<span>Media Studio</span>${brandByline()}</a>
  <nav class="header-nav" aria-label="Studio">
    ${bridged && launcherHome ? `<a class="quiet" href="${escapeHtml(launcherHome)}">App Composer</a>` : ""}
    ${storyUrl ? `<a class="quiet" href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    <a href="#/">Projects</a>
    ${session ? `<a href="/compare">Compare models</a>` : ""}
    ${woodhouseShare ? `<a href="${composerShare}">Share artwork</a>` : ""}
    <a href="${escapeHtml(helpHref)}" target="_blank" rel="noopener">Help</a>
    ${launcherHome ? `<div class="app-launcher">
      <button type="button" class="secondary apps-trigger" data-open-apps aria-controls="app-navigation" aria-label="Open apps" title="Apps and shortcuts (Ctrl/Cmd+K)" aria-haspopup="dialog"><span>Apps</span><kbd>Ctrl K</kbd></button>
      <dialog data-composer-home="${escapeHtml(launcherHome)}" data-launcher-scope="local" id="app-navigation" aria-labelledby="app-navigation-title">
        <div class="dialog-heading"><h2 id="app-navigation-title">Apps and shortcuts</h2><button type="button" data-close-apps autofocus>Close</button></div>
        <label>Find an app or task<input type="search" placeholder="App name, gallery, compare…" autocomplete="off"></label>
        <p class="small" role="status" aria-live="polite"></p>
        <ul>
          <li data-destination data-local-launcher-group="studio"><a href="#/"><span>Studio projects<small>Private work in this studio</small></span></a></li>
          <li data-destination data-local-launcher-group="studio"><a href="/gallery"><span>Public gallery<small>Work published from studios</small></span></a></li>
          ${session ? '<li data-destination data-local-launcher-group="studio"><a href="/compare"><span>Compare models<small>Saved takes for the same job</small></span></a></li>' : ""}
          ${woodhouseShare ? `<li data-destination data-local-launcher-group="studio"><a href="${composerShare}"><span>Share artwork<small>App Composer Share originals</small></span></a></li>` : ""}
          <li data-destination data-local-launcher-group="studio"><a href="${escapeHtml(helpHref)}" target="_blank" rel="noopener"><span>Help<small>Studio guides and limits</small></span></a></li>
          <li data-destination data-local-launcher-group="studio" data-keywords="image editor image workbench resize crop convert rotate batch export"><a href="/tools/images"><span>Edit images<small>Image tools: resize, crop, convert and batch-export local images</small></span></a></li>
          <li data-destination data-local-launcher-group="apps" data-keywords="favicon favicons site icon app icon make create pwa maskable"><a href="https://composer-launch-kit.loftwah.workers.dev/?operation=icons" target="_blank" rel="noopener"><span>Make site icons<small>Open Launch Kit in a new tab</small></span></a></li>
        </ul>
      </dialog>
    </div>` : ""}
    <button class="quiet" id="signout" type="button">Sign out</button>
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button>
  </nav>
  ${context}
</header>${launcherHome ? '<script src="/brand/launcher.js" defer></script>' : ""}`;
}

export interface StudioShellOptions {
  revision: string;
  session?: StudioShellSession | null;
  composerOrigin?: string | null;
  storyUrl?: string | null;
  woodhouseShare?: boolean;
  directorName?: string | null;
}

export function shell({ revision, session = null, composerOrigin = null, storyUrl = null, woodhouseShare = false, directorName = directorNameFromEnv() }: StudioShellOptions): string {
  const configuredDirectorName = normalizeDirectorName(directorName);
  const directorMeta = configuredDirectorName
    ? `<meta name="studio-director-name" content="${escapeHtml(configuredDirectorName)}">`
    : "";
  return `${head({
    title: "Media Studio — make, assemble and keep images, video and sound",
    description:
      "An independent studio for uploads, image generation, reference variations, masked fills, background removal, upscaling, image-to-video, generated music, narration and effects, bounded multi-track assembly, saved compositions and deliberate publishing.",
    extra: `${directorMeta}<meta name="robots" content="noindex"><link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}"><link rel="stylesheet" href="/review.css"><link rel="stylesheet" href="/brand/launcher.css">`,
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
${studioHeader({ session, composerOrigin, storyUrl, woodhouseShare })}
<main id="main" tabindex="-1">
  <div id="app">
    <p class="notice calm">Loading your studio…</p>
  </div>
  <noscript><p class="notice warn">Media Studio needs JavaScript for the studio screens. Published pages still work without it.</p></noscript>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="confirm" aria-labelledby="confirm-title">
  <form method="dialog" class="dialog-body" id="confirm-form">
    <h2 id="confirm-title">Confirm</h2>
    <div id="confirm-copy"></div>
    <div class="row end">
      <button value="cancel" class="secondary" formnovalidate>Cancel</button>
      <button value="ok" class="button">Continue</button>
    </div>
  </form>
</dialog>
<script type="module" src="/studio.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

export interface LoginPageOptions {
  next?: string;
  revision?: string;
  bridged?: boolean;
  composerOrigin?: string | null;
  storyUrl?: string | null;
  woodhouseShare?: boolean;
}

export function loginPage({ next = "/", revision = "dev", bridged = false, composerOrigin = null, storyUrl = null, woodhouseShare = false }: LoginPageOptions): string {
  return `${head({
    title: "Sign in — Media Studio",
    description: "Owner sign-in for an independent Media Studio.",
    extra: `<meta name="robots" content="noindex">`,
  })}
<body>
<div class="login">
  <main class="card" id="main">
    <div class="mark">${mark}</div>
    <div>
      <p class="eyebrow">${bridged ? "App Composer · Media Studio" : "Independent studio"}</p>
      <h1 style="font-size:2rem">Your media, kept here.</h1>
    </div>
    <p>Upload and organise images, video and sound, make and edit new work with a funded model, and publish deliberately. Uploads and the library work without any AI account.</p>
    ${bridged ? `<p class="notice calm">Open this studio from App Composer. Your existing Composer sign-in carries you in; there is no second password.</p>
    <p><a class="button" data-composer-sign-in href="${escapeHtml(composerOrigin || "https://composer.loftwah.com")}/media-studio/studio">Continue with App Composer</a></p>
    ${storyUrl ? `<p class="small"><a href="${escapeHtml(storyUrl)}">Read how this studio was built</a></p>` : ""}
    <details><summary>Standalone owner sign-in</summary>` : ""}
    <form id="login-form" class="stack">
      <label>Owner passphrase
        <input name="username" type="text" autocomplete="username" value="owner" hidden>
        <input name="passphrase" type="password" autocomplete="current-password" required minlength="16" autofocus>
      </label>
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <button class="button" type="submit">${bridged ? "Sign in with the owner passphrase" : "Open the studio"}</button>
      <p class="small" role="status" id="login-status"></p>
    </form>
    ${bridged ? "</details>" : ""}
    ${woodhouseShare ? `<p><a href="${composerShare}">Browse Share artwork</a></p>` : ""}
    <p><a href="/tools/images">Resize, crop and convert images</a> · <a href="/tools/audio-trim">Trim a song</a> · <a href="/tools/video-clip">Clip and frame a video</a> · <a href="/tools/add-music">Add music</a> · no sign-in needed</p>
    <p class="small">Your media stays in this studio. The owner passphrase is separate from your App Composer password.</p>
  </main>
</div>
<script type="module" src="/login.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}
