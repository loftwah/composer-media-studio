// Narrow, type-only declarations for the provider lane consumed by darkroom.ts.
// The catalogue and its public projections are maintained in
// provider-catalogue.ts; runtime adapters stay in providers.mjs.

/** Frame dimensions for one aspect, or the reference's own when matching. */
export function aspectDimensions(
  aspect: string,
  reference?: { width?: number | null; height?: number | null } | null,
): { width: number; height: number };
