/**
 * Shared, RLS-scoped reads for alerts (Chunk 3.3). Used by the GET route,
 * the inbox page, and the alert-creation email step, so they never drift
 * (same pattern as lib/vendors/queries.ts).
 *
 * Payment count/amount are computed LIVE from `payments` at read time, not
 * read off `alerts.payment_impact_amount` (a snapshot from whenever the
 * alert was created/deduped) — a finance head deciding right now should see
 * the current open-payment picture.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AlertStatus, AlertTriggerType } from "@/lib/supabase/types";
import { buildNudgeMessage, type NudgeMessage } from "./nudgeCopy";

type Client = SupabaseClient<Database>;

export interface AlertFilters {
  status?: AlertStatus;
  vendorId?: string;
  triggerType?: AlertTriggerType;
}

export interface AlertWithNudge {
  id: string;
  vendorId: string;
  vendorName: string;
  triggerType: AlertTriggerType;
  status: AlertStatus;
  resolvedBy: string | null;
  /** The resolver's display name/email, when resolved — lets the UI
   * attribute the decision to a specific person, not a vague "you"/"the
   * system" (the wording constraint this chunk is built around). */
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  nudge: NudgeMessage;
}

interface AlertRow {
  id: string;
  vendor_id: string;
  trigger_type: AlertTriggerType;
  source_check_id: string;
  status: AlertStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

const ALERT_COLUMNS =
  "id, vendor_id, trigger_type, source_check_id, status, resolved_by, resolved_at, created_at";

/** Batch-fetches vendor names, source-check status values, and live pending
 * payment stats for a set of alert rows, then attaches each row's nudge. */
async function attachNudge(supabase: Client, rows: AlertRow[]): Promise<AlertWithNudge[]> {
  if (rows.length === 0) return [];

  const vendorIds = [...new Set(rows.map((a) => a.vendor_id))];
  // Polymorphic source: gst_change/msme_change alerts point into
  // verification_checks; lei_check alerts point into lei_checks. Split the
  // ids by which table they actually belong to before fetching.
  const verificationCheckIds = [
    ...new Set(rows.filter((a) => a.trigger_type !== "lei_check").map((a) => a.source_check_id)),
  ];
  const leiCheckIds = [
    ...new Set(rows.filter((a) => a.trigger_type === "lei_check").map((a) => a.source_check_id)),
  ];
  const resolverIds = [...new Set(rows.map((a) => a.resolved_by).filter((id): id is string => Boolean(id)))];

  const [vendorsRes, checksRes, leiChecksRes, paymentsRes, resolversRes] = await Promise.all([
    supabase.from("vendors").select("id, name").in("id", vendorIds),
    supabase.from("verification_checks").select("id, status_value").in("id", verificationCheckIds),
    supabase.from("lei_checks").select("id, status").in("id", leiCheckIds),
    supabase.from("payments").select("vendor_id, amount").eq("status", "pending").in("vendor_id", vendorIds),
    resolverIds.length > 0
      ? supabase.from("users").select("id, full_name, email").in("id", resolverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (vendorsRes.error) throw new Error(`list alert vendors failed: ${vendorsRes.error.message}`);
  if (checksRes.error) throw new Error(`list alert source checks failed: ${checksRes.error.message}`);
  if (leiChecksRes.error) throw new Error(`list alert lei checks failed: ${leiChecksRes.error.message}`);
  if (paymentsRes.error) throw new Error(`list alert payments failed: ${paymentsRes.error.message}`);
  if (resolversRes.error) throw new Error(`list alert resolvers failed: ${resolversRes.error.message}`);

  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));
  const statusValueByCheckId = new Map<string, string>([
    ...(checksRes.data ?? []).map((c): [string, string] => [c.id, c.status_value]),
    ...(leiChecksRes.data ?? []).map((c): [string, string] => [c.id, c.status]),
  ]);
  const resolverNameById = new Map(
    (resolversRes.data ?? []).map((u) => [u.id, u.full_name ?? u.email ?? "a team member"]),
  );

  const paymentStatsByVendor = new Map<string, { count: number; amount: number }>();
  for (const p of paymentsRes.data ?? []) {
    const prev = paymentStatsByVendor.get(p.vendor_id) ?? { count: 0, amount: 0 };
    prev.count += 1;
    prev.amount += Number(p.amount);
    paymentStatsByVendor.set(p.vendor_id, prev);
  }

  return rows.map((a) => {
    const vendorName = vendorNameById.get(a.vendor_id) ?? "Unknown vendor";
    const statusValue = statusValueByCheckId.get(a.source_check_id) ?? "UNKNOWN";
    const stats = paymentStatsByVendor.get(a.vendor_id) ?? { count: 0, amount: 0 };
    return {
      id: a.id,
      vendorId: a.vendor_id,
      vendorName,
      triggerType: a.trigger_type,
      status: a.status,
      resolvedBy: a.resolved_by,
      resolvedByName: a.resolved_by ? (resolverNameById.get(a.resolved_by) ?? null) : null,
      resolvedAt: a.resolved_at,
      createdAt: a.created_at,
      nudge: buildNudgeMessage({
        vendorName,
        triggerType: a.trigger_type,
        statusValue,
        paymentCount: stats.count,
        paymentAmount: stats.amount,
      }),
    };
  });
}

export async function listAlertsForOrg(
  supabase: Client,
  filters: AlertFilters = {},
): Promise<AlertWithNudge[]> {
  let query = supabase.from("alerts").select(ALERT_COLUMNS).order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.vendorId) query = query.eq("vendor_id", filters.vendorId);
  if (filters.triggerType) query = query.eq("trigger_type", filters.triggerType);

  const { data, error } = await query;
  if (error) throw new Error(`list alerts failed: ${error.message}`);
  return attachNudge(supabase, (data ?? []) as AlertRow[]);
}

/** One alert's nudge, by id — used by the alert-creation email step. */
export async function getAlertNudgeById(
  supabase: Client,
  alertId: string,
): Promise<AlertWithNudge | null> {
  const { data, error } = await supabase
    .from("alerts")
    .select(ALERT_COLUMNS)
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw new Error(`load alert failed: ${error.message}`);
  if (!data) return null;

  const [result] = await attachNudge(supabase, [data as AlertRow]);
  return result;
}
