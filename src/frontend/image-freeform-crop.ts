// Pure state and validation for one deliberate freeform crop. Coordinates are
// whole pixels in the EXIF-upright source, before any resize or output encoding.

import type { ImageBounds } from "./image-colour.ts";

export type FreeformCropFields = {
  left: string;
  top: string;
  width: string;
  height: string;
};

export type FreeformCropSource = {
  sourceHash: string;
  width: number;
  height: number;
};

export type FreeformCropState = FreeformCropSource & {
  fields: FreeformCropFields;
  applied: ImageBounds | null;
};

export type FreeformCropSettings = {
  cropAspect: string;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  straighten: number;
};

export type FreeformCropParse =
  | { ok: true; rect: ImageBounds }
  | { ok: false; error: string; invalid: Partial<Record<keyof FreeformCropFields, boolean>> };

export function fullImageCropFields(source: FreeformCropSource): FreeformCropFields {
  return {
    left: "0",
    top: "0",
    width: String(source.width),
    height: String(source.height),
  };
}

export function freeformCropStateForSource(
  state: FreeformCropState | null | undefined,
  source: FreeformCropSource,
): FreeformCropState | null {
  if (!state) return null;
  return state.sourceHash === source.sourceHash &&
    state.width === source.width &&
    state.height === source.height
    ? state
    : null;
}

export function freeformCropSourceProblem(
  state: FreeformCropState | null | undefined,
  source: FreeformCropSource,
): string | null {
  if (!state || freeformCropStateForSource(state, source)) return null;
  return "This exact crop belongs to different source pixels. Clear exact crop before continuing; it was not attached to this image.";
}

export function updateFreeformCropField(
  state: FreeformCropState | null | undefined,
  source: FreeformCropSource,
  field: keyof FreeformCropFields,
  value: string,
): FreeformCropState {
  const current = freeformCropStateForSource(state, source);
  return {
    ...source,
    fields: { ...(current?.fields ?? fullImageCropFields(source)), [field]: value },
    // Editing a draft never silently replaces the rectangle already in the plan.
    applied: current?.applied ?? null,
  };
}

/** Validate without rounding, clamping or substituting a different rectangle. */
export function parseFreeformCrop(
  fields: FreeformCropFields,
  source: Pick<FreeformCropSource, "width" | "height">,
): FreeformCropParse {
  const invalid: Partial<Record<keyof FreeformCropFields, boolean>> = {};
  const values = {} as Record<keyof FreeformCropFields, number>;
  const labels: Record<keyof FreeformCropFields, string> = {
    left: "Left",
    top: "Top",
    width: "Width",
    height: "Height",
  };
  for (const field of ["left", "top", "width", "height"] as const) {
    const raw = fields[field];
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) {
      invalid[field] = true;
    } else {
      values[field] = value;
    }
  }
  if (Object.keys(invalid).length) {
    const names = (Object.keys(invalid) as Array<keyof FreeformCropFields>)
      .map((field) => labels[field].toLowerCase())
      .join(", ");
    return {
      ok: false,
      error: `Enter whole pixels for ${names}; decimals, signs and blank values are not applied.`,
      invalid,
    };
  }
  if (values.width < 1 || values.height < 1) {
    if (values.width < 1) invalid.width = true;
    if (values.height < 1) invalid.height = true;
    return { ok: false, error: "Crop width and height must each be at least 1 px.", invalid };
  }
  if (
    values.left + values.width > source.width ||
    values.top + values.height > source.height
  ) {
    if (values.left + values.width > source.width) {
      invalid.left = true;
      invalid.width = true;
    }
    if (values.top + values.height > source.height) {
      invalid.top = true;
      invalid.height = true;
    }
    return {
      ok: false,
      error: `The rectangle must fit inside the upright ${source.width} × ${source.height} px source. Reduce left or width, and top or height; values are not clamped.`,
      invalid,
    };
  }
  return {
    ok: true,
    rect: { x: values.left, y: values.top, width: values.width, height: values.height },
  };
}

export function freeformCropCompatibilityProblem(
  source: FreeformCropSource,
  settings: FreeformCropSettings,
  hasAlphaTrim: boolean,
): string | null {
  if (hasAlphaTrim)
    return "Clear transparent trim before applying an exact crop. Exact crop and automatic alpha trim cannot be combined.";
  if (
    settings.rotate !== 0 ||
    settings.flipH ||
    settings.flipV ||
    settings.straighten !== 0 ||
    settings.cropAspect !== "original"
  )
    return "Exact crop needs Original aspect with rotation, flips and straighten neutral. Restore those controls, or clear exact crop to continue with the current settings.";
  return null;
}

export function sameFreeformCrop(a: ImageBounds | null, b: ImageBounds | null): boolean {
  return a === b || Boolean(
    a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height,
  );
}
