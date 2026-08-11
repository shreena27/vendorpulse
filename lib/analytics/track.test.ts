import { describe, it, expect, vi } from "vitest";
import { track, trackBatch, type AnalyticsClient } from "./track";

function client(insertImpl?: (rows: unknown[]) => PromiseLike<{ error: { message: string } | null }>): AnalyticsClient {
  return {
    from: () => ({
      insert: insertImpl ?? (async () => ({ error: null })),
    }),
  };
}

describe("track / trackBatch", () => {
  it("inserts one row shaped from the input, defaulting actor to system", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await track(client(insert), {
      organizationId: "org-1",
      vendorId: "vendor-1",
      eventType: "vendor_import_completed",
      payload: { rowCount: 3 },
    });
    expect(insert).toHaveBeenCalledWith([
      {
        organization_id: "org-1",
        vendor_id: "vendor-1",
        event_type: "vendor_import_completed",
        payload: { rowCount: 3 },
        actor: "system",
      },
    ]);
  });

  it("defaults vendorId to null and payload to {} when omitted", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await track(client(insert), { organizationId: "org-1", eventType: "evidence_export_completed" });
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ vendor_id: null, payload: {} }),
    ]);
  });

  it("no-ops on an empty batch — no insert call at all", async () => {
    const insert = vi.fn();
    await trackBatch(client(insert), []);
    expect(insert).not.toHaveBeenCalled();
  });

  it("batches multiple events into one insert call", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await trackBatch(client(insert), [
      { organizationId: "org-1", eventType: "status_change_detected" },
      { organizationId: "org-1", eventType: "status_change_detected" },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it("never throws when the insert returns an error", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db down" } });
    await expect(
      track(client(insert), { organizationId: "org-1", eventType: "pmf_survey_triggered" }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the insert call itself rejects", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      track(client(insert), { organizationId: "org-1", eventType: "pmf_survey_triggered" }),
    ).resolves.toBeUndefined();
  });
});
