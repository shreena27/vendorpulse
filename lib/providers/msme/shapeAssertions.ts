import { expect } from "vitest";
import type { MsmeCheckResult, MsmeStatus } from "./types";

const STATUSES: MsmeStatus[] = ["REGISTERED", "LAPSED", "NOT_MSME", "UNKNOWN"];

/**
 * Assert the common `MsmeCheckResult` shape. Every adapter must satisfy this, so
 * the poller (1.4) can treat the live and mock providers identically.
 */
export function expectMsmeCheckResultShape(result: MsmeCheckResult): void {
  expect(typeof result.udyamNumber).toBe("string");
  expect(STATUSES).toContain(result.status);
  expect(
    result.rawStatus === null || typeof result.rawStatus === "string",
  ).toBe(true);
  expect(
    result.registrationDate === null ||
      typeof result.registrationDate === "string",
  ).toBe(true);
  expect(["deepvue", "mock"]).toContain(result.provider);
  expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  expect("raw" in result).toBe(true);
  if (result.error !== undefined) {
    expect(typeof result.error).toBe("string");
    // A failed check is never treated as compliant.
    expect(result.status).toBe("UNKNOWN");
  }
}
