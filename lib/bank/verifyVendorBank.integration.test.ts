import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { verifyVendorBank } from "./verifyVendorBank";
import { createMockAdapter, MOCK_ACCOUNT_PARTIAL_MATCH, MOCK_IFSC } from "@/lib/providers/bank/mockAdapter";

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
 * Chunk 2.1 acceptance (integration): a bank check writes exactly one
 * bank_verifications row with a masked account number, the RAW account
 * number is never persisted anywhere, and status maps correctly for the
 * exact/partial mock fixtures.
 *
 * Prerequisite: migration 0004 applied and Supabase "Confirm email" off.
 * Uses the mock adapter, so no external API is called. `supabase` (the
 * signed-up user's own client, not the admin client) is the caller for
 * verifyVendorBank — record_bank_verification() is SECURITY DEFINER and
 * resolves the org via auth.uid(), so it must be called with a real user
 * session, exactly as the route handlers do.
 */
describe.skipIf(!hasEnv)("verifyVendorBank (integration)", () => {
  let admin: SupabaseClient<Database>;
  let supabase: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;

  async function seedVendor(name: string): Promise<string> {
    const { data, error } = await admin
      .from("vendors")
      .insert({ organization_id: orgId, name, source: "excel" })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id;
  }

  beforeAll(async () => {
    supabase = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.bank.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await supabase.auth.signUp({
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
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    // Deleting vendors cascades their bank_verifications; deleting the org
    // cascades its users. Then remove the auth user.
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("writes exactly one masked bank_verifications row and never persists the raw account number", async () => {
    const RAW_ACCOUNT_NUMBER = "918273645500"; // literal test account number
    const vendorId = await seedVendor("Integration Test Vendor");

    const summary = await verifyVendorBank(supabase, createMockAdapter(), {
      vendorId,
      vendorName: "Integration Test Vendor",
      accountNumber: RAW_ACCOUNT_NUMBER,
      ifsc: MOCK_IFSC,
    });

    expect(summary.accountNumberMasked).toBe(`****${RAW_ACCOUNT_NUMBER.slice(-4)}`);

    const { data: rows, error } = await admin
      .from("bank_verifications")
      .select("*")
      .eq("vendor_id", vendorId);
    expect(error, error?.message).toBeNull();
    expect(rows).toHaveLength(1);

    const row = rows![0];
    expect(row.account_number_masked).toBe(`****${RAW_ACCOUNT_NUMBER.slice(-4)}`);
    expect(row.account_number_masked).not.toContain(RAW_ACCOUNT_NUMBER);

    // The literal acceptance check: grep the full DB row for the raw test
    // account number and assert it is absent, anywhere in the row.
    const serializedRow = JSON.stringify(row);
    expect(serializedRow).not.toContain(RAW_ACCOUNT_NUMBER);
  });

  it("maps an exact-match fixture to vendors.current_bank_status = 'verified'", async () => {
    const vendorId = await seedVendor("Exact Match Vendor");
    // The exact-match fixture echoes the vendor's own name as the holder
    // name, so any vendor name works — no coincidental string needed.
    const { MOCK_ACCOUNT_EXACT_MATCH } = await import("@/lib/providers/bank/mockAdapter");

    await verifyVendorBank(supabase, createMockAdapter(), {
      vendorId,
      vendorName: "Exact Match Vendor",
      accountNumber: MOCK_ACCOUNT_EXACT_MATCH,
      ifsc: MOCK_IFSC,
    });

    const { data: vendor } = await admin
      .from("vendors")
      .select("current_bank_status")
      .eq("id", vendorId)
      .single();
    expect(vendor!.current_bank_status).toBe("verified");
  });

  it("maps a partial-match fixture to vendors.current_bank_status = 'manual_review'", async () => {
    const vendorId = await seedVendor("Partial Match Vendor");

    await verifyVendorBank(supabase, createMockAdapter(), {
      vendorId,
      vendorName: "Partial Match Vendor",
      accountNumber: MOCK_ACCOUNT_PARTIAL_MATCH,
      ifsc: MOCK_IFSC,
    });

    const { data: vendor } = await admin
      .from("vendors")
      .select("current_bank_status")
      .eq("id", vendorId)
      .single();
    expect(vendor!.current_bank_status).toBe("manual_review");
  });
});
