import { describe, it, expect, vi } from "vitest";
import {
  endOfDayIstIso,
  resolveMsmeStatusAsOf,
  resolveLeiStatusAsOf,
  buildExportRows,
  type MsmeEvidenceEntry,
  type LeiEvidenceEntry,
  type BuildExportDeps,
  type PaymentInRange,
  type VendorRef,
} from "./buildExport";

describe("endOfDayIstIso", () => {
  it("converts a date-only string to end-of-day IST expressed as UTC", () => {
    // 2026-06-15 23:59:59.999 IST (UTC+5:30) = 2026-06-15 18:29:59.999 UTC.
    expect(endOfDayIstIso("2026-06-15")).toBe("2026-06-15T18:29:59.999Z");
  });
});

function entry(overrides: Partial<MsmeEvidenceEntry> = {}): MsmeEvidenceEntry {
  return { vendorId: "v1", createdAt: "2026-01-01T00:00:00.000Z", statusValue: "REGISTERED", ...overrides };
}

describe("resolveMsmeStatusAsOf", () => {
  it("returns not_applicable when the vendor has no udyam_number, regardless of evidence", () => {
    const result = resolveMsmeStatusAsOf(null, [entry()], "2026-06-15");
    expect(result).toEqual({ kind: "not_applicable" });
  });

  it("returns no_record when the vendor has an udyam_number but no evidence at all", () => {
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", [], "2026-06-15");
    expect(result).toEqual({ kind: "no_record" });
  });

  it("returns no_record when every evidence entry is after the cutoff", () => {
    const evidence = [entry({ createdAt: "2026-07-01T00:00:00.000Z" })];
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", evidence, "2026-06-15");
    expect(result).toEqual({ kind: "no_record" });
  });

  it("returns checked with the single entry's status when it is at or before the cutoff", () => {
    const evidence = [entry({ createdAt: "2026-06-01T00:00:00.000Z", statusValue: "REGISTERED" })];
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-06-01T00:00:00.000Z" });
  });

  it("picks the LAST entry at or before the cutoff, not the first and not one after it", () => {
    const evidence = [
      entry({ createdAt: "2026-05-01T00:00:00.000Z", statusValue: "REGISTERED" }),
      entry({ createdAt: "2026-06-10T00:00:00.000Z", statusValue: "LAPSED" }),
      entry({ createdAt: "2026-07-01T00:00:00.000Z", statusValue: "NOT_MSME" }), // after cutoff
    ];
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "LAPSED", checkedAt: "2026-06-10T00:00:00.000Z" });
  });

  it("includes an entry whose createdAt exactly equals the cutoff (inclusive boundary)", () => {
    const evidence = [entry({ createdAt: endOfDayIstIso("2026-06-15"), statusValue: "LAPSED" })];
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "LAPSED", checkedAt: endOfDayIstIso("2026-06-15") });
  });

  it("preserves a statusValue of UNKNOWN as checked, distinct from no_record", () => {
    const evidence = [entry({ createdAt: "2026-06-01T00:00:00.000Z", statusValue: "UNKNOWN" })];
    const result = resolveMsmeStatusAsOf("UDYAM-MH-01-0000001", evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "UNKNOWN", checkedAt: "2026-06-01T00:00:00.000Z" });
  });
});

function leiEntry(overrides: Partial<LeiEvidenceEntry> = {}): LeiEvidenceEntry {
  return { vendorId: "v1", createdAt: "2026-01-01T00:00:00.000Z", statusValue: "issued", ...overrides };
}

