// MIT. Geometry for a bounded, transparent, browser-local contact sheet.
import { MAX_BATCH_IMAGES } from "./image-limits.ts";

const TILE = 240;
const MAX_COLUMNS = 4;
export const CONTACT_SHEET_MIN_IMAGES = 2;

type ContactSheetLayout = {
  count: number;
  columns: number;
  width: number;
  height: number;
};

export function contactSheetLayout(count: number): ContactSheetLayout | null {
  if (!Number.isInteger(count) || count < CONTACT_SHEET_MIN_IMAGES || count > MAX_BATCH_IMAGES) return null;

  const columns = Math.min(count, MAX_COLUMNS);
  return {
    count,
    columns,
    width: columns * TILE,
    height: Math.ceil(count / columns) * TILE,
  };
}

export function contactSheetPlacement(layout: ContactSheetLayout, index: number, sourceWidth: number, sourceHeight: number) {
  if (!Number.isInteger(index) || index < 0 || index >= layout.count ||
      !Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new RangeError("The image does not fit this contact sheet.");
  }

  const scale = Math.min(TILE / sourceWidth, TILE / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: column * TILE + Math.floor((TILE - width) / 2),
    y: row * TILE + Math.floor((TILE - height) / 2),
    width,
    height,
  };
}
