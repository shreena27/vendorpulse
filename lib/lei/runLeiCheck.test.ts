import { describe, it, expect, vi } from "vitest";
import { runLeiCheck, type RunLeiCheckDeps, type RunLeiCheckInput } from "./runLeiCheck";
import type { LeiCheckResult } from "@/lib/providers/lei/types";

function input(overrides: Partial<RunLeiCheckInput> = {}): RunLeiCheckInput {
  return {
    paymentId: "pay-1",
    organizationId: "org-1",
    vendorId: "vendor-1",
    vendorLeiNumber: "5493003UOETFYRONLG31",
    amount: 600_000_000,
    paymentMethod: "rtgs",
    ...overrides,
  };
}

function leiResult(overrides: Partial<LeiCheckResult> = {}): LeiCheckResult {
  return {
    leiNumber: "5493003UOETFYRONLG31",
    status: "lapsed",
    rawStatus: "LAPSED",
    provider: "gleif",
    checkedAt: "2026-01-01T00:00:00.000Z",
    raw: {},
    ...overrides,
  };
}

function deps(
  opts: {
    checkResult?: LeiCheckResult;
    alertAction?: "created" | "updated";
  } = {},
): RunLeiCheckDeps {
  return {
    checkLei: vi.fn().mockResolvedValue(opts.checkResult ?? leiResult()),
    recordLeiCheck: vi.fn().mockResolvedValue({ id: "lei-check-1" }),
    createOrUpdateAlert: vi.fn().mockResolvedValue({ alertId: "alert-1", action: opts.alertAction ?? "created" }),
    notifyAlertCreated: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runLeiCheck", () => {
  it("does nothing and reports below_threshold for a payment under ₹50cr", async () => {
    const d = deps();
    const result = await runLeiCheck(input({ amount: 499_900_000 }), d);
    expect(result).toEqual({ ok: false, reason: "below_threshold" });
    expect(d.checkLei).not.toHaveBeenCalled();
    expect(d.recordLeiCheck).not.toHaveBeenCalled();
  });

  it("does nothing for a qualifying amount on 'other' payment method", async () => {
    const d = deps();
    const result = await runLeiCheck(input({ paymentMethod: "other" }), d);
    expect(result).toEqual({ ok: false, reason: "below_threshold" });
    expect(d.checkLei).not.toHaveBeenCalled();
  });

  it("calls GLEIF with the vendor's LEI, records the check, and creates an alert for a lapsed result", async () => {
    const d = deps({ checkResult: leiResult({ status: "lapsed" }) });
    const result = await runLeiCheck(input(), d);

    expect(d.checkLei).toHaveBeenCalledWith("5493003UOETFYRONLG31");
    expect(d.recordLeiCheck).toHaveBeenCalledWith(
      expect.objectContaining({ status: "lapsed", leiNumber: "5493003UOETFYRONLG31" }),
    );
    expect(d.createOrUpdateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        vendorId: "vendor-1",
        triggerType: "lei_check",
        sourceCheckId: "lei-check-1",
        paymentImpactAmount: 600_000_000,
      }),
    );
    expect(d.notifyAlertCreated).toHaveBeenCalledWith("alert-1", "org-1");
    expect(result).toEqual({ ok: true, leiCheckId: "lei-check-1", status: "lapsed", alertAction: "created" });
  });

  it("skips GLEIF entirely and records not_on_record when the vendor has no LEI on file", async () => {
    const d = deps();
    const result = await runLeiCheck(input({ vendorLeiNumber: null }), d);

    expect(d.checkLei).not.toHaveBeenCalled();
    expect(d.recordLeiCheck).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not_on_record", leiNumber: null }),
    );
    expect(d.createOrUpdateAlert).toHaveBeenCalled(); // not_on_record is still alert-worthy
    if (result.ok) expect(result.status).toBe("not_on_record");
  });

  it("records the check but creates no alert for an issued (favorable) result", async () => {
    const d = deps({ checkResult: leiResult({ status: "issued", rawStatus: "ISSUED" }) });
    const result = await runLeiCheck(input(), d);

    expect(d.recordLeiCheck).toHaveBeenCalled();
    expect(d.createOrUpdateAlert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, leiCheckId: "lei-check-1", status: "issued", alertAction: "none" });
  });

  it("does not notify on a dedupe update, only on a newly-created alert", async () => {
    const d = deps({ alertAction: "updated" });
    const result = await runLeiCheck(input(), d);
    expect(d.notifyAlertCreated).not.toHaveBeenCalled();
    if (result.ok) expect(result.alertAction).toBe("updated");
  });

  it("does not let a failed notification abort the result", async () => {
    const d = deps();
    d.notifyAlertCreated = vi.fn().mockRejectedValue(new Error("resend down"));
    const result = await runLeiCheck(input(), d);
    expect(result.ok).toBe(true);
  });
});
