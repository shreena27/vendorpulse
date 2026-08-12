import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runLeiCheckForPayment } from "./runLeiCheck";
import { describeStatusChange } from "@/lib/alerts/nudgeCopy";

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

// Confirmed live during planning (GET https://api.gleif.org/api/v1/lei-records/{lei}):
// Reliance Plastic Industries, entity.status ACTIVE, registration.status LAPSED.
// If GLEIF's registry has since changed this record, re-verify live rather
// than guessing a replacement (the Chunk 1.2 lesson).
const KNOWN_LAPSED_LEI = "335800CO2E555Q1ZEY28";

/**
 * Chunk 4.3 acceptance (integration, live GLEIF): the LEI check end to end.
 * GLEIF is free/unauthenticated, so this hits the real API — same spirit as
 * the Sandbox GST integration coverage.
 *
 * Prerequisite: migrations 0001-0012 applied, Supabase "Confirm email" off.
 */
describe.skipIf(!hasEnv)("runLeiCheck (integration)", () => {
  let admin: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;

  async function seedVendor(name: string, leiNumber: string | null) {
    const { data, error } = await admin
      .from("vendors")
      .insert({ organization_id: orgId, name, lei_number: leiNumber, source: "excel" })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id as string;
  }

  async function seedPayment(vendorId: string, amount: string, paymentMethod: "rtgs" | "neft" | "other") {
    const { data, error } = await admin
      .from("payments")
      .insert({
        organization_id: orgId,
        vendor_id: vendorId,
        amount,
        due_date: "2030-01-01",
        payment_method: paymentMethod,
        status: "pending",
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id as string;
  }

  beforeAll(async () => {
    const anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.lei.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`;
    const { data, error } = await anon.auth.signUp({ email, password: "test-password-123" });
    expect(error, error?.message).toBeNull();
    userId = data.user!.id;

    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRow } = await admin.from("users").select("organization_id").eq("id", userId).single();
    orgId = userRow!.organization_id;
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("a ₹60cr RTGS payment to a vendor with a lapsed LEI creates a lei_checks row and an alert", async () => {
    const vendorId = await seedVendor("Lapsed LEI Vendor", KNOWN_LAPSED_LEI);
    const paymentId = await seedPayment(vendorId, "600000000", "rtgs");

    const result = await runLeiCheckForPayment(admin, {
      paymentId,
      organizationId: orgId,
      vendorId,
      vendorLeiNumber: KNOWN_LAPSED_LEI,
      amount: 600_000_000,
      paymentMethod: "rtgs",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("lapsed");
    expect(result.alertAction).toBe("created");

    const { data: leiCheckRow } = await admin
      .from("lei_checks")
      .select("*")
      .eq("id", result.leiCheckId)
      .single();
    expect(leiCheckRow).toMatchObject({ vendor_id: vendorId, payment_id: paymentId, status: "lapsed" });

    const { data: alertRow } = await admin
      .from("alerts")
      .select("*")
      .eq("vendor_id", vendorId)
      .eq("trigger_type", "lei_check")
      .single();
    expect(alertRow).toMatchObject({ source_check_id: result.leiCheckId, status: "open" });

    // Bugfix (2026-08-12): lei_checks used to get a row while evidence_log
    // got nothing — the same bug class Clause 22's MSME column hit. This is
    // the literal acceptance check: the export's LEI Status column reads
    // evidence_log exclusively, so a real check must leave a matching row.
    const { data: evidenceRow } = await admin
      .from("evidence_log")
      .select("event_type, entity_type, entity_id, payload")
      .eq("entity_type", "lei_checks")
      .eq("entity_id", result.leiCheckId)
      .single();
    expect(evidenceRow).toMatchObject({
      event_type: "verification_check",
      payload: { checkType: "lei", statusValue: "lapsed", provider: "gleif" },
    });
  });

  it("a ₹10cr payment triggers no LEI check at all (below threshold)", async () => {
    const vendorId = await seedVendor("Below Threshold Vendor", KNOWN_LAPSED_LEI);
    const paymentId = await seedPayment(vendorId, "100000000", "rtgs");

    const result = await runLeiCheckForPayment(admin, {
      paymentId,
      organizationId: orgId,
      vendorId,
      vendorLeiNumber: KNOWN_LAPSED_LEI,
      amount: 100_000_000,
      paymentMethod: "rtgs",
    });

    expect(result).toEqual({ ok: false, reason: "below_threshold" });

    const { data: leiChecks } = await admin.from("lei_checks").select("id").eq("payment_id", paymentId);
    expect(leiChecks ?? []).toHaveLength(0);
  });

  it("a vendor with no LEI on file gets not_on_record, and an alert is still created", async () => {
    const vendorId = await seedVendor("No LEI Vendor", null);
    const paymentId = await seedPayment(vendorId, "600000000", "neft");

    const result = await runLeiCheckForPayment(admin, {
      paymentId,
      organizationId: orgId,
      vendorId,
      vendorLeiNumber: null,
      amount: 600_000_000,
      paymentMethod: "neft",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("not_on_record");
    expect(result.alertAction).toBe("created");

    const { data: leiCheckRow } = await admin
      .from("lei_checks")
      .select("lei_number, status")
      .eq("id", result.leiCheckId)
      .single();
    expect(leiCheckRow).toEqual({ lei_number: null, status: "not_on_record" });
  });

  it("not_on_record and lapsed are distinguishable, both in the DB and in the UI's nudge phrasing", async () => {
    const notOnRecordVendor = await seedVendor("Distinguish A", null);
    const notOnRecordPayment = await seedPayment(notOnRecordVendor, "600000000", "rtgs");
    const notOnRecordResult = await runLeiCheckForPayment(admin, {
      paymentId: notOnRecordPayment,
      organizationId: orgId,
      vendorId: notOnRecordVendor,
      vendorLeiNumber: null,
      amount: 600_000_000,
      paymentMethod: "rtgs",
    });

    const lapsedVendor = await seedVendor("Distinguish B", KNOWN_LAPSED_LEI);
    const lapsedPayment = await seedPayment(lapsedVendor, "600000000", "rtgs");
    const lapsedResult = await runLeiCheckForPayment(admin, {
      paymentId: lapsedPayment,
      organizationId: orgId,
      vendorId: lapsedVendor,
      vendorLeiNumber: KNOWN_LAPSED_LEI,
      amount: 600_000_000,
      paymentMethod: "rtgs",
    });

    expect(notOnRecordResult.ok && notOnRecordResult.status).toBe("not_on_record");
    expect(lapsedResult.ok && lapsedResult.status).toBe("lapsed");
    expect(notOnRecordResult.ok && lapsedResult.ok && notOnRecordResult.status !== lapsedResult.status).toBe(true);

    expect(describeStatusChange("lei_check", "not_on_record")).not.toBe(
      describeStatusChange("lei_check", "lapsed"),
    );
  });

  it("an 'other' payment method never qualifies, however large the amount", async () => {
    const vendorId = await seedVendor("Other Method Vendor", KNOWN_LAPSED_LEI);
    const paymentId = await seedPayment(vendorId, "1000000000", "other");

    const result = await runLeiCheckForPayment(admin, {
      paymentId,
      organizationId: orgId,
      vendorId,
      vendorLeiNumber: KNOWN_LAPSED_LEI,
      amount: 1_000_000_000,
      paymentMethod: "other",
    });

    expect(result).toEqual({ ok: false, reason: "below_threshold" });
  });
});
