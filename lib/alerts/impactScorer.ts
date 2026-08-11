/**
 * Impact scorer (Chunk 3.1). Decides whether a detected change is worth
 * surfacing as an alert (ERD "Key business rules"): only when the vendor has
 * an open pending payment, or a LEI check resolves unfavorably for a payment
 * in flight.
 *
 * This module is purely the scoring decision. Nothing here writes to or
 * reads from `verification_checks` — that table is written unconditionally
 * by the poller (Chunk 1.4), regardless of what this function decides.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LeiCheckStatus } from "@/lib/supabase/types";
import { LEI_THRESHOLD } from "@/lib/lei/qualifiesForLeiCheck";

export interface ScoreChangeInput {
  vendorId: string;
  /** The verification_checks row's is_change value for this poll. */
  isChange: boolean;
}

export type ScoreReason =
  | "no_change"
  | "no_open_payment"
  | "open_payment"
  | "lei_unfavorable";

export interface ScoreResult {
  alertWorthy: boolean;
  reason: ScoreReason;
}

export interface ScoreChangeDeps {
  hasOpenPendingPayment: (vendorId: string) => Promise<boolean>;
  hasUnfavorableLeiCheck: (vendorId: string) => Promise<boolean>;
}

/**
 * A non-change is never alert-worthy, regardless of payment/LEI state — so
 * neither dependency is even called in that case.
 */
export async function scoreChange(
  input: ScoreChangeInput,
  deps: ScoreChangeDeps,
): Promise<ScoreResult> {
  if (!input.isChange) {
    return { alertWorthy: false, reason: "no_change" };
  }

  const [openPayment, leiUnfavorable] = await Promise.all([
    deps.hasOpenPendingPayment(input.vendorId),
    deps.hasUnfavorableLeiCheck(input.vendorId),
  ]);

  if (openPayment) return { alertWorthy: true, reason: "open_payment" };
  if (leiUnfavorable) return { alertWorthy: true, reason: "lei_unfavorable" };
  return { alertWorthy: false, reason: "no_open_payment" };
}

const UNFAVORABLE_LEI_STATUSES: LeiCheckStatus[] = ["lapsed", "retired", "not_on_record"];

/**
 * True when this vendor has at least one qualifying payment (RTGS/NEFT,
 * >= LEI_THRESHOLD — lib/lei/qualifiesForLeiCheck.ts) whose lei_checks row
 * came back lapsed, retired, or not_on_record. Written directly against the
 * concrete client (not a narrow interface) — no hermetic unit-testing need
 * strong enough to justify one; covered by impactScorer.integration.test.ts
 * instead (same call as Chunk 4.2's buildExport.ts real fetch functions).
 */
export async function hasUnfavorableLeiCheckForVendor(
  supabase: SupabaseClient<Database>,
  vendorId: string,
): Promise<boolean> {
  const { data: payments, error: pErr } = await supabase
    .from("payments")
    .select("id")
    .eq("vendor_id", vendorId)
    .in("payment_method", ["rtgs", "neft"])
    .gte("amount", LEI_THRESHOLD);
  if (pErr) throw new Error(`qualifying payments lookup failed: ${pErr.message}`);

  const paymentIds = (payments ?? []).map((p) => p.id);
  if (paymentIds.length === 0) return false;

  const { data: checks, error: cErr } = await supabase
    .from("lei_checks")
    .select("status")
    .in("payment_id", paymentIds)
    .in("status", UNFAVORABLE_LEI_STATUSES)
    .limit(1);
  if (cErr) throw new Error(`lei check lookup failed: ${cErr.message}`);

  return (checks ?? []).length > 0;
}

/** Minimal Supabase client surface these functions need — easy to stub in tests. */
export interface PaymentsClient {
  from(table: "payments"): {
    select(columns: "id"): {
      eq(
        column: "vendor_id",
        value: string,
      ): {
        eq(
          column2: "status",
          value2: "pending",
        ): {
          limit(
            n: number,
          ): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
        };
      };
    };
    select(columns: "amount"): {
      eq(
        column: "vendor_id",
        value: string,
      ): {
        eq(
          column2: "status",
          value2: "pending",
        ): PromiseLike<{ data: { amount: string }[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export async function hasOpenPendingPayment(
  supabase: PaymentsClient,
  vendorId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("payments")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("status", "pending")
    .limit(1);
  if (error) {
    throw new Error(`open-payment lookup failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * Sums `amount` across every pending payment for the vendor (0 if none).
 * Used only by Chunk 3.2's alert-creation step, to populate
 * `alerts.payment_impact_amount` — not by `scoreChange` itself, which only
 * needs the boolean.
 */
export async function getOpenPaymentAmount(
  supabase: PaymentsClient,
  vendorId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("payments")
    .select("amount")
    .eq("vendor_id", vendorId)
    .eq("status", "pending");
  if (error) {
    throw new Error(`open-payment amount lookup failed: ${error.message}`);
  }
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

/** Wires the real dependencies together. Takes the concrete client (not
 * PaymentsClient) so it can call hasUnfavorableLeiCheckForVendor directly;
 * the one `as unknown as PaymentsClient` cast this function needs for
 * hasOpenPendingPayment lives here now, consolidated in the one place that
 * bridges real code to that narrow interface — callers (e.g.
 * processChangeAlertsForPipeline) just pass the real supabase client
 * straight through, no pre-casting needed on their end. */
export async function scoreChangeForVendor(
  supabase: SupabaseClient<Database>,
  input: ScoreChangeInput,
): Promise<ScoreResult> {
  const paymentsClient = supabase as unknown as PaymentsClient;
  return scoreChange(input, {
    hasOpenPendingPayment: (vendorId) => hasOpenPendingPayment(paymentsClient, vendorId),
    hasUnfavorableLeiCheck: (vendorId) => hasUnfavorableLeiCheckForVendor(supabase, vendorId),
  });
}
