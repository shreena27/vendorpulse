import { describe, it, expect, vi } from "vitest";
import { processChangeAlerts, type ChangedCheck } from "./processChangeAlerts";

function check(overrides: Partial<ChangedCheck> = {}): ChangedCheck {
  return {
    id: "check-1",
    vendorId: "vendor-1",
    organizationId: "org-1",
    checkType: "gst",
    ...overrides,
  };
}

function deps(opts: {
  alertWorthy: boolean | boolean[];
  amount?: number;
  action?: "created" | "updated";
}) {
  const worthySequence = Array.isArray(opts.alertWorthy) ? [...opts.alertWorthy] : null;
  return {
    scoreChangeForVendor: vi.fn().mockImplementation(async () => ({
      alertWorthy: worthySequence ? worthySequence.shift()! : opts.alertWorthy,
      reason: "open_payment" as const,
    })),
    getOpenPaymentAmount: vi.fn().mockResolvedValue(opts.amount ?? 1000),
    createOrUpdateAlert: vi.fn().mockResolvedValue({
      alertId: "alert-1",
      action: opts.action ?? "created",
    }),
  };
}

describe("processChangeAlerts", () => {
  it("scores every changed check but only alerts the ones that are alert-worthy", async () => {
    const checks = [check({ id: "c1" }), check({ id: "c2" })];
    const d = deps({ alertWorthy: [true, false] });

    const summary = await processChangeAlerts(checks, d);

    expect(d.scoreChangeForVendor).toHaveBeenCalledTimes(2);
    expect(d.createOrUpdateAlert).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      scored: 2,
      alertsCreated: 1,
      alertsUpdated: 0,
      notAlertWorthy: 1,
    });
  });

  it("maps check_type to the right trigger_type", async () => {
    const gst = check({ checkType: "gst" });
    const msme = check({ checkType: "msme_udyam", id: "c2" });
    const d = deps({ alertWorthy: true });

    await processChangeAlerts([gst, msme], d);

    const calls = d.createOrUpdateAlert.mock.calls.map((c) => c[0].triggerType);
    expect(calls).toEqual(["gst_change", "msme_change"]);
  });

  it("passes the check's own id as sourceCheckId and its organizationId/vendorId through", async () => {
    const c = check({ id: "the-check", vendorId: "the-vendor", organizationId: "the-org" });
    const d = deps({ alertWorthy: true });

    await processChangeAlerts([c], d);

    expect(d.createOrUpdateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCheckId: "the-check",
        vendorId: "the-vendor",
        organizationId: "the-org",
      }),
    );
  });

  it("fetches the open payment amount and forwards it as paymentImpactAmount", async () => {
    const d = deps({ alertWorthy: true, amount: 42_000 });
    await processChangeAlerts([check()], d);
    expect(d.createOrUpdateAlert).toHaveBeenCalledWith(
      expect.objectContaining({ paymentImpactAmount: 42_000 }),
    );
  });

  it("counts created vs updated separately based on createOrUpdateAlert's result", async () => {
    const d = deps({ alertWorthy: true, action: "updated" });
    const summary = await processChangeAlerts([check()], d);
    expect(summary).toEqual({ scored: 1, alertsCreated: 0, alertsUpdated: 1, notAlertWorthy: 0 });
  });

  it("returns all zeros for an empty batch, without calling any dependency", async () => {
    const d = deps({ alertWorthy: true });
    const summary = await processChangeAlerts([], d);
    expect(summary).toEqual({ scored: 0, alertsCreated: 0, alertsUpdated: 0, notAlertWorthy: 0 });
    expect(d.scoreChangeForVendor).not.toHaveBeenCalled();
  });
});
