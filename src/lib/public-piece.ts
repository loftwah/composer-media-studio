/// <reference lib="es2024.string" />
// MIT. Renderer for the published image, film and sound pages.

import { escapeHtml } from "./util.mjs";
import { woodhouseUrl } from "./woodhouse-share.ts";
import { videoObjectJsonLd } from "./video-object-json-ld.ts";
import { galleryCards, type GalleryCardItem } from "./gallery-cards.ts";
import { head, brandMark as mark, brandByline } from "./page-head.ts";
import { publishedStillToolUrl } from "../frontend/image-social-source.ts";
import { publicVideoAddMusicUrl, publicVideoClipUrl } from "../frontend/video-clip-source.ts";

interface PublicPageAttribution {
  credit?: unknown;
  sourceUrl?: unknown;
  reuse?: unknown;
  tablerMit?: unknown;
}

interface PublicPageOptions {
  attribution?: (PublicPageAttribution | null)[];
  galleryBack?: string;
  listed?: boolean;
  publishedAt?: number | null;
  title: string;
  description?: string | null;
  kind: string;
  mime: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  bytes?: number | null;
  media: string;
  download: string;
  captionSrc?: string | null;
  transcriptLines?: readonly string[] | null;
  embedUrl?: string | null;
  poster?: string | null;
  videoPoster?: string | null;
  posterMime?: string | null;
  posterWidth?: number | null;
  posterHeight?: number | null;
  buildUrl?: string | null;
  storyUrl?: string | null;
  origin: string;
  slug: string;
  related?: readonly GalleryCardItem[];
}

// Only explicit web addresses become links; all authored text remains escaped.
function linkPublicDescription(value: string) {
  const text = String(value);
  const urls = /(?<![\w@:/])https?:\/\/[^\s<>"']+/gi;
  let html = "", cursor = 0;
  for (const match of text.matchAll(urls)) {
    let candidate = match[0];
    const unmatchedClosing = () => {
      const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      const close = candidate.at(-1);
      const open = close ? pairs[close] : undefined;
      return open && [...candidate].filter((c) => c === close).length > [...candidate].filter((c) => c === open).length;
    };
    while (/[.,!?;:]$/.test(candidate) || unmatchedClosing()) candidate = candidate.slice(0, -1);
    let safe = false;
    try {
      const url = new URL(candidate);
      safe = ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !candidate.includes("\\");
    } catch {}
    if (!safe) continue;
    const start = match.index ?? 0;
    html += escapeHtml(text.slice(cursor, start));
    html += `<a href="${escapeHtml(candidate)}">${escapeHtml(candidate)}</a>`;
    cursor = start + candidate.length;
  }
  return html + escapeHtml(text.slice(cursor));
}

export function publicPage({
  attribution = [],
  galleryBack = "/gallery",
  listed = false,
  publishedAt = null,
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
  captionSrc = null,
  transcriptLines = null,
  embedUrl = null,
  poster,
  videoPoster,
  posterMime,
  posterWidth,
  posterHeight,
  buildUrl,
  storyUrl,
  origin,
  slug,
  related = [],
}: PublicPageOptions): string {
  const url = `${origin}/p/${slug}`;
  const isVideo = kind === "video";
  const isAudio = kind === "audio";
  const hasVideoDimensions = typeof width === "number" && Number.isSafeInteger(width) && width > 0 &&
    typeof height === "number" && Number.isSafeInteger(height) && height > 0;
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
  const publicAttribution = (Array.isArray(attribution) ? attribution : []).flatMap((item) => {
    if (typeof item?.credit !== "string") return [];
    const source = woodhouseUrl(item.sourceUrl);
    return source ? [{ credit: item.credit, source, unconfirmed: item.reuse === "unconfirmed" }] : [];
  });
  const sourceCredits = publicAttribution.map(({ credit, source, unconfirmed }) =>
    `<li>${escapeHtml(credit)} · <a href="${escapeHtml(source)}">Public source and provenance</a>${unconfirmed ? " · Catalogue reuse status: unconfirmed" : ""}</li>`,
  ).join("");
  const postCredits = publicAttribution.map(({ credit, source, unconfirmed }) =>
    `${credit} · ${source}${unconfirmed ? " · Reuse status unconfirmed" : ""}`,
  );
  const caption = typeof description === "string" ? description.trim() : "";
  const postText = [title, caption, ...postCredits, url].filter(Boolean).join("\n\n");
  const postTextDownload = `data:text/plain;charset=utf-8,${encodeURIComponent(postText.toWellFormed())}`;
  const posterDownload = isVideo ? poster : null;
  const posterHandoff = posterDownload === `/p/${slug}/poster` || posterDownload === `/p/${slug}/thumb`
    ? `/tools/images#public-poster=${encodeURIComponent(posterDownload)}`
    : null;
  // A published still can be opened in the same signed-out workbench, but the
  // editor only loads its own exact `/media` after the visitor asks it to.
  const stillHandoff = kind === "image" &&
    media === `/p/${slug}/media` &&
    ["image/jpeg", "image/png", "image/webp"].includes(mime)
    ? publishedStillToolUrl(slug)
    : null;
  // The published MP4 enters the local editors only after an explicit bounded
  // read. Clip accepts a longer source; Add Music shares the duration gate with
  // a <=60s maximum, and the editor re-checks decoded length before any export.
  const videoHandoff = publicVideoClipUrl({ kind, mime, media, slug, bytes, durationMs });
  const addMusicHandoff = publicVideoAddMusicUrl({ kind, mime, media, slug, bytes, durationMs });
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
  // A bounded, optional continuation. The related items are already vetted
  // listed public works of this same project, so they reuse the gallery card
  // renderer verbatim and link to the canonical public page for each work.
  const relatedSection = Array.isArray(related) && related.length
    ? `\n<section class="public-related" aria-labelledby="related-title">
    <h2 id="related-title">More from this project</h2>
    <p class="small">Other published work from the same project.</p>
    <ul class="gallery-grid">${galleryCards(related)}</ul>
  </section>\n  `
    : "";
  const structuredData = videoObjectJsonLd({ kind, listed, title, description, poster, media, mime, publishedAt, pageUrl: url });
  // Native, collapsed transcript for the exact reviewed film. It is plain
  // disclosure content from the same cues as the VTT: no script, no media.
  const transcript = isVideo && Array.isArray(transcriptLines) && transcriptLines.length
    ? `<details class="public-transcript">
      <summary>Read the transcript</summary>
      <div class="public-transcript-lines">${transcriptLines.map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div>
    </details>`
    : "";
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
      : ""}<script src="/public-piece.js" defer></script>${structuredData}`,
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header public-piece-header">
  <a class="wordmark" href="${escapeHtml(origin)}/" aria-label="Media Studio home">${mark}<span>Media Studio</span>${brandByline()}</a>
  <nav class="header-nav" aria-label="Published piece">
    <a href="${escapeHtml(origin + galleryBack)}" data-gallery-back="${escapeHtml(galleryBack)}">← Back to gallery</a>
    ${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story</a>` : ""}
    ${buildUrl ? `<a href="${escapeHtml(buildUrl)}">Build your own</a>` : ""}
    <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false" hidden>Dark</button>
  </nav>
