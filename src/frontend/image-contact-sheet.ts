// MIT. Geometry and portable layout metadata for a bounded, transparent,
// browser-local contact sheet.
import { MAX_BATCH_IMAGES } from "./image-limits.ts";

export const CONTACT_SHEET_TILE = 240;
export const CONTACT_SHEET_MAX_COLUMNS = 4;
export const CONTACT_SHEET_MIN_IMAGES = 2;
export const CONTACT_SHEET_LAYOUT_SCHEMA = "media-studio/contact-sheet-layout";
export const CONTACT_SHEET_LAYOUT_VERSION = 1;

export type ContactSheetLayout = {
  count: number;
  columns: number;
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

export function contactSheetLayout(count: number): ContactSheetLayout | null {
  if (!Number.isInteger(count) || count < CONTACT_SHEET_MIN_IMAGES || count > MAX_BATCH_IMAGES) return null;

  const columns = Math.min(count, CONTACT_SHEET_MAX_COLUMNS);
  return {
    count,
    columns,
    width: columns * CONTACT_SHEET_TILE,
    height: Math.ceil(count / columns) * CONTACT_SHEET_TILE,
  };
}

export function contactSheetPlacement(layout: ContactSheetLayout, index: number, sourceWidth: number, sourceHeight: number): ContactSheetRect {
  if (!Number.isInteger(index) || index < 0 || index >= layout.count ||
      !Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError("The image does not fit this contact sheet.");
  }

  const scale = Math.min(CONTACT_SHEET_TILE / sourceWidth, CONTACT_SHEET_TILE / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: column * CONTACT_SHEET_TILE + Math.floor((CONTACT_SHEET_TILE - width) / 2),
    y: row * CONTACT_SHEET_TILE + Math.floor((CONTACT_SHEET_TILE - height) / 2),
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
      tileSize: CONTACT_SHEET_TILE,
      columns: layout.columns,
      count: layout.count,
      background: "transparent",
    },
    sheet: { width: layout.width, height: layout.height, ...sheet },
    tiles,
  };
}
