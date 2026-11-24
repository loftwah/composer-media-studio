// MIT. Signed-out public utility pages: the four browser-local media tool
// shells, the help page and the 404 shell. Moved verbatim out of ui.mjs for
// #198; the rendered bytes are unchanged. page-head.ts owns the shared document
// chrome, and util.mjs supplies escapeHtml. The four tool routes' response
// assembly is also owned here so the Worker only supplies the current revision.

import { escapeHtml } from "./util.mjs";
import { head, brandMark as mark, brandByline } from "./page-head.ts";

/** The four tool shells only read the current build revision. */
export interface RevisionOptions {
  revision?: string;
}

/** The help page may receive the configured Composer origin and story URL. */
export interface HelpPageOptions {
  composerOrigin?: string | null;
  storyUrl?: string | null;
}

export function audioTrimPage({ revision = "dev" }: RevisionOptions = {}) {
  return `${head({ title: "Trim a song — Media Studio", description: "Trim audio privately on your device and save a WAV.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="audio-trim"><main id="main"><h1>Trim a song</h1><p>JavaScript is required to trim audio on your device.</p></main></div><script type="module" src="/audio-trim.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function imagesPage({ revision = "dev" }: RevisionOptions = {}) {
  return `${head({ title: "Image tools — Media Studio", description: "Resize, crop, convert, batch export and inspect image metadata privately on your device.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="images" data-studio-revision="${escapeHtml(revision)}"><main id="main"><h1>Image tools</h1><p>JavaScript is required to resize, crop, convert and inspect images on your device.</p></main></div><script type="module" src="/images.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function videoClipPage({ revision = "dev" }: RevisionOptions = {}) {
  return `${head({ title: "Clip and frame a video — Media Studio", description: "Trim and frame video, and preview your own captions on this device.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="video-clip"><main id="main"><h1>Clip and frame a video</h1><p>JavaScript is required to edit video on your device.</p></main></div><script type="module" src="/video-clip.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function addMusicPage({ revision = "dev" }: RevisionOptions = {}) {
  return `${head({ title: "Add music to a video — Media Studio", description: "Add music to video privately on your device.", extra: `<link rel="stylesheet" href="/creative/home.css?v=${encodeURIComponent(revision)}">` })}
<body><div id="add-music"><main id="main"><h1>Add music to a video</h1><p>JavaScript is required to edit video on your device.</p></main></div><script type="module" src="/add-music.js?v=${encodeURIComponent(revision)}"></script></body></html>`;
}

export function notFoundPage() {
  return `${head({ title: "Not found — Media Studio", description: "This page is not available." })}
<body><main id="main"><p class="eyebrow">404</p><h1>Nothing here.</h1><p>This page may have been withdrawn. <a href="/">Return to the studio</a>.</p></main></body></html>`;
}

export function helpPage({ composerOrigin = null, storyUrl = null }: HelpPageOptions = {}) {
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
  <p>The signed-out <a href="/tools/images">browser-local image workbench</a> resizes, crops, rotates, converts and batch-exports JPEG, PNG and WebP files without an upload, and can inspect or losslessly strip metadata. Its limits and the honest remaining gaps are listed there and in the repository's image-tools coverage matrix.</p>
  <p>In your browser, you can also <a href="/tools/audio-trim">trim a song</a>, <a href="/tools/video-clip">clip and frame a video with captions</a> and <a href="/tools/add-music">add music to a video</a>.</p>

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
  <p>Add <code>/mcp</code> on this Studio's origin as a Streamable HTTP MCP server in a compatible agent. Sign in, choose one project and review the requested permissions. Read access includes prompts and exports; edit, generate and publish are separate grants. Some clients, including OpenCode, request <code>studio.read</code> by default; ask for <code>studio.edit</code> explicitly if the agent needs to change saved work. Generation permits spending up to the estimated limit you set for the connection; actual provider charges can differ. Publication permits publishing and withdrawal until the connection expires or is revoked. Connections expire after 30 minutes; <a href="/mcp/connections">manage or disconnect an agent</a> at any time.</p>

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
  <p>A portable project bundle can include the live media originals and restore them into a fresh owner-controlled Studio. Export the bundle with the owner CLI described in <code>docs/portable-project.md</code>, then choose that file in the restore panel on the studio home screen. Studio verifies the bundle in your browser, previews what will be written, stages the media, and reports real progress; a retry resumes the same restore rather than duplicating it. Restore is available to a standalone owner session, not to an App Composer bridge session. Provider keys and sessions are still excluded, and restored publications start withdrawn and hidden.</p>
  <p>Code and media restore are separate operations. Restoring an older Worker version does not bring back deleted bytes; restoring bytes does not roll back code.</p>

  <h2>Owner setup for a new installation</h2>
  <ol>
    <li>Create a D1 database and an R2 bucket, then apply the migrations in order.</li>
    <li>Bind them as <code>DB</code> and <code>MEDIA</code>, and add the Workers AI binding <code>AI</code>.</li>
    <li>Set <code>OWNER_PASSPHRASE</code> (at least 16 characters) and <code>SESSION_SECRET</code> (at least 32 characters) as Wrangler secrets.</li>
    <li>Optional video, sound, edits and assembly: set <code>FAL_KEY</code> as a Wrangler secret. Without it, image work and the library still function and the studio says those routes need a key.</li>
    <li>Optional App Composer entry: set <code>BRIDGE_SECRET</code> to the same value as Composer's <code>MEDIA_STUDIO_BRIDGE_SECRET</code>, and set <code>PUBLIC_ORIGIN</code>, <code>COMPOSER_ORIGIN</code> and <code>PUBLIC_STORY_URL</code>.</li>
    <li>Optional studio identity: set <code>DIRECTOR_NAME</code> to publish a name beside the Creative Director, or leave it unset for the neutral label. It is display copy only and does not change what the Director may propose.</li>
    <li>Deploy with a clean pushed <code>main</code>. The guarded deploy runs the focused checks first.</li>
  </ol>
  <p class="small">No App Composer account, licence callback or hosted service is required after deployment.</p>
</main>
</body>
</html>`;
}

/** The four tool shells share one public cache window and content type. */
const TOOL_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60",
};

/**
 * Assemble one signed-out utility tool response. Returns null for every other
 * path so the Worker keeps the exact existing branch order. No method check is
 * added: these routes answered every method before the extraction and still do.
 */
export function publicToolPageResponse(path: string, revision: string): Response | null {
  switch (path) {
    case "/tools/add-music":
      return new Response(addMusicPage({ revision }), { headers: TOOL_PAGE_HEADERS });
    case "/tools/video-clip":
      return new Response(videoClipPage({ revision }), { headers: TOOL_PAGE_HEADERS });
    case "/tools/audio-trim":
      return new Response(audioTrimPage({ revision }), { headers: TOOL_PAGE_HEADERS });
    case "/tools/images":
      return new Response(imagesPage({ revision }), { headers: TOOL_PAGE_HEADERS });
    default:
      return null;
  }
}
