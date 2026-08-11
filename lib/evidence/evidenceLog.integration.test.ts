import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runPoll, type PollSummary } from "@/lib/verification/pollRunner";
import { mapMsmeStatusToVendor, buildCheckEvidenceEvents } from "@/lib/verification/changeDetector";
import type { CheckOutcome } from "@/lib/verification/changeDetector";
import { processChangeAlertsForPipeline } from "@/lib/alerts/processChangeAlerts";
import { resolveAlert } from "@/lib/alerts/resolveAlert";
import { logEvent, logEvents } from "./logEvent";

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
 * Chunk 4.1 acceptance (integration): a full check -> change -> alert ->
 * resolve cycle produces exactly one evidence_log row per distinct event,
 * each reconstructable back to its source row — and evidence_log physically
 * rejects UPDATE/DELETE even from the service role.
 *
 * Prerequisite: migrations 0003, 0006, 0007, 0008, 0009 applied, Supabase
 * "Confirm email" off. Uses the msme_udyam path with a stub adapter, so no
 * external API is called except the (expected-to-fail, per Chunk 3.3) Resend
 * send during alert creation.
 */
describe.skipIf(!hasEnv)("evidence_log (integration)", () => {
  let admin: SupabaseClient<Database>;
  let user: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;
  let vendorId: string;
  let udyam: string;

  const pollConfig = () => ({
    supabase: admin,
    checkType: "msme_udyam" as const,
    vendorField: "udyam_number" as const,
    statusColumn: "current_msme_status" as const,
    providerName: "mock" as const,
    mapStatus: mapMsmeStatusToVendor,
  });

  function stub(status: string): (value: string) => Promise<CheckOutcome> {
    return async (value) => ({ status, provider: "mock", raw: { value } });
  }

  /** The poller is global (all orgs) — scope its result to this test's own
   * vendor, same pattern pollRunner.integration.test.ts and
   * processChangeAlerts.integration.test.ts already use. */
  function changedCheckForVendor(summary: PollSummary, id: string) {
    return summary.changedChecks.find((c) => c.vendorId === id);
  }

  async function evidenceFor(id: string) {
    const { data } = await admin
      .from("evidence_log")
      .select("*")
      .eq("vendor_id", id)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  beforeAll(async () => {
    const anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.evidence.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await anon.auth.signUp({ email, password: "test-password-123" });
    expect(error, error?.message).toBeNull();
    userId = data.user!.id;
    user = anon;

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
    udyam = `UDYAM-MH-01-${String(base).padStart(7, "0")}`;

    const { data: vendor, error: vErr } = await admin
      .from("vendors")
      .insert({ organization_id: orgId, name: "Evidence Vendor", udyam_number: udyam, source: "excel" })
      .select("id")
      .single();
    expect(vErr, vErr?.message).toBeNull();
    vendorId = vendor!.id;
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("writes one evidence row per check, per change, per alert action, and per resolution across a full cycle", async () => {
    // Poll 1: baseline (REGISTERED) — first check, not a change.
    const summary1 = await runPoll({ ...pollConfig(), runCheck: stub("REGISTERED") });
    await logEvents(admin, buildCheckEvidenceEvents(summary1.allChecks));

    // Poll 2: flips to LAPSED — a genuine change.
    const summary2 = await runPoll({ ...pollConfig(), runCheck: stub("LAPSED") });
    await logEvents(admin, buildCheckEvidenceEvents(summary2.allChecks));
    const changedCheck = changedCheckForVendor(summary2, vendorId);
    expect(changedCheck).toBeDefined();
    const changed = [changedCheck!];

    // An open payment makes the change alert-worthy.
    const { error: pErr } = await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendorId,
      amount: "100000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    });
    expect(pErr, pErr?.message).toBeNull();

    const alertSummary = await processChangeAlertsForPipeline(admin, changed);
    expect(alertSummary.alertsCreated).toBe(1);

    const { data: alertRow } = await admin
      .from("alerts")
      .select("id")
      .eq("vendor_id", vendorId)
      .single();
    const alertId = alertRow!.id;

    // Resolve it as the signed-in user, then log evidence exactly as
    // app/api/alerts/[id]/action/route.ts does on a successful resolution.
    const resolution = await resolveAlert(user, alertId, "hold");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    await logEvent(admin, {
      organizationId: resolution.alert.organization_id,
      vendorId: resolution.alert.vendor_id,
      eventType: "alert_resolved",
      entityType: "alerts",
      entityId: resolution.alert.id,
      payload: { action: "hold", status: resolution.alert.status },
      actor: userId,
    });

    const events = await evidenceFor(vendorId);
    const byType = (t: string) => events.filter((e) => e.event_type === t);

    expect(byType("verification_check")).toHaveLength(2); // one per poll run
    expect(byType("status_change")).toHaveLength(1); // only poll 2 changed
    expect(byType("alert_created")).toHaveLength(1);
    expect(byType("alert_updated")).toHaveLength(0);
    expect(byType("alert_resolved")).toHaveLength(1);
    expect(events).toHaveLength(5);

    // Reconstructable back to the source row.
    const { data: changedRow } = await admin
      .from("verification_checks")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("is_change", true)
      .single();
    expect(byType("status_change")[0].entity_id).toBe(changedRow!.id);
    expect(byType("alert_created")[0].entity_id).toBe(alertId);
    expect(byType("alert_resolved")[0].entity_id).toBe(alertId);
    expect(byType("alert_resolved")[0].actor).toBe(userId);
  });

  it("rejects an UPDATE and a DELETE on evidence_log even as the service role", async () => {
    const { data: seeded, error: insErr } = await admin
      .from("evidence_log")
      .insert({
        organization_id: orgId,
        vendor_id: vendorId,
        event_type: "verification_check",
        entity_type: "verification_checks",
        entity_id: vendorId, // no FK on entity_id, so any uuid is valid here
        payload: { note: "permissions probe" },
      })
      .select("id")
      .single();
    expect(insErr, insErr?.message).toBeNull();

    const { error: updateErr } = await admin
      .from("evidence_log")
      .update({ payload: { tampered: true } })
      .eq("id", seeded!.id);
    expect(updateErr).not.toBeNull();
    expect(updateErr!.message).toMatch(/permission denied/i);

    const { error: deleteErr } = await admin
      .from("evidence_log")
      .delete()
      .eq("id", seeded!.id);
    expect(deleteErr).not.toBeNull();
    expect(deleteErr!.message).toMatch(/permission denied/i);
  });
});
