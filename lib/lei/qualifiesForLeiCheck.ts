/**
 * The LEI pre-payment check threshold (Chunk 4.3, ERD §3.2): only
 * RTGS/NEFT payments of ₹50 crore or more trigger a GLEIF check.
 */

import type { PaymentMethod } from "@/lib/supabase/types";

export const LEI_THRESHOLD = 500_000_000; // ₹50,00,00,000 = ₹50 crore

export function qualifiesForLeiCheck(amount: number, paymentMethod: PaymentMethod): boolean {
  return amount >= LEI_THRESHOLD && (paymentMethod === "rtgs" || paymentMethod === "neft");
}
