// MIT. Server-rendered shells. The studio itself is progressive, same-origin JS.

import { escapeHtml } from "./util.mjs";
import { shareOrigin, shareProjectName, shareProjects, woodhouseUrl } from "./woodhouse-share.mjs";

const mark = `<img class="brand-mark" src="/brand/composer-icon-tile.svg" width="40" height="40" alt="">`;

const styles = "/studio.css";

// Only explicit web addresses become links; all authored text remains escaped.
function linkPublicDescription(value) {
  const text = String(value);
  const urls = /(?<![\w@:/])https?:\/\/[^\s<>"']+/gi;
  let html = "", cursor = 0;
  for (const match of text.matchAll(urls)) {
    let candidate = match[0];
    const unmatchedClosing = () => {
      const pairs = { ")": "(", "]": "[", "}": "{" };
      const close = candidate.at(-1), open = pairs[close];
      return open && [...candidate].filter((c) => c === close).length > [...candidate].filter((c) => c === open).length;
    };
    while (/[.,!?;:]$/.test(candidate) || unmatchedClosing()) candidate = candidate.slice(0, -1);
    let safe = false;
    try {
      const url = new URL(candidate);
      safe = ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !candidate.includes("\\");
    } catch {}
    if (!safe) continue;
    html += escapeHtml(text.slice(cursor, match.index));
    html += `<a href="${escapeHtml(candidate)}">${escapeHtml(candidate)}</a>`;
    cursor = match.index + candidate.length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function head({
  title,
  description,
  image,
  imageAlt,
  imageType,
  imageWidth,
  imageHeight,
  url,
  kind = "website",
  extra = "",
  theme = true,
  private: isPrivate = false,
}) {
  const hasImage = Boolean(image) && !isPrivate;
  const width = Number.isInteger(imageWidth) && imageWidth > 0 ? imageWidth : null;
  const height = Number.isInteger(imageHeight) && imageHeight > 0 ? imageHeight : null;
  const type = typeof imageType === "string" && imageType.startsWith("image/") ? imageType : null;
  const alt = imageAlt || title;
  const imageTags = hasImage
    ? [
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        type ? `<meta property="og:image:type" content="${escapeHtml(type)}">` : "",
        width ? `<meta property="og:image:width" content="${width}">` : "",
        height ? `<meta property="og:image:height" content="${height}">` : "",
        `<meta property="og:image:alt" content="${escapeHtml(alt)}">`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const twitter = [
    `<meta name="twitter:card" content="${hasImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    hasImage ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : "",
    hasImage ? `<meta name="twitter:image:alt" content="${escapeHtml(alt)}">` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="en"${theme ? ' data-theme="light"' : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#f4f0e8">
${isPrivate ? '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">' : ""}
<link rel="icon" href="/brand/composer-icon-tile.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/composer-icon-tile.svg">
<link rel="preload" href="/brand/space-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${styles}">
${theme ? '<script src="/theme.js" defer></script>' : ""}
${isPrivate ? "" : imageTags}
${isPrivate ? "" : `<meta property="og:type" content="${kind}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}"><link rel="canonical" href="${escapeHtml(url)}">` : ""}
${twitter}`}
${extra}
</head>`;
}

function brandByline() {
  return `<span class="brand-by">App Composer</span>`;
}

function header({ session, composerOrigin, storyUrl, buildUrl, woodhouseShare, helpHref = "/help" }) {
  const bridged = session?.mode === "bridge";
  let launcherHome = null;
  let composerStudioEntry = null;
  try {
    const candidate = new URL(composerOrigin);
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) {
      launcherHome = candidate.origin + "/";
      composerStudioEntry = new URL("/media-studio/studio", candidate.origin).href;
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
    ${bridged && composerStudioEntry ? `<a class="quiet" href="${escapeHtml(composerStudioEntry)}">App Composer</a>` : ""}
    ${storyUrl ? `<a class="quiet" href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    <a href="#/">Projects</a>
    ${session ? `<a href="/compare">Compare models</a>` : ""}
    ${woodhouseShare ? '<a href="/portfolio">Share artwork</a>' : ""}
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
          ${woodhouseShare ? '<li data-destination data-local-launcher-group="studio"><a href="/portfolio"><span>Share artwork<small>Woodhouse Share originals</small></span></a></li>' : ""}
          <li data-destination data-local-launcher-group="studio"><a href="${escapeHtml(helpHref)}" target="_blank" rel="noopener"><span>Help<small>Studio guides and limits</small></span></a></li>
        </ul>
      </dialog>
    </div>` : ""}
    <button class="quiet" id="signout" type="button">Sign out</button>
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button>
  </nav>
  ${context}
</header>${launcherHome ? '<script src="/brand/launcher.js" defer></script>' : ""}`;
}

export function shell({ revision, session = null, composerOrigin = null, storyUrl = null, woodhouseShare = false }) {
  return `${head({
    title: "Media Studio — make, assemble and keep images, video and sound",
    description:
      "An independent studio for uploads, image generation, reference variations, masked fills, background removal, upscaling, image-to-video, generated music, narration and effects, bounded multi-track assembly, saved compositions and deliberate publishing.",
    extra: `<meta name="robots" content="noindex"><link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}"><link rel="stylesheet" href="/review.css"><link rel="stylesheet" href="/brand/launcher.css">`,
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
${header({ session, composerOrigin, storyUrl, woodhouseShare })}
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

export function audioTrimPage({ revision = "dev" } = {}) {
  return `${head({ title: "Trim a song — Media Studio", description: "Trim audio privately on your device and save a WAV.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="audio-trim"><main id="main"><h1>Trim a song</h1><p>JavaScript is required to trim audio on your device.</p></main></div><script type="module" src="/audio-trim.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function videoClipPage({ revision = "dev" } = {}) {
  return `${head({ title: "Clip and frame a video — Media Studio", description: "Clip and frame video privately on your device.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="video-clip"><main id="main"><h1>Clip and frame a video</h1><p>JavaScript is required to edit video on your device.</p></main></div><script type="module" src="/video-clip.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function addMusicPage({ revision = "dev" } = {}) {
  return `${head({ title: "Add music to a video — Media Studio", description: "Add music to video privately on your device.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="add-music"><main id="main"><h1>Add music to a video</h1><p>JavaScript is required to edit video on your device.</p></main></div><script type="module" src="/add-music.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function loginPage({ next = "/", revision = "dev", bridged = false, composerOrigin = null, storyUrl = null, woodhouseShare = false }) {
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
    <p><a class="button" href="${escapeHtml(composerOrigin || "https://composer.loftwah.com")}/media-studio/studio">Continue with App Composer</a></p>
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
    ${woodhouseShare ? '<p><a href="/portfolio">Browse artwork from Woodhouse Share</a></p>' : ""}
    <p><a href="/tools/audio-trim">Trim a song</a> · <a href="/tools/video-clip">Clip and frame a video</a> · <a href="/tools/add-music">Add music</a> · no sign-in needed</p>
    <p class="small">Your media stays in this studio. The owner passphrase is separate from your App Composer password.</p>
  </main>
</div>
<script type="module" src="/login.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

export function publicPage({
  attribution = [],
  galleryBack = "/gallery",
  listed = false,
  title,
  description,
  kind,
  mime,
  width,
  height,
  durationMs,
  bytes,
  media,
  download,
  poster,
  videoPoster,
  posterMime,
  posterWidth,
  posterHeight,
  buildUrl,
  storyUrl,
  origin,
  slug,
}) {
  const url = `${origin}/p/${slug}`;
  const isVideo = kind === "video";
  const isAudio = kind === "audio";
  const hasVideoDimensions = Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0;
  const videoDimensions = hasVideoDimensions ? `width="${width}" height="${height}" style="aspect-ratio:auto ${width} / ${height}"` : "";
  const videoFrameStyle = isVideo && hasVideoDimensions ? ` style="width:min(100%,${Math.min(10000, 82 * width / height)}vh)"` : "";
  const dimensions = width && height ? `${width} × ${height}` : null;
  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;
  const size = bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;
  const facts = [dimensions, duration, size, mime].filter(Boolean).join(" · ");
  const ogImage = isVideo ? poster : isAudio ? null : media;
  const ogImageUrl = ogImage ? `${origin}${ogImage}` : null;
  const ogImageMime = isVideo ? posterMime : mime;
  const ogImageWidth = isVideo ? posterWidth : width;
  const ogImageHeight = isVideo ? posterHeight : height;
  const sourceCredits = (Array.isArray(attribution) ? attribution : []).filter((item) => item && typeof item.credit === "string" && woodhouseUrl(item.sourceUrl)).map((item) => `<li>${escapeHtml(item.credit)} · <a href="${escapeHtml(woodhouseUrl(item.sourceUrl))}">Public source and provenance</a>${item.reuse === "unconfirmed" ? " · Catalogue reuse status: unconfirmed" : ""}</li>`).join("");
  const tablerLicense = (Array.isArray(attribution) && attribution.some((item) => item?.tablerMit === true)) ? `<details><summary>Tabler Icons MIT licence</summary><pre class="licence-copy">${escapeHtml(`MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`)}</pre><p><a href="https://github.com/tabler/tabler-icons/blob/main/LICENSE">Tabler Icons licence source</a></p></details>` : "";
  const actions = [
    buildUrl
      ? `<a class="button" href="${escapeHtml(buildUrl)}">Build your own Media Studio</a>`
      : "",
    storyUrl
      ? `<a class="button secondary" href="${escapeHtml(storyUrl)}">Read how this was made</a>`
      : "",
  ].filter(Boolean);
  const nextCopy = buildUrl
    ? "Take the same kind of studio into your own Cloudflare account, with your own media storage and model keys."
    : "The project, references and decisions behind this published piece.";
  return `${head({
    title,
    description: description || "Published from an independent Media Studio.",
    image: ogImageUrl,
    imageAlt: title,
    imageType: ogImageMime,
    imageWidth: ogImageWidth,
    imageHeight: ogImageHeight,
    url,
    kind: isVideo ? "video.other" : isAudio ? "music.song" : "website",
    extra: `${listed ? "" : '<meta name="robots" content="noindex">'}${isVideo
      ? `<meta property="og:video" content="${escapeHtml(origin + media)}"><meta property="og:video:type" content="${escapeHtml(mime)}">${durationMs ? `<meta property="video:duration" content="${Math.round(durationMs / 1000)}">` : ""}`
      : ""}`,
  })}
<body>
<header class="site-header public-piece-header">
  <a class="wordmark" href="${escapeHtml(origin)}/" aria-label="Media Studio home">${mark}<span>Media Studio</span>${brandByline()}</a>
  <nav class="header-nav" aria-label="Published piece">
    <a href="${escapeHtml(origin + galleryBack)}">← Back to gallery</a>
    ${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    ${buildUrl ? `<a href="${escapeHtml(buildUrl)}">Build your own</a>` : ""}
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false" hidden>Dark</button>
  </nav>
</header>
<main class="public-page" id="main">
  <p class="eyebrow">Published from Media Studio</p>
  <h1>${escapeHtml(title)}</h1>
  ${description ? `<p class="lede">${linkPublicDescription(description)}</p>` : ""}
  <figure style="margin:1.4rem 0">
    <div class="media${isVideo ? " media-video" : ""}"${videoFrameStyle}>
      ${
        isVideo
          ? `<video controls playsinline preload="metadata" ${videoDimensions} ${poster || videoPoster ? `poster="${escapeHtml(videoPoster ?? poster)}"` : ""} aria-label="${escapeHtml(title)}"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this video. <a href="${escapeHtml(download)}">Download it instead</a>.</video>`
          : isAudio
            ? `<audio controls preload="metadata" aria-label="${escapeHtml(title)}" style="width:100%"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this audio. <a href="${escapeHtml(download)}">Download it instead</a>.</audio>`
            : `<img src="${escapeHtml(media)}" alt="${escapeHtml(title)}" ${width ? `width="${width}" height="${height}"` : ""} decoding="async" fetchpriority="high">`
      }
    </div>
    <figcaption class="caption">
      <span>${escapeHtml(facts)}</span>
      <a href="${escapeHtml(download)}" download>Download ${isVideo ? "video" : isAudio ? "audio" : "image"}</a>
    </figcaption>
  </figure>
  ${sourceCredits ? `<section class="public-credits" aria-labelledby="credits-title"><h2 id="credits-title">Source and credit</h2><ul>${sourceCredits}</ul>${tablerLicense}</section>` : ""}
  <p class="small">A deliberately published piece. Private projects, other media, masks and prompts stay in the studio. Withdrawing this page stops new visits here; copies someone already downloaded cannot be recalled.</p>
  ${
    actions.length
      ? `<section class="public-next" aria-labelledby="public-next-title">
    <p class="eyebrow">${buildUrl ? "Make your own" : "Behind this page"}</p>
    <h2 id="public-next-title">${buildUrl ? "Build your own Media Studio" : "How this was made"}</h2>
    <p>${nextCopy}</p>
    <div class="row">${actions.join("")}</div>
  </section>`
      : ""
  }
  <footer class="public-footer">Published with an independently owned Media Studio · <a href="${escapeHtml(origin)}/studio">Owner sign-in</a></footer>
</main>
</body>
</html>`;
}

export function notFoundPage() {
  return `${head({ title: "Not found — Media Studio", description: "This page is not available." })}
<body><main id="main"><p class="eyebrow">404</p><h1>Nothing here.</h1><p>This page may have been withdrawn. <a href="/">Return to the studio</a>.</p></main></body></html>`;
}

export function helpPage({ composerOrigin = null, storyUrl = null } = {}) {
  return `${head({
    title: "How Media Studio works",
    description: "What the studio keeps, what generation costs, how masked edits and multi-track assembly work, and how to recover from a failed save.",
  })}
<body>
<header class="site-header">
  <a class="wordmark" href="/" aria-label="Media Studio home">${mark}<span>Media Studio</span>${brandByline()}</a>
  <nav class="header-nav">${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}<a href="/">Open the studio</a><button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button></nav>
</header>
<main id="main" class="public-page">
  <p class="eyebrow">Help and setup</p>
  <h1>How Media Studio works</h1>
  <p class="lede">Learn what the studio stores, how generation is charged and how to recover your work.</p>

  <h2>Without an AI account</h2>
  <p>Uploads, project collections, search and filters, the viewer, renaming, downloads, deletion, creative references, storyboards, export and public pages all work without any model provider. Nothing on those paths calls a model or spends money.</p>
  <p>Uploads accept JPEG, PNG and WebP images and WAV, MP3 or M4A audio up to 32&nbsp;MB, and MP4 or WebM video up to 64&nbsp;MB. The studio checks the file bytes and records dimensions, duration and audio format. A reference image for generation is capped at 8&nbsp;MB. A saved storyboard can also render to MP4 on a compatible device without a provider or generation charge. Keep the page open while it renders; browser and device support, input size and duration limits apply.</p>

  <h2>Generation and editing</h2>
  <p>Generation uses this studio’s configured providers, rather than a separate personal account:</p>
  <ul>
    <li><strong>Images</strong> run on Cloudflare Workers AI. Studio Print, Studio Film and Studio Draft support square, portrait, landscape and wide frames. Studio Draft uses FLUX.2 Klein 9B; entered jobs keep their original model attribution. Studio Quick makes square drafts. Studio Detail takes one selected still as a reference for a square variation.</li>
    <li><strong>Edits</strong> run on fal.ai. Studio Fill takes a still and a same-size mask to fill or extend an image. Studio Cutout removes the background and returns a transparent PNG. Studio Upscale doubles the still. The original, mask and result are separate assets with their own hashes.</li>
    <li><strong>Video</strong> runs on fal.ai. Animate a still sends the selected image and a motion prompt to an asynchronous image-to-video job, then copies the finished MP4 into this studio's storage.</li>
    <li><strong>Sound</strong> runs on fal.ai too. Studio Score makes an instrumental bed of 10 to 30 seconds; Studio Voice narrates text you supply; Studio Effect makes one short cue. Each is saved as a separate audio asset with its duration, sample rate and channel count. Music, narration and effects can be mixed in the browser with trim, gain and fades, then saved as a new WAV before the render uses it.</li>
    <li><strong>Assembly</strong> starts with a saved storyboard. On a compatible device, render its two to six clips and saved WAV mix or silence locally to an MP4, then download it or save it to the library. Source-clip audio stays muted. A storyboard made from a song plan can also include saved captions. Alternatively, a separately estimated provider render uses short-lived media links; provider availability and result retrieval can fail. Earlier saved results remain in the library.</li>
    <li><strong>Vertical cuts</strong> can be rendered locally on a compatible device; the local output frame is chosen from the first shot and may not be 9:16. Check the resulting dimensions before sharing. The separate provider-based 9:16 workflow is designed for a 720 × 1280 master, but result retrieval returned HTTP 403 on the tested provider account, so a completed provider cut is not confirmed there.</li>
  </ul>
  <p>Every paid generation or provider-render request shows an estimate before you confirm it. The amounts shown as estimated use and reserved are planning figures, not provider invoice charges. The monthly allowance is enforced per project with an atomic check, so two simultaneous requests cannot oversubscribe that project allowance.</p>

  <h2>Access from App Composer</h2>
  <p>An installation opened from App Composer uses the existing Composer sign-in. The handoff carries the current actor, workspace, selected project and only the actions granted there. Read, edit, generate, publish and admin are separate. Every privileged action re-checks the current Composer grant on the server, so revoking a member stops the next dispatch even if their studio tab is still open. A standalone installation uses its own owner passphrase and does not depend on Composer.</p>

  <h2>Connect an agent</h2>
  <p>Add <code>/mcp</code> on this Studio's origin as a Streamable HTTP MCP server in a compatible agent. Sign in, choose one project and review the requested permissions. Read access includes prompts and exports; edit, generate and publish are separate grants. Generation permits spending up to the estimated limit you set for the connection; actual provider charges can differ. Publication permits publishing and withdrawal until the connection expires or is revoked. Connections expire after 30 minutes; <a href="/mcp/connections">manage or disconnect an agent</a> at any time.</p>

  <h2>What the statuses mean</h2>
  <ul>
    <li><strong>Prepared</strong> — the request is saved and ready for dispatch.</li>
    <li><strong>Submitting / Submitted / Generating</strong> — the request is being sent, has been submitted, or is running with the provider.</li>
    <li><strong>Merging / composing</strong> — the 9:16 cut is on its first or second bounded provider call.</li>
    <li><strong>Copying result / Saving</strong> — the provider finished. The studio is saving the exact file bytes and its library record. A save failure can be retried without generating again.</li>
    <li><strong>Saved</strong> — the file and its library record are stored.</li>
    <li><strong>Cancel requested</strong> — the provider was asked to stop. The studio shows what the provider confirmed. A cancellation is not a refund.</li>
    <li><strong>Outcome unknown</strong> — the studio lost the provider's reply or cannot prove what happened. It keeps the reservation and never resubmits automatically. Reconcile when the provider is reachable.</li>
    <li><strong>Discarded after delete</strong> — the job or its asset was deleted before a late result arrived. The result is not restored.</li>
  </ul>

  <h2>Publishing and withdrawing</h2>
  <p>A published page includes its title, description, media, download link and any eligible public source credits and links. Prompts, masks, other projects and filenames stay private. Withdrawing stops new visits immediately, but copies someone already downloaded cannot be recalled. Deleting media also withdraws any page using it.</p>

  <h2>Ownership and recovery</h2>
  <p>The studio keeps its metadata in D1, media in R2 and provider keys in its own secret storage. The metadata project export contains records including prompts, references, song plans and captions. Studio provider keys and session cookies are excluded, but your text and links may contain sensitive information; share the file carefully. Media files download separately while they still exist. The metadata export is not an importable restore or an R2 backup.</p>
  <p>A portable project bundle can include the live media originals and restore them into a fresh owner-controlled Studio. Use the owner CLI described in <code>docs/portable-project.md</code>; provider keys and sessions are still excluded, and restored publications start withdrawn and hidden.</p>
  <p>Code and media restore are separate operations. Restoring an older Worker version does not bring back deleted bytes; restoring bytes does not roll back code.</p>

  <h2>Owner setup for a new installation</h2>
  <ol>
    <li>Create a D1 database and an R2 bucket, then apply the migrations in order.</li>
    <li>Bind them as <code>DB</code> and <code>MEDIA</code>, and add the Workers AI binding <code>AI</code>.</li>
    <li>Set <code>OWNER_PASSPHRASE</code> (at least 16 characters) and <code>SESSION_SECRET</code> (at least 32 characters) as Wrangler secrets.</li>
    <li>Optional video, sound, edits and assembly: set <code>FAL_KEY</code> as a Wrangler secret. Without it, image work and the library still function and the studio says those routes need a key.</li>
    <li>Optional App Composer entry: set <code>BRIDGE_SECRET</code> to the same value as Composer's <code>MEDIA_STUDIO_BRIDGE_SECRET</code>, and set <code>PUBLIC_ORIGIN</code>, <code>COMPOSER_ORIGIN</code> and <code>PUBLIC_STORY_URL</code>.</li>
    <li>Deploy with a clean pushed <code>main</code>. The guarded deploy runs the focused checks first.</li>
  </ol>
  <p class="small">No App Composer account, licence callback or hosted service is required after deployment.</p>
</main>
</body>
</html>`;
}

function shareLink(url, label) {
  const href = woodhouseUrl(url);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : "";
}

function sharePreview(asset, large = false) {
  const href = woodhouseUrl(large ? asset.previewUrl : asset.thumbnailUrl);
  return href
    ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(asset.alt || asset.title)}"
          ${large ? "" : 'loading="lazy"'} decoding="async">`
    : "";
}

function shareCard(asset, context) {
  const detail = new URLSearchParams(context);
  detail.set("asset", asset.id);
  return `<li id="artwork-${escapeHtml(asset.id)}"><a href="/portfolio?${escapeHtml(detail)}">
    ${sharePreview(asset)}<span>${escapeHtml(shareProjectName(asset.project))}</span>
    <strong>${escapeHtml(asset.title)}</strong>
  </a></li>`;
}

function shareDetail(asset, context) {
  const query = context.toString();
  const back = `/portfolio${query ? `?${query}` : ""}#artwork-${encodeURIComponent(asset.id)}`;
  return `<div class="row"><a class="button secondary" href="${escapeHtml(back)}">← Back to artwork</a><a href="/portfolio?project=${encodeURIComponent(asset.project)}">More from ${escapeHtml(shareProjectName(asset.project))}</a></div>
    <div class="share-detail">
      <figure>${sharePreview(asset, true)}</figure>
      <section>
        <h1>${escapeHtml(asset.title)}</h1>
        <p>${escapeHtml(asset.description)}</p>
        <p class="small">${escapeHtml(asset.kind)} · ${escapeHtml(asset.credit)}</p>
        <div class="row">
          ${shareLink(asset.original?.url, "Open original")}
          ${shareLink(asset.sourceUrl, "Source notes")}
          ${shareLink(asset.shareUrl, "Woodhouse gallery")}
        </div>
        <h2>Use in a project</h2>
        <p>Confirm reuse rights in the source notes. In your Studio project, open Library → Import from Woodhouse Share and enter this asset ID.</p>
        <p><code>${escapeHtml(asset.id)}</code></p>
        ${asset.formats?.length ? `<h2>Formats</h2><ul>${asset.formats.map((format) => `<li>${shareLink(format.url, format.label)}</li>`).join("")}</ul>` : ""}
        ${asset.versions?.length ? `<h2>Versions</h2><ul>${asset.versions.map((version) => `<li>${shareLink(version.url, version.label)} · ${escapeHtml(version.note)} ${shareLink(version.sourceUrl, "Source")}</li>`).join("")}</ul>` : ""}
        ${asset.kitUrl ? shareLink(asset.kitUrl, "Open social kit") : ""}
      </section>
    </div>`;
}

function showcaseFilm(film) {
  const slug = encodeURIComponent(film.slug);
  const title = escapeHtml(film.title);
  const duration = Number(film.duration_ms) > 0 ? `${(film.duration_ms / 1000).toFixed(0)} sec` : "Video";
  // The chosen poster is the owner's artwork. Its derived preview is that same
  // picture scaled down, so it may stand in; a video frame may not. Until the
  // poster preview exists, the full poster stays exactly as it was.
  const posterPreview = Boolean(film.poster_asset_id) && Boolean(Number(film.has_poster_preview));
  const poster = posterPreview ? `/p/${slug}/poster-preview` : `/p/${slug}/poster`;
  const size = posterPreview && Number.isSafeInteger(film.preview_w) && film.preview_w > 0 && Number.isSafeInteger(film.preview_h) && film.preview_h > 0
    ? ` width="${film.preview_w}" height="${film.preview_h}"`
    : "";
  const preview = film.poster_asset_id
    ? `<video controls playsinline preload="none" poster="${poster}"${size} aria-label="${title}"><source src="/p/${slug}/media" type="${escapeHtml(film.mime)}"><a href="/p/${slug}">Open ${title}</a></video>`
    : `<a class="film-placeholder" href="/p/${slug}" aria-label="Open ${title}"><span class="film-placeholder-kind">${escapeHtml(duration)} · Published film</span><strong>${title}</strong><span class="film-placeholder-action"><span class="film-play-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16"><path d="M7 4.5v11l8-5.5z" fill="currentColor"/></svg></span>Open film</span><span class="film-placeholder-note">No preview still provided</span></a>`;
  return `<figure>${preview}<figcaption><strong>${title}</strong><p>${escapeHtml(film.description || "")}</p><a href="/p/${slug}">Open the published piece</a></figcaption></figure>`;
}

export function woodhouseGallery({ asset, assets = [], query = "", project = "", after, nextAfter, error, films = [] }) {
  const filters = new URLSearchParams();
  if (query) filters.set("q", query);
  if (project) filters.set("project", project);
  const firstPage = filters.toString() ? "/portfolio?" + filters : "/portfolio";
  if (after) filters.set("after", after);
  const context = new URLSearchParams(filters);
  if (nextAfter) filters.set("after", nextAfter);
  return `${head({
    title: asset ? `${asset.title} — Artwork from Woodhouse Share` : "Artwork from Woodhouse Share — Media Studio",
    description: "Browse the public Woodhouse Share artwork catalogue, originals and versions.",
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <a class="wordmark" href="/">${mark}<span>Media Studio</span></a>
  <nav class="header-nav" aria-label="Portfolio">
    <a href="/portfolio">Share artwork</a>
    <a href="/studio">Open Studio</a>
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button>
  </nav>
</header>
<main id="main" class="share-portfolio">
${error ? `<h1>Share artwork</h1><p role="status">${escapeHtml(error)}</p><p><a href="/portfolio">Browse the catalogue</a> · <a href="${shareOrigin}/share/">Open Woodhouse Share</a></p>`
  : asset ? shareDetail(asset, context)
  : `<section class="share-intro">
      <h1>Artwork from Woodhouse Share</h1>
      <p>Browse public artwork, production captures and alternate editions. Each entry links to its original, credit and source notes.</p>
      <a href="${shareOrigin}/share/">Open Woodhouse Share ↗</a>
    </section>
    ${!query && !project && !after ? `<section class="share-story" aria-labelledby="share-story-title"><div class="share-story-copy"><p class="share-story-kicker">A short Studio story · 31 sec</p><h2 id="share-story-title">From artwork to motion</h2><p>Follow a real visit to the public Studio gallery, see a commissioned illustration used in a local LDraw preview, and watch a separate Studio-generated motion study.</p><p class="small">Silent film. Public gallery recording, local LDraw preview and generated motion are labelled in the film; it does not show the Studio creation process.</p></div><video controls playsinline preload="none" poster="/films/artwork-to-motion-poster.webp" aria-label="From artwork to motion, a silent Media Studio story"><source src="/films/artwork-to-motion.mp4" type="video/mp4"><a href="/films/artwork-to-motion.mp4">Download the film</a></video></section>` : ""}
    ${films.length ? `<section class="share-films" aria-labelledby="share-films-title"><h2 id="share-films-title">Made in Media Studio</h2><p>Watch published work and follow each piece to its source and details.</p><div class="share-film-grid">${films.map(showcaseFilm).join("")}</div></section>` : ""}
    <form class="share-filters" action="/portfolio" method="get" role="search">
      <label>Search artwork <input name="q" type="search" maxlength="100" value="${escapeHtml(query)}"></label>
      <label>Project <select name="project">
        <option value="">All projects</option>
        ${Object.entries(shareProjects).map(([key, label]) => `<option value="${key}"${key === project ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select></label>
      <button class="button" type="submit">Search</button>
    </form>
    ${assets.length ? `<ul class="share-prints">${assets.map((item) => shareCard(item, context)).join("")}</ul>` : '<p>No artwork matches these filters. Try another project or search.</p>'}
    ${after || nextAfter ? `<nav class="row share-pagination" aria-label="Artwork pages">
      ${after ? `<a href="${escapeHtml(firstPage)}">First page</a>` : ""}
      ${nextAfter ? `<a class="button secondary" href="/portfolio?${escapeHtml(filters)}">Next page →</a>` : ""}
    </nav>` : ""}`}
</main>
</body>
</html>`;
}

// The gallery uses listed publications; the home fallback uses only configured public films.
// Keep the published description unchanged; cards point readers to its full version.
function galleryDescription(description) {
  return description.replace(/https?:\/\/[^\s<>"']+/gi, url => {
    const punctuation = url.match(/[.,;!?]+$/)?.[0] || "";
    return `see the work page${punctuation}`;
  });
}

export function publicGallery({ items = [], featured = [], hasMore = false, page = 1, home = false, woodhouseShare = false, buildUrl = null, storyUrl = null, query = "", kind = "", order = "newest" }) {
  const pageHref = (number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind) params.set("kind", kind);
    if (order === "oldest") params.set("order", order);
    params.set("page", String(number));
    return `/gallery?${params}`;
  };
  const option = (value, label, selected) => `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
  const controls = `<form class="gallery-controls" action="/gallery" method="get"><label>Search titles and descriptions<input type="search" name="q" value="${escapeHtml(query)}" maxlength="80" placeholder="Search public work"></label><label>Type<select name="kind">${option("", "All media", !kind)}${option("image", "Images", kind === "image")}${option("video", "Video", kind === "video")}${option("audio", "Audio", kind === "audio")}</select></label><label>Order<select name="order">${option("newest", "Newest first", order !== "oldest")}${option("oldest", "Oldest first", order === "oldest")}</select></label><button type="submit">Apply filters</button>${query || kind || order === "oldest" ? '<a href="/gallery">Clear filters</a>' : ""}</form>`;
  const dimensions = (width, height) =>
    Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
      ? ` width="${width}" height="${height}"`
      : "";
  const previewImage = (src, width, height) =>
    `<img src="${src}" alt=""${dimensions(width, height)} loading="lazy" decoding="async">`;
  const renderCards = (entries) => entries.map((item) => {
    const slug = encodeURIComponent(item.slug);
    const title = escapeHtml(item.title);
    // A stored preview is small and regenerable, so it always beats the full
    // original or a large parent poster. The old routes stay as fallbacks.
    const preview = item.thumb_id
      ? previewImage(`/p/${slug}/thumb`, item.thumb_width, item.thumb_height)
      : item.kind === "image"
        ? previewImage(`/p/${slug}/media`, item.width, item.height)
        : item.kind === "video" && item.poster_asset_id
          ? previewImage(`/p/${slug}/poster`, item.poster_width, item.poster_height)
          : `<span class="gallery-placeholder"><span>${item.kind === "audio" ? "Listen" : "Watch"}</span><strong>${title}</strong><span aria-hidden="true">↗</span></span>`;
    const action = item.kind === "video" ? "Watch film →" : item.kind === "audio" ? "Listen →" : "View image →";
    const pieceHref = `/p/${slug}${home || (!query && !kind && order !== "oldest" && page === 1) ? "" : `?back=${encodeURIComponent(pageHref(page))}`}`;
    return `<li><a class="gallery-card" href="${escapeHtml(pieceHref)}"><span class="gallery-preview">${preview}</span><span class="gallery-card-copy"><strong>${title}</strong><span>${escapeHtml(action)}</span></span>${item.description ? `<span class="gallery-description">${escapeHtml(galleryDescription(item.description))}</span>` : ""}</a></li>`;
  }).join("");
  const heroItem = home ? (items.find((item) => item.kind === "video" && (item.poster_asset_id || item.thumb_id)) || items.find((item) => item.kind === "image")) : null;
  const heroSlug = heroItem ? encodeURIComponent(heroItem.slug) : "";
  const heroSource = heroItem
    ? heroItem.thumb_id
      ? { route: "thumb", width: heroItem.thumb_width, height: heroItem.thumb_height }
      : heroItem.kind === "image"
        ? { route: "media", width: heroItem.width, height: heroItem.height }
        : { route: "poster", width: heroItem.poster_width, height: heroItem.poster_height }
    : null;
  // The hero is the page's largest paint, so it asks for the first bytes. Cards
  // below it stay lazy: the gallery grid defers offscreen cards in studio.css.
  const heroArtwork = heroItem ? `<a class="gallery-hero-art" href="/p/${heroSlug}"><img src="/p/${heroSlug}/${heroSource.route}" alt=""${dimensions(heroSource.width, heroSource.height)} decoding="async" fetchpriority="high"><span><small>Published in Media Studio</small><strong>${escapeHtml(heroItem.title)}</strong><span>Explore this work →</span></span></a>` : "";
  const cards = renderCards(items);
  const featuredCards = renderCards(featured.map((film) => ({ ...film, kind: "video", poster_asset_id: film.hasPoster })));
  return `${head({ title: home ? "Media Studio — work worth keeping" : "Public gallery — Media Studio", description: "Explore images, films and sound deliberately published from Media Studio." })}
<body><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="wordmark" href="/">${mark}<span>Media Studio</span></a><nav class="header-nav" aria-label="Main"><a href="/gallery">Gallery</a>${woodhouseShare ? '<a href="/portfolio">Share artwork</a>' : ""}<a class="button secondary" href="/studio">Open Studio</a><button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button></nav></header>
<main id="main" class="public-gallery${home ? "" : " public-gallery--catalogue"}"><section class="gallery-intro${heroArtwork ? " gallery-intro--art" : ""}"><div class="gallery-intro-copy"><p class="eyebrow">Images · film · sound</p><h1>${home ? "Made to be seen." : "The public gallery."}</h1><p>${home ? "Explore work made and kept in Media Studio." : "Images, films and sound shared by their creators."}</p>${home ? `<div class="gallery-actions"><a class="button" href="/gallery">Explore the gallery →</a>${buildUrl ? `<a class="button secondary" href="${escapeHtml(buildUrl)}">Build your own studio</a>` : ""}${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story →</a>` : ""}</div>` : ""}</div>${heroArtwork}</section>
<section aria-labelledby="gallery-title"><div class="spread gallery-heading"><div><p class="eyebrow">Shared work</p><h2 id="gallery-title">${home ? "From the studio" : "Published work"}</h2></div>${home ? '<a href="/gallery">View all →</a>' : ""}</div>${home ? "" : controls}${items.length ? `<ul class="gallery-grid">${cards}</ul>` : query || kind ? '<p>No published work matches these filters.</p>' : '<p>No work has been added to the public gallery yet.</p>'}
${!home && (page > 1 || hasMore) ? `<nav class="row gallery-pages" aria-label="Gallery pages">${page > 1 ? `<a class="button secondary" href="${escapeHtml(pageHref(page - 1))}">← Previous</a>` : ""}<span>Page ${page}</span>${hasMore ? `<a class="button secondary" href="${escapeHtml(pageHref(page + 1))}">Next →</a>` : ""}</nav>` : ""}</section>${featuredCards ? `<section class="gallery-featured" aria-labelledby="featured-title"><div class="gallery-heading"><p class="eyebrow">Selected public films</p><h2 id="featured-title">Made in Media Studio</h2><p>Explore a selection of published films made in Media Studio.</p></div><ul class="gallery-grid">${featuredCards}</ul>${woodhouseShare ? '<p><a href="/portfolio">See more featured films and artwork →</a></p>' : ""}</section>` : ""}</main></body></html>`;
}

/**
 * The model chooser. Everything on this page comes from saved work, so opening it
 * never calls a provider. Two takes are shown beside each other because that is
 * the only honest way to answer "which should I use".
 */
export function comparePage({ revision = "dev", jobs = [], job = null, project = null, projects = [], entries = [], excluded = [], briefNote = null, verdict = null, weakness = null, session = null, composerOrigin = null, storyUrl = null, woodhouseShare = false, models = {} }) {
  const money = (micro) => (micro === null || micro === undefined || !Number.isFinite(Number(micro)) ? "unknown" : `$${(Number(micro) / 1_000_000).toFixed(Number(micro) < 10_000 ? 4 : 2)}`);
  const when = (value) => (value ? new Date(Number(value)).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown");
  const label = (id) => escapeHtml(models?.[id]?.label ?? id);
  const projectQuery = project?.id ? `project=${encodeURIComponent(project.id)}&` : "";
  const tab = (entry) =>
    `<a class="cmp-tab${entry.id === job?.id ? " is-current" : ""}" href="/compare?${projectQuery}job=${encodeURIComponent(entry.id)}"${entry.id === job?.id ? ' aria-current="page"' : ""}>${escapeHtml(entry.label)}<span>${entry.models.length} model${entry.models.length === 1 ? "" : "s"}</span></a>`;
  const take = (entry, index) => `
    <article class="cmp-take" data-take="${escapeHtml(entry.model)}" data-generation="${escapeHtml(entry.generationId ?? "")}" data-brief="${escapeHtml(entry.briefKey ?? "")}" data-created="${escapeHtml(String(entry.createdAt ?? ""))}">
      <header>
        <div>
          <h3><span class="cmp-model-name">${label(entry.model)}</span><span class="cmp-blind-name">Take ${String.fromCharCode(65 + index)}</span></h3>
          <p class="small">${escapeHtml(entry.kind)} · saved ${when(entry.createdAt)}</p>
        </div>
        <span class="cmp-badge" data-take-badge hidden>Your pick</span>
      </header>
      ${entry.settings?.reference ? `<a class="cmp-source" href="/api/assets/${encodeURIComponent(entry.settings.reference)}/file" target="_blank" rel="noreferrer"><img src="/api/assets/${encodeURIComponent(entry.settings.reference)}/file" alt="Source still used for this take" loading="lazy" decoding="async"><span>Source still</span></a>` : ""}
      <div class="cmp-media">
        ${
          entry.previewUrl
            ? entry.kind === "video"
              ? `<video src="${escapeHtml(entry.previewUrl)}" controls preload="metadata" playsinline></video>`
              : entry.kind === "audio"
                ? `<audio src="${escapeHtml(entry.previewUrl)}" controls preload="metadata"></audio>`
                : `<img src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(entry.prompt || `A still generated by ${models?.[entry.model]?.label ?? entry.model}`)}" loading="lazy" decoding="async">`
            : `<p class="notice warn">The saved bytes for this take are not available.</p>`
        }
      </div>
      ${entry.prompt ? `<p class="cmp-prompt"><span class="small">Brief</span>${escapeHtml(entry.prompt)}</p>` : ""}
      <dl class="cmp-facts">
        <div class="cmp-cost"><dt>Estimate</dt><dd>${money(entry.cost.estimateMicro)}</dd></div>
        <div class="cmp-cost"><dt>Allocated</dt><dd>${money(entry.cost.allocatedMicro)}</dd></div>
        <div class="cmp-cost"><dt>Provider charge</dt><dd>${entry.cost.providerChargedMicro === null ? "not reported" : money(entry.cost.providerChargedMicro)}</dd></div>
        ${entry.width && entry.height ? `<div><dt>Size</dt><dd>${entry.width}×${entry.height}</dd></div>` : ""}
        ${entry.durationMs ? `<div><dt>Length</dt><dd>${(entry.durationMs / 1000).toFixed(1)}s</dd></div>` : ""}
        ${entry.sha256 ? `<div class="cmp-hash"><dt>Output hash</dt><dd><code>${escapeHtml(String(entry.sha256).slice(0, 18))}…</code></dd></div>` : ""}
      </dl>
      <div class="cmp-vote">
        <button type="button" class="secondary" data-pick="${escapeHtml(entry.model)}" aria-pressed="false">I would use this take</button>
        <button type="button" class="quiet" data-reject="${escapeHtml(entry.model)}" aria-pressed="false">Not this one</button>
        <label class="cmp-field"><span class="small">Why, or the moment it breaks</span><input type="text" maxlength="240" data-reason="${escapeHtml(entry.model)}" placeholder="Short note"></label>
        <label class="cmp-field cmp-field-time"><span class="small">At</span><input type="text" maxlength="32" data-at="${escapeHtml(entry.model)}" placeholder="0:04"></label>
      </div>
    </article>`;

  return `${head({
    title: "Which model should do this job — Media Studio",
    description: "Compare retained takes for the same job, with the estimate, the allocation and the provider charge kept separate.",
    extra: `<meta name="robots" content="noindex"><link rel="stylesheet" href="/studio.css?v=${encodeURIComponent(revision)}">`,
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
${header({ session, composerOrigin, storyUrl, woodhouseShare })}
<main id="main" class="cmp-page" tabindex="-1">
  <p class="eyebrow">Choose a model</p>
  <h1>Which model should do this job?</h1>
  <p class="lede">A comparison only makes sense inside one job. These takes were already saved${project ? ` in <strong>${escapeHtml(project.name)}</strong>` : ""}, so nothing here generates, spends or calls a provider.</p>

  ${projects.length && !project ? `<section class="cmp-section" aria-labelledby="cmp-projects-title">
    <h2 id="cmp-projects-title">Choose a studio</h2>
    <p>Saved takes belong to the studio that made them. Choose one to review its matched outputs.</p>
    <ul class="cmp-projects">${projects.map((choice) => `<li><a href="/compare?project=${encodeURIComponent(choice.id)}"><span>${escapeHtml(choice.name)}</span><span class="small">Open comparison</span></a></li>`).join("")}</ul>
  </section>` : ""}

  ${entries.length > 0 ? `<label class="cmp-blind-toggle"><input type="checkbox" data-blind-mode checked> <span>Blind review: hide model names and costs until you choose a take</span></label>` : ""}

  <nav class="cmp-tabs" aria-label="Jobs">${jobs.map(tab).join("")}</nav>

  ${
    verdict
      ? `<section class="cmp-verdict" aria-labelledby="verdict-title" data-verdict><p class="eyebrow">Verdict</p><h2 id="verdict-title" data-verdict-title>${escapeHtml(verdict.headline)}</h2><p data-verdict-detail>${escapeHtml(verdict.detail)}</p></section>`
      : ""
  }

  ${
    job
      ? `<section class="cmp-section" aria-labelledby="job-title"><h2 id="job-title">${escapeHtml(job.label)}</h2><p>${escapeHtml(job.purpose)}</p><p class="small">Matched settings: ${escapeHtml(job.settings)}</p>${job.note ? `<p class="notice warn">${escapeHtml(job.note)}</p>` : ""}</section>`
      : ""
  }

  ${briefNote ? `<p class="notice warn" role="note">${escapeHtml(briefNote)}</p>` : ""}

  ${entries.length > 0 ? `<div class="cmp-grid is-blind">${entries.map(take).join("")}</div>` : `<p class="notice calm">No saved takes for this job yet. Create one from the studio, then come back: a comparison is built from work you already kept.</p>`}

  ${
    excluded.length > 0
      ? `<section class="cmp-section" aria-labelledby="excluded-title"><h2 id="excluded-title">Saved, but not comparable</h2><p>These takes did the same kind of job with a different brief or different settings, so they are not ranked against the ones above.</p><ul>${excluded
          .map(
            (entry) =>
              `<li><strong>${label(entry.model)}</strong> <span class="small">${escapeHtml(entry.settings?.aspect ?? "aspect unknown")} · ${entry.settings?.durationSeconds ? `${entry.settings.durationSeconds}s` : "length unknown"} · ${entry.prompt ? escapeHtml(entry.prompt.slice(0, 90)) : "no brief recorded"}</span></li>`,
          )
          .join("")}</ul></section>`
      : ""
  }

  ${
    weakness
      ? `<section class="cmp-section" aria-labelledby="weak-title"><h2 id="weak-title">One weakness, and who owns it</h2><p>${escapeHtml(weakness.reason)}</p><p class="small">Owner: ${escapeHtml(weakness.owner)}. Next: ${escapeHtml(weakness.next)}</p></section>`
      : ""
  }

  <section class="cmp-section" aria-labelledby="limits-title">
    <h2 id="limits-title">What this page does not claim</h2>
    <ul>
      <li>The provider charge stays “not reported” unless a provider actually told us what it billed. An allocation is the studio's own budget figure, never an invoice.</li>
      <li>These are the newest saved takes per model, not repeated trials. A difference you can see is a difference in one take, not a reliability score.</li>
      <li>Takes are only compared when they share the same instruction and settings. Anything generated from a different brief is listed separately.</li>
      <li>The source still is shown with each take. A clip can run for the requested length and still replace the subject; that is a review finding, not a hidden pass.</li>
      <li>Your pick and your note are stored in this browser only and bound to the exact saved take. They are private by default and are not published anywhere.</li>
      <li>Opening this page never calls a model, so it cannot add a take. New comparisons need a fresh run from the studio.</li>
    </ul>
    <p class="small" id="cmp-status" role="status" aria-live="polite"></p>
    <div class="row"><button type="button" class="secondary" id="cmp-copy">Copy this review as JSON</button><a class="quiet" href="${project?.id ? `/#/p/${encodeURIComponent(project.id)}/history` : "/"}">Back to the studio</a></div>
  </section>
</main>
<script type="module" src="/compare.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

function reviewTime(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  const total = Math.max(0, Number(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function reviewFeedbackList(feedback) {
  if (!feedback.length) return '<p class="small" id="review-feedback-empty">No feedback yet. Comments are bound to this exact saved version.</p>';
  return `<ol class="review-feedback" aria-label="Feedback on this saved version">${feedback.map((item) => {
    let region = null;
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

function reviewDecisionCopy(room) {
  if (room.decision === "approved")
    return `<p class="review-verdict approved"><strong>Reviewer approved this saved version.</strong> Approval here is feedback only. It does not publish, schedule, spend or change project permissions.</p>`;
  if (room.decision === "changes_requested")
    return `<p class="review-verdict changes"><strong>Changes requested.</strong> This decision applies to this saved version only. A new render starts a new review.</p>`;
  return `<p class="review-verdict waiting"><strong>Awaiting review.</strong> Leave specific feedback or record a decision for this saved version.</p>`;
}

function reviewFacts({ kind, width, height, durationMs, bytes, mime }) {
  return [
    kind === "video" ? "film" : "image",
    width && height ? `${width} × ${height}` : null,
    durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null,
    bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null,
    mime,
  ].filter(Boolean).join(" · ");
}

function reviewCompareEntry(reviewPath) {
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
export function reviewRoomPage({ room, feedback = [], mediaPath, reviewPath = "", kind, title, expiresAt }) {
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
export function reviewComparePage({ left, right, primaryToken = "" }) {
  const primaryPath = `/r/${encodeURIComponent(primaryToken)}`;
  const side = (view, position) => {
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

export function reviewRefusalPage({ title = "This review link is not available", message = "Ask the creator for a current private review link.", code = "review_unavailable" }) {
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
