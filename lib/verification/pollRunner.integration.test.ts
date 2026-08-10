import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runPoll } from "./pollRunner";
import { mapMsmeStatusToVendor } from "./changeDetector";
import type { CheckOutcome } from "./changeDetector";

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
 * Chunk 1.4 acceptance (integration): the poller writes one verification_checks
 * row per vendor with is_change computed against the prior check, and one
 * adapter failure never aborts the batch.
 *
 * Prerequisite: migration 0003 applied and Supabase "Confirm email" off.
 * Uses the msme_udyam path with a stub adapter, so no external API is called.
 *
 * The poller is global (service role, every org), and the test DB holds vendors
 * from other runs, so every assertion is scoped to THIS test's seeded vendor ids
 * rather than the global summary counts.
 */
describe.skipIf(!hasEnv)("runPoll (integration)", () => {
  let admin: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;

  const config = () => ({
    supabase: admin,
    checkType: "msme_udyam" as const,
    vendorField: "udyam_number" as const,
    statusColumn: "current_msme_status" as const,
    providerName: "mock" as const,
    mapStatus: mapMsmeStatusToVendor,
  });

  /** Seed N vendors with unique Udyam numbers; returns {id, udyam} in order. */
  async function seedVendors(
    count: number,
  ): Promise<{ id: string; udyam_number: string }[]> {
    const base = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    const inputs = Array.from({ length: count }, (_, i) => ({
      organization_id: orgId,
      name: `Vendor ${i + 1}`,
      udyam_number: `UDYAM-MH-01-${String(base + i)
        .padStart(7, "0")
        .slice(-7)}`,
      source: "excel" as const,
    }));
    const { data, error } = await admin
      .from("vendors")
      .insert(inputs)
      .select("id, udyam_number");
    expect(error, error?.message).toBeNull();
    const order = new Map(inputs.map((r, i) => [r.udyam_number, i]));
    return (data ?? [])
      .slice()
      .sort((a, b) => order.get(a.udyam_number!)! - order.get(b.udyam_number!)!)
      .map((v) => ({ id: v.id, udyam_number: v.udyam_number! }));
  }

  /** A stub adapter call: status keyed by udyam number, or throw. */
  function stub(
    statusByUdyam: Map<string, string>,
    throwFor?: Set<string>,
  ): (value: string) => Promise<CheckOutcome> {
    return async (value: string) => {
      if (throwFor?.has(value)) throw new Error("simulated provider failure");
      return {
        status: statusByUdyam.get(value) ?? "REGISTERED",
        provider: "mock",
        raw: { value },
      };
    };
  }

  /** All msme checks for the given vendor ids, oldest first. */
  async function checksFor(vendorIds: string[]) {
    const { data } = await admin
      .from("verification_checks")
      .select("vendor_id, status_value, is_change, checked_at")
      .eq("check_type", "msme_udyam")
      .in("vendor_id", vendorIds)
      .order("checked_at", { ascending: true });
    return data ?? [];
  }

  beforeAll(async () => {
    const anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.poll.${Date.now()}.${Math.random()
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
  });

  afterAll(async () => {
    if (!admin || !orgId) return;
    // Deleting vendors cascades their verification_checks; deleting the org
    // cascades its users. Then remove the auth user.
    await admin.from("vendors").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("flags is_change only on the vendor whose status changed between runs", async () => {
    const seeded = await seedVendors(4);
    const ids = seeded.map((s) => s.id);
    const udyams = seeded.map((s) => s.udyam_number);

    // Run 1: everyone REGISTERED — first checks, so no changes on any seeded row.
    await runPoll({
      ...config(),
      runCheck: stub(new Map(udyams.map((u) => [u, "REGISTERED"]))),
    });
    const afterRun1 = await checksFor(ids);
    expect(afterRun1).toHaveLength(4);
    expect(afterRun1.every((r) => !r.is_change)).toBe(true);

    // Run 2: vendor index 2 flips to LAPSED; others unchanged.
    const second = new Map(udyams.map((u) => [u, "REGISTERED"]));
    second.set(udyams[2], "LAPSED");
    await runPoll({ ...config(), runCheck: stub(second) });

    // Exactly one is_change=true row among the seeded vendors — the changed one.
    const rows = await checksFor(ids);
    const changed = rows.filter((r) => r.is_change);
    expect(changed).toHaveLength(1);
    expect(changed[0].vendor_id).toBe(ids[2]);
    expect(changed[0].status_value).toBe("LAPSED");

    // The vendor's current status was updated to lapsed.
    const { data: vendor } = await admin
      .from("vendors")
      .select("current_msme_status")
      .eq("id", ids[2])
      .single();
    expect(vendor!.current_msme_status).toBe("lapsed");
  });

  it("keeps polling the rest of the batch when one check throws", async () => {
    const seeded = await seedVendors(4);
    const ids = seeded.map((s) => s.id);
    const udyams = seeded.map((s) => s.udyam_number);

    const statuses = new Map(udyams.map((u) => [u, "REGISTERED"]));
    const throwFor = new Set([udyams[1]]); // the second vendor's check throws

    await runPoll({
      ...config(),
      runCheck: stub(statuses, throwFor),
    });

    // All four seeded vendors got a row; the failed one landed at UNKNOWN.
    const rows = await checksFor(ids);
    expect(rows).toHaveLength(4);
    const byVendor = new Map(rows.map((r) => [r.vendor_id, r.status_value]));
    expect(byVendor.get(ids[1])).toBe("UNKNOWN");
    expect(byVendor.get(ids[0])).toBe("REGISTERED");
    expect(byVendor.get(ids[2])).toBe("REGISTERED");
    expect(byVendor.get(ids[3])).toBe("REGISTERED");
  });
});
