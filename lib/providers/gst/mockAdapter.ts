/**
 * Deterministic mock GST adapter.
 *
 * Lets Phase 1 build and test without live credentials (ERD §12). It returns
 * the same `GstCheckResult` shape as the Sandbox adapter, so callers cannot
 * tell them apart. Three fixture GSTINs cover the states the tests assert;
 * every other well-formed GSTIN resolves to ACTIVE so dev flows return
 * something sensible.
 */

import { GSTIN_REGEX } from "@/lib/import/validateVendorRow";
import type { GstCheckResult, GstProviderAdapter, GstStatus } from "./types";

// Fixture GSTINs (valid pattern; no real checksum needed — the mock never calls
// an API). Callers/tests import these by name.
export const MOCK_GSTIN_ACTIVE = "27AAAAA0000A1Z5";
export const MOCK_GSTIN_CANCELLED = "27BBBBB1111B1Z5";
export const MOCK_GSTIN_TIMEOUT = "27CCCCC2222C1Z5";

function result(
  gstin: string,
  status: GstStatus,
  rawStatus: string | null,
  error?: string,
): GstCheckResult {
  return {
    gstin,
    status,
    rawStatus,
    provider: "mock",
    checkedAt: new Date().toISOString(),
    // Mirror the Sandbox shape (status lives at data.data.sts) for realism.
    raw: { data: { data: { sts: rawStatus } }, mock: true },
    ...(error ? { error } : {}),
  };
}

export function createMockAdapter(): GstProviderAdapter {
  async function checkGstin(input: string): Promise<GstCheckResult> {
    const gstin = input.trim().toUpperCase();

    if (!GSTIN_REGEX.test(gstin)) {
      return result(gstin, "UNKNOWN", null, "invalid_gstin");
    }
    if (gstin === MOCK_GSTIN_TIMEOUT) {
      // Same shape the live adapter returns after its retries are exhausted.
      return result(gstin, "UNKNOWN", null, "timeout");
    }
    if (gstin === MOCK_GSTIN_CANCELLED) {
      return result(gstin, "CANCELLED", "Cancelled");
    }
    // MOCK_GSTIN_ACTIVE and any other well-formed GSTIN.
    return result(gstin, "ACTIVE", "Active");
  }

  return { name: "mock", checkGstin };
}
