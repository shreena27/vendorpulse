import { describe, it, expect } from "vitest";
import { findMsmeEvidenceGaps } from "./findMsmeEvidenceGaps";

describe("findMsmeEvidenceGaps", () => {
  it("flags a vendor with a udyam number and a checked status but no evidence_log row (the bug)", () => {
    const gaps = findMsmeEvidenceGaps({
      vendors: [{ id: "v1", name: "Vishwakarma Tooling Industries", udyamNumber: "UDYAM-GJ-02-0056142" }],
      vendorIdsWithMsmeChecks: new Set(["v1"]),
      vendorIdsWithMsmeEvidence: new Set(),
    });
    expect(gaps).toEqual([{ vendorId: "v1", vendorName: "Vishwakarma Tooling Industries" }]);
  });

  it("does not flag a vendor that has both a check and matching evidence", () => {
    const gaps = findMsmeEvidenceGaps({
      vendors: [{ id: "v1", name: "Healthy Vendor", udyamNumber: "UDYAM-MH-03-0028471" }],
      vendorIdsWithMsmeChecks: new Set(["v1"]),
      vendorIdsWithMsmeEvidence: new Set(["v1"]),
    });
    expect(gaps).toEqual([]);
  });

  it("does not flag a vendor with no udyam number — never MSME-checkable", () => {
    const gaps = findMsmeEvidenceGaps({
      vendors: [{ id: "v1", name: "No Udyam Vendor", udyamNumber: null }],
      vendorIdsWithMsmeChecks: new Set(),
      vendorIdsWithMsmeEvidence: new Set(),
    });
    expect(gaps).toEqual([]);
  });

  it("does not flag a vendor with a udyam number that has never been checked — legitimate no_record", () => {
    const gaps = findMsmeEvidenceGaps({
      vendors: [{ id: "v1", name: "Not Yet Checked Vendor", udyamNumber: "UDYAM-DL-04-0011223" }],
      vendorIdsWithMsmeChecks: new Set(),
      vendorIdsWithMsmeEvidence: new Set(),
    });
    expect(gaps).toEqual([]);
  });

  it("checks each vendor independently across a mixed batch", () => {
    const gaps = findMsmeEvidenceGaps({
      vendors: [
        { id: "gap", name: "Gap Vendor", udyamNumber: "UDYAM-1" },
        { id: "healthy", name: "Healthy Vendor", udyamNumber: "UDYAM-2" },
        { id: "no-udyam", name: "No Udyam Vendor", udyamNumber: null },
        { id: "unchecked", name: "Unchecked Vendor", udyamNumber: "UDYAM-3" },
      ],
      vendorIdsWithMsmeChecks: new Set(["gap", "healthy"]),
      vendorIdsWithMsmeEvidence: new Set(["healthy"]),
    });
    expect(gaps).toEqual([{ vendorId: "gap", vendorName: "Gap Vendor" }]);
  });
});
