import { expect } from "vitest";
import type { BankCheckResult, BankStatus } from "./types";

const STATUSES: BankStatus[] = ["verified", "manual_review", "mismatch"];

/**
 * Assert the common `BankCheckResult` shape. Every adapter must satisfy this,
 * so callers can treat the live and mock providers identically. Also enforces
 * the safety guarantee: nothing in the result carries more than a masked
 * account number.
 */
export function expectBankCheckResultShape(result: BankCheckResult): void {
  expect(typeof result.accountNumberMasked).toBe("string");
  expect(result.accountNumberMasked.startsWith("****")).toBe(true);
  expect(typeof result.ifsc).toBe("string");
  expect(["exact", "partial", "none"]).toContain(result.nameMatchResult);
  expect(STATUSES).toContain(result.status);
  expect(["eko", "mock"]).toContain(result.provider);
  expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  expect("raw" in result).toBe(true);
  if (result.error !== undefined) {
    expect(typeof result.error).toBe("string");
    // A failed check is never treated as compliant.
    expect(result.status).toBe("manual_review");
  }
}
