// Narrow, type-only declarations for the provider catalogue consumed by
// capabilities.ts. Runtime behaviour stays in providers.mjs; this file names
// only the symbols and shapes that lane reads so it can be checked in strict TS.

/** A server-side catalogue entry, as far as the capability check reads it. */
export interface CatalogueModel {
  id: string;
  label: string;
  provider: string;
  endpoint: string;
}

export interface PublicModelAudio {
  mode: "music" | "speech" | "effect";
  minSeconds?: number;
  maxSeconds?: number;
  maxChars?: number;
}

/** One served model in the exact shape publicModels() returns and the manifest stores. */
export interface PublicModelRecord {
  id: string;
  label: string;
  kind: string;
  endpoint: string;
  composer: boolean;
  description: string;
  aspects: string[];
  durations: number[] | null;
  references: number;
  audio: PublicModelAudio | null;
  edit: string | null;
  promptRequired: boolean;
  mask: boolean;
  render: string | null;
  provider: string;
  costMicro: number;
  costPerSecondMicro: number | null;
  durationCostsMicro: Record<string, number> | null;
  costBasis: string;
}

/** A retired model's retained attribution. */
export interface RetiredModelRecord {
  id: string;
  label: string;
  kind: string;
  endpoint: string;
  provider: string;
  retiredAt: string;
  replacement: string;
  reason: string;
}

export const imageAspects: string[];
export const models: Record<string, CatalogueModel>;
/** Frame dimensions for one aspect, or the reference's own when matching. */
export function aspectDimensions(
  aspect: string,
  reference?: { width?: number | null; height?: number | null } | null,
): { width: number; height: number };
export function publicModels(): PublicModelRecord[];
export function publicRetiredModels(): RetiredModelRecord[];
