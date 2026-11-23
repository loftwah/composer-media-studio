// MIT. A private Library comparison link is an ordinary Library route with
// exactly two opaque, same-project asset ids in the fragment. It grants no new
// access: opening it still needs the owner's existing Studio session.
//
// Nothing else travels in the link: no title, digest, signature or query. A
// malformed, duplicated or cross-project pair is refused before it can open a
// comparison, leaving the ordinary Library intact.
//
// Authored here; public/studio-comparison.js is emitted by scripts/launcher-assets.mjs.

const ASSET_ID = /^asset_[0-9a-f]{32}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface ComparableAsset {
  id: string;
  kind: string;
}

type ComparableKind = "image" | "video";
type ComparisonPair = readonly [string, string];

function pair(ids: readonly string[]): ComparisonPair | null {
  if (!Array.isArray(ids) || ids.length !== 2) return null;
  const [first, second] = ids;
  if (typeof first !== "string" || typeof second !== "string") return null;
  if (ASSET_ID.exec(first)?.[0] !== first || ASSET_ID.exec(second)?.[0] !== second) return null;
  if (first === second) return null;
  return [first, second];
}

/** Build the fragment-only link, or null unless exactly two opaque ids are given. */
export function comparisonLink(projectId: string, ids: readonly string[]): string | null {
  const valid = pair(ids);
  if (!valid || typeof projectId !== "string" || PROJECT_ID.exec(projectId)?.[0] !== projectId) return null;
  return `#/p/${projectId}/library/compare/${valid[0]}/${valid[1]}`;
}

/**
 * Read the two ids from the route segments after `#/p/:projectId/`. Any extra,
 * missing, duplicated or lookalike segment is refused rather than guessed at.
 */
export function comparisonFromRoute(parts: readonly string[]): ComparisonPair | null {
  if (!Array.isArray(parts) || parts.length !== 4) return null;
  if (parts[0] !== "library" || parts[1] !== "compare") return null;
  return pair([parts[2], parts[3]]);
}

/**
 * Resolve the link's ids against the assets already loaded for this project.
 * Only two distinct assets of the same comparable kind pass; an unknown, a
 * cross-project, a duplicate or a mixed pair keeps the ordinary Library.
 */
export function resolveComparison(
  assets: readonly ComparableAsset[] | null | undefined,
  ids: readonly string[] | null | undefined,
): { kind: ComparableKind; ids: [string, string] } | null {
  if (!Array.isArray(assets) || !Array.isArray(ids) || ids.length !== 2) return null;
  const [first, second] = ids;
  if (typeof first !== "string" || typeof second !== "string" || first === second) return null;
  const comparable = (id: string) =>
    assets.find(
      (asset): asset is ComparableAsset & { kind: ComparableKind } =>
        Boolean(asset) && asset.id === id && (asset.kind === "image" || asset.kind === "video"),
    );
  const a = comparable(first);
  const b = comparable(second);
  if (!a || !b || a.kind !== b.kind) return null;
  return { kind: a.kind, ids: [first, second] };
}
