/**
 * Live bank-verification provider adapter — Eko.
 *
 * SERVER-ONLY. NOT IMPLEMENTED YET — this is a deliberate stub.
 *
 * No Eko sandbox credentials exist yet, and Eko's docs have not been
 * reviewed. Following the Chunk 1.2 lesson (the live Sandbox contract
 * differed from its public docs) and the Chunk 1.3 precedent
 * (lib/providers/msme/deepvueAdapter.ts), we do NOT guess. The interface is
 * implemented so the selector and types compile, but `verifyAccount` throws a
 * clear, explicit error rather than returning a fabricated result. Until
 * then, run against the mock (BANK_PROVIDER=mock, the default).
 *
 * TODO(chunk-2.1-live): Implement the real Eko bank-verification check once
 * sandbox credentials and docs are available. Verify against the live API
 * first (as done for Sandbox in lib/providers/gst/sandboxAdapter.ts): confirm
 * the auth flow, the endpoint, the request field names for the account number
 * and IFSC, and exactly where the account-holder name and match result live
 * in the response. Reuse ACCOUNT_NUMBER_REGEX/IFSC_REGEX for the pre-call
 * format check, retry once on timeout/5xx (ERD §7), mask the account number
 * immediately after use (never let the raw value leave this function), and
 * map the provider's match result to BankStatus via matchNames() or the
 * provider's own verdict if it returns one. Do not guess field names.
 */

import type { BankProviderAdapter, BankCheckResult } from "./types";

export function createEkoAdapter(): BankProviderAdapter {
  // The input argument is intentionally omitted: this stub throws before it
  // would ever use it. The real implementation will take it (see the TODO).
  async function verifyAccount(): Promise<BankCheckResult> {
    throw new Error(
      "Eko bank adapter is not configured. Provide Eko credentials and " +
        "implement the live adapter, or set BANK_PROVIDER=mock.",
    );
  }

  return { name: "eko", verifyAccount };
}
