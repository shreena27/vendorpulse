import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { findMsmeEvidenceGapsForOrg } from "./findMsmeEvidenceGaps";
import { buildCheckEvidenceEvents } from "@/lib/verification/changeDetector";
import { logEvents } from "@/lib/evidence/logEvent";

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
 * Regression test for the 2026-08-12 bug (Vishwakarma Tooling Industries
 * showing "No record" in the Clause 22 export despite a real, seeded Lapsed
 * status): a `verification_checks` row inserted directly, bypassing Chunk
 * 4.1's evidence_log write, is exactly what findMsmeEvidenceGapsForOrg
 * exists to catch. Proves both that the checker flags the bug scenario AND
 * that it doesn't false-positive on the correct (evidence-logged) path —
 * scripts/seed-demo-data.ts now always takes that correct path.
 *
 * Prerequisite: migrations 0001-0009 applied, Supabase "Confirm email" off.
 */
describe.skipIf(!hasEnv)("findMsmeEvidenceGapsForOrg (integration)", () => {
  let admin: SupabaseClient<Database>;
  let orgId: string;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function signUp(tag: string) {
    const client = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.evidencegap.${tag}.${Date.now()}.${Math.random()
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

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const a = await signUp("a");
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

  it("flags a vendor whose verification_checks row was inserted without a matching evidence_log write", async () => {
    const vendorId = await seedVendor(orgId, "Bug Repro Vendor", "UDYAM-GJ-02-0056142");

    // Reproduces the exact bug: a direct insert, no logEvents() call.
    const { error } = await admin.from("verification_checks").insert({
      organization_id: orgId,
      vendor_id: vendorId,
      check_type: "msme_udyam",
      status_value: "LAPSED",
      provider: "mock",
      is_change: true,
    });
    expect(error, error?.message).toBeNull();

    const gaps = await findMsmeEvidenceGapsForOrg(admin, orgId);
    expect(gaps.map((g) => g.vendorId)).toContain(vendorId);
  });

  it("does not flag a vendor whose check went through buildCheckEvidenceEvents()/logEvents() (the correct path)", async () => {
    const vendorId = await seedVendor(orgId, "Correct Path Vendor", "UDYAM-MH-03-0028471");

    const { data: check, error } = await admin
      .from("verification_checks")
      .insert({
        organization_id: orgId,
        vendor_id: vendorId,
        check_type: "msme_udyam",
        status_value: "REGISTERED",
        provider: "mock",
        is_change: false,
      })
      .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change")
      .single();
    expect(error, error?.message).toBeNull();
    await logEvents(admin, buildCheckEvidenceEvents([check!]));

    const gaps = await findMsmeEvidenceGapsForOrg(admin, orgId);
    expect(gaps.map((g) => g.vendorId)).not.toContain(vendorId);
  });

  it("does not flag a vendor with no udyam_number, or one that has never been checked", async () => {
    const noUdyamId = await seedVendor(orgId, "No Udyam Vendor", null);
    const uncheckedId = await seedVendor(orgId, "Unchecked Vendor", "UDYAM-DL-04-0011223");

    const gaps = await findMsmeEvidenceGapsForOrg(admin, orgId);
    const gapIds = gaps.map((g) => g.vendorId);
    expect(gapIds).not.toContain(noUdyamId);
    expect(gapIds).not.toContain(uncheckedId);
  });
});
