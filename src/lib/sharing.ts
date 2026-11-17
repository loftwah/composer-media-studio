// MIT. Pure sharing and reuse rules.
//
// Destinations are optional installation configuration, not product defaults:
// an independent studio may omit them and keep a working owner/public page.
// A reuse still must resolve through a stored relationship in the same project
// and have a MIME that Launch Kit can actually import. Filenames and titles are
// never used to guess one.

export const LAUNCH_KIT_MIMES: readonly string[] = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const MAX_DESTINATION_LENGTH = 2048;

/** The optional destination variables read from one installation's environment. */
export interface SharingEnvironment {
  PUBLIC_BUILD_URL?: unknown;
  PUBLIC_STORY_URL?: unknown;
  LAUNCH_KIT_URL?: unknown;
}

export interface SharingDestinations {
  buildUrl: string | null;
  storyUrl: string | null;
  launchKitUrl: string | null;
}

/** A saved library asset and the stored relationships this module reads. */
export interface ReuseAsset {
  id: string;
  kind: string;
  mime: string;
  deleted_at?: number | null;
  deletedAt?: number | null;
  generation_id?: string | null;
  generationId?: string | null;
  parent_asset_id?: string | null;
  parentAssetId?: string | null;
}

interface ReuseGeneration {
  id?: string | null;
  assetId?: string | null;
  outputAssetId?: string | null;
  referenceAssetId?: string | null;
}

interface ReusePublication {
  assetId?: string | null;
  asset_id?: string | null;
  posterAssetId?: string | null;
  poster_asset_id?: string | null;
}

export interface ReuseStillInput {
  asset?: ReuseAsset | null;
  assets?: readonly ReuseAsset[];
  generations?: readonly ReuseGeneration[];
  publications?: readonly ReusePublication[];
}

/**
 * Normalise one optional HTTPS destination. Invalid or unsafe values fail
 * closed so a configuration typo can never produce a link to another scheme,
 * a credential-bearing URL or a header-breaking value.
 */
export function publicDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_DESTINATION_LENGTH) return null;
  // Spaces, tabs, newlines and control characters never belong in a configured link.
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** Read the optional destinations from one installation's environment. */
export function sharingDestinations(env: SharingEnvironment = {}): SharingDestinations {
  return {
    buildUrl: publicDestination(env.PUBLIC_BUILD_URL),
    storyUrl: publicDestination(env.PUBLIC_STORY_URL),
    launchKitUrl: publicDestination(env.LAUNCH_KIT_URL),
  };
}

function isImportableStill(asset: ReuseAsset | null | undefined): asset is ReuseAsset {
  return Boolean(
    asset &&
      asset.kind === "image" &&
      !asset.deleted_at &&
      !asset.deletedAt &&
      LAUNCH_KIT_MIMES.includes(asset.mime),
  );
}

/**
 * Resolve the still a viewer may reuse for Launch Kit or a variation.
 *
 * `assets` is the authorised, same-project library; `generations` and
 * `publications` carry the stored relationships. A still is returned only when
 * it is listed there, still present, a still image and importable.
 */
export function reuseStillFor({ asset, assets = [], generations = [], publications = [] }: ReuseStillInput = {}): ReuseAsset | null {
  if (!asset) return null;
  const importable = new Map<string, ReuseAsset>();
  for (const candidate of assets) {
    if (isImportableStill(candidate)) importable.set(candidate.id, candidate);
  }
  if (importable.size === 0) return null;

  if (asset.kind === "image") return importable.get(asset.id) ?? null;
  if (asset.kind !== "video") return null;

  const generation =
    generations.find((item) => asset.generation_id && item.id === asset.generation_id) ??
    generations.find((item) => asset.generationId && item.id === asset.generationId) ??
    generations.find((item) => item.assetId && item.assetId === asset.id) ??
    generations.find((item) => item.outputAssetId && item.outputAssetId === asset.id) ??
    null;

  const candidates = [
    asset.parent_asset_id ?? asset.parentAssetId ?? null,
    generation?.referenceAssetId ?? null,
    ...publications
      .filter((publication) => publication.assetId === asset.id || publication.asset_id === asset.id)
      .map((publication) => publication.posterAssetId ?? publication.poster_asset_id ?? null),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const still = importable.get(candidate);
    if (still) return still;
  }
  return null;
}

/** Extension used for a Launch Kit download filename. */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}
