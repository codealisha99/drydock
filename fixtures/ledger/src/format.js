/** Formats pence as pounds, e.g. 1250 -> "$12.50". */
export function formatMoney(pence) {
  return `$${(pence / 100).toFixed(0)}`;
}
