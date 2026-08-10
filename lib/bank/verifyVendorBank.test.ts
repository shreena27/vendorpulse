import { describe, it, expect, vi } from "vitest";
import { verifyVendorBank } from "./verifyVendorBank";
import { createMockAdapter, MOCK_ACCOUNT_EXACT_MATCH, MOCK_IFSC } from "@/lib/providers/bank/mockAdapter";

const RAW_ACCOUNT_NUMBER = MOCK_ACCOUNT_EXACT_MATCH;

function stubSupabase(rpcResult: { data?: unknown; error: null | { message: string } }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) };
}

describe("verifyVendorBank", () => {
  it("calls the adapter, then records the result via the RPC with only masked/derived fields", async () => {
    const supabase = stubSupabase({ data: "row-1", error: null });
    const adapter = createMockAdapter();

    const summary = await verifyVendorBank(supabase, adapter, {
      vendorId: "vendor-1",
      vendorName: "Acme Traders",
      accountNumber: RAW_ACCOUNT_NUMBER,
      ifsc: MOCK_IFSC,
    });

    expect(summary).toEqual({
      vendorId: "vendor-1",
      status: "verified",
      nameMatchResult: "exact",
      accountNumberMasked: `****${RAW_ACCOUNT_NUMBER.slice(-4)}`,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = supabase.rpc.mock.calls[0];
    expect(fnName).toBe("record_bank_verification");
    expect(params).toMatchObject({
      p_vendor_id: "vendor-1",
      p_account_number_masked: `****${RAW_ACCOUNT_NUMBER.slice(-4)}`,
      p_ifsc: MOCK_IFSC,
      p_name_match_result: "exact",
      p_status: "verified",
      p_provider: "mock",
      p_re_verified_reason: null,
    });

    // The raw account number must never appear anywhere in the RPC call.
    expect(JSON.stringify(params)).not.toContain(RAW_ACCOUNT_NUMBER);
  });

  it("passes reason through as p_re_verified_reason for a manual re-flag", async () => {
    const supabase = stubSupabase({ data: "row-2", error: null });
    const adapter = createMockAdapter();

    await verifyVendorBank(supabase, adapter, {
      vendorId: "vendor-2",
      vendorName: "Acme Traders",
      accountNumber: RAW_ACCOUNT_NUMBER,
      ifsc: MOCK_IFSC,
      reason: "vendor requested re-check",
    });

    const params = supabase.rpc.mock.calls[0][1];
    expect(params.p_re_verified_reason).toBe("vendor requested re-check");
  });

  it("throws when the RPC returns an error", async () => {
    const supabase = stubSupabase({ error: { message: "boom" } });
    const adapter = createMockAdapter();

    await expect(
      verifyVendorBank(supabase, adapter, {
        vendorId: "vendor-3",
        vendorName: "Acme Traders",
        accountNumber: RAW_ACCOUNT_NUMBER,
        ifsc: MOCK_IFSC,
      }),
    ).rejects.toThrow(/boom/);
  });
});
