// The vanilla studio imports this file directly. Keep it in step with the
// tested source in src/frontend/derivative-size.mjs.
export const DERIVATIVE_LONG_EDGE = 720;

/** Scale a source frame down to the preview edge, preserving its aspect. */
export function derivativeSize(width, height, longEdge = DERIVATIVE_LONG_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(longEdge) || longEdge <= 0) return null;
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
