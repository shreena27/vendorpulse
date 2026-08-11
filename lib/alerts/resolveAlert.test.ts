import { describe, it, expect, vi } from "vitest";
import { resolveAlert, type ResolveAlertClient } from "./resolveAlert";

const sampleAlert = {
  id: "alert-1",
  organization_id: "org-1",
  vendor_id: "vendor-1",
  trigger_type: "gst_change" as const,
  source_check_id: "check-1",
  payment_impact_amount: "50000",
  status: "hold" as const,
  resolved_by: "user-1",
  resolved_at: "2026-08-10T00:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
};

function stubClient(result: { data: typeof sampleAlert | null; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as ResolveAlertClient, rpc };
}

describe("resolveAlert", () => {
  it("returns ok:true with the updated alert on success", async () => {
    const { client, rpc } = stubClient({ data: sampleAlert, error: null });

    const result = await resolveAlert(client, "alert-1", "hold");

    expect(result).toEqual({ ok: true, alert: sampleAlert });
    expect(rpc).toHaveBeenCalledWith("resolve_alert", {
      p_alert_id: "alert-1",
      p_action: "hold",
    });
  });

  it("returns ok:false, reason: already_resolved when the RPC reports it", async () => {
    const { client } = stubClient({ data: null, error: { message: "alert_already_resolved" } });
    const result = await resolveAlert(client, "alert-1", "hold");
    expect(result).toEqual({ ok: false, reason: "already_resolved" });
  });

  it("returns ok:false, reason: not_found when the RPC reports it", async () => {
    const { client } = stubClient({ data: null, error: { message: "alert_not_found" } });
    const result = await resolveAlert(client, "missing", "hold");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns ok:false, reason: invalid_action when the RPC reports it", async () => {
    const { client } = stubClient({ data: null, error: { message: "invalid_action" } });
    const result = await resolveAlert(client, "alert-1", "bogus");
    expect(result).toEqual({ ok: false, reason: "invalid_action" });
  });

  it("throws on an unrelated error rather than misclassifying it", async () => {
    const { client } = stubClient({ data: null, error: { message: "connection lost" } });
    await expect(resolveAlert(client, "alert-1", "hold")).rejects.toThrow(/connection lost/);
  });
});
