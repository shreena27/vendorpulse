import { expect } from "vitest";
import type { GstCheckResult, GstStatus } from "./types";

const STATUSES: GstStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "CANCELLED",
  "SUSPENDED",
  "UNKNOWN",
];

/**
 * Assert the common `GstCheckResult` shape. Every adapter must satisfy this, so
 * the poller (1.4) can treat the live and mock providers identically.
 */
export function expectGstCheckResultShape(result: GstCheckResult): void {
  expect(typeof result.gstin).toBe("string");
  expect(STATUSES).toContain(result.status);
  expect(
    result.rawStatus === null || typeof result.rawStatus === "string",
  ).toBe(true);
  expect(["sandbox_quicko", "mock"]).toContain(result.provider);
  expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  expect("raw" in result).toBe(true);
  if (result.error !== undefined) {
    expect(typeof result.error).toBe("string");
    // A failed check is never treated as compliant.
    expect(result.status).toBe("UNKNOWN");
  }
}
