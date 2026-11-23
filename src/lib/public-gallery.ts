// MIT. The authored public gallery page renderer: the home showcase, the
// browse catalogue with its project/creation facets, the curated film strip
// and pagination. Runtime stays byte-identical to the former ui.mjs
// implementation; this module only makes that render path a checked source
// file. The Worker owns route validation, listed-only data selection and the
// response headers; gallery-query.ts and gallery-cards.ts stay the shared
// contracts, and page-head.ts owns the document chrome every page reuses.

import { escapeHtml } from "./util.mjs";
import { composerShare, composerShowcase } from "./composer-share.ts";
import { galleryPageHref, galleryHasFilters, galleryResultCount, galleryAudioEmpty, type GalleryQueryState } from "./gallery-query.ts";
import { galleryCards, galleryDimensions, type GalleryCardItem, type GalleryCardsOptions } from "./gallery-cards.ts";
import { head, brandMark as mark } from "./page-head.ts";

/** One configured showcase film row, as homeShowcase()/shareShowcaseFilms()
 * select it. `hasPoster` is mapped into the gallery-card contract's
 * poster_asset_id presence flag, exactly as the untyped renderer did. */
export interface PublicGalleryFilm {
  slug: string;
  title: string;
  description?: string | null;
  mime?: string | null;
  hasPoster?: boolean;
  thumb_id?: unknown;
  thumb_width?: number | null;
  thumb_height?: number | null;
  poster_preview_id?: unknown;
  poster_preview_width?: number | null;
  poster_preview_height?: number | null;
}

/** One project facet option, as the Worker's public catalogue query returns it. */
export interface PublicGalleryProject {
  value: string;
  label: string;
}

/** The public gallery page options. The Worker has already validated the raw
 * URL values; only the normalised strings and the already-selected facet
 * values reach this renderer. */
export interface PublicGalleryOptions {
  items?: readonly GalleryCardItem[];
  featured?: readonly PublicGalleryFilm[];
  hasMore?: boolean;
  total?: number;
  projects?: readonly PublicGalleryProject[];
  capabilities?: readonly string[];
  page?: number;
  home?: boolean;
  woodhouseShare?: boolean;
  buildUrl?: string | null;
  storyUrl?: string | null;
  query?: string;
  kind?: string;
  project?: string;
  capability?: string;
  order?: string;
}

function publicStudioHeader({ sourceArtwork = false, active }: { sourceArtwork?: boolean; active?: string }) {
  return `<header class="site-header">
    <a class="wordmark" href="/" aria-label="Media Studio home">${mark}<span>Media Studio</span></a>
    <nav class="header-nav" aria-label="Main navigation">
      <a href="/gallery"${active === "gallery" ? ' aria-current="page"' : ""}>Gallery</a>
      ${sourceArtwork ? `<a href="${composerShare}">Source artwork</a>` : ""}
      <a class="button secondary" href="/studio">Open Studio</a>
      <button class="quiet theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">Dark</button>
    </nav>
  </header>`;
}

