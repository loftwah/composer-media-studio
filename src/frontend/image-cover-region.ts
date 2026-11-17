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
