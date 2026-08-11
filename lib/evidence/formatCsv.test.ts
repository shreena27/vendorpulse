import { describe, it, expect } from "vitest";
import { formatExportCsv } from "./formatCsv";
import type { EvidenceExportRow } from "./buildExport";

const HEADER =
  "Payment ID,Due Date,Vendor Name,GSTIN,Udyam Number,Amount (INR),Payment Method,Payment Status,MSME Status (as of due date),MSME Status Checked At";

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

function lines(csv: string): string[] {
  // Strip the BOM before splitting, so line-content assertions stay clean.
  return csv.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
}

describe("formatExportCsv", () => {
  it("returns just the header row for an empty rows array", () => {
    const csv = formatExportCsv([]);
    expect(lines(csv)).toEqual([HEADER]);
  });

  it("prepends a UTF-8 BOM", () => {
    const csv = formatExportCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("renders all ten fields in order for one full row", () => {
    const csv = formatExportCsv([row()]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toBe(
      'pay-1,2026-06-15,Acme Traders,27ABCDE1234F1Z5,UDYAM-MH-01-0000001,45000.00,neft,pending,Registered,2026-06-01T00:00:00.000Z',
    );
  });

  it("quotes and escapes a vendor name containing a comma", () => {
    const csv = formatExportCsv([row({ vendorName: "Sharma, Traders & Co" })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toContain('"Sharma, Traders & Co"');
  });

  it("escapes an embedded double quote by doubling it", () => {
    const csv = formatExportCsv([row({ vendorName: 'The "Best" Traders' })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toContain('"The ""Best"" Traders"');
  });

  it("renders null gstin/udyamNumber as empty strings, never the literal 'null'", () => {
    const csv = formatExportCsv([row({ gstin: null, udyamNumber: null })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).not.toContain("null");
    expect(dataLine.split(",")[3]).toBe("");
    expect(dataLine.split(",")[4]).toBe("");
  });

  it("renders not_applicable and no_record with an empty checkedAt column", () => {
    const naCsv = formatExportCsv([row({ msmeStatus: { kind: "not_applicable" } })]);
    const naFields = lines(naCsv)[1].split(",");
    expect(naFields[8]).toBe("Not applicable");
    expect(naFields[9]).toBe("");

    const nrCsv = formatExportCsv([row({ msmeStatus: { kind: "no_record" } })]);
    const nrFields = lines(nrCsv)[1].split(",");
    expect(nrFields[8]).toBe("No record");
    expect(nrFields[9]).toBe("");
  });

  it("renders whole-number amounts with two decimal places", () => {
    const csv = formatExportCsv([row({ amount: 100000 })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toContain("100000.00");
  });
});