export function publicGallery({
  items = [],
  featured = [],
  hasMore = false,
  total = 0,
  projects = [],
  capabilities = [],
  page = 1,
  home = false,
  woodhouseShare = false,
  buildUrl = null,
  storyUrl = null,
  query = "",
  kind = "",
  project = "",
  capability = "",
  order = "newest",
}: PublicGalleryOptions) {
  const option = (value: string, label: string, selected: boolean) => `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const capabilityNames: Record<string, string> = { original: "Original", variation: "Variation", refinement: "Refinement", assembled: "Assembled" };
  const projectOptions = projects.map((entry) => option(entry.value, entry.label, entry.value === project)).join("");
  const capabilityOptions = capabilities.map((value) => option(value, capabilityNames[value] ?? value, value === capability)).join("");
  const projectControl = projects.length
    ? `<label>Project<select name="project">${option("", "All projects", !project)}${projectOptions}</select></label>`
    : "";
  const capabilityControl = capabilities.length
    ? `<label>Creation<select name="capability">${option("", "All creations", !capability)}${capabilityOptions}</select></label>`
    : "";
  const queryState: GalleryQueryState = { search: query, kind, project, capability, order, page };
  const hasFilters = galleryHasFilters(queryState);
  const controls = `<form class="gallery-controls" action="/gallery#gallery-results" method="get"><label>Search titles and descriptions<input type="search" name="q" value="${escapeHtml(query)}" maxlength="80" placeholder="Search public work"></label>${projectControl}<label>Type<select name="kind">${option("", "All media", !kind)}${option("image", "Images", kind === "image")}${option("video", "Video", kind === "video")}${option("audio", "Audio", kind === "audio")}</select></label>${capabilityControl}<label>Order<select name="order">${option("newest", "Newest first", order !== "oldest")}${option("oldest", "Oldest first", order === "oldest")}</select></label><button type="submit">Apply filters</button>${(hasFilters ? items.length > 0 : order === "oldest") ? '<a href="/gallery">Clear filters</a>' : ""}</form>`;
  const featuredFilms: GalleryCardItem[] = featured.map((film) => ({ ...film, kind: "video", poster_asset_id: film.hasPoster }));
  const hasPreview = (item: GalleryCardItem): unknown => item.poster_preview_id || item.poster_asset_id || item.thumb_id;
  const heroItem = home
    ? items.find((item) => item.kind === "video" && hasPreview(item)) || items.find((item) => item.kind === "image")
    : featuredFilms.find(hasPreview);
  const heroSlug = heroItem ? encodeURIComponent(heroItem.slug) : "";
  const heroSource = heroItem
    ? heroItem.poster_preview_id
      ? { route: "poster-preview", width: heroItem.poster_preview_width, height: heroItem.poster_preview_height }
      : heroItem.thumb_id
        ? { route: "thumb", width: heroItem.thumb_width, height: heroItem.thumb_height }
        : heroItem.kind === "image"
          ? { route: "media", width: heroItem.width, height: heroItem.height }
          : { route: "poster", width: heroItem.poster_width, height: heroItem.poster_height }
    : null;
  // The hero is the page's largest paint, so it asks for the first bytes. Cards
  // below it stay lazy: the gallery grid defers offscreen cards in studio.css.
  const heroArtwork = heroItem && heroSource ? `<a class="gallery-hero-art" href="/p/${heroSlug}"><img src="/p/${heroSlug}/${heroSource.route}" alt=""${galleryDimensions(heroSource.width, heroSource.height)} decoding="async" fetchpriority="high"><span><strong>${escapeHtml(heroItem.title)}</strong><span>${heroItem.kind === "video" ? "Watch film →" : "Open artwork →"}</span></span></a>` : "";
  const cardOptions: GalleryCardsOptions = { query, kind, project, capability, order, page, home };
  const cards = galleryCards(items, cardOptions);
  const featuredCards = home ? galleryCards(featuredFilms, cardOptions) : "";
  const countText = galleryResultCount(total);
  const audioEmpty = galleryAudioEmpty(queryState, total, home);
  // Returning keyboard readers get the exact card they opened. Only the
  // catalogue results opt in, and an empty gallery needs no focus handler.
  const focusScript = !home && items.length ? '<script src="/gallery-focus.js" defer></script>' : "";
  return `${head({ title: home ? "Media Studio — work worth keeping" : "Public gallery — Media Studio", description: "Explore images, films and sound deliberately published from Media Studio.", extra: focusScript })}
<body><a class="skip" href="#main">Skip to content</a>${publicStudioHeader({ sourceArtwork: woodhouseShare, active: home ? undefined : "gallery" })}
<main id="main" class="public-gallery${home ? "" : " public-gallery--catalogue"}"><section class="gallery-intro${heroArtwork ? " gallery-intro--art" : ""}"><div class="gallery-intro-copy"><h1>${home ? "Made to be seen." : "Media Studio gallery"}</h1><p>${home ? "Explore work made and kept in Media Studio." : "Watch films, see images and listen to audio published from Media Studio."}</p>${home ? `<div class="gallery-actions"><a class="button" href="/gallery">Explore the gallery →</a>${buildUrl ? `<a class="button secondary" href="${escapeHtml(buildUrl)}">Build your own studio</a>` : ""}<a href="/tools/images">Image Tools →</a><a href="/tools/video-clip">Clip and caption video →</a>${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story →</a>` : ""}</div>` : ""}</div>${heroArtwork}</section>
<section aria-labelledby="gallery-title"><div class="spread gallery-heading"><div><h2 id="gallery-title">${home ? "From the studio" : "Published work"}</h2></div>${home ? '<a href="/gallery">View all →</a>' : ""}</div>${home ? "" : controls}${home ? "" : `<p class="gallery-count" id="gallery-results" tabindex="-1" data-total="${total}">${countText}</p>`}${items.length ? `<ul class="gallery-grid"${home ? "" : " data-gallery-cards"}>${cards}</ul>` : audioEmpty ? '<p class="notice calm">No audio work has been published to the gallery yet. You can still <a href="/tools/audio-trim">trim a song in your browser</a>, no sign-in needed. <a href="/gallery">Clear filters</a></p>' : hasFilters ? '<p>No published work matches these filters. <a href="/gallery">Clear filters</a></p>' : '<p>No work has been added to the public gallery yet.</p>'}
${!home && (page > 1 || hasMore) ? `<nav class="row gallery-pages" aria-label="Gallery pages">${page > 1 ? `<a class="button secondary" href="${escapeHtml(galleryPageHref(queryState, page - 1))}">← Previous</a>` : ""}<span>Page ${page}</span>${hasMore ? `<a class="button secondary" href="${escapeHtml(galleryPageHref(queryState, page + 1))}">Next →</a>` : ""}</nav>` : ""}</section>${featuredCards ? `<section class="gallery-featured" aria-labelledby="featured-title"><div class="gallery-heading"><p class="eyebrow">Selected public films</p><h2 id="featured-title">Made in Media Studio</h2><p>Explore a selection of published films made in Media Studio.</p></div><ul class="gallery-grid">${featuredCards}</ul>${woodhouseShare ? `<p><a href="${composerShowcase}">See more featured films →</a></p>` : ""}</section>` : ""}</main></body></html>`;
}
