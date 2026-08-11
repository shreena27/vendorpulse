import { describe, it, expect, vi } from "vitest";
import {
  endOfDayIstIso,
  resolveMsmeStatusAsOf,
  buildExportRows,
  type MsmeEvidenceEntry,
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
}): BuildExportDeps {
  return {
    fetchPaymentsInRange: vi.fn().mockResolvedValue(opts.payments),
    fetchVendorsByIds: vi.fn().mockResolvedValue(opts.vendors ?? []),
    fetchMsmeEvidence: vi.fn().mockResolvedValue(opts.evidence ?? []),
  };
}

describe("buildExportRows", () => {
  it("returns an empty array without calling the other two deps when there are no payments", async () => {
    const d = deps({ payments: [] });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows).toEqual([]);
    expect(d.fetchVendorsByIds).not.toHaveBeenCalled();
    expect(d.fetchMsmeEvidence).not.toHaveBeenCalled();
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
    expect(rows[0].udyamNumber).toBeNull();
    expect(rows[0].msmeStatus).toEqual({ kind: "not_applicable" });
  });

  it("returns amount as a number, not a string", async () => {
    const d = deps({ payments: [payment({ amount: 45000 })], vendors: [vendor()] });
    const rows = await buildExportRows({ from: "2026-06-01", to: "2026-06-30" }, d);
    expect(rows[0].amount).toBe(45000);
    expect(typeof rows[0].amount).toBe("number");
  });
});
