import { describe, it, expect } from "vitest";
import { correlateImportedVendors } from "./correlateImport";

describe("correlateImportedVendors", () => {
  it("matches a row to its inserted vendor by GSTIN when present", () => {
    const rows = [{ name: "Acme", gstin: "27AAAAA0000A1Z5", extra: "x" }];
    const inserted = [
      { id: "v1", name: "Acme", gstin: "27AAAAA0000A1Z5" },
      { id: "v2", name: "Other", gstin: "27BBBBB0000B1Z5" },
    ];
    const result = correlateImportedVendors(rows, inserted);
    expect(result).toEqual([{ ...rows[0], vendorId: "v1" }]);
  });

  it("falls back to matching by exact name when GSTIN is absent", () => {
    const rows = [{ name: "Acme", gstin: null }];
    const inserted = [{ id: "v1", name: "Acme", gstin: null }];
    const result = correlateImportedVendors(rows, inserted);
    expect(result[0].vendorId).toBe("v1");
  });

  it("returns vendorId: null when no inserted vendor matches", () => {
    const rows = [{ name: "Ghost", gstin: null }];
    const inserted = [{ id: "v1", name: "Acme", gstin: null }];
    const result = correlateImportedVendors(rows, inserted);
    expect(result[0].vendorId).toBeNull();
  });

  it("assigns each same-named, GSTIN-less vendor to a distinct id (documented edge case: arbitrary pairing, never double-assigned)", () => {
    const rows = [
      { name: "Acme", gstin: null },
      { name: "Acme", gstin: null },
    ];
    const inserted = [
      { id: "v1", name: "Acme", gstin: null },
      { id: "v2", name: "Acme", gstin: null },
    ];
    const result = correlateImportedVendors(rows, inserted);
    const ids = result.map((r) => r.vendorId).sort();
    expect(ids).toEqual(["v1", "v2"]);
  });
});
