import { describe, it, expect } from "vitest";
import { createEkoAdapter } from "./ekoAdapter";
import { MOCK_ACCOUNT_EXACT_MATCH, MOCK_IFSC } from "./mockAdapter";

describe("Eko bank adapter (stub)", () => {
  it("constructs but fails loudly when used, never silently", async () => {
    const adapter = createEkoAdapter();
    expect(adapter.name).toBe("eko");
    // Even well-formed input must not return a fabricated result.
    await expect(
      adapter.verifyAccount({
        vendorName: "Acme Traders",
        accountNumber: MOCK_ACCOUNT_EXACT_MATCH,
        ifsc: MOCK_IFSC,
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
