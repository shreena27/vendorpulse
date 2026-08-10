/**
 * Masks a raw bank account number to its last 4 digits (ERD §6.3-style rule:
 * the full number is never persisted). Every adapter calls this immediately
 * after using the raw number, so the unmasked value never leaves the adapter.
 */
export function maskAccountNumber(raw: string): string {
  return `****${raw.slice(-4)}`;
}
