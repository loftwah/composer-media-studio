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

/** The public option labels shared by the filter controls and active links. */
const kindLabels: Readonly<Record<string, string>> = { image: "Images", video: "Video", audio: "Audio" };
const capabilityLabels: Readonly<Record<string, string>> = { original: "Original", variation: "Variation", refinement: "Refinement", assembled: "Assembled" };

/** The exact public label for a media-type option value. */
export function galleryKindLabel(value: string): string {
  return kindLabels[value] ?? value;
}

/** The exact public label for a creation option value. */
export function galleryCapabilityLabel(value: string): string {
  return capabilityLabels[value] ?? value;
}

/** One public project facet option, as the Worker's catalogue query returns it. */
export interface GalleryProjectOption {
  value: string;
  label: string;
}

/** One removable active filter and the first-page link that clears it. */
export interface GalleryActiveFilter {
  key: "search" | "project" | "kind" | "capability";
  /** The matching control label, e.g. "Search" or "Creation". */
  label: string;
  /** The current value, using the same public label as its option. */
  value: string;
  /** A `/gallery` link that clears only this filter and returns to page 1. */
  href: string;
}

/** The compact list of explicit filters shown below the gallery controls.
 * Every link rebuilds the normalised query with that one value removed,
 * keeps the other filters and sort, and targets the results landmark. */
export function galleryActiveFilters(
  state: GalleryQueryState,
  projects: readonly GalleryProjectOption[] = [],
): GalleryActiveFilter[] {
  const clearHref = (patch: Partial<GalleryQueryState>): string =>
    `${galleryPageHref({ ...state, ...patch }, 1)}#gallery-results`;
  const projectLabel = projects.find((entry) => entry.value === state.project)?.label ?? state.project;
  const filters: GalleryActiveFilter[] = [];
  if (state.search) filters.push({ key: "search", label: "Search", value: state.search, href: clearHref({ search: "" }) });
  if (state.project) filters.push({ key: "project", label: "Project", value: projectLabel, href: clearHref({ project: "" }) });
  if (state.kind) filters.push({ key: "kind", label: "Type", value: galleryKindLabel(state.kind), href: clearHref({ kind: "" }) });
  if (state.capability) filters.push({ key: "capability", label: "Creation", value: galleryCapabilityLabel(state.capability), href: clearHref({ capability: "" }) });
  return filters;
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