describe("resolveLeiStatusAsOf", () => {
  it("returns not_applicable when the payment doesn't qualify, regardless of evidence", () => {
    const result = resolveLeiStatusAsOf(false, [leiEntry()], "2026-06-15");
    expect(result).toEqual({ kind: "not_applicable" });
  });

  it("returns no_record when the payment qualifies but there is no evidence at all", () => {
    const result = resolveLeiStatusAsOf(true, [], "2026-06-15");
    expect(result).toEqual({ kind: "no_record" });
  });

  it("returns no_record when every evidence entry is after the cutoff", () => {
    const evidence = [leiEntry({ createdAt: "2026-07-01T00:00:00.000Z" })];
    const result = resolveLeiStatusAsOf(true, evidence, "2026-06-15");
    expect(result).toEqual({ kind: "no_record" });
  });

  it("picks the LAST entry at or before the cutoff, not the first and not one after it", () => {
    const evidence = [
      leiEntry({ createdAt: "2026-05-01T00:00:00.000Z", statusValue: "issued" }),
      leiEntry({ createdAt: "2026-06-10T00:00:00.000Z", statusValue: "lapsed" }),
      leiEntry({ createdAt: "2026-07-01T00:00:00.000Z", statusValue: "retired" }), // after cutoff
    ];
    const result = resolveLeiStatusAsOf(true, evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "lapsed", checkedAt: "2026-06-10T00:00:00.000Z" });
  });

  it("includes an entry whose createdAt exactly equals the cutoff (inclusive boundary)", () => {
    const evidence = [leiEntry({ createdAt: endOfDayIstIso("2026-06-15"), statusValue: "lapsed" })];
    const result = resolveLeiStatusAsOf(true, evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "lapsed", checkedAt: endOfDayIstIso("2026-06-15") });
  });

  it("preserves a statusValue of not_on_record as checked, distinct from no_record", () => {
    const evidence = [leiEntry({ createdAt: "2026-06-01T00:00:00.000Z", statusValue: "not_on_record" })];
    const result = resolveLeiStatusAsOf(true, evidence, "2026-06-15");
    expect(result).toEqual({ kind: "checked", statusValue: "not_on_record", checkedAt: "2026-06-01T00:00:00.000Z" });
  });
});

function payment(overrides: Partial<PaymentInRange> = {}): PaymentInRange {
  return {
    id: "pay-1",
    vendorId: "v1",
    amount: 1000,
    dueDate: "2026-06-15",
    paymentMethod: "neft",
    paymentStatus: "pending",
    ...overrides,
  };
}

function vendor(overrides: Partial<VendorRef> = {}): VendorRef {
  return { id: "v1", name: "Acme Traders", gstin: "27ABCDE1234F1Z5", udyamNumber: "UDYAM-MH-01-0000001", ...overrides };
}

function deps(opts: {
  payments: PaymentInRange[];
  vendors?: VendorRef[];
  evidence?: MsmeEvidenceEntry[];
  leiEvidence?: LeiEvidenceEntry[];
}): BuildExportDeps {
  return {
    fetchPaymentsInRange: vi.fn().mockResolvedValue(opts.payments),
    fetchVendorsByIds: vi.fn().mockResolvedValue(opts.vendors ?? []),
    fetchMsmeEvidence: vi.fn().mockResolvedValue(opts.evidence ?? []),
    fetchLeiEvidence: vi.fn().mockResolvedValue(opts.leiEvidence ?? []),
  };
}

