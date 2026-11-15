export const DERIVATIVE_LONG_EDGE: number;
export function derivativeSize(
  width: number,
  height: number,
  longEdge?: number,
): { width: number; height: number } | null;
