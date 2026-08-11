import { describe, it, expect, vi } from "vitest";
import { createGleifAdapter } from "./gleifAdapter";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function gleifRecord(registrationStatus: string) {
  return {
    data: {
      attributes: {
        lei: "5493003UOETFYRONLG31",
        entity: { legalName: { name: "RELIANCE INDUSTRIES LIMITED" }, status: "ACTIVE" },
        registration: { status: registrationStatus },
      },
    },
  };
}

describe("gleifAdapter", () => {
  it("rejects a malformed LEI before spending a call", async () => {
    const fetchImpl = vi.fn();
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("not-a-real-lei");
    expect(result.status).toBe("not_on_record");
    expect(result.error).toBe("invalid_lei");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps ISSUED to issued", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, gleifRecord("ISSUED")));
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("5493003UOETFYRONLG31");
    expect(result.status).toBe("issued");
    expect(result.rawStatus).toBe("ISSUED");
  });

  it("maps LAPSED to lapsed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, gleifRecord("LAPSED")));
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("5493003UOETFYRONLG31");
    expect(result.status).toBe("lapsed");
  });

  it.each(["RETIRED", "MERGED", "ANNULLED", "CANCELLED"])(
    "maps %s to retired",
    async (raw) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, gleifRecord(raw)));
      const adapter = createGleifAdapter({ fetchImpl });
      const result = await adapter.checkLei("5493003UOETFYRONLG31");
      expect(result.status).toBe("retired");
    },
  );

  it.each(["PENDING_VALIDATION", "DUPLICATE", "TRANSFERRED", "PENDING_TRANSFER", "PENDING_ARCHIVAL"])(
    "maps the ambiguous status %s to not_on_record, never issued",
    async (raw) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, gleifRecord(raw)));
      const adapter = createGleifAdapter({ fetchImpl });
      const result = await adapter.checkLei("5493003UOETFYRONLG31");
      expect(result.status).toBe("not_on_record");
    },
  );

  it("maps a 404 (unknown LEI) to not_on_record without an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("5493003UOETFYRONLG31");
    expect(result.status).toBe("not_on_record");
    expect(result.error).toBeUndefined();
  });

  it("retries once on a 5xx before giving up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(200, gleifRecord("ISSUED")));
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("5493003UOETFYRONLG31");
    expect(result.status).toBe("issued");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to not_on_record with an error after two failed attempts", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const adapter = createGleifAdapter({ fetchImpl });
    const result = await adapter.checkLei("5493003UOETFYRONLG31");
    expect(result.status).toBe("not_on_record");
    expect(result.error).toBe("provider_error");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
