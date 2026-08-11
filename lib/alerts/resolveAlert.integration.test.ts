import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { resolveAlert } from "./resolveAlert";

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
 * Chunk 3.3 acceptance (integration): resolve_alert() is atomic. The first
 * action on an alert succeeds and sets status/resolved_by/resolved_at; a
 * second action on the SAME alert — regardless of which action — returns
 * already_resolved and leaves the first resolution's fields untouched. Also
 * covers a different org's alert (not_found, RLS-scoped) and an unknown id.
 *
 * Prerequisite: migrations 0003, 0006, 0007, 0008 applied, Supabase
 * "Confirm email" off.
 */
describe.skipIf(!hasEnv)("resolveAlert (integration)", () => {
  let admin: SupabaseClient<Database>;
  let userA: SupabaseClient<Database>;
  let userB: SupabaseClient<Database>;
  let userIdA: string;
  let userIdB: string;
  let orgA: string;
  let orgB: string;

  async function signUp(tag: string) {
    const client = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.resolve.${tag}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await client.auth.signUp({ email, password: "test-password-123" });
    expect(error, error?.message).toBeNull();
    return { client, userId: data.user!.id };
  }

  async function seedAlertInOrg(orgId: string): Promise<string> {
    const { data: vendor, error: vErr } = await admin
      .from("vendors")
      .insert({ organization_id: orgId, name: "Resolve Test Vendor", source: "excel" })
      .select("id")
      .single();
    expect(vErr, vErr?.message).toBeNull();

    const { data: check, error: cErr } = await admin
      .from("verification_checks")
      .insert({
        organization_id: orgId,
        vendor_id: vendor!.id,
        check_type: "gst",
        status_value: "CANCELLED",
        provider: "mock",
        is_change: true,
      })
      .select("id")
      .single();
    expect(cErr, cErr?.message).toBeNull();

    const { data: alert, error: aErr } = await admin
      .from("alerts")
      .insert({
        organization_id: orgId,
        vendor_id: vendor!.id,
        trigger_type: "gst_change",
        source_check_id: check!.id,
        payment_impact_amount: "50000",
        status: "open",
      })
      .select("id")
      .single();
    expect(aErr, aErr?.message).toBeNull();
    return alert!.id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const a = await signUp("a");
    userA = a.client;
    userIdA = a.userId;
    const b = await signUp("b");
    userB = b.client;
    userIdB = b.userId;

    const { data: userRowA } = await admin
      .from("users")
      .select("organization_id")
      .eq("id", userIdA)
      .single();
    orgA = userRowA!.organization_id;
    const { data: userRowB } = await admin
      .from("users")
      .select("organization_id")
      .eq("id", userIdB)
      .single();
    orgB = userRowB!.organization_id;
  });

  afterAll(async () => {
    if (!admin) return;
    for (const orgId of [orgA, orgB]) {
      if (!orgId) continue;
      await admin.from("vendors").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
    }
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("succeeds once, then returns already_resolved on a second call, leaving the first resolution untouched", async () => {
    const alertId = await seedAlertInOrg(orgA);

    const first = await resolveAlert(userA, alertId, "hold");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.alert.status).toBe("hold");
    expect(first.alert.resolved_by).toBe(userIdA);
    expect(first.alert.resolved_at).not.toBeNull();

    const second = await resolveAlert(userA, alertId, "reviewed");
    expect(second).toEqual({ ok: false, reason: "already_resolved" });

    const { data: row } = await admin
      .from("alerts")
      .select("status, resolved_by, resolved_at")
      .eq("id", alertId)
      .single();
    expect(row!.status).toBe("hold");
    expect(row!.resolved_by).toBe(userIdA);
    expect(row!.resolved_at).toBe(first.alert.resolved_at);
  });

  it("returns not_found for an alert belonging to a different organization", async () => {
    const alertId = await seedAlertInOrg(orgA);
    const result = await resolveAlert(userB, alertId, "hold");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for an unknown alert id", async () => {
    const result = await resolveAlert(userA, "00000000-0000-0000-0000-000000000000", "hold");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns invalid_action for an action outside hold/reviewed/escalate", async () => {
    const alertId = await seedAlertInOrg(orgA);
    const result = await resolveAlert(userA, alertId, "delete");
    expect(result).toEqual({ ok: false, reason: "invalid_action" });
  });
});
