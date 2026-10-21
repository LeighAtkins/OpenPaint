// Round half up (away from zero) on the exact decimal value.
//
// Number.prototype.toFixed rounds the binary float, so 6.35 (stored as
// 6.3499999...) prints as "6.3" while a calculator says 6.4. Cleaning the
// scaled value to 12 significant digits first removes that float noise, so a
// value that is exactly on the half rounds up the way people expect.
export function roundHalfUp(value: number, decimals = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const places = Math.max(0, Math.min(10, Math.floor(Number(decimals) || 0)));
  const factor = 10 ** places;
  const scaled = Number((Math.abs(numeric) * factor).toPrecision(12));
  const rounded = Math.floor(scaled + 0.5) / factor;
  return numeric < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Fixed-point text using roundHalfUp, e.g. formatHalfUp(6.35, 1) === "6.4". */
export function formatHalfUp(value: number, decimals = 0, trimTrailingZeros = false): string {
  const places = Math.max(0, Math.min(10, Math.floor(Number(decimals) || 0)));
  const text = roundHalfUp(value, places).toFixed(places);
  return trimTrailingZeros && text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
