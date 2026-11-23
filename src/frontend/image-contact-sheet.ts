// MIT. Geometry and portable layout metadata for a bounded, transparent,
// browser-local contact sheet.
import { MAX_BATCH_IMAGES } from "./image-limits.ts";

export const CONTACT_SHEET_TILE = 240;
export const CONTACT_SHEET_TILE_SIZES = [120, 240, 360] as const;
export const CONTACT_SHEET_MAX_COLUMNS = 4;
export const CONTACT_SHEET_MIN_IMAGES = 2;
export const CONTACT_SHEET_LAYOUT_SCHEMA = "media-studio/contact-sheet-layout";
export const CONTACT_SHEET_LAYOUT_VERSION = 1;

export type ContactSheetColumns = "auto" | 1 | 2 | 3 | 4;
export type ContactSheetTileSize = (typeof CONTACT_SHEET_TILE_SIZES)[number];

export type ContactSheetLayout = {
  count: number;
  columns: number;
  tileSize: ContactSheetTileSize;
  width: number;
  height: number;
};

export type ContactSheetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContactSheetTile = {
  index: number;
  rect: ContactSheetRect;
  source: { sha256: string; width: number; height: number; mime: string };
  output: { sha256: string; width: number; height: number; mime: string; bytes: number };
};

export function contactSheetLayout(
  count: number,
  columns: ContactSheetColumns = "auto",
  tileSize: ContactSheetTileSize = CONTACT_SHEET_TILE,
): ContactSheetLayout | null {
  if (!Number.isInteger(count) || count < CONTACT_SHEET_MIN_IMAGES || count > MAX_BATCH_IMAGES) return null;

  const resolved = columns !== "auto" && Number.isInteger(columns) && columns >= 1 && columns <= CONTACT_SHEET_MAX_COLUMNS
    ? columns
    : Math.min(count, CONTACT_SHEET_MAX_COLUMNS);
  // An out-of-range tile choice from an untyped caller falls back to Standard,
  // the same way an out-of-range column choice falls back to Auto.
  const tile = (CONTACT_SHEET_TILE_SIZES as readonly number[]).includes(tileSize)
    ? tileSize
    : CONTACT_SHEET_TILE;
  return {
    count,
    columns: resolved,
    tileSize: tile,
    width: resolved * tile,
    height: Math.ceil(count / resolved) * tile,
  };
}

export function contactSheetPlacement(layout: ContactSheetLayout, index: number, sourceWidth: number, sourceHeight: number): ContactSheetRect {
  if (!Number.isInteger(index) || index < 0 || index >= layout.count ||
      !Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError("The image does not fit this contact sheet.");
  }

  const tile = layout.tileSize;
  const scale = Math.min(tile / sourceWidth, tile / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: column * tile + Math.floor((tile - width) / 2),
    y: row * tile + Math.floor((tile - height) / 2),
    width,
    height,
  };
}

export function contactSheetDocument(
  layout: ContactSheetLayout,
  sheet: { sha256: string; bytes: number },
  tiles: ContactSheetTile[],
) {
  return {
    schema: CONTACT_SHEET_LAYOUT_SCHEMA,
    version: CONTACT_SHEET_LAYOUT_VERSION,
    layout: {
      kind: "fixed-contact-sheet",
      tileSize: layout.tileSize,
      columns: layout.columns,
      count: layout.count,
      background: "transparent",
    },
    sheet: { width: layout.width, height: layout.height, ...sheet },
    tiles,
  };
}
