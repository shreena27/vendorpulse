import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runPoll } from "@/lib/verification/pollRunner";
import { mapGstStatusToVendor } from "@/lib/verification/changeDetector";
import type { CheckOutcome } from "@/lib/verification/changeDetector";
import { processChangeAlertsForPipeline } from "@/lib/alerts/processChangeAlerts";
import { resolveAlert } from "@/lib/alerts/resolveAlert";
import { buildExport } from "@/lib/evidence/buildExport";
import { track, trackBatch } from "@/lib/analytics/track";
import { maybeTrackPmfSurveyTrigger } from "@/lib/analytics/maybeTrackPmfSurveyTrigger";
import {
  getSection11Metrics,
  getPilotToPaidIntent,
  getPmfSurveyScore,
  getTimeToFirstValuePortfolioKillSignal,
} from "@/lib/analytics/metrics";

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
 * Chunk 5.1 acceptance: the full import -> poll -> alert -> resolve ->
 * export cycle, run for real, with every Section 11 metric asserted
 * queryable afterward — one assertion per metric, so a missing one fails
 * loudly rather than being noticed a month into the pilot.
 *
 * Prerequisite: migrations 0001-0013 applied, Supabase "Confirm email" off.
 */
describe.skipIf(!hasEnv)("Section 11 metrics (scripted end-to-end)", () => {
  let admin: SupabaseClient<Database>;
  let anon: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;
  let vendorId: string;
  let gstin: string;
  let alertId: string;

  beforeAll(async () => {
    anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.metrics.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`;
    const { data, error } = await anon.auth.signUp({ email, password: "test-password-123" });
    expect(error, error?.message).toBeNull();
    userId = data.user!.id;

    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRow } = await admin.from("users").select("organization_id").eq("id", userId).single();
    orgId = userRow!.organization_id;

    const base = Math.floor(Math.random() * 900) + 100;
    gstin = `27AAAPL${base}C1Z5`;

    // --- IMPORT: replicate app/api/vendors/import/route.ts's own sequence.
    // import_vendors() is SECURITY DEFINER and reads current_org_id() from
    // the CALLING client's own auth.uid() — it must run on the signed-up
    // user's own session client (anon, now holding that session), not the
    // admin/service-role client, which has no user JWT at all. ---
    const { data: importId, error: importErr } = await anon.rpc("import_vendors", {
      p_source: "excel",
      p_row_count: 1,
      p_error_count: 0,
      p_vendors: [
        {
          name: "Section 11 Metrics Vendor",
          gstin,
          udyam_number: null,
          pan: null,
          current_gst_status: "unknown",
          current_msme_status: "unknown",
          current_bank_status: "unverified",
          source: "excel",
        },
      ],
    });
    expect(importErr, importErr?.message).toBeNull();
    const { data: vendors } = await admin.from("vendors").select("id").eq("import_id", importId as string);
    vendorId = vendors![0].id;
    await track(admin, {
      organizationId: orgId,
      eventType: "vendor_import_completed",
      payload: { source: "excel", importId, rowCount: 1, insertedCount: 1, errorCount: 0 },
      actor: userId,
    });
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("produces a queryable value for every Section 11 metric after a real end-to-end run", async () => {
    // --- POLL: baseline, then a genuine change ---
    const pollConfig = () => ({
      supabase: admin,
      checkType: "gst" as const,
      vendorField: "gstin" as const,
      statusColumn: "current_gst_status" as const,
      providerName: "mock" as const,
      mapStatus: mapGstStatusToVendor,
    });
    const stub = (status: string) => async (): Promise<CheckOutcome> => ({ status, provider: "mock", raw: {} });

    await runPoll({ ...pollConfig(), runCheck: stub("ACTIVE") });
    const summary2 = await runPoll({ ...pollConfig(), runCheck: stub("CANCELLED") });
    const changed = summary2.changedChecks.find((c) => c.vendorId === vendorId)!;
    expect(changed).toBeDefined();

    await trackBatch(
      admin,
      summary2.changedChecks
        .filter((c) => c.vendorId === vendorId)
        .map((c) => ({
          organizationId: c.organizationId,
          vendorId: c.vendorId,
          eventType: "status_change_detected" as const,
          payload: { checkType: c.checkType, checkId: c.id },
        })),
    );

    // Seed a qualifying pending payment so the change is alert-worthy.
    await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendorId,
      amount: "6000000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    });

    // --- ALERT: real pipeline (already tracks alert_created_tracked internally) ---
    const alertSummary = await processChangeAlertsForPipeline(admin, [changed]);
    expect(alertSummary.alertsCreated).toBe(1);
    const { data: alerts } = await admin.from("alerts").select("id").eq("vendor_id", vendorId);
    alertId = alerts![0].id;

    // --- RESOLVE: replicate app/api/alerts/[id]/action/route.ts's own
    // sequence. resolve_alert() is SECURITY DEFINER and reads
    // current_org_id() from the CALLING client's own auth.uid() — same
    // reasoning as import_vendors() above, so this runs on the anon
    // (session) client, not admin. ---
    const result = await resolveAlert(anon, alertId, "hold");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const hoursSinceCreated = (Date.now() - new Date(result.alert.created_at).getTime()) / 3_600_000;
    await track(admin, {
      organizationId: result.alert.organization_id,
      vendorId: result.alert.vendor_id,
      eventType: "alert_actioned",
      payload: {
        alertId: result.alert.id,
        action: "hold",
        triggerType: result.alert.trigger_type,
        paymentImpactAmount: Number(result.alert.payment_impact_amount),
        hoursSinceCreated,
        actionedWithin24h: hoursSinceCreated <= 24,
        actionedWithin48h: hoursSinceCreated <= 48,
      },
      actor: userId,
    });
    await maybeTrackPmfSurveyTrigger(admin, orgId);

    // A bank/cert issue: simulate a non-verified bank check directly.
    await track(admin, {
      organizationId: orgId,
      vendorId,
      eventType: "bank_cert_issue_caught",
      payload: { kind: "bank", status: "manual_review" },
    });

    // --- EXPORT: replicate app/api/evidence/export/route.ts's own sequence ---
    const rows = await buildExport(admin, { from: "2020-01-01", to: "2035-01-01" });
    await track(admin, {
      organizationId: orgId,
      eventType: "evidence_export_completed",
      payload: { format: "csv", from: "2020-01-01", to: "2035-01-01", rowCount: rows.length },
      actor: userId,
    });

    // --- SELF-REPORTED SIGNALS: no app UI triggers these yet; simulate the
    // future survey/CRM submission directly, proving the pipeline works. ---
    await track(admin, {
      organizationId: orgId,
      eventType: "audit_time_saved_reported",
      payload: { percentReduction: 35 },
      actor: userId,
    });
    await track(admin, {
      organizationId: orgId,
      eventType: "pilot_to_paid_intent_signal",
      payload: { intent: "yes" },
      actor: userId,
    });
    await track(admin, {
      organizationId: orgId,
      eventType: "pmf_survey_response",
      payload: { sentiment: "very_disappointed" },
      actor: userId,
    });

    // --- ASSERT: one assertion per Section 11 metric ---
    const metrics = await getSection11Metrics(admin, orgId);

    expect(metrics.northStar.value, "north star / payments held").toBeGreaterThanOrEqual(1);
    expect(metrics.vendorsConnectedWithoutIt.sampleSize, "vendors connected without IT").toBeGreaterThan(0);
    expect(metrics.timeToFirstValue.sampleSize, "time to first value").toBeGreaterThan(0);
    expect(metrics.statusChangesDetected.sampleSize, "status changes detected").toBeGreaterThan(0);
    expect(metrics.alertsActionedWithin24h.sampleSize, "alerts actioned within 24h").toBeGreaterThan(0);
    expect(metrics.alertPrecision.sampleSize, "alert precision").toBeGreaterThan(0);
    expect(metrics.bankCertIssuesCaught.value, "bank/cert issues caught").toBeGreaterThanOrEqual(1);
    expect(metrics.auditTimeSaved.sampleSize, "audit time saved").toBeGreaterThan(0);

    const pilotToPaid = await getPilotToPaidIntent(admin);
    expect(pilotToPaid.sampleSize, "pilot-to-paid intent").toBeGreaterThan(0);

    const pmf = await getPmfSurveyScore(admin);
    expect(pmf.sampleSize, "PMF survey score").toBeGreaterThan(0);

    // Portfolio kill-signal helper is at least callable and well-shaped —
    // not asserting a specific verdict, since other tests' leftover orgs
    // in a shared test DB would make an exact percentage flaky.
    const portfolio = await getTimeToFirstValuePortfolioKillSignal(admin);
    expect(portfolio.orgCount, "time-to-first-value portfolio kill signal").toBeGreaterThan(0);
  });
});
