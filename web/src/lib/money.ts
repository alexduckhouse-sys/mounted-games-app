/** "£18.00", or "Free" for no charge. Amounts are in pence. */
export function priceLabel(minor: number): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}
