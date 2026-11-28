// MIT. The authored public gallery page renderer: the home showcase, the
// browse catalogue with its project/creation facets, the curated film strip
// and pagination. Runtime stays byte-identical to the former ui.mjs
// implementation; this module only makes that render path a checked source
// file. The Worker owns route validation, listed-only data selection and the
// response headers; gallery-query.ts and gallery-cards.ts stay the shared
// contracts, and page-head.ts owns the document chrome every page reuses.

import { escapeHtml } from "./util.mjs";
import { composerShare, composerShowcase } from "./composer-share.ts";
import { galleryPageHref, galleryHasFilters, galleryResultCount, galleryAudioEmpty, galleryActiveFilters, galleryCapabilityLabel, galleryKindLabel, type GalleryQueryState } from "./gallery-query.ts";
import { galleryCards, galleryDimensions, type GalleryCardItem, type GalleryCardsOptions } from "./gallery-cards.ts";
import { head, brandMark as mark, type PageHeadOptions } from "./page-head.ts";

/** The committed, inspected case-study poster for the signed-out discovery
 *  pages. Its query string is an explicit cache version: crawlers that saw an
 *  older preview refetch when the artwork or this value changes. */
export const PUBLIC_GALLERY_OG_IMAGE_PATH = "/media-studio-next-cut-20261128.png";
export const PUBLIC_GALLERY_OG_IMAGE_ALT = "Media Studio. Make the next cut. Edit images, clip video and trim audio.";

/**
 * Turn one installation's public origin into absolute OpenGraph/Twitter image
 * fields. This is the committed case-study artwork, not a screenshot claim
 * about whatever happens to be published right now. It is opt-in: callers
 * without an origin keep the existing summary-card head exactly as before.
 */
