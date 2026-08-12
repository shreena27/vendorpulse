import { describe, it, expect } from "vitest";
import { formatExportCsv } from "./formatCsv";
import type { EvidenceExportRow } from "./buildExport";

const HEADER =
  "Payment ID,Due Date,Vendor Name,GSTIN,Amount (INR),Payment Method,Payment Status,MSME Status (as of due date),MSME Status Checked At,LEI Status (as of due date),LEI Status Checked At";

function row(overrides: Partial<EvidenceExportRow> = {}): EvidenceExportRow {
  return {
    paymentId: "pay-1",
    dueDate: "2026-06-15",
    vendorId: "v1",
    vendorName: "Acme Traders",
    gstin: "27ABCDE1234F1Z5",
    amount: 45000,
    paymentMethod: "neft",
    paymentStatus: "pending",
    msmeStatus: { kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-06-01T00:00:00.000Z" },
    leiStatus: { kind: "not_applicable" },
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

  it("renders all eleven fields in order for one full row, no Udyam Number column", () => {
    const csv = formatExportCsv([
      row({ leiStatus: { kind: "checked", statusValue: "issued", checkedAt: "2026-06-02T00:00:00.000Z" } }),
    ]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toBe(
      "pay-1,2026-06-15,Acme Traders,27ABCDE1234F1Z5,45000.00,neft,pending,Registered,2026-06-01T00:00:00.000Z,Valid,2026-06-02T00:00:00.000Z",
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

  it("renders a null gstin as an empty string, never the literal 'null'", () => {
    const csv = formatExportCsv([row({ gstin: null })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).not.toContain("null");
    expect(dataLine.split(",")[3]).toBe("");
  });

  it("renders MSME not_applicable and no_record with distinct, self-explanatory labels and an empty checkedAt column", () => {
    const naCsv = formatExportCsv([row({ msmeStatus: { kind: "not_applicable" } })]);
    const naFields = lines(naCsv)[1].split(",");
    expect(naFields[7]).toBe("Not MSME-registered");
    expect(naFields[8]).toBe("");

    const nrCsv = formatExportCsv([row({ msmeStatus: { kind: "no_record" } })]);
    const nrFields = lines(nrCsv)[1].split(",");
    expect(nrFields[7]).toBe("No verification record");
    expect(nrFields[8]).toBe("");
  });

  it("renders LEI not_applicable, no_record, and checked with distinct labels and an empty checkedAt column where relevant", () => {
    const naCsv = formatExportCsv([row({ leiStatus: { kind: "not_applicable" } })]);
    const naFields = lines(naCsv)[1].split(",");
    expect(naFields[9]).toBe("Not applicable");
    expect(naFields[10]).toBe("");

    const nrCsv = formatExportCsv([row({ leiStatus: { kind: "no_record" } })]);
    const nrFields = lines(nrCsv)[1].split(",");
    expect(nrFields[9]).toBe("No verification record");
    expect(nrFields[10]).toBe("");

    const lapsedCsv = formatExportCsv([
      row({ leiStatus: { kind: "checked", statusValue: "lapsed", checkedAt: "2026-08-12T00:00:00.000Z" } }),
    ]);
    const lapsedFields = lines(lapsedCsv)[1].split(",");
    expect(lapsedFields[9]).toBe("Lapsed");
    expect(lapsedFields[10]).toBe("2026-08-12T00:00:00.000Z");
  });

  it("renders whole-number amounts with two decimal places", () => {
    const csv = formatExportCsv([row({ amount: 100000 })]);
    const [, dataLine] = lines(csv);
    expect(dataLine).toContain("100000.00");
  });
});
