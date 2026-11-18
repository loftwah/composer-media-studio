// MIT. Pure query/filter and result-state rules shared by the public gallery
// renderer. The Worker owns URL parameter validation and listed-only data
// selection; this module only normalises the already-validated values back
// into the exact public links, count label and empty-state decisions.

export interface GalleryQueryState {
  /** The already-normalised `q` search text. */
  search: string;
  kind: string;
  project: string;
  capability: string;
  order: string;
  page: number;
}

/** Rebuild a `/gallery` link with the existing query labels and their order. */
export function galleryPageHref(state: GalleryQueryState, number: number): string {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.project) params.set("project", state.project);
  if (state.kind) params.set("kind", state.kind);
  if (state.capability) params.set("capability", state.capability);
  if (state.order === "oldest") params.set("order", state.order);
  params.set("page", String(number));
  return `/gallery?${params}`;
}

/** Whether an explicit search, project, media type or creation filter is set. */
export function galleryHasFilters(state: GalleryQueryState): boolean {
  return Boolean(state.search || state.kind || state.project || state.capability);
}

/** Whether a card should carry its browsing context back to the work page. */
export function galleryIsFiltered(state: GalleryQueryState): boolean {
  return galleryHasFilters(state) || state.order === "oldest" || state.page > 1;
}

/** The exact singular/plural count label shown above the results. */
export function galleryResultCount(total: number): string {
  return `${total} ${total === 1 ? "work" : "works"}`;
}

/** The audio-only first-page empty state; other empty cases keep their copy. */
export function galleryAudioEmpty(state: GalleryQueryState, total: number, home: boolean): boolean {
  return !home && state.kind === "audio" && !state.search && !state.project && !state.capability && state.page === 1 && total === 0;
}
