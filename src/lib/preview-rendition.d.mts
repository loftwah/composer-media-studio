// Narrow, type-only declaration for the renderPreview helper imported with an
// exact direct import by publication-derivatives.ts. Runtime stays in the
// existing preview-rendition.mjs; this only describes what the caller sees.

export interface RenderedPreview {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  sha256: string;
}

export interface PreviewEnv {
  // Owned and used by the real renderPreview implementation, not by this lane.
  IMAGES: unknown;
}

export interface RenderPreviewOptions {
  maxEdge?: number;
  quality?: number;
  width?: number;
  height?: number;
}

export function renderPreview(
  env: PreviewEnv,
  bytes: Uint8Array,
  options?: RenderPreviewOptions,
): Promise<RenderedPreview>;
