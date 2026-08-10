/**
 * Common GST provider-adapter contract (ERD §4.1, §8).
 *
 * Every GST provider (the live Sandbox by Quicko adapter, the mock, and any
 * future one) implements `GstProviderAdapter` and returns the same
 * `GstCheckResult` shape. The poller (Chunk 1.4) calls this and never has to
 * know which provider answered.
 */

/** Normalized GST registration status. Maps to verification_checks.status_value. */
export type GstStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "CANCELLED"
  | "SUSPENDED"
  | "UNKNOWN";

export interface GstCheckResult {
  /** The GSTIN that was checked, upper-cased and trimmed. */
  gstin: string;
  /** Normalized status. UNKNOWN on any failure or an unrecognized value. */
  status: GstStatus;
  /** The provider's original status label (e.g. "Active"), for audit. Null on failure. */
  rawStatus: string | null;
  /** Which adapter produced this result. */
  provider: "sandbox_quicko" | "mock";
  /** When the check ran, ISO 8601. */
  checkedAt: string;
  /** The full provider payload — stored in verification_checks.raw_response (1.4). */
  raw: unknown;
  /**
   * Set only when the check failed; `status` is then UNKNOWN. One of:
   * "invalid_gstin" | "timeout" | "auth_failed" | "provider_error".
   * A failed check is never treated as compliant (ERD §7).
   */
  error?: string;
}

export interface GstProviderAdapter {
  readonly name: "sandbox_quicko" | "mock";
  checkGstin(gstin: string): Promise<GstCheckResult>;
}
