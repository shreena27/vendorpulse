/**
 * Poll orchestration for GST/MSME checks (ERD §5.1). SERVER-ONLY.
 *
 * `runPoll` loads every vendor with the relevant identifier, checks each one via
 * the injected adapter call, writes a verification_checks row per vendor (with
 * is_change computed against the prior check), and updates the vendor's current
 * status. Dependencies are injected so the integration test can drive it with a
 * stub adapter and the service-role client.
 *
 * Resilience: one failing check never aborts the batch — a thrown adapter call
 * becomes a status_value = UNKNOWN row, and the other vendors still get written
 * (ERD acceptance).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CheckType, CheckProvider } from "@/lib/supabase/types";
import {
  buildCheck,
  type BuiltCheck,
  type CheckOutcome,
  type VendorRef,
} from "./changeDetector";

type Admin = SupabaseClient<Database>;

export interface PollConfig {
  supabase: Admin;
  checkType: CheckType;
  vendorField: "gstin" | "udyam_number";
  statusColumn: "current_gst_status" | "current_msme_status";
  /** Provider recorded when `runCheck` throws (the batch continues). */
  providerName: CheckProvider;
  /** The adapter call; returns the normalized outcome for one identifier. */
  runCheck: (value: string) => Promise<CheckOutcome>;
  /** Uppercase status_value → the vendor's current-status enum value. */
  mapStatus: (status: string) => string;
  /** Max concurrent checks (default 8). */
  concurrency?: number;
}

export interface PollSummary {
  checkType: CheckType;
  checked: number;
  changes: number;
  unknown: number;
}

export async function runPoll(config: PollConfig): Promise<PollSummary> {
  const {
    supabase,
    checkType,
    vendorField,
    statusColumn,
    providerName,
    runCheck,
    mapStatus,
  } = config;
  const concurrency = config.concurrency ?? 8;
  const now = new Date().toISOString();

  // 1. Load every vendor that has the relevant identifier (service role → all orgs).
  const { data: vendorData, error: vErr } = await supabase
    .from("vendors")
    .select("id, organization_id, gstin, udyam_number")
    .not(vendorField, "is", null);
  if (vErr) throw new Error(`load vendors failed: ${vErr.message}`);

  const vendors = (vendorData ?? []).filter((v) => v[vendorField]);
  if (vendors.length === 0) {
    return { checkType, checked: 0, changes: 0, unknown: 0 };
  }

  // 2. Latest prior status_value per vendor for this check_type, in one query.
  const ids = vendors.map((v) => v.id);
  const { data: priors, error: pErr } = await supabase
    .from("verification_checks")
    .select("vendor_id, status_value, checked_at")
    .eq("check_type", checkType)
    .in("vendor_id", ids)
    .order("checked_at", { ascending: false });
  if (pErr) throw new Error(`load prior checks failed: ${pErr.message}`);

  const priorByVendor = new Map<string, string>();
  for (const p of priors ?? []) {
    if (!priorByVendor.has(p.vendor_id)) {
      priorByVendor.set(p.vendor_id, p.status_value);
    }
  }

  // 3. Check each vendor with bounded concurrency. A thrown call falls back to
  //    UNKNOWN so one failure never aborts the batch.
  const checks: BuiltCheck[] = new Array(vendors.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (let i = cursor++; i < vendors.length; i = cursor++) {
      const vendor = vendors[i];
      const ref: VendorRef = {
        id: vendor.id,
        organization_id: vendor.organization_id,
      };
      const value = vendor[vendorField] as string;
      let outcome: CheckOutcome;
      try {
        outcome = await runCheck(value);
      } catch {
        outcome = {
          status: "UNKNOWN",
          provider: providerName,
          raw: { error: "adapter_threw" },
        };
      }
      checks[i] = buildCheck(
        ref,
        checkType,
        outcome,
        priorByVendor.get(vendor.id) ?? null,
        now,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, vendors.length) }, worker),
  );

  // 4. Append every check row (verification_checks is append-only).
  const { error: insErr } = await supabase
    .from("verification_checks")
    .insert(checks);
  if (insErr) throw new Error(`insert checks failed: ${insErr.message}`);

  // 5. Update each vendor's current status, grouped by target status so this is
  //    a handful of UPDATEs, not one per vendor.
  const idsByStatus = new Map<string, string[]>();
  for (const c of checks) {
    const mapped = mapStatus(c.status_value);
    const list = idsByStatus.get(mapped) ?? [];
    list.push(c.vendor_id);
    idsByStatus.set(mapped, list);
  }
  for (const [status, vendorIds] of idsByStatus) {
    // The column name is a validated union; the value is a mapped enum member.
    const patch = { [statusColumn]: status, updated_at: now } as unknown as Database["public"]["Tables"]["vendors"]["Update"];
    const { error: upErr } = await supabase
      .from("vendors")
      .update(patch)
      .in("id", vendorIds);
    if (upErr) throw new Error(`update vendors failed: ${upErr.message}`);
  }

  return {
    checkType,
    checked: checks.length,
    changes: checks.filter((c) => c.is_change).length,
    unknown: checks.filter((c) => c.status_value === "UNKNOWN").length,
  };
}
