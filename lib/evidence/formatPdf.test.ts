import { describe, it, expect } from "vitest";
import { formatExportPdf } from "./formatPdf";
import type { EvidenceExportRow } from "./buildExport";

const RANGE = { from: "2026-06-01", to: "2026-06-30" };

function row(overrides: Partial<EvidenceExportRow> = {}): EvidenceExportRow {
  return {
    paymentId: "pay-1",
    dueDate: "2026-06-15",
    vendorId: "v1",
    vendorName: "Acme Traders",
    gstin: "27ABCDE1234F1Z5",
    udyamNumber: "UDYAM-MH-01-0000001",
    amount: 45000,
    paymentMethod: "neft",
    paymentStatus: "pending",
    msmeStatus: { kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-06-01T00:00:00.000Z" },
    ...overrides,
  };
}

// Structural smoke test only — no PDF-parsing library is being added
// (confirmed scope decision), so content is not asserted line-by-line.
describe("formatExportPdf", () => {
  it("resolves a valid PDF buffer for an empty rows array, without throwing", async () => {
    const buf = await formatExportPdf([], RANGE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("resolves a valid PDF buffer covering all three MsmeAsOfStatus kinds, without throwing", async () => {
    const rows: EvidenceExportRow[] = [
      row({ paymentId: "p1", msmeStatus: { kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-06-01T00:00:00.000Z" } }),
      row({ paymentId: "p2", msmeStatus: { kind: "no_record" }, udyamNumber: "UDYAM-MH-01-0000002" }),
      row({ paymentId: "p3", msmeStatus: { kind: "not_applicable" }, udyamNumber: null }),
    ];
    const buf = await formatExportPdf(rows, RANGE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
