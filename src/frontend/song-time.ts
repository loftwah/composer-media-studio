/** Parse a deliberate non-negative second value without turning an empty field into zero. */
export function parseSongTime(value: string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const milliseconds = Math.round(Number(value) * 1000);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}
