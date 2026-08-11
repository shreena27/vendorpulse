/**
 * One-tap alert resolution (Chunk 3.3). SERVER-ONLY.
 *
 * Thin wrapper over the resolve_alert() RPC (migration 0008) — classifies
 * its distinguishable exception messages into typed results, so
 * app/api/alerts/[id]/action/route.ts stays a plain HTTP-status mapper, same
 * split as verifyVendorBank.ts / uploadCertificate.ts.
 */

import type { Database } from "@/lib/supabase/types";

export type AlertRow = Database["public"]["Functions"]["resolve_alert"]["Returns"];

export type ResolveAlertReason = "not_found" | "already_resolved" | "invalid_action";

export type ResolveAlertResult =
  | { ok: true; alert: AlertRow }
  | { ok: false; reason: ResolveAlertReason };

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface ResolveAlertClient {
  rpc(
    fn: "resolve_alert",
    params: { p_alert_id: string; p_action: string },
  ): PromiseLike<{ data: AlertRow | null; error: { message: string } | null }>;
}

export async function resolveAlert(
  supabase: ResolveAlertClient,
  alertId: string,
  action: string,
): Promise<ResolveAlertResult> {
  const { data, error } = await supabase.rpc("resolve_alert", {
    p_alert_id: alertId,
    p_action: action,
  });

  if (error) {
    if (error.message.includes("alert_already_resolved")) {
      return { ok: false, reason: "already_resolved" };
    }
    if (error.message.includes("alert_not_found")) {
      return { ok: false, reason: "not_found" };
    }
    if (error.message.includes("invalid_action")) {
      return { ok: false, reason: "invalid_action" };
    }
    throw new Error(`resolve alert failed: ${error.message}`);
  }

  return { ok: true, alert: data! };
}
