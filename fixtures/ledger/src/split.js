/** Splits total pence across n shares. */
export function splitEvenly(total, n) {
  return Array.from({ length: n }, () => Math.floor(total / n));
}
