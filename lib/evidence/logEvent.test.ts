import { describe, it, expect, vi } from "vitest";
import { logEvent, logEvents, type EvidenceClient } from "./logEvent";

function stubClient(opts: { error?: { message: string } | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.error ?? null });
  const client = { from: () => ({ insert }) } as unknown as EvidenceClient;
  return { client, insert };
}

const baseEvent = {
  organizationId: "org-1",
  vendorId: "vendor-1",
  eventType: "verification_check" as const,
  entityType: "verification_checks",
  entityId: "check-1",
  payload: { statusValue: "ACTIVE" },
};

describe("logEvent", () => {
  it("inserts one row defaulting actor to system", async () => {
    const { client, insert } = stubClient();
    await logEvent(client, baseEvent);
    expect(insert).toHaveBeenCalledWith([
      {
        organization_id: "org-1",
        vendor_id: "vendor-1",
        event_type: "verification_check",
        entity_type: "verification_checks",
        entity_id: "check-1",
        payload: { statusValue: "ACTIVE" },
        actor: "system",
      },
    ]);
  });

  it("passes through an explicit actor", async () => {
    const { client, insert } = stubClient();
    await logEvent(client, { ...baseEvent, actor: "user-42" });
    expect(insert.mock.calls[0][0][0].actor).toBe("user-42");
  });

  it("throws when the insert fails", async () => {
    const { client } = stubClient({ error: { message: "constraint violation" } });
    await expect(logEvent(client, baseEvent)).rejects.toThrow(/constraint violation/);
  });
});

describe("logEvents", () => {
  it("batches multiple events into one insert call", async () => {
    const { client, insert } = stubClient();
    await logEvents(client, [
      baseEvent,
      { ...baseEvent, entityId: "check-2", eventType: "status_change" as const },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not call insert at all for an empty batch", async () => {
    const { client, insert } = stubClient();
    await logEvents(client, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws when the batch insert fails", async () => {
    const { client } = stubClient({ error: { message: "db down" } });
    await expect(logEvents(client, [baseEvent])).rejects.toThrow(/db down/);
  });
});
