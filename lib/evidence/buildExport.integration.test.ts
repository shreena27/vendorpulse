import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { buildExport } from "./buildExport";

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
 * Chunk 4.2 acceptance (integration): the "time travel" scenario — the
 * literal reason this export exists. A vendor's MSME status changes AFTER
 * a payment's due date; exporting a past range must still show the status
 * that was true back then, never the newer one, even though the newer
 * event is the vendor's current live status.
 *
 * Prerequisite: migrations 0001-0010 applied, Supabase "Confirm email" off.
 */
describe.skipIf(!hasEnv)("buildExport (integration)", () => {
  let admin: SupabaseClient<Database>;
  let user: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;

  async function signUp(tag: string) {
    const client = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.export.${tag}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await client.auth.signUp({ email, password: "test-password-123" });
    expect(error, error?.message).toBeNull();
    return { client, userId: data.user!.id };
  }

  async function orgIdFor(uid: string): Promise<string> {
    const { data } = await admin.from("users").select("organization_id").eq("id", uid).single();
    return data!.organization_id;
  }

  async function seedVendor(org: string, name: string, udyamNumber: string | null) {
    const { data, error } = await admin
      .from("vendors")
      .insert({ organization_id: org, name, udyam_number: udyamNumber, source: "excel" })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id as string;
  }

  async function seedEvidence(org: string, vendorId: string, statusValue: string, createdAt: string) {
    const { error } = await admin.from("evidence_log").insert({
      organization_id: org,
      vendor_id: vendorId,
      event_type: "verification_check",
      entity_type: "verification_checks",
      entity_id: vendorId, // no FK on entity_id, so any uuid is valid here
      payload: { checkType: "msme_udyam", statusValue, provider: "mock", isChange: false },
      created_at: createdAt,
    });
    expect(error, error?.message).toBeNull();
  }

  async function seedPayment(org: string, vendorId: string, dueDate: string, amount = "10000") {
    const { data, error } = await admin
      .from("payments")
      .insert({ organization_id: org, vendor_id: vendorId, amount, due_date: dueDate, payment_method: "neft", status: "pending" })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id as string;
  }

  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const a = await signUp("a");
    user = a.client;
    userId = a.userId;
    userIds.push(a.userId);
    orgId = await orgIdFor(a.userId);
    orgIds.push(orgId);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const org of orgIds) {
      await admin.from("vendors").delete().eq("organization_id", org);
      await admin.from("organizations").delete().eq("id", org);
    }
    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid);
    }
  });

  it("shows the OLD status for a past-due payment even after the vendor's status has since changed", async () => {
    const vendorId = await seedVendor(orgId, "Time Travel Vendor", "UDYAM-MH-01-1000001");

    // The status as it was back in January.
    await seedEvidence(orgId, vendorId, "REGISTERED", "2024-01-01T00:00:00.000Z");
    const p1 = await seedPayment(orgId, vendorId, "2024-01-15");

    // The vendor's status changes AFTER that — this must never leak backward.
    await seedEvidence(orgId, vendorId, "LAPSED", "2024-02-10T00:00:00.000Z");

    const janExport = await buildExport(admin, { from: "2024-01-01", to: "2024-01-31" });
    const janRow = janExport.find((r) => r.paymentId === p1);
    expect(janRow).toBeDefined();
    // checkedAt is compared via Date normalization, not raw string equality:
    // PostgREST returns created_at as "...+00:00" (Postgres's own textual
    // form), not the "...Z" form this test wrote — see buildExport.ts's
    // resolveMsmeStatusAsOf comment for why plain <= comparison still works.
    expect(janRow!.msmeStatus.kind).toBe("checked");
    if (janRow!.msmeStatus.kind === "checked") {
      expect(janRow!.msmeStatus.statusValue).toBe("REGISTERED");
      expect(new Date(janRow!.msmeStatus.checkedAt).toISOString()).toBe("2024-01-01T00:00:00.000Z");
    }

    // A payment due AFTER the change resolves the new status — proving this
    // is genuine per-payment reconstruction, not "latest always wins".
    const p2 = await seedPayment(orgId, vendorId, "2024-02-20");
    const febExport = await buildExport(admin, { from: "2024-02-01", to: "2024-02-28" });
    const febRow = febExport.find((r) => r.paymentId === p2);
    expect(febRow).toBeDefined();
    expect(febRow!.msmeStatus.kind).toBe("checked");
    if (febRow!.msmeStatus.kind === "checked") {
      expect(febRow!.msmeStatus.statusValue).toBe("LAPSED");
      expect(new Date(febRow!.msmeStatus.checkedAt).toISOString()).toBe("2024-02-10T00:00:00.000Z");
    }
  });

  it("returns no_record for a payment due before any evidence exists for that vendor", async () => {
    const vendorId = await seedVendor(orgId, "No Record Vendor", "UDYAM-MH-01-1000002");
    await seedEvidence(orgId, vendorId, "REGISTERED", "2024-06-01T00:00:00.000Z");
    const paymentId = await seedPayment(orgId, vendorId, "2024-03-01");

    const rows = await buildExport(admin, { from: "2024-03-01", to: "2024-03-31" });
    const row = rows.find((r) => r.paymentId === paymentId);
    expect(row).toBeDefined();
    expect(row!.msmeStatus).toEqual({ kind: "no_record" });
  });

  it("returns not_applicable for a vendor with no udyam_number", async () => {
    const vendorId = await seedVendor(orgId, "No Udyam Vendor", null);
    const paymentId = await seedPayment(orgId, vendorId, "2024-04-01");

    const rows = await buildExport(admin, { from: "2024-04-01", to: "2024-04-30" });
    const row = rows.find((r) => r.paymentId === paymentId);
    expect(row).toBeDefined();
    expect(row!.msmeStatus).toEqual({ kind: "not_applicable" });
  });

  it("scopes to the caller's own org via RLS when called with the signed-in session client", async () => {
    const b = await signUp("b");
    userIds.push(b.userId);
    const orgB = await orgIdFor(b.userId);
    orgIds.push(orgB);

    const vendorA = await seedVendor(orgId, "Org A Vendor", "UDYAM-MH-01-1000003");
    const vendorB = await seedVendor(orgB, "Org B Vendor", "UDYAM-MH-01-1000004");
    await seedEvidence(orgId, vendorA, "REGISTERED", "2024-05-01T00:00:00.000Z");
    await seedEvidence(orgB, vendorB, "REGISTERED", "2024-05-01T00:00:00.000Z");
    const paymentA = await seedPayment(orgId, vendorA, "2024-05-15");
    await seedPayment(orgB, vendorB, "2024-05-15");

    // `user` is org A's signed-in session client — RLS must scope this,
    // not any manual organization_id filter in buildExport itself.
    const rows = await buildExport(user, { from: "2024-05-01", to: "2024-05-31" });
    expect(rows.map((r) => r.paymentId)).toContain(paymentA);
    expect(rows.every((r) => r.vendorId === vendorA)).toBe(true);
  });
});
