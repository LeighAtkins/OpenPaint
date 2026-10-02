/** A customer value of zero is filled; whitespace and missing values are empty. */
export function measurementTagShape(value: unknown): 'circle' | 'square' {
  const filled =
    typeof value === 'string'
      ? value.trim() !== ''
      : typeof value === 'number' && Number.isFinite(value);
  return filled ? 'square' : 'circle';
}
