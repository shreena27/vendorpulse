/**
 * Common MSME/Udyam provider-adapter contract (ERD §4.1, §8).
 *
 * The twin of the GST adapter (lib/providers/gst). Every MSME provider — the
 * (future) live Deepvue adapter and the mock — implements `MsmeProviderAdapter`
 * and returns the same `MsmeCheckResult` shape, so the poller (Chunk 1.4) never
 * has to know which provider answered.
 */

/** Normalized MSME registration status. Maps to verification_checks.status_value. */
export type MsmeStatus = "REGISTERED" | "LAPSED" | "NOT_MSME" | "UNKNOWN";

export interface MsmeCheckResult {
  /** The Udyam number that was checked, upper-cased and trimmed. */
  udyamNumber: string;
  /** Normalized status. UNKNOWN on any failure or an unrecognized value. */
  status: MsmeStatus;
  /** The provider's original status label, for audit. Null on failure. */
  rawStatus: string | null;
  /** Registration date (ISO, YYYY-MM-DD) when REGISTERED/LAPSED, else null. */
  registrationDate: string | null;
  /** Which adapter produced this result. */
  provider: "deepvue" | "mock";
  /** When the check ran, ISO 8601. */
  checkedAt: string;
  /** The full provider payload — stored in verification_checks.raw_response (1.4). */
  raw: unknown;
  /**
   * Set only when the check failed; `status` is then UNKNOWN. One of:
   * "invalid_udyam" | "timeout" | "not_configured" | "provider_error".
   * A failed check is never treated as compliant (ERD §7).
   */
  error?: string;
}

export interface MsmeProviderAdapter {
  readonly name: "deepvue" | "mock";
  checkUdyam(udyamNumber: string): Promise<MsmeCheckResult>;
}