export function publicGalleryOgImage(origin?: string | null): Pick<PageHeadOptions, "image" | "imageAlt" | "imageType" | "imageWidth" | "imageHeight"> {
  const base = origin ? origin.replace(/\/$/, "") : "";
  return {
    image: base ? `${base}${PUBLIC_GALLERY_OG_IMAGE_PATH}` : null,
    imageAlt: base ? PUBLIC_GALLERY_OG_IMAGE_ALT : null,
    imageType: base ? "image/png" : null,
    imageWidth: base ? 1200 : null,
    imageHeight: base ? 630 : null,
  };
}

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
  /** Request/configured origin; only the Worker supplies it for / and /gallery. */
  origin?: string | null;
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
  origin = null,
}: PublicGalleryOptions) {
  const option = (value: string, label: string, selected: boolean) => `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const projectOptions = projects.map((entry) => option(entry.value, entry.label, entry.value === project)).join("");
  const capabilityOptions = capabilities.map((value) => option(value, galleryCapabilityLabel(value), value === capability)).join("");
  const projectControl = projects.length
    ? `<label>Project<select name="project">${option("", "All projects", !project)}${projectOptions}</select></label>`
    : "";
  const capabilityControl = capabilities.length
    ? `<label>Creation<select name="capability">${option("", "All creations", !capability)}${capabilityOptions}</select></label>`
    : "";
  const queryState: GalleryQueryState = { search: query, kind, project, capability, order, page };
  const hasFilters = galleryHasFilters(queryState);
  const activeFilterItems = home ? [] : galleryActiveFilters(queryState, projects);
  const activeFilters = activeFilterItems.length
    ? `<ul class="row small gallery-active-filters" aria-label="Active filters">${activeFilterItems.map((filter) => `<li>${escapeHtml(filter.label)}: <a href="${escapeHtml(filter.href)}" aria-label="Clear ${escapeHtml(filter.label.toLowerCase())} filter: ${escapeHtml(filter.value)}">${escapeHtml(filter.value)}<span aria-hidden="true"> ×</span></a></li>`).join("")}</ul>`
    : "";
  const controls = `<form class="gallery-controls" action="/gallery#gallery-results" method="get"><label>Search titles and descriptions<input type="search" name="q" value="${escapeHtml(query)}" maxlength="80" placeholder="Search public work"></label>${projectControl}<label>Type<select name="kind">${option("", "All media", !kind)}${option("image", galleryKindLabel("image"), kind === "image")}${option("video", galleryKindLabel("video"), kind === "video")}${option("audio", galleryKindLabel("audio"), kind === "audio")}</select></label>${capabilityControl}<label>Order<select name="order">${option("newest", "Newest first", order !== "oldest")}${option("oldest", "Oldest first", order === "oldest")}</select></label><button type="submit">Apply filters</button>${(hasFilters ? items.length > 0 : order === "oldest") ? '<a href="/gallery">Clear filters</a>' : ""}</form>`;
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
  return `${head({ title: home ? "Media Studio — edit images, video and audio" : "Public gallery — Media Studio", description: home ? "Edit images, clip video or trim audio in your browser. Explore published work or open your Studio." : "Explore images, films and sound deliberately published from Media Studio.", ...publicGalleryOgImage(origin), extra: focusScript })}
<body><a class="skip" href="#main">Skip to content</a>${publicStudioHeader({ sourceArtwork: woodhouseShare, active: home ? undefined : "gallery" })}
<main id="main" class="public-gallery${home ? " public-gallery--home" : " public-gallery--catalogue"}">
<section class="gallery-intro${home ? " gallery-intro--tools" : heroArtwork ? " gallery-intro--art" : ""}">
  <div class="gallery-intro-copy">
    <h1>${home ? "Make the next cut." : "Media Studio gallery"}</h1>
    <p>${home ? "Edit an image, cut a clip or trim a track in your browser." : "Watch films, see images and listen to audio published from Media Studio."}</p>
    ${home ? `<div class="gallery-actions">
      <a class="button" href="/gallery">Explore the gallery</a>
      <a class="button secondary" href="/studio">Open Studio</a>
    </div>` : ""}
  </div>
  ${home ? `<nav class="studio-workbench-links" aria-label="Start editing">
    <a href="/tools/images"><strong>Edit an image</strong><span>Crop, resize or export a social kit.</span><b aria-hidden="true">↗</b></a>
    <a href="/tools/video-clip"><strong>Cut a clip</strong><span>Trim footage, add captions or save a frame.</span><b aria-hidden="true">↗</b></a>
    <a href="/tools/audio-trim"><strong>Trim audio</strong><span>Keep the part of the track you need.</span><b aria-hidden="true">↗</b></a>
  </nav>` : heroArtwork}
</section>
${home ? `<nav class="gallery-tool-links" aria-label="Media Studio tools">
  ${buildUrl ? `<a href="${escapeHtml(buildUrl)}">Build your own studio <span aria-hidden="true">→</span></a>` : ""}
  ${storyUrl ? `<a href="${escapeHtml(storyUrl)}">Read the story <span aria-hidden="true">→</span></a>` : ""}
</nav>${heroArtwork ? `<div class="studio-featured-work">${heroArtwork}</div>` : ""}` : ""}
<section aria-labelledby="gallery-title"><div class="spread gallery-heading"><div><h2 id="gallery-title">${home ? "From the studio" : "Published work"}</h2></div>${home ? '<a href="/gallery">View all →</a>' : ""}</div>${home ? "" : controls}${activeFilters}${home ? "" : `<p class="gallery-count" id="gallery-results" tabindex="-1" data-total="${total}">${countText}</p>`}${items.length ? `<ul class="gallery-grid"${home ? "" : " data-gallery-cards"}>${cards}</ul>` : audioEmpty ? '<p class="notice calm">No audio work has been published to the gallery yet. You can still <a href="/tools/audio-trim">trim a song in your browser</a>, no sign-in needed. <a href="/gallery">Clear filters</a></p>' : hasFilters ? '<p>No published work matches these filters. <a href="/gallery">Clear filters</a></p>' : '<p>No work has been added to the public gallery yet.</p>'}
${!home && (page > 1 || hasMore) ? `<nav class="row gallery-pages" aria-label="Gallery pages">${page > 1 ? `<a class="button secondary" href="${escapeHtml(galleryPageHref(queryState, page - 1))}">← Previous</a>` : ""}<span>Page ${page}</span>${hasMore ? `<a class="button secondary" href="${escapeHtml(galleryPageHref(queryState, page + 1))}">Next →</a>` : ""}</nav>` : ""}</section>${featuredCards ? `<section class="gallery-featured" aria-labelledby="featured-title"><div class="gallery-heading"><p class="eyebrow">Selected public films</p><h2 id="featured-title">Made in Media Studio</h2><p>Explore a selection of published films made in Media Studio.</p></div><ul class="gallery-grid">${featuredCards}</ul>${woodhouseShare ? `<p><a href="${composerShowcase}">See more featured films →</a></p>` : ""}</section>` : ""}</main></body></html>`;
}
