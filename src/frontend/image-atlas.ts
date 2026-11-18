// MIT. Geometry and portable layout metadata for a bounded, transparent,
// browser-local sprite atlas assembled from completed PNG pixels at native size.
// Sibling of image-contact-sheet.ts; it never changes the v1 contact-sheet shape.
import {
  CONTACT_SHEET_MAX_COLUMNS,
  CONTACT_SHEET_MIN_IMAGES,
  type ContactSheetColumns,
  type ContactSheetRect,
  type ContactSheetTile,
} from "./image-contact-sheet.ts";
import { MAX_BATCH_IMAGES, MAX_DECODED_PIXELS, MAX_IMAGE_OUTPUT_DIMENSION } from "./image-limits.ts";

export const ATLAS_LAYOUT_SCHEMA = "media-studio/sprite-atlas-layout";
export const ATLAS_LAYOUT_VERSION = 1;

export type AtlasLayout = {
  count: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
};

/**
 * Compute the transparent-cell geometry for an atlas. Each cell is the largest
 * native width and height in the selection, so every image is placed at 1:1
 * with no resampling. Columns follow the same Auto / 1–4 choice as the contact
 * sheet. Returns null for an unsafe count or dimension before any allocation.
 */
export function atlasLayout(
  dimensions: ReadonlyArray<{ width: number; height: number }>,
  columns: ContactSheetColumns = "auto",
): AtlasLayout | null {
  if (!Array.isArray(dimensions) || dimensions.length < CONTACT_SHEET_MIN_IMAGES || dimensions.length > MAX_BATCH_IMAGES) {
    return null;
  }
  for (const size of dimensions) {
    if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) ||
        size.width < 1 || size.height < 1) {
      return null;
    }
  }
  const resolved = columns !== "auto" && Number.isInteger(columns) && columns >= 1 && columns <= CONTACT_SHEET_MAX_COLUMNS
    ? columns
    : Math.min(dimensions.length, CONTACT_SHEET_MAX_COLUMNS);
  const cellWidth = Math.max(...dimensions.map(size => size.width));
  const cellHeight = Math.max(...dimensions.map(size => size.height));
  return {
    count: dimensions.length,
    columns: resolved,
    cellWidth,
    cellHeight,
    width: resolved * cellWidth,
    height: Math.ceil(dimensions.length / resolved) * cellHeight,
  };
}

/**
 * Refuse an atlas that would exceed the existing canvas/output limits. Called
 * before a canvas is allocated or a bitmap is decoded, using the same product
 * bounds as the other image tools.
 */
export function atlasBoundsProblem(layout: AtlasLayout): string | null {
  if (!layout || !Number.isSafeInteger(layout.width) || !Number.isSafeInteger(layout.height) ||
      layout.width < 1 || layout.height < 1) {
    return "The atlas dimensions could not be read.";
  }
  if (layout.width > MAX_IMAGE_OUTPUT_DIMENSION || layout.height > MAX_IMAGE_OUTPUT_DIMENSION) {
    return `An atlas must stay at or below ${MAX_IMAGE_OUTPUT_DIMENSION} px on each side. Try fewer columns or smaller completed PNGs.`;
  }
  if (layout.width * layout.height > MAX_DECODED_PIXELS) {
    return `An atlas must stay at or below ${MAX_DECODED_PIXELS / 1_000_000} megapixels. Try fewer columns or smaller completed PNGs.`;
  }
  return null;
}

/**
 * Integer-centred placement inside a transparent cell. The reported width and
 * height are the source's native pixels; drawImage is called without a size so
 * no resampling occurs. Offsets are floored, so padding is always whole pixels.
 */
export function atlasPlacement(layout: AtlasLayout, index: number, sourceWidth: number, sourceHeight: number): ContactSheetRect {
  if (!layout || !Number.isInteger(index) || index < 0 || index >= layout.count ||
      !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) ||
      sourceWidth < 1 || sourceHeight < 1 ||
      sourceWidth > layout.cellWidth || sourceHeight > layout.cellHeight) {
    throw new RangeError("The image does not fit this atlas cell.");
  }
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: column * layout.cellWidth + Math.floor((layout.cellWidth - sourceWidth) / 2),
    y: row * layout.cellHeight + Math.floor((layout.cellHeight - sourceHeight) / 2),
    width: sourceWidth,
    height: sourceHeight,
  };
}

/** A distinct document shape: no contact-sheet v1 field is reused for atlas data. */
export function atlasDocument(
  layout: AtlasLayout,
  sheet: { sha256: string; bytes: number },
  tiles: ContactSheetTile[],
) {
  return {
    schema: ATLAS_LAYOUT_SCHEMA,
    version: ATLAS_LAYOUT_VERSION,
    layout: {
      kind: "sprite-atlas",
      columns: layout.columns,
      count: layout.count,
      cellWidth: layout.cellWidth,
      cellHeight: layout.cellHeight,
      background: "transparent",
      resample: "none",
    },
    sheet: { width: layout.width, height: layout.height, ...sheet },
    tiles,
  };
}
