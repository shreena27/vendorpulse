/**
 * Resend client selector. SERVER-ONLY.
 *
 * No mock/live split like the GST/MSME/bank provider adapters — Resend's own
 * sandbox sender (onboarding@resend.dev) already only delivers to the
 * account's verified address, and tests inject a stub ResendClient directly
 * (see sendAlertEmail.test.ts), so a separate mock adapter would add nothing.
 */

import { Resend } from "resend";
import type { ResendClient } from "./sendAlertEmail";

let cached: ResendClient | null = null;

export function getResendClient(): ResendClient {
  if (cached) return cached;
  cached = new Resend(process.env.RESEND_API_KEY) as unknown as ResendClient;
  return cached;
}

/** Test hook: drop the memoized client so the next call re-constructs it. */
export function resetResendClient(): void {
  cached = null;
}
