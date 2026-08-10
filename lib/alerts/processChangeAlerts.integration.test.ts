import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runPoll, type PollSummary } from "@/lib/verification/pollRunner";
import { mapMsmeStatusToVendor } from "@/lib/verification/changeDetector";
import type { CheckOutcome } from "@/lib/verification/changeDetector";
import { processChangeAlertsForPipeline, type ChangedCheck } from "./processChangeAlerts";

// Load .env.local into process.env (the Vitest runner is a separate process).
try {
  const envPath = fileURLToPath(new URL("../../.env.local", import.meta.url));
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  // No .env.local — the suite self-skips below.
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && ANON && SERVICE);

/**
 * Chunk 3.2 acceptance (integration): the full pipeline — real runPoll, real
 * scorer, real alert writer — end to end. A changed vendor with an open
 * payment gets exactly one alert with the right trigger_type/source_check_id
 * /payment_impact_amount; a second real change on the same vendor updates
 * that same row (dedupe: no duplicate, source_check_id untouched, amount
 * refreshed); a changed vendor with no payment gets no alert at all.
 *
 * Prerequisite: migrations 0003, 0006, 0007 applied, Supabase "Confirm
 * email" off. Uses the msme_udyam path with a stub adapter, so no external
 * API is called.
 */
describe.skipIf(!hasEnv)("processChangeAlerts (integration)", () => {
  let admin: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;
  let vendorAId: string;
  let vendorBId: string;
  let udyamA: string;
  let udyamB: string;

  const pollConfig = () => ({
    supabase: admin,
    checkType: "msme_udyam" as const,
    vendorField: "udyam_number" as const,
    statusColumn: "current_msme_status" as const,
    providerName: "mock" as const,
    mapStatus: mapMsmeStatusToVendor,
  });

  /** A stub adapter call: status keyed by udyam number, default REGISTERED. */
  function stub(statusByUdyam: Map<string, string>): (value: string) => Promise<CheckOutcome> {
    return async (value: string) => ({
      status: statusByUdyam.get(value) ?? "REGISTERED",
      provider: "mock",
      raw: { value },
    });
  }

  function changedCheckFor(summary: PollSummary, vendorId: string): ChangedCheck | undefined {
    return summary.changedChecks.find((c) => c.vendorId === vendorId);
  }

  async function alertsFor(vendorId: string) {
    const { data } = await admin
      .from("alerts")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  beforeAll(async () => {
    const anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.alerts.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await anon.auth.signUp({
      email,
      password: "test-password-123",
    });
    expect(error, error?.message).toBeNull();
    userId = data.user!.id;

    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRow } = await admin
      .from("users")
      .select("organization_id")
      .eq("id", userId)
      .single();
    orgId = userRow!.organization_id;

    const base = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    udyamA = `UDYAM-MH-01-${String(base).padStart(7, "0")}`;
    udyamB = `UDYAM-MH-01-${String(base + 1).padStart(7, "0")}`;

    const { data: vendors, error: vErr } = await admin
      .from("vendors")
      .insert([
        { organization_id: orgId, name: "Alert Vendor A", udyam_number: udyamA, source: "excel" },
        { organization_id: orgId, name: "Alert Vendor B", udyam_number: udyamB, source: "excel" },
      ])
      .select("id, udyam_number");
    expect(vErr, vErr?.message).toBeNull();
    vendorAId = vendors!.find((v) => v.udyam_number === udyamA)!.id;
    vendorBId = vendors!.find((v) => v.udyam_number === udyamB)!.id;
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("creates one alert for a changed vendor with an open payment, updates (not duplicates) it on a repeat change, and creates nothing for a changed vendor with no payment", async () => {
    // Run 1: baseline for both vendors — first checks, not changes.
    await runPoll({
      ...pollConfig(),
      runCheck: stub(new Map([[udyamA, "REGISTERED"], [udyamB, "REGISTERED"]])),
    });

    // Run 2: both flip to LAPSED — genuine is_change = true for both.
    const summary2 = await runPoll({
      ...pollConfig(),
      runCheck: stub(new Map([[udyamA, "LAPSED"], [udyamB, "LAPSED"]])),
    });
    const checkA1 = changedCheckFor(summary2, vendorAId);
    const checkB1 = changedCheckFor(summary2, vendorBId);
    expect(checkA1).toBeDefined();
    expect(checkB1).toBeDefined();

    // Vendor A has an open payment; vendor B has none.
    const { error: pErr } = await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendorAId,
      amount: "50000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    });
    expect(pErr, pErr?.message).toBeNull();

    const summaryA1 = await processChangeAlertsForPipeline(admin, [checkA1!]);
    expect(summaryA1).toEqual({ scored: 1, alertsCreated: 1, alertsUpdated: 0, notAlertWorthy: 0 });

    const summaryB1 = await processChangeAlertsForPipeline(admin, [checkB1!]);
    expect(summaryB1).toEqual({ scored: 1, alertsCreated: 0, alertsUpdated: 0, notAlertWorthy: 1 });

    const alertsA = await alertsFor(vendorAId);
    expect(alertsA).toHaveLength(1);
    expect(alertsA[0]).toMatchObject({
      trigger_type: "msme_change",
      source_check_id: checkA1!.id,
      status: "open",
    });
    expect(Number(alertsA[0].payment_impact_amount)).toBe(50000);

    expect(await alertsFor(vendorBId)).toHaveLength(0);

    // Run 3: vendor A changes again (LAPSED -> REGISTERED); B untouched.
    const summary3 = await runPoll({
      ...pollConfig(),
      runCheck: stub(new Map([[udyamA, "REGISTERED"], [udyamB, "LAPSED"]])),
    });
    const checkA2 = changedCheckFor(summary3, vendorAId);
    expect(checkA2).toBeDefined();
    expect(checkA2!.id).not.toBe(checkA1!.id);

    // A second open payment for the same vendor — the dedupe update should
    // reflect the new SUMMED amount (50000 + 25000 = 75000).
    const { error: p2Err } = await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendorAId,
      amount: "25000",
      due_date: "2030-06-01",
      payment_method: "rtgs",
      status: "pending",
    });
    expect(p2Err, p2Err?.message).toBeNull();

    const summaryA2 = await processChangeAlertsForPipeline(admin, [checkA2!]);
    expect(summaryA2).toEqual({ scored: 1, alertsCreated: 0, alertsUpdated: 1, notAlertWorthy: 0 });

    const alertsAAfter = await alertsFor(vendorAId);
    // Still exactly one row — the repeat detection updated it, no duplicate.
    expect(alertsAAfter).toHaveLength(1);
    expect(alertsAAfter[0].id).toBe(alertsA[0].id);
    expect(Number(alertsAAfter[0].payment_impact_amount)).toBe(75000);
    // source_check_id stays pointed at the check that ORIGINALLY opened it.
    expect(alertsAAfter[0].source_check_id).toBe(checkA1!.id);
  });
});
