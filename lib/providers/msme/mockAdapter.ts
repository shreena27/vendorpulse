/**
 * Deterministic mock MSME/Udyam adapter.
 *
 * Lets Phase 1 build and test without live Deepvue credentials (ERD §12). It
 * returns the same `MsmeCheckResult` shape the live adapter will, so callers
 * cannot tell them apart. Fixture Udyam numbers cover the states the tests
 * assert; every other well-formed number resolves to REGISTERED so dev flows
 * return something sensible.
 */

import { UDYAM_REGEX } from "@/lib/import/validateVendorRow";
import type { MsmeCheckResult, MsmeProviderAdapter, MsmeStatus } from "./types";

// Fixture Udyam numbers (valid pattern). Callers/tests import these by name.
export const MOCK_UDYAM_REGISTERED = "UDYAM-MH-01-0000001";
export const MOCK_UDYAM_LAPSED = "UDYAM-MH-02-0000002";
export const MOCK_UDYAM_NOT_MSME = "UDYAM-MH-03-0000003";
export const MOCK_UDYAM_TIMEOUT = "UDYAM-MH-04-0000004";

function result(
  udyamNumber: string,
  status: MsmeStatus,
  rawStatus: string | null,
  registrationDate: string | null,
  error?: string,
): MsmeCheckResult {
  return {
    udyamNumber,
    status,
    rawStatus,
    registrationDate,
    provider: "mock",
    checkedAt: new Date().toISOString(),
    raw: { data: { status: rawStatus, registrationDate }, mock: true },
    ...(error ? { error } : {}),
  };
}

export function createMockAdapter(): MsmeProviderAdapter {
  async function checkUdyam(input: string): Promise<MsmeCheckResult> {
    const udyamNumber = input.trim().toUpperCase();

    // Reject a malformed Udyam number before any call (acceptance: no wasted calls).
    if (!UDYAM_REGEX.test(udyamNumber)) {
      return result(udyamNumber, "UNKNOWN", null, null, "invalid_udyam");
    }
    if (udyamNumber === MOCK_UDYAM_TIMEOUT) {
      // Same shape the live adapter returns after its retries are exhausted.
      return result(udyamNumber, "UNKNOWN", null, null, "timeout");
    }
    if (udyamNumber === MOCK_UDYAM_LAPSED) {
      return result(udyamNumber, "LAPSED", "Lapsed", "2019-04-10");
    }
    if (udyamNumber === MOCK_UDYAM_NOT_MSME) {
      return result(udyamNumber, "NOT_MSME", "Not MSME", null);
    }
    // MOCK_UDYAM_REGISTERED and any other well-formed number.
    return result(udyamNumber, "REGISTERED", "Registered", "2021-06-15");
  }

  return { name: "mock", checkUdyam };
}
