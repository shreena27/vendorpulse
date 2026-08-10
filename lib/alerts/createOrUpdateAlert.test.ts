import { describe, it, expect, vi } from "vitest";
import { createOrUpdateAlert, type AlertsClient } from "./createOrUpdateAlert";

const baseInput = {
  organizationId: "org-1",
  vendorId: "vendor-1",
  triggerType: "gst_change" as const,
  sourceCheckId: "check-1",
  paymentImpactAmount: 5000,
};

function stubAlertsClient(opts: {
  existingId?: string | null;
  insertedId?: string;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const eq = vi.fn();
  const lookupChain = {
    eq: () => lookupChain,
    in: () => lookupChain,
    limit: () => lookupChain,
    maybeSingle: () =>
      Promise.resolve({
        data: opts.existingId ? { id: opts.existingId } : null,
        error: null,
      }),
  };

  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));

  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.insertedId ? { id: opts.insertedId } : null,
    error: opts.insertError ?? null,
  });
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const client = {
    from: () => ({
      select: () => lookupChain,
      update,
      insert,
    }),
  } as unknown as AlertsClient;

  return { client, update, updateEq, insert, insertSelect, insertSingle, eq };
}

describe("createOrUpdateAlert", () => {
  it("creates a new open alert when no matching open alert exists", async () => {
    const { client, insert, update } = stubAlertsClient({ existingId: null, insertedId: "new-alert" });

    const result = await createOrUpdateAlert(client, baseInput);

    expect(result).toEqual({ alertId: "new-alert", action: "created" });
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      vendor_id: "vendor-1",
      trigger_type: "gst_change",
      source_check_id: "check-1",
      payment_impact_amount: 5000,
      status: "open",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing open alert's payment_impact_amount instead of creating a duplicate", async () => {
    const { client, insert, update, updateEq } = stubAlertsClient({ existingId: "existing-alert" });

    const result = await createOrUpdateAlert(client, { ...baseInput, paymentImpactAmount: 9000 });

    expect(result).toEqual({ alertId: "existing-alert", action: "updated" });
    expect(update).toHaveBeenCalledWith({ payment_impact_amount: 9000 });
    expect(updateEq).toHaveBeenCalledWith("id", "existing-alert");
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws when the update fails", async () => {
    const { client } = stubAlertsClient({ existingId: "existing-alert", updateError: { message: "db down" } });
    await expect(createOrUpdateAlert(client, baseInput)).rejects.toThrow(/db down/);
  });

  it("throws when the insert fails", async () => {
    const { client } = stubAlertsClient({ existingId: null, insertError: { message: "constraint violation" } });
    await expect(createOrUpdateAlert(client, baseInput)).rejects.toThrow(/constraint violation/);
  });
});
