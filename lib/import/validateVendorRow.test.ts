import { describe, it, expect } from "vitest";
import { validateVendorRow, type MappedRow } from "./validateVendorRow";

function row(overrides: MappedRow): MappedRow {
  return { name: "Acme Traders", ...overrides };
}

describe("validateVendorRow — bank details (Chunk 2.1)", () => {
  it("returns bankDetails when both account number and IFSC are valid", () => {
    const result = validateVendorRow(
      row({ bank_account_number: "123456789012", bank_ifsc: "HDFC0000123" }),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bankDetails).toEqual({
      accountNumber: "123456789012",
      ifsc: "HDFC0000123",
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("returns bankDetails: null when no bank columns are mapped", () => {
    const result = validateVendorRow(row({}), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bankDetails).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it("soft-warns and drops bankDetails on a malformed account number, but keeps the vendor", () => {
    const result = validateVendorRow(
      row({ bank_account_number: "abc123", bank_ifsc: "HDFC0000123" }),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bankDetails).toBeNull();
    expect(result.warnings).toEqual([
      {
        row: 2,
        field: "bank_account_number",
        message: expect.stringContaining("account number"),
      },
    ]);
  });

  it("soft-warns and drops bankDetails on a malformed IFSC, but keeps the vendor", () => {
    const result = validateVendorRow(
      row({ bank_account_number: "123456789012", bank_ifsc: "not-an-ifsc" }),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bankDetails).toBeNull();
    expect(result.warnings).toEqual([
      {
        row: 2,
        field: "bank_ifsc",
        message: expect.stringContaining("IFSC"),
      },
    ]);
  });

  it("soft-warns and drops bankDetails when only one of the two bank fields is mapped", () => {
    const result = validateVendorRow(
      row({ bank_account_number: "123456789012" }),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bankDetails).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