describe("buildExportRows", () => {
  it("returns an empty array without calling the other three deps when there are no payments", async () => {
    const d = deps({ payments: [] });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows).toEqual([]);
    expect(d.fetchVendorsByIds).not.toHaveBeenCalled();
    expect(d.fetchMsmeEvidence).not.toHaveBeenCalled();
    expect(d.fetchLeiEvidence).not.toHaveBeenCalled();
  });

  it("resolves three different statuses for one vendor's three payments on three dates as evidence changes", async () => {
    const payments = [
      payment({ id: "p1", dueDate: "2026-01-15" }),
      payment({ id: "p2", dueDate: "2026-03-15" }),
      payment({ id: "p3", dueDate: "2026-06-15" }),
    ];
    const evidence = [
      entry({ createdAt: "2026-01-01T00:00:00.000Z", statusValue: "REGISTERED" }),
      entry({ createdAt: "2026-02-01T00:00:00.000Z", statusValue: "LAPSED" }),
      entry({ createdAt: "2026-05-01T00:00:00.000Z", statusValue: "REGISTERED" }),
    ];
    const d = deps({ payments, vendors: [vendor()], evidence });
    const rows = await buildExportRows({ from: "2026-01-01", to: "2026-06-30" }, d);

    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.paymentId === "p1")!.msmeStatus).toEqual({
      kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows.find((r) => r.paymentId === "p2")!.msmeStatus).toEqual({
      kind: "checked", statusValue: "LAPSED", checkedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(rows.find((r) => r.paymentId === "p3")!.msmeStatus).toEqual({
      kind: "checked", statusValue: "REGISTERED", checkedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("resolves two vendors' payments independently with no cross-vendor bleed", async () => {
    const payments = [
      payment({ id: "p1", vendorId: "v1", dueDate: "2026-06-15" }),
      payment({ id: "p2", vendorId: "v2", dueDate: "2026-06-15" }),
    ];
    const vendors = [vendor({ id: "v1" }), vendor({ id: "v2", name: "Beta Supplies", udyamNumber: "UDYAM-MH-01-0000002" })];
    const evidence = [
      entry({ vendorId: "v1", createdAt: "2026-06-01T00:00:00.000Z", statusValue: "REGISTERED" }),
      entry({ vendorId: "v2", createdAt: "2026-06-01T00:00:00.000Z", statusValue: "LAPSED" }),
    ];
    const d = deps({ payments, vendors, evidence });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);

    expect(rows.find((r) => r.paymentId === "p1")!.msmeStatus).toMatchObject({ statusValue: "REGISTERED" });
    expect(rows.find((r) => r.paymentId === "p2")!.msmeStatus).toMatchObject({ statusValue: "LAPSED" });
  });

  it("falls back defensively when a payment's vendor is missing from fetchVendorsByIds", async () => {
    const d = deps({ payments: [payment({ vendorId: "ghost" })], vendors: [] });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows).toHaveLength(1);
    expect(rows[0].gstin).toBeNull();
    expect(rows[0].msmeStatus).toEqual({ kind: "not_applicable" });
  });

  it("resolves leiStatus not_applicable for a below-threshold payment, regardless of evidence", async () => {
    const d = deps({
      payments: [payment({ amount: 1000, paymentMethod: "neft" })],
      vendors: [vendor()],
      leiEvidence: [leiEntry({ statusValue: "lapsed" })],
    });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows[0].leiStatus).toEqual({ kind: "not_applicable" });
  });

  it("resolves leiStatus no_record for a qualifying payment with no LEI evidence at all", async () => {
    const d = deps({
      payments: [payment({ amount: 600_000_000, paymentMethod: "rtgs" })],
      vendors: [vendor()],
    });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows[0].leiStatus).toEqual({ kind: "no_record" });
  });

  it("resolves leiStatus checked for a qualifying payment with matching LEI evidence as of the due date", async () => {
    const d = deps({
      payments: [payment({ amount: 620_000_000, paymentMethod: "rtgs", dueDate: "2026-09-01" })],
      vendors: [vendor()],
      leiEvidence: [leiEntry({ createdAt: "2026-08-12T00:00:00.000Z", statusValue: "lapsed" })],
    });
    const rows = await buildExportRows({ from: "2026-08-01", to: "2026-09-30" }, d);
    expect(rows[0].leiStatus).toEqual({
      kind: "checked",
      statusValue: "lapsed",
      checkedAt: "2026-08-12T00:00:00.000Z",
    });
  });

  it("resolves MSME and LEI status independently on the same row — a below-threshold payment can still have a real MSME status", async () => {
    const d = deps({
      payments: [payment({ amount: 925_000, paymentMethod: "neft" })],
      vendors: [vendor()],
      evidence: [entry({ statusValue: "LAPSED" })],
    });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows[0].msmeStatus).toMatchObject({ statusValue: "LAPSED" });
    expect(rows[0].leiStatus).toEqual({ kind: "not_applicable" });
  });

  it("returns amount as a number, not a string", async () => {
    const d = deps({ payments: [payment({ amount: 45000 })], vendors: [vendor()] });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows[0].amount).toBe(45000);
    expect(typeof rows[0].amount).toBe("number");
  });
});
