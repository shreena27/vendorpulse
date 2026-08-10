/**
 * Bank-verification orchestrator (Chunk 2.1). SERVER-ONLY.
 *
 * The single call site for "check one vendor's bank details and record the
 * result" — used both in a loop right after import and once per manual flag.
 * Calls the adapter, then persists the (already masked) result via the
 * `record_bank_verification` RPC (SECURITY DEFINER; see migration 0004). The
 * raw account number is passed to the adapter and never touched again here.
 */

import type { BankProviderAdapter } from "@/lib/providers/bank/types";
import type { BankNameMatchResult, BankVerificationStatus } from "@/lib/supabase/types";

export interface VerifyVendorBankInput {
  vendorId: string;
  vendorName: string;
  accountNumber: string;
  ifsc: string;
  /** Set for a manual re-flag; null/omitted for the automatic post-import check. */
  reason?: string;
}

export interface VerifyVendorBankSummary {
  vendorId: string;
  status: BankVerificationStatus;
  nameMatchResult: BankNameMatchResult;
  accountNumberMasked: string;
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface RpcClient {
  rpc(
    fn: "record_bank_verification",
    params: {
      p_vendor_id: string;
      p_account_number_masked: string;
      p_ifsc: string;
      p_name_match_result: BankNameMatchResult;
      p_status: BankVerificationStatus;
      p_provider: "eko" | "mock";
      p_re_verified_reason: string | null;
    },
  ): PromiseLike<{ data?: unknown; error: { message: string } | null }>;
}

export async function verifyVendorBank(
  supabase: RpcClient,
  adapter: BankProviderAdapter,
  input: VerifyVendorBankInput,
): Promise<VerifyVendorBankSummary> {
  const result = await adapter.verifyAccount({
    vendorName: input.vendorName,
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
  });

  const { error } = await supabase.rpc("record_bank_verification", {
    p_vendor_id: input.vendorId,
    p_account_number_masked: result.accountNumberMasked,
    p_ifsc: result.ifsc,
    p_name_match_result: result.nameMatchResult,
    p_status: result.status,
    p_provider: result.provider,
    p_re_verified_reason: input.reason ?? null,
  });
  if (error) {
    throw new Error(`record bank verification failed: ${error.message}`);
  }

  return {
    vendorId: input.vendorId,
    status: result.status,
    nameMatchResult: result.nameMatchResult,
    accountNumberMasked: result.accountNumberMasked,
  };
}
