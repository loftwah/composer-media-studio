// MIT. Pure planning logic for the workbench's title + thumbnail compare:
// the feed sizes, the cover-crop plan shared by the CSS preview and the PNG
// export, and the download-name rules. No DOM, no React, no state.

import type { CropAnchorKey } from "./image-ops.ts";

export const PAIR_IDS = ["a", "b", "c"] as const;
export type PairId = (typeof PAIR_IDS)[number];

export const PAIR_LABELS: Readonly<Record<PairId, string>> = Object.freeze({
  a: "A",
  b: "B",
  c: "C",
});

/** The two representative feed scales this slice previews. The card box is
 * exactly 16:9; the row box is the common rounded listing size, a hair
 * taller than 16:9 — which is why the crop plan, not the aspect label, is
 * the shared truth. */
export const FEED_SIZES = Object.freeze([
  Object.freeze({ key: "row", label: "row", width: 168, height: 94 } as const),
  Object.freeze({ key: "card", label: "card", width: 640, height: 360 } as const),
]);
export type FeedSizeKey = (typeof FEED_SIZES)[number]["key"];
export type FeedSize = (typeof FEED_SIZES)[number];

export const TITLE_MAX_LENGTH = 200;

export type CoverRect = { left: number; top: number; width: number; height: number };

function anchorFractions(anchor: CropAnchorKey): { x: number; y: number } {
  return {
    x: anchor === "left" || anchor === "topLeft" || anchor === "bottomLeft" ? 0
      : anchor === "right" || anchor === "topRight" || anchor === "bottomRight" ? 1
      : 0.5,
    y: anchor === "top" || anchor === "topLeft" || anchor === "topRight" ? 0
      : anchor === "bottom" || anchor === "bottomLeft" || anchor === "bottomRight" ? 1
      : 0.5,
  };
}

/**
 * The whole-pixel source rectangle that `object-fit: cover` shows for a box of
 * `boxWidth × boxHeight`, positioned by the same crop anchors the workbench
 * already uses. A source smaller than the box is scaled up, exactly as the
 * cover preview does. The CSS preview and the exported pixels read one plan,
 * so what the preview crops is what the file contains.
 */
export function coverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  anchor: CropAnchorKey = "centre",
): CoverRect | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1)
    return null;
  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth < 1 || boxHeight < 1) return null;
  const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const { x, y } = anchorFractions(anchor);
  const width = Math.min(Math.round(boxWidth / scale), sourceWidth);
  const height = Math.min(Math.round(boxHeight / scale), sourceHeight);
  const left = Math.min(Math.round((sourceWidth - width) * x), sourceWidth - width);
  const top = Math.min(Math.round((sourceHeight - height) * y), sourceHeight - height);
  return { left: Math.max(left, 0), top: Math.max(top, 0), width, height };
}

/** The CSS equivalent of the same plan, for the live preview. */
export function objectPositionFor(anchor: CropAnchorKey): string {
  const { x, y } = anchorFractions(anchor);
  return `${x * 100}% ${y * 100}%`;
}

/** The download stem of one export, with the workbench's name rules. */
export function safeTitleStem(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "thumbnail"
  );
}

/** One export's download name, keyed by its feed size. */
export function exportFileName(title: string, fallbackName: string, size: FeedSize): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}.png`;
}

/** The manifest this slice exports, so a chosen pair can be handed on with the
 * exact facts this tab actually knows: the title text, the source thumbnail's
 * own facts, the crop plan and the identity of the PNG the same run encoded.
 * Version bumps when the field set changes; nothing else here claims a work,
 * rights or performance value this tab cannot know. */
export const MANIFEST_SCHEMA = "studio.title-thumbnail-pair-manifest";
export const MANIFEST_VERSION = 1;

export type ManifestSourceFacts = {
  fileName: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
};

export type ManifestPngFacts = {
  fileName: string;
  bytes: number;
  sha256: string;
};

export type TitlePairManifest = {
  schema: string;
  version: number;
  generatedAt: string;
  generator: string;
  pair: { id: PairId; label: string };
  title: { text: string; maxLength: number };
  source: ManifestSourceFacts;
  crop: { mode: "cover"; anchor: CropAnchorKey; sourceRect: CoverRect };
  render: {
    sizeKey: FeedSizeKey;
    width: number;
    height: number;
    format: "image/png";
    png: ManifestPngFacts;
  };
  local: { uploaded: false; serverInvolved: false };
};

/** The versioned manifest for one captured pair, built only from facts the
 * component captured from its own encode. */
export function buildTitlePairManifest(input: {
  generatedAt: string;
  pairId: PairId;
  title: string;
  source: ManifestSourceFacts;
  anchor: CropAnchorKey;
  size: FeedSize;
  sourceRect: CoverRect;
  png: ManifestPngFacts;
}): TitlePairManifest {
  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    generatedAt: input.generatedAt,
    generator: "Media Studio Image Tools — Title + thumbnail compare (browser-local)",
    pair: { id: input.pairId, label: PAIR_LABELS[input.pairId] },
    title: { text: input.title, maxLength: TITLE_MAX_LENGTH },
    source: input.source,
    crop: { mode: "cover", anchor: input.anchor, sourceRect: input.sourceRect },
    render: {
      sizeKey: input.size.key,
      width: input.size.width,
      height: input.size.height,
      format: "image/png",
      png: input.png,
    },
    local: { uploaded: false, serverInvolved: false },
  };
}

/** One manifest's download name, versioned beside the PNG it names. */
export function manifestFileName(
  title: string,
  fallbackName: string,
  size: FeedSize,
  version: number = MANIFEST_VERSION,
): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}-manifest-v${version}.json`;
}

/** The package ZIP's download name: the same stem as the pair it carries, so
 * the archive and the two files inside it stay recognisably one export. */
export function bundleFileName(
  title: string,
  fallbackName: string,
  size: FeedSize,
): string {
  return `${safeTitleStem(title || fallbackName)}-feed-${size.width}x${size.height}-package.zip`;
}
