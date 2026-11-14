/** Parse seconds exactly to whole, safe milliseconds without treating an empty field as zero. */
export function parseSongTime(value: string): number | null {
  const match = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const [whole, fraction = ''] = match[1].split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return 0;
  const exponent = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const shift = exponent - fraction.length + 3;
  if (shift < 0) {
    const remove = -shift;
    if (remove > digits.length || !/^0+$/.test(digits.slice(-remove))) return null;
    digits = digits.slice(0, -remove);
  } else {
    if (digits.length + shift > 16) return null;
    digits += '0'.repeat(shift);
  }
  const result = Number(digits);
  return Number.isSafeInteger(result) ? result : null;
}
