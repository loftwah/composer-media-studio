// Narrow, type-only declarations for the Woodhouse Share helpers imported by
// publication-attribution.ts. Runtime behaviour stays in woodhouse-share.mjs;
// this only names the symbols that lane imports so they can be checked in
// strict TS.

export interface ShareAsset {
  credit: string;
  reuse: string;
  sourceUrl: unknown;
}

export const shareApi: string;

export function shareAsset(assetId: string, timeout?: number): Promise<ShareAsset>;

export function shareOriginal(asset: ShareAsset, limit: number, timeout?: number): Promise<Uint8Array>;

export function woodhouseUrl(value: unknown): string | null;
