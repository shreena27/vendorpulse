import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  scoreChange,
  hasOpenPendingPayment,
  scoreChangeForVendor,
  getOpenPaymentAmount,
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

/** Same shape as stubPaymentsClient, but for the amount-summing query (no .limit()). */
function stubAmountClient(
  rows: { amount: string }[] | null,
  error: { message: string } | null = null,
): PaymentsClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (
      resolve?: ((v: { data: typeof rows; error: typeof error }) => unknown) | null,
    ) => Promise.resolve(resolve?.({ data: rows, error })),
  };
  return { from: () => builder } as unknown as PaymentsClient;
}

describe("getOpenPaymentAmount", () => {
  it("sums the amount across all pending payment rows for the vendor", async () => {
    const client = stubAmountClient([{ amount: "1000" }, { amount: "2500.50" }]);
    expect(await getOpenPaymentAmount(client, "v1")).toBe(3500.5);
  });

  it("is 0 when there are no pending payments", async () => {
    const client = stubAmountClient([]);
    expect(await getOpenPaymentAmount(client, "v1")).toBe(0);
  });

  it("throws on a query error rather than silently reporting 0", async () => {
    const client = stubAmountClient(null, { message: "connection lost" });
    await expect(getOpenPaymentAmount(client, "v1")).rejects.toThrow(/connection lost/);
  });
});

/** A thenable resolving to a fixed { data, error } result, independent of
 * whichever chain method returns it — lets one stub client distinguish
 * "the hasOpenPendingPayment chain" (ends in .limit()) from "the
 * qualifying-payments-for-LEI chain" (ends in .gte()), which otherwise both
 * query .from("payments") and would collide on a single shared response. */
function thenable(rows: unknown[]) {
  return {
    then: (resolve?: ((v: { data: unknown[]; error: null }) => unknown) | null) =>
      Promise.resolve(resolve?.({ data: rows, error: null })),
  };
}

function stubScoreVendorClient(opts: {
  openPaymentRows?: { id: string }[];
  qualifyingPaymentRows?: { id: string }[];
  leiCheckRows?: { status: string }[];
}): SupabaseClient<Database> {
  const paymentsBuilder: Record<string, (...args: unknown[]) => unknown> = {
    select: () => paymentsBuilder,
    eq: () => paymentsBuilder,
    in: () => paymentsBuilder,
    limit: () => thenable(opts.openPaymentRows ?? []),
    gte: () => thenable(opts.qualifyingPaymentRows ?? []),
  };
  const leiChecksBuilder: Record<string, (...args: unknown[]) => unknown> = {
    select: () => leiChecksBuilder,
    in: () => leiChecksBuilder,
    limit: () => thenable(opts.leiCheckRows ?? []),
  };
  const client = {
    from: (table: string) => (table === "lei_checks" ? leiChecksBuilder : paymentsBuilder),
  };
  return client as unknown as SupabaseClient<Database>;
}

describe("scoreChangeForVendor (real dependencies wired together)", () => {
  it("is alert-worthy when the wired payments query finds an open payment", async () => {
    const client = stubScoreVendorClient({ openPaymentRows: [{ id: "p1" }] });
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: true, reason: "open_payment" });
  });

  it("is not alert-worthy when there's no open payment and no qualifying LEI-checkable payment", async () => {
    const client = stubScoreVendorClient({});
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: false, reason: "no_open_payment" });
  });

  it("is alert-worthy via the LEI path when there's no open payment but a qualifying payment has an unfavorable lei_checks row", async () => {
    const client = stubScoreVendorClient({
      openPaymentRows: [],
      qualifyingPaymentRows: [{ id: "p-qualifying" }],
      leiCheckRows: [{ status: "lapsed" }],
    });
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: true, reason: "lei_unfavorable" });
  });

  it("is not alert-worthy when a qualifying payment exists but its lei_checks row is favorable (issued)", async () => {
    const client = stubScoreVendorClient({
      openPaymentRows: [],
      qualifyingPaymentRows: [{ id: "p-qualifying" }],
      leiCheckRows: [], // the unfavorable-status filter finds nothing
    });
    const result = await scoreChangeForVendor(client, { vendorId: "v1", isChange: true });
    expect(result).toEqual({ alertWorthy: false, reason: "no_open_payment" });
  });
});
