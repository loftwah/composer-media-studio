export type AdjustmentKey = "exposure" | "contrast" | "saturation" | "temperature";

export type Adjustments = Record<AdjustmentKey, number>;

export const ADJUSTMENT_KEYS: ReadonlyArray<AdjustmentKey>;
export const ADJUSTMENT_RANGE: number;
export const ADJUSTMENT_LABELS: Readonly<Record<AdjustmentKey, string>>;
export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments>;

export type AdjustmentPreset = {
  id: string;
  label: string;
  adjustments: Adjustments;
};

export const ADJUSTMENT_PRESETS: ReadonlyArray<AdjustmentPreset>;

export function normaliseAdjustments(input?: Partial<Adjustments> | null): Adjustments;
export function adjustmentsAreNeutral(adjustments?: Partial<Adjustments> | null): boolean;
export function presetIdFor(adjustments?: Partial<Adjustments> | null): string;
export function presetAdjustments(id: string): Adjustments;
export function describeAdjustments(adjustments?: Partial<Adjustments> | null): string;

export type AdjustResult =
  | {
      ok: true;
      pixels: Uint8ClampedArray;
      neutral: boolean;
      changed: number;
    }
  | { ok: false; error: string };

export function adjustPixels(
  pixels: Uint8ClampedArray,
  input: {
    width: number;
    height: number;
    adjustments?: Partial<Adjustments> | null;
  },
): AdjustResult;
