import { describe, it, expect } from "vitest";
import { maskAccountNumber } from "./mask";

describe("maskAccountNumber", () => {
  it("keeps only the last 4 digits, masking the rest with asterisks", () => {
    expect(maskAccountNumber("1234567890123456")).toBe("****3456");
  });

  it("does not include any part of the original number beyond the last 4 digits", () => {
    const raw = "9988776655443322";
    const masked = maskAccountNumber(raw);
    expect(masked).not.toContain(raw.slice(0, -4));
    expect(masked.endsWith(raw.slice(-4))).toBe(true);
  });

  it("masks a short (9-digit) account number the same way", () => {
    expect(maskAccountNumber("123456789")).toBe("****6789");
  });
});
