/**
 * Common bank-verification provider-adapter contract (Chunk 2.1).
 *
 * The twin of the GST/MSME adapters (lib/providers/gst, lib/providers/msme).
 * Every bank provider — the (future) live Eko adapter and the mock —
 * implements `BankProviderAdapter` and returns the same `BankCheckResult`
 * shape, so callers never know which provider answered.
 *
 * Safety guarantee: `BankCheckResult` has no field for the raw account
 * number, only `accountNumberMasked`. Nothing downstream of an adapter call
 * can carry the full number, even by accident.
 */

import type { NameMatchResult } from "./nameMatch";

export type { NameMatchResult };

/** Normalized outcome. Maps to bank_verifications.status. */
export type BankStatus = "verified" | "manual_review" | "mismatch";

export interface BankCheckInput {
  /** The vendor's registered name, compared against the account holder name. */
  vendorName: string;
  /** Raw account number. Used only for this call; never returned or stored. */
  accountNumber: string;
  ifsc: string;
}

export interface BankCheckResult {
  /** e.g. "****3456". The full number is never available past this point. */
  accountNumberMasked: string;
  ifsc: string;
  nameMatchResult: NameMatchResult;
  status: BankStatus;
  /** Which adapter produced this result. */
  provider: "eko" | "mock";
  /** When the check ran, ISO 8601. */
  checkedAt: string;
  /** The full provider payload, minus the raw account number, for audit. */
  raw: unknown;
  /**
   * Set only when the check failed; `status` is then "manual_review". One of:
   * "invalid_account" | "invalid_ifsc" | "timeout" | "not_configured" |
   * "provider_error". A failed check is never treated as compliant (ERD §7).
   */
  error?: string;
}

export interface BankProviderAdapter {
  readonly name: "eko" | "mock";
  verifyAccount(input: BankCheckInput): Promise<BankCheckResult>;
}
