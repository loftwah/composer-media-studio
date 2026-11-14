// MIT. Server-rendered shells. The studio itself is progressive, same-origin JS.

import { escapeHtml } from "./util.mjs";
import { shareOrigin, shareProjectName, shareProjects, woodhouseUrl } from "./woodhouse-share.mjs";

const mark = `<img class="brand-mark" src="/brand/composer-icon-tile.svg" width="40" height="40" alt="">`;

const styles = "/studio.css";

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
}) {
  const hasImage = Boolean(image);
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
<link rel="icon" href="/brand/composer-icon-tile.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/composer-icon-tile.svg">
<link rel="preload" href="/brand/space-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${styles}">
${theme ? '<script src="/theme.js" defer></script>' : ""}
${imageTags}
<meta property="og:type" content="${kind}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}"><link rel="canonical" href="${escapeHtml(url)}">` : ""}
${twitter}
${extra}
</head>`;
}

function brandByline() {
  return `<span class="brand-by">App Composer</span>`;
}

function header({ session, composerOrigin, storyUrl, buildUrl, woodhouseShare, helpHref = "/help" }) {
  const bridged = session?.mode === "bridge";
  let launcherHome = null;
  try {
    const candidate = new URL(composerOrigin);
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) launcherHome = candidate.origin + "/";
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
    ${bridged && composerOrigin ? `<a class="quiet" href="${escapeHtml(composerOrigin)}/">App Composer</a>` : ""}
    ${storyUrl ? `<a class="quiet" href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    <a href="#/">Projects</a>
    ${woodhouseShare ? '<a href="/portfolio">Share artwork</a>' : ""}
    <a href="${escapeHtml(helpHref)}" target="_blank" rel="noopener">Help</a>
    ${launcherHome ? '<div class="app-launcher"><button type="button" class="secondary apps-trigger" data-open-apps aria-label="Open apps" title="Apps and shortcuts (Ctrl/Cmd+K)" aria-haspopup="dialog"><span>Apps</span><kbd>Ctrl K</kbd></button></div>' : ""}
    <button class="quiet" id="signout" type="button">Sign out</button>
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button>
  </nav>
  ${context}
</header>${launcherHome ? `<dialog data-composer-home="${escapeHtml(launcherHome)}" id="app-navigation" aria-labelledby="app-navigation-title">
  <div class="dialog-heading"><h2 id="app-navigation-title">Apps and shortcuts</h2><button type="button" data-close-apps autofocus>Close</button></div>
  <label>Find an app or task<input type="search" placeholder="App name, Get Ready, Init…" autocomplete="off"></label>
  <p class="small" role="status" aria-live="polite"></p><ul></ul>
  <a class="launcher-all" href="${escapeHtml(new URL("apps", launcherHome).href)}">Browse all apps</a>
</dialog><script src="/brand/launcher.js" defer></script>` : ""}`;
}

export function shell({ revision, session = null, composerOrigin = null, storyUrl = null, woodhouseShare = false }) {
  return `${head({
    title: "Media Studio — make, assemble and keep images, video and sound",
    description:
      "An independent studio for uploads, image generation, reference variations, masked fills, background removal, upscaling, image-to-video, generated music, narration and effects, bounded multi-track assembly, saved compositions and deliberate publishing.",
    extra: `<meta name="robots" content="noindex"><link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}"><link rel="stylesheet" href="/brand/launcher.css">`,
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
    <p class="small">This studio belongs to its own Cloudflare account and stores media in its own R2 bucket. It does not use your App Composer password.</p>
  </main>
</div>
<script type="module" src="/login.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

export function publicPage({
  attribution = [],
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
    <a href="${escapeHtml(origin)}/gallery">← Back to gallery</a>
    ${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    ${buildUrl ? `<a href="${escapeHtml(buildUrl)}">Build your own</a>` : ""}
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false" hidden>Dark</button>
  </nav>
</header>
<main class="public-page" id="main">
  <p class="eyebrow">Published from Media Studio</p>
  <h1>${escapeHtml(title)}</h1>
  ${description ? `<p class="lede">${escapeHtml(description)}</p>` : ""}
  <figure style="margin:1.4rem 0">
    <div class="media">
      ${
        isVideo
          ? `<video controls playsinline preload="metadata" ${poster ? `poster="${escapeHtml(poster)}"` : ""} aria-label="${escapeHtml(title)}"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this video. <a href="${escapeHtml(download)}">Download it instead</a>.</video>`
          : isAudio
            ? `<audio controls preload="metadata" aria-label="${escapeHtml(title)}" style="width:100%"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this audio. <a href="${escapeHtml(download)}">Download it instead</a>.</audio>`
            : `<img src="${escapeHtml(media)}" alt="${escapeHtml(title)}" ${width ? `width="${width}" height="${height}"` : ""} decoding="async">`
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
    <li><strong>Images</strong> run on Cloudflare Workers AI. Studio Print, Studio Film and Studio Draft support square, portrait, landscape and wide frames. Studio Quick makes square drafts. Studio Detail takes one selected still as a reference for a square variation.</li>
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
  <p>The studio keeps its metadata in D1, media in R2 and provider keys in its own secret storage. The project export contains the project record, references, prompts, generation history, costs and lineage without secrets. Media files download separately while they still exist. The export does not back up R2 files; download the media you need.</p>
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
  const preview = film.poster_asset_id
    ? `<video controls playsinline preload="none" poster="/p/${slug}/poster" aria-label="${title}"><source src="/p/${slug}/media" type="${escapeHtml(film.mime)}"><a href="/p/${slug}">Open ${title}</a></video>`
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
    <a href="/">Open Studio</a>
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
export function publicGallery({ items = [], featured = [], hasMore = false, page = 1, home = false, woodhouseShare = false, query = "", kind = "", order = "newest" }) {
  const pageHref = (number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind) params.set("kind", kind);
    if (order === "oldest") params.set("order", order);
    params.set("page", String(number));
    return `/gallery?${params}`;
  };
  const option = (value, label, selected) => `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
  const controls = `<form class="gallery-controls" action="/gallery" method="get"><label>Search titles and descriptions<input type="search" name="q" value="${escapeHtml(query)}" maxlength="80" placeholder="Search public work"></label><label>Media<select name="kind">${option("", "All media", !kind)}${option("image", "Images", kind === "image")}${option("video", "Video", kind === "video")}${option("audio", "Audio", kind === "audio")}</select></label><label>Order<select name="order">${option("newest", "Newest first", order !== "oldest")}${option("oldest", "Oldest first", order === "oldest")}</select></label><button type="submit">Find work</button>${query || kind || order === "oldest" ? '<a href="/gallery">Clear filters</a>' : ""}</form>`;
  const renderCards = (entries) => entries.map((item) => {
    const slug = encodeURIComponent(item.slug);
    const title = escapeHtml(item.title);
    const preview = item.kind === "image"
      ? `<img src="/p/${slug}/media" alt="" loading="lazy" decoding="async">`
      : item.kind === "video" && item.poster_asset_id
        ? `<img src="/p/${slug}/poster" alt="" loading="lazy" decoding="async">`
        : `<span class="gallery-placeholder"><span>${item.kind === "audio" ? "Listen" : "Watch"}</span><strong>${title}</strong><span aria-hidden="true">↗</span></span>`;
    const action = item.kind === "video" ? "Watch film →" : item.kind;
    return `<li><a class="gallery-card" href="/p/${slug}"><span class="gallery-preview">${preview}</span><span class="gallery-card-copy"><strong>${title}</strong><span>${escapeHtml(action)}</span></span>${item.description ? `<span class="gallery-description">${escapeHtml(item.description)}</span>` : ""}</a></li>`;
  }).join("");
  const cards = renderCards(items);
  const featuredCards = renderCards(featured.map((film) => ({ ...film, kind: "video", poster_asset_id: film.hasPoster })));
  return `${head({ title: home ? "Media Studio — work worth keeping" : "Public gallery — Media Studio", description: "Explore images, films and sound deliberately published from Media Studio." })}
<body><a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="wordmark" href="/">${mark}<span>Media Studio</span></a><nav class="header-nav" aria-label="Main"><a href="/gallery">Gallery</a>${woodhouseShare ? '<a href="/portfolio">Share artwork</a>' : ""}<a class="button secondary" href="/studio">Open Studio</a><button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button></nav></header>
<main id="main" class="public-gallery${home ? "" : " public-gallery--catalogue"}"><section class="gallery-intro"><p class="eyebrow">Images · film · sound</p><h1>${home ? "Made to be seen." : "The public gallery."}</h1><p>${home ? "Explore work made and kept in Media Studio." : "Images, films and sound shared by their creators."}</p>${home ? '<a class="button" href="/gallery">Explore the gallery →</a>' : ""}</section>
<section aria-labelledby="gallery-title"><div class="spread gallery-heading"><div><p class="eyebrow">Publications</p><h2 id="gallery-title">${home ? "From the studio" : "Published work"}</h2></div>${home ? '<a href="/gallery">View all →</a>' : ""}</div>${home ? "" : controls}${items.length ? `<ul class="gallery-grid">${cards}</ul>` : query || kind ? '<p>No published work matches these filters.</p>' : '<p>No work has been added to the public gallery yet.</p>'}
${!home && (page > 1 || hasMore) ? `<nav class="row gallery-pages" aria-label="Gallery pages">${page > 1 ? `<a class="button secondary" href="${escapeHtml(pageHref(page - 1))}">← Previous</a>` : ""}<span>Page ${page}</span>${hasMore ? `<a class="button secondary" href="${escapeHtml(pageHref(page + 1))}">Next →</a>` : ""}</nav>` : ""}</section>${featuredCards ? `<section class="gallery-featured" aria-labelledby="featured-title"><div class="gallery-heading"><p class="eyebrow">Selected public films</p><h2 id="featured-title">Made in Media Studio</h2><p>Explore a selection of published films while the public gallery is being populated.</p></div><ul class="gallery-grid">${featuredCards}</ul>${woodhouseShare ? '<p><a href="/portfolio">See more featured films and artwork →</a></p>' : ""}</section>` : ""}</main></body></html>`;
}
