// MIT. The authored gallery card renderer, shared by the public catalogue, the
// home gallery, the curated film strip and the related-work section of a work
// page. Runtime stays byte-identical to the former ui.mjs implementation; this
// module only makes that renderer a checked source file.

import { escapeHtml } from "./util.mjs";
import { galleryIsFiltered, galleryPageHref, type GalleryQueryState } from "./gallery-query.ts";

/** A listed publication's card data, as selected by the Worker's public query. */
export interface GalleryCardItem {
  slug: string;
  title: string;
  description?: string | null;
  kind: string;
  width?: number | null;
  height?: number | null;
  // Preview ids are only read as presence flags; the curated film row maps its
  // `hasPoster` boolean into poster_asset_id, so the exact runtime value varies.
  thumb_id?: unknown;
  thumb_width?: number | null;
  thumb_height?: number | null;
  poster_preview_id?: unknown;
  poster_preview_width?: number | null;
  poster_preview_height?: number | null;
  poster_asset_id?: unknown;
  poster_width?: number | null;
  poster_height?: number | null;
}

export interface GalleryCardsOptions {
  query?: string;
  kind?: string;
  project?: string;
  capability?: string;
  order?: string;
  page?: number;
  home?: boolean;
}

// The gallery uses listed publications; the home fallback uses only configured public films.
// Keep the published description unchanged; cards point readers to its full version.
function galleryDescription(description: string): string {
  return description.replace(/https?:\/\/[^\s<>"']+/gi, url => {
    const punctuation = url.match(/[.,;!?]+$/)?.[0] || "";
    return `see the work page${punctuation}`;
  });
}

// Dimensions come from stored media metadata, so only positive safe integers
// become width/height attributes; anything else keeps the old attribute-free tag.
export function galleryDimensions(width: unknown, height: unknown): string {
  if (typeof width !== "number" || typeof height !== "number") return "";
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
    ? ` width="${width}" height="${height}"`
    : "";
}

// One renderer for public gallery cards and the related-work strip on a work
// page. It keeps the exact /p/<slug> canonical link, preview fallbacks and
// published-copy handling identical everywhere a listed work is shown.
export function galleryCards(
  entries: readonly GalleryCardItem[],
  { query = "", kind = "", project = "", capability = "", order = "newest", page = 1, home = false }: GalleryCardsOptions = {},
): string {
  const previewImage = (src: string, width: unknown, height: unknown): string =>
    `<img src="${src}" alt=""${galleryDimensions(width, height)} loading="lazy" decoding="async">`;
  const queryState: GalleryQueryState = { search: query, kind, project, capability, order, page };
  const filtered = galleryIsFiltered(queryState);
  const pageHref = (number: number): string => galleryPageHref(queryState, number);
  return entries.map((item) => {
    const slug = encodeURIComponent(item.slug);
    const title = escapeHtml(item.title);
    // A stored preview is small and regenerable, so it always beats the full
    // original or a large parent poster. The old routes stay as fallbacks.
    const preview = item.thumb_id
      ? previewImage(`/p/${slug}/thumb`, item.thumb_width, item.thumb_height)
      : item.poster_preview_id
        ? previewImage(`/p/${slug}/poster-preview`, item.poster_preview_width, item.poster_preview_height)
        : item.kind === "image"
          ? previewImage(`/p/${slug}/media`, item.width, item.height)
          : item.kind === "video" && item.poster_asset_id
            ? previewImage(`/p/${slug}/poster`, item.poster_width, item.poster_height)
            : `<span class="gallery-placeholder"><span>${item.kind === "audio" ? "Listen" : "Watch"}</span><strong>${title}</strong><span aria-hidden="true">↗</span></span>`;
    const action = item.kind === "video" ? "Watch film →" : item.kind === "audio" ? "Listen →" : "View image →";
    const pieceHref = `/p/${slug}${home || !filtered ? "" : `?back=${encodeURIComponent(pageHref(page))}`}`;
    return `<li><a class="gallery-card" href="${escapeHtml(pieceHref)}"><span class="gallery-preview">${preview}</span><span class="gallery-card-copy"><strong>${title}</strong><span>${escapeHtml(action)}</span></span>${item.description ? `<span class="gallery-description">${escapeHtml(galleryDescription(item.description))}</span>` : ""}</a></li>`;
  }).join("");
}