</header>
<main class="public-page" id="main" data-public-piece tabindex="-1">
  <p class="eyebrow">Published from Media Studio</p>
  <h1>${escapeHtml(title)}</h1>
  ${description ? `<p class="lede">${linkPublicDescription(description)}</p>` : ""}
  <figure style="margin:1.4rem 0">
    <div class="media${isVideo ? " media-video" : ""}"${videoFrameStyle}>
      ${
        isVideo
          ? `<video controls playsinline preload="metadata" ${videoDimensions} ${poster || videoPoster ? `poster="${escapeHtml(videoPoster ?? poster)}"` : ""} aria-label="${escapeHtml(title)}"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">${captionSrc ? `<track kind="captions" srclang="en" label="English" src="${escapeHtml(captionSrc)}">` : ""}Your browser cannot play this video. <a href="${escapeHtml(download)}">Download it instead</a>.</video>`
          : isAudio
            ? `<audio controls preload="metadata" aria-label="${escapeHtml(title)}" style="width:100%"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this audio. <a href="${escapeHtml(download)}">Download it instead</a>.</audio>`
            : `<img src="${escapeHtml(media)}" alt="${escapeHtml(title)}" ${width ? `width="${width}" height="${height}"` : ""} decoding="async" fetchpriority="high">`
      }
    </div>
    <figcaption class="caption">
      <span>${escapeHtml(facts)}</span>
      <span class="row">
        <button type="button" class="button secondary" data-copy-link data-copy-url="${escapeHtml(url)}" hidden>Copy link</button>
        <button type="button" class="button secondary" data-copy-post hidden>Copy post text</button>
        <a href="${escapeHtml(postTextDownload)}" download="${escapeHtml(slug)}-post-text.txt">Download post text (TXT)</a>
        ${posterDownload ? `<a href="${escapeHtml(posterDownload)}" download>Download poster</a>` : ""}
        ${posterHandoff ? `<a href="${escapeHtml(posterHandoff)}">Make social sizes</a>` : ""}
        ${stillHandoff ? `<a href="${escapeHtml(stillHandoff)}">Edit in Image Tools</a>` : ""}
        ${videoHandoff ? `<a href="${escapeHtml(videoHandoff)}">Clip this video</a>` : ""}
        ${addMusicHandoff ? `<a href="${escapeHtml(addMusicHandoff)}">Mix this video locally</a>` : ""}
        <a href="${escapeHtml(download)}" download>Download ${isVideo ? "video" : isAudio ? "audio" : "image"}</a>
        ${isVideo && captionSrc ? `<a href="${escapeHtml(captionSrc)}" download="${escapeHtml(slug)}-en.vtt">Download English captions (VTT)</a>` : ""}
        ${embedUrl ? `<a href="${escapeHtml(embedUrl)}">Embed this film</a>` : ""}
      </span>
    </figcaption>
  </figure>
  ${transcript}
  <span class="small" role="status" data-copy-status></span>
  <input class="copy-link-field" type="text" readonly aria-label="Link to this page" value="${escapeHtml(url)}" data-copy-field hidden>
  <textarea class="copy-link-field" readonly rows="4" aria-label="Post text to copy manually" data-post-field hidden>${escapeHtml(postText)}</textarea>
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
  ${relatedSection}<footer class="public-footer">Published with an independently owned Media Studio · <a href="${escapeHtml(origin)}/studio">Owner sign-in</a></footer>
</main>
</body>
</html>`;
}
