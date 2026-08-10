/**
 * Pure certificate-status derivation (Chunk 2.2).
 *
 * Computed once, server-side, at upload time — there is no ongoing/scheduled
 * certificate monitoring in v1 (explicitly out of scope per the PRD), so this
 * is never re-evaluated after the row is written.
 */

export type CertificateStatus = "valid" | "expired";

/**
 * `expiryDateIso` is a plain date string (YYYY-MM-DD, no time component).
 * A certificate expiring today is still valid (it expires at the end of that
 * day) — only a date strictly before today's date is expired.
 */
export function deriveCertificateStatus(
  expiryDateIso: string,
  today: Date,
): CertificateStatus {
  const todayIso = today.toISOString().slice(0, 10);
  return expiryDateIso < todayIso ? "expired" : "valid";
}
