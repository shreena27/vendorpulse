import { describe, it, expect } from "vitest";
import { createMockAdapter, MOCK_IFSC } from "./mockAdapter";
import {
  MOCK_ACCOUNT_EXACT_MATCH,
  MOCK_ACCOUNT_PARTIAL_MATCH,
  MOCK_ACCOUNT_MISMATCH,
  MOCK_ACCOUNT_TIMEOUT,
} from "./mockAdapter";
import { expectBankCheckResultShape } from "./shapeAssertions";

describe("mock bank adapter", () => {
  it("returns exact/verified for the exact-match fixture, for any vendor name", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Some Random Vendor Pvt Ltd",
      accountNumber: MOCK_ACCOUNT_EXACT_MATCH,
      ifsc: MOCK_IFSC,
    });
    expectBankCheckResultShape(result);
    expect(result.nameMatchResult).toBe("exact");
    expect(result.status).toBe("verified");
    expect(result.accountNumberMasked).toBe(
      `****${MOCK_ACCOUNT_EXACT_MATCH.slice(-4)}`,
    );
  });

  it("returns partial/manual_review for the partial-match fixture, for any vendor name", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: MOCK_ACCOUNT_PARTIAL_MATCH,
      ifsc: MOCK_IFSC,
    });
    expectBankCheckResultShape(result);
    expect(result.nameMatchResult).toBe("partial");
    expect(result.status).toBe("manual_review");
  });

  it("returns none/mismatch for the mismatch fixture", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: MOCK_ACCOUNT_MISMATCH,
      ifsc: MOCK_IFSC,
    });
    expectBankCheckResultShape(result);
    expect(result.nameMatchResult).toBe("none");
    expect(result.status).toBe("mismatch");
  });

  it("returns manual_review with a timeout error for the timeout fixture", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: MOCK_ACCOUNT_TIMEOUT,
      ifsc: MOCK_IFSC,
    });
    expectBankCheckResultShape(result);
    expect(result.status).toBe("manual_review");
    expect(result.error).toBe("timeout");
  });

  it("rejects a malformed account number before any provider call", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: "not-a-number",
      ifsc: MOCK_IFSC,
    });
    expectBankCheckResultShape(result);
    expect(result.error).toBe("invalid_account");
    expect(result.status).toBe("manual_review");
  });

  it("rejects a malformed IFSC before any provider call", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: MOCK_ACCOUNT_EXACT_MATCH,
      ifsc: "bad-ifsc",
    });
    expectBankCheckResultShape(result);
    expect(result.error).toBe("invalid_ifsc");
    expect(result.status).toBe("manual_review");
  });

  it("never includes the raw account number in the result", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.verifyAccount({
      vendorName: "Zenith Traders",
      accountNumber: MOCK_ACCOUNT_EXACT_MATCH,
      ifsc: MOCK_IFSC,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MOCK_ACCOUNT_EXACT_MATCH);
  });
});
