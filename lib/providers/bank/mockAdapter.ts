/**
 * Deterministic mock bank-verification adapter.
 *
 * Lets Chunk 2.1 build and test without live Eko credentials (ERD §12). It
 * returns the same `BankCheckResult` shape the live adapter will, so callers
 * cannot tell them apart. Fixture account numbers derive a canned holder
 * name FROM the vendor name they're given, so any test vendor name produces
 * the intended classification (exact / partial / none) regardless of what
 * that name is — no coincidental string overlap required.
 */

import { ACCOUNT_NUMBER_REGEX, IFSC_REGEX } from "@/lib/import/validateVendorRow";
import { maskAccountNumber } from "./mask";
import { matchNames } from "./nameMatch";
import type { BankCheckInput, BankCheckResult, BankProviderAdapter } from "./types";

// Fixture account numbers (valid format). Callers/tests import these by name.
export const MOCK_ACCOUNT_EXACT_MATCH = "100200300012";
export const MOCK_ACCOUNT_PARTIAL_MATCH = "100200300013";
export const MOCK_ACCOUNT_MISMATCH = "100200300014";
export const MOCK_ACCOUNT_TIMEOUT = "100200300099";
export const MOCK_IFSC = "HDFC0000123";

function statusFor(match: BankCheckResult["nameMatchResult"]): BankCheckResult["status"] {
  if (match === "exact") return "verified";
  if (match === "partial") return "manual_review";
  return "mismatch";
}

function result(
  input: BankCheckInput,
  holderName: string | null,
  error?: string,
): BankCheckResult {
  const nameMatchResult = holderName ? matchNames(input.vendorName, holderName) : "none";
  return {
    accountNumberMasked: maskAccountNumber(input.accountNumber),
    ifsc: input.ifsc,
    nameMatchResult,
    status: error ? "manual_review" : statusFor(nameMatchResult),
    provider: "mock",
    checkedAt: new Date().toISOString(),
    raw: { mock: true, holderName, error: error ?? null },
    ...(error ? { error } : {}),
  };
}

export function createMockAdapter(): BankProviderAdapter {
  async function verifyAccount(input: BankCheckInput): Promise<BankCheckResult> {
    // Reject malformed input before any "provider call" (acceptance: no
    // wasted calls), same rule as the GST/MSME mocks.
    if (!ACCOUNT_NUMBER_REGEX.test(input.accountNumber)) {
      return result(input, null, "invalid_account");
    }
    if (!IFSC_REGEX.test(input.ifsc)) {
      return result(input, null, "invalid_ifsc");
    }

    if (input.accountNumber === MOCK_ACCOUNT_TIMEOUT) {
      return result(input, null, "timeout");
    }
    if (input.accountNumber === MOCK_ACCOUNT_MISMATCH) {
      return result(input, "ZZZZ UNRELATED ENTITY ZZZZ");
    }
    if (input.accountNumber === MOCK_ACCOUNT_PARTIAL_MATCH) {
      const firstWord = input.vendorName.trim().split(/\s+/)[0] ?? "VENDOR";
      return result(input, `${firstWord} ENTERPRISES`);
    }
    // MOCK_ACCOUNT_EXACT_MATCH and any other well-formed number: echo the
    // vendor's own name back as the holder name.
    return result(input, input.vendorName);
  }

  return { name: "mock", verifyAccount };
}
