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

type NotifyAlertCreatedFn = (alertId: string, check: ChangedCheck) => Promise<void>;

function deps(opts: {
  alertWorthy: boolean | boolean[];
  amount?: number;
  action?: "created" | "updated" | ("created" | "updated")[];
  notifyAlertCreated?: ReturnType<typeof vi.fn<NotifyAlertCreatedFn>>;
}) {
  const worthySequence = Array.isArray(opts.alertWorthy) ? [...opts.alertWorthy] : null;
  const actionSequence = Array.isArray(opts.action) ? [...opts.action] : null;
  return {
    scoreChangeForVendor: vi.fn().mockImplementation(async () => ({
      alertWorthy: worthySequence ? worthySequence.shift()! : opts.alertWorthy,
      reason: "open_payment" as const,
    })),
    getOpenPaymentAmount: vi.fn().mockResolvedValue(opts.amount ?? 1000),
    createOrUpdateAlert: vi.fn().mockImplementation(async () => ({
      alertId: "alert-1",
      action: actionSequence ? actionSequence.shift()! : (opts.action ?? "created"),
    })),
    notifyAlertCreated:
      opts.notifyAlertCreated ?? vi.fn<NotifyAlertCreatedFn>().mockResolvedValue(undefined),
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
      emailsSent: 1,
      emailsFailed: 0,
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
    expect(summary).toEqual({
      scored: 1,
      alertsCreated: 0,
      alertsUpdated: 1,
      notAlertWorthy: 0,
      emailsSent: 0,
      emailsFailed: 0,
    });
    expect(d.notifyAlertCreated).not.toHaveBeenCalled();
  });

  it("returns all zeros for an empty batch, without calling any dependency", async () => {
    const d = deps({ alertWorthy: true });
    const summary = await processChangeAlerts([], d);
    expect(summary).toEqual({
      scored: 0,
      alertsCreated: 0,
      alertsUpdated: 0,
      notAlertWorthy: 0,
      emailsSent: 0,
      emailsFailed: 0,
    });
    expect(d.scoreChangeForVendor).not.toHaveBeenCalled();
  });

  it("notifies only on a newly-created alert, never on a dedupe update", async () => {
    const created = check({ id: "c1", vendorId: "v-created" });
    const updated = check({ id: "c2", vendorId: "v-updated" });
    const d = deps({ alertWorthy: true, action: ["created", "updated"] });

    await processChangeAlerts([created, updated], d);

    expect(d.notifyAlertCreated).toHaveBeenCalledTimes(1);
    expect(d.notifyAlertCreated).toHaveBeenCalledWith("alert-1", created);
  });

  it("counts a failed notification without throwing or aborting the rest of the batch", async () => {
    const failing = check({ id: "c1", vendorId: "v1" });
    const fine = check({ id: "c2", vendorId: "v2" });
    const notifyAlertCreated = vi
      .fn<NotifyAlertCreatedFn>()
      .mockRejectedValueOnce(new Error("resend down"))
      .mockResolvedValueOnce(undefined);
    const d = deps({ alertWorthy: true, notifyAlertCreated });

    const summary = await processChangeAlerts([failing, fine], d);

    expect(summary).toEqual({
      scored: 2,
      alertsCreated: 2,
      alertsUpdated: 0,
      notAlertWorthy: 0,
      emailsSent: 1,
      emailsFailed: 1,
    });
  });
});
