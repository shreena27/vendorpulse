import { describe, it, expect, vi } from "vitest";
import {
  scoreChange,
  hasUnfavorableLeiCheck,
  hasOpenPendingPayment,
  scoreChangeForVendor,
  type PaymentsClient,
} from "./impactScorer";

function deps(hasOpenPendingPayment: boolean, hasUnfavorableLeiCheck: boolean) {
  return {
    hasOpenPendingPayment: vi.fn().mockResolvedValue(hasOpenPendingPayment),
    hasUnfavorableLeiCheck: vi.fn().mockResolvedValue(hasUnfavorableLeiCheck),
  };
}

describe("scoreChange", () => {
  it("is never alert-worthy when there was no change, and skips both dependency checks", async () => {
    const d = deps(true, true);

    const result = await scoreChange({ vendorId: "v1", isChange: false }, d);

    expect(result).toEqual({ alertWorthy: false, reason: "no_change" });
    expect(d.hasOpenPendingPayment).not.toHaveBeenCalled();
    expect(d.hasUnfavorableLeiCheck).not.toHaveBeenCalled();
  });

  it("is alert-worthy when the vendor has an open pending payment", async () => {
    const result = await scoreChange({ vendorId: "v1", isChange: true }, deps(true, false));
    expect(result).toEqual({ alertWorthy: true, reason: "open_payment" });
  });

  it("is alert-worthy when the LEI check is unfavorable, even with no open payment", async () => {
    const result = await scoreChange({ vendorId: "v1", isChange: true }, deps(false, true));
    expect(result).toEqual({ alertWorthy: true, reason: "lei_unfavorable" });
  });

  it("prefers the open_payment reason when both conditions are true", async () => {
    const result = await scoreChange({ vendorId: "v1", isChange: true }, deps(true, true));
    expect(result).toEqual({ alertWorthy: true, reason: "open_payment" });
  });

  it("is not alert-worthy when there is a change but no open payment and no unfavorable LEI check", async () => {
    const result = await scoreChange({ vendorId: "v1", isChange: true }, deps(false, false));
    expect(result).toEqual({ alertWorthy: false, reason: "no_open_payment" });
  });

  it("passes the vendorId through to both dependency checks", async () => {
    const d = deps(false, false);
    await scoreChange({ vendorId: "vendor-42", isChange: true }, d);
    expect(d.hasOpenPendingPayment).toHaveBeenCalledWith("vendor-42");
    expect(d.hasUnfavorableLeiCheck).toHaveBeenCalledWith("vendor-42");
  });
});

describe("hasUnfavorableLeiCheck (deliberate stub, Chunk 4.3 not built yet)", () => {
  it("always resolves false", async () => {
    expect(await hasUnfavorableLeiCheck()).toBe(false);
  });

  it("satisfies the (vendorId) => Promise<boolean> shape ScoreChangeDeps expects, and still resolves false when called with one", async () => {
    const dep: (vendorId: string) => Promise<boolean> = hasUnfavorableLeiCheck;
    expect(await dep("some-vendor")).toBe(false);
  });
});

/** A thenable stub mirroring supabase-js's chainable, awaitable query builder. */
function stubPaymentsClient(
  rows: { id: string }[] | null,
  error: { message: string } | null = null,
): PaymentsClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    then: (
      resolve?: ((v: { data: typeof rows; error: typeof error }) => unknown) | null,
    ) => Promise.resolve(resolve?.({ data: rows, error })),
  };
  return { from: () => builder } as unknown as PaymentsClient;
}

describe("hasOpenPendingPayment", () => {
  it("is true when a pending payment row exists for the vendor", async () => {
    const client = stubPaymentsClient([{ id: "p1" }]);
    expect(await hasOpenPendingPayment(client, "v1")).toBe(true);
  });

  it("is false when no pending payment row exists for the vendor", async () => {
    const client = stubPaymentsClient([]);
    expect(await hasOpenPendingPayment(client, "v1")).toBe(false);
  });

  it("throws on a query error rather than silently reporting false", async () => {
    const client = stubPaymentsClient(null, { message: "connection lost" });
    await expect(hasOpenPendingPayment(client, "v1")).rejects.toThrow(/connection lost/);
  });
});

describe("scoreChangeForVendor (real dependencies wired together)", () => {
  it("is alert-worthy when the wired payments query finds an open payment", async () => {
    const client = stubPaymentsClient([{ id: "p1" }]);
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: true, reason: "open_payment" });
  });

  it("is not alert-worthy when the wired payments query finds nothing (LEI stub is always false)", async () => {
    const client = stubPaymentsClient([]);
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: false, reason: "no_open_payment" });
  });
});
