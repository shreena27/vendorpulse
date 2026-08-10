/**
 * Impact scorer (Chunk 3.1). Decides whether a detected change is worth
 * surfacing as an alert (ERD "Key business rules"): only when the vendor has
 * an open pending payment, or a LEI check resolves unfavorably for a payment
 * in flight. `lei_checks` doesn't exist until Chunk 4.3 — that check is a
 * deliberate stub (see below), same pattern as the Deepvue/Eko adapter
 * stubs.
 *
 * This module is purely the scoring decision. Nothing here writes to or
 * reads from `verification_checks` — that table is written unconditionally
 * by the poller (Chunk 1.4), regardless of what this function decides. No
 * pipeline calls `scoreChangeForVendor` yet; that's Chunk 3.2.
 */

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

/**
 * DELIBERATE STUB — lei_checks doesn't exist until Chunk 4.3, so this
 * always resolves false rather than guessing at a table that isn't built.
 * Same pattern as lib/providers/bank/ekoAdapter.ts.
 *
 * TODO(chunk-4.3): once lei_checks exists, query it for this vendor's
 * payments that are RTGS/NEFT and >= ₹50cr (ERD §3.2 threshold), and return
 * true when the matching lei_checks.status is lapsed/retired/not_on_record.
 * Verify the live GLEIF response shape before writing this — do not guess.
 */
// The vendorId argument is intentionally omitted: this stub returns false
// before it would ever use it. The real implementation will take it (see the
// TODO above) — ScoreChangeDeps still types this as (vendorId) => ..., and a
// function with fewer parameters satisfies that.
export async function hasUnfavorableLeiCheck(): Promise<boolean> {
  return false;
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface PaymentsClient {
  from(table: "payments"): {
    select(columns: string): {
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

/** Wires the real dependencies together. Nothing calls this yet — Chunk 3.2
 * will, from the alert-generation pipeline. */
export async function scoreChangeForVendor(
  supabase: PaymentsClient,
  input: ScoreChangeInput,
): Promise<ScoreResult> {
  return scoreChange(input, {
    hasOpenPendingPayment: (vendorId) => hasOpenPendingPayment(supabase, vendorId),
    hasUnfavorableLeiCheck,
  });
}
