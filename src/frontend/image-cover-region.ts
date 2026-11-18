export type CoverRegion = { left: number; top: number; width: number; height: number };
export type CoverFields = Record<keyof CoverRegion, string>;

export function coverRegion(fields: CoverFields, imageWidth: number, imageHeight: number): CoverRegion | null {
  if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) ||
      Object.values(fields).some(value => !value.trim())) return null;
  const { left, top, width, height } = {
    left: Number(fields.left), top: Number(fields.top),
    width: Number(fields.width), height: Number(fields.height),
  };
  if (![left, top, width, height].every(Number.isSafeInteger) ||
      left < 0 || top < 0 || width < 1 || height < 1 ||
      left + width > imageWidth || top + height > imageHeight) return null;
  return { left, top, width, height };
}

export const MAX_COVER_AREAS = 8;

export type CoverAreaState = {
  /** Retained areas plus a valid current area: the exact set painted once. */
  regions: CoverRegion[];
  current: CoverRegion | null;
  /** The current input was edited but is not an accepted whole-pixel rectangle. */
  pending: boolean;
  canExport: boolean;
  canRetain: boolean;
};

export const EMPTY_COVER_FIELDS: CoverFields = { left: "0", top: "0", width: "", height: "" };

export function coverAreas(
  fields: CoverFields,
  retained: readonly CoverRegion[],
  imageWidth: number,
  imageHeight: number,
): CoverAreaState {
  const current = coverRegion(fields, imageWidth, imageHeight);
  const edited = (Object.keys(EMPTY_COVER_FIELDS) as (keyof CoverFields)[]).some(
    key => fields[key].trim() !== EMPTY_COVER_FIELDS[key],
  );
  const pending = edited && !current;
  const regions = current ? [...retained, current] : [...retained];
  return {
    regions,
    current,
    pending,
    canExport: !pending && regions.length >= 1 && regions.length <= MAX_COVER_AREAS,
    canRetain: current !== null && retained.length < MAX_COVER_AREAS - 1,
  };
}
