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
