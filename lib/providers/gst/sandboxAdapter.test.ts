import { describe, it, expect, vi } from "vitest";
import { createSandboxAdapter } from "./sandboxAdapter";
import { expectGstCheckResultShape } from "./shapeAssertions";

// A well-formed GSTIN (passes the pattern check; the network is mocked, so the
// checksum is irrelevant here).
const VALID_GSTIN = "27AAAAA0000A1Z5";

// A fake JWT whose payload carries a future `exp`, so token caching works.
const TOKEN =
  "h." +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url") +
  ".s";

function fakeRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const authRes = () => fakeRes(200, { code: 200, data: { access_token: TOKEN } });
const gstRes = (sts: string) =>
  fakeRes(200, { code: 200, data: { data: { sts } } });

/** Build an adapter with a routed fake fetch and call counters. */
function makeAdapter(gstResponder: (call: number) => Promise<Response>) {
  let authCalls = 0;
  let gstCalls = 0;
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).endsWith("/authenticate")) {
      authCalls++;
      return authRes();
    }
    gstCalls++;
    return gstResponder(gstCalls);
  });
  const adapter = createSandboxAdapter({
    apiKey: "k",
    apiSecret: "s",
    baseUrl: "https://sandbox.test",
    fetchImpl: fetchMock as unknown as typeof fetch,
    timeoutMs: 1000,
  });
  return {
    adapter,
    fetchMock,
    counts: () => ({ authCalls, gstCalls }),
  };
}

describe("sandbox GST adapter", () => {
  it("maps sts=Active -> ACTIVE", async () => {
    const { adapter } = makeAdapter(async () => gstRes("Active"));
    const result = await adapter.checkGstin(VALID_GSTIN);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("ACTIVE");
    expect(result.rawStatus).toBe("Active");
    expect(result.provider).toBe("sandbox_quicko");
    expect(result.error).toBeUndefined();
  });

  it("maps sts=Cancelled -> CANCELLED", async () => {
    const { adapter } = makeAdapter(async () => gstRes("Cancelled"));
    const result = await adapter.checkGstin(VALID_GSTIN);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("CANCELLED");
    expect(result.rawStatus).toBe("Cancelled");
  });

  it("maps an unknown status label -> UNKNOWN", async () => {
    const { adapter } = makeAdapter(async () => gstRes("Provisional"));
    const result = await adapter.checkGstin(VALID_GSTIN);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBeUndefined(); // a successful check, just unmapped
  });

  it("rejects a malformed GSTIN without any network call", async () => {
    const { adapter, fetchMock } = makeAdapter(async () => gstRes("Active"));
    const result = await adapter.checkGstin("not-a-gstin");
    expectGstCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("invalid_gstin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a provider 400 as invalid_gstin, no retry", async () => {
    const { adapter, counts } = makeAdapter(async () =>
      fakeRes(400, { message: "Invalid GSTIN pattern" }),
    );
    const result = await adapter.checkGstin(VALID_GSTIN);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("invalid_gstin");
    expect(counts().gstCalls).toBe(1); // returned immediately, not retried
  });

  it("retries once on a network failure, then returns UNKNOWN/timeout", async () => {
    const { adapter, counts } = makeAdapter(async () => {
      throw new Error("network down");
    });
    const result = await adapter.checkGstin(VALID_GSTIN);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("timeout");
    expect(counts().gstCalls).toBe(2); // exactly two attempts
  });

  it("recovers on the retry when the first attempt fails", async () => {
    const { adapter, counts } = makeAdapter(async (call) => {
      if (call === 1) throw new Error("transient");
      return gstRes("Active");
    });
    const result = await adapter.checkGstin(VALID_GSTIN);
    expect(result.status).toBe("ACTIVE");
    expect(counts().gstCalls).toBe(2);
  });

  it("refreshes the token on a 401 and retries", async () => {
    const { adapter, counts } = makeAdapter(async (call) =>
      call === 1 ? fakeRes(401, { message: "unauthorized" }) : gstRes("Active"),
    );
    const result = await adapter.checkGstin(VALID_GSTIN);
    expect(result.status).toBe("ACTIVE");
    expect(counts().authCalls).toBe(2); // initial + forced refresh
    expect(counts().gstCalls).toBe(2);
  });

  it("caches the token across checks (authenticates once)", async () => {
    const { adapter, counts } = makeAdapter(async () => gstRes("Active"));
    await adapter.checkGstin(VALID_GSTIN);
    await adapter.checkGstin(VALID_GSTIN);
    expect(counts().authCalls).toBe(1);
    expect(counts().gstCalls).toBe(2);
  });
});
