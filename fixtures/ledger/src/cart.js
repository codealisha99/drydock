export const TAX_RATE = 0.2;

/** Returns the cart total in pence: subtotal, then the discount, then tax on what remains. */
export function cartTotal(items, discountPct = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.pence * item.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const discount = Math.round(subtotal * (discountPct / 100));
  return subtotal - discount + tax;
}
