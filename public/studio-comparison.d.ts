/** Fragment-only private Library link for two opaque asset ids, or null. */
export function comparisonLink(projectId: string, ids: readonly string[]): string | null;
/** The two ids in a `#/p/:projectId/library/compare/:a/:b` route, or null. */
export function comparisonFromRoute(parts: readonly string[]): readonly [string, string] | null;
/** Validate a linked pair against this project's loaded assets, or null. */
export function resolveComparison(
  assets: readonly { id: string; kind: string }[] | null | undefined,
  ids: readonly string[] | null | undefined,
): { kind: "image" | "video"; ids: [string, string] } | null;
