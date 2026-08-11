import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runPoll } from "@/lib/verification/pollRunner";
import { mapMsmeStatusToVendor } from "@/lib/verification/changeDetector";
import type { CheckOutcome } from "@/lib/verification/changeDetector";
import { scoreChangeForVendor } from "./impactScorer";

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
 * Chunk 3.1 acceptance (integration): the identical detected change is
 * alert-worthy for a vendor with an open pending payment, and NOT
 * alert-worthy for a vendor with none — and, critically, the
 * verification_checks row itself exists either way. Scoring never suppresses
 * the raw audit trail; it only decides whether an alert would follow.
 *
 * Prerequisite: migrations 0003 (verification_checks) and 0006 (payments)
 * applied, and Supabase "Confirm email" off. Uses the real, already-built
 * runPoll (Chunk 1.4) with a stub adapter, so no external API is called.
 */
describe.skipIf(!hasEnv)("impact scorer (integration)", () => {
  let admin: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;
  let vendorId: string;

  /** A stub adapter call: fixed status for every vendor in the batch. */
  function stub(status: string): (value: string) => Promise<CheckOutcome> {
    return async () => ({ status, provider: "mock", raw: {} });
  }

  const pollConfig = () => ({
    supabase: admin,
    checkType: "msme_udyam" as const,
    vendorField: "udyam_number" as const,
    statusColumn: "current_msme_status" as const,
    providerName: "mock" as const,
    mapStatus: mapMsmeStatusToVendor,
  });

  async function latestCheck(id: string) {
    const { data } = await admin
      .from("verification_checks")
      .select("id, status_value, is_change, checked_at")
      .eq("check_type", "msme_udyam")
      .eq("vendor_id", id)
      .order("checked_at", { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  }

  beforeAll(async () => {
    const anon = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.scorer.${Date.now()}.${Math.random()
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

    const udyam = `UDYAM-MH-01-${String(
      Math.floor(Math.random() * 9_000_000) + 1_000_000,
    ).padStart(7, "0")}`;
    const { data: vendor, error: vErr } = await admin
      .from("vendors")
      .insert({
        organization_id: orgId,
        name: "Impact Scorer Vendor",
        udyam_number: udyam,
        source: "excel",
      })
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

  it("scores the same detected change differently based on an open payment, without ever touching verification_checks", async () => {
    // Baseline poll (no prior check, so not a change), then a second poll
    // with a different status — a genuine is_change = true row.
    await runPoll({ ...pollConfig(), runCheck: stub("REGISTERED") });
    await runPoll({ ...pollConfig(), runCheck: stub("LAPSED") });

    const changedCheck = await latestCheck(vendorId);
    expect(changedCheck).not.toBeNull();
    expect(changedCheck!.is_change).toBe(true);

    // No payment yet: not alert-worthy.
    const beforePayment = await scoreChangeForVendor(admin, {
      vendorId,
      isChange: changedCheck!.is_change,
    });
    expect(beforePayment).toEqual({ alertWorthy: false, reason: "no_open_payment" });

    // The check itself is untouched by scoring either way — query it directly.
    expect(await latestCheck(vendorId)).toEqual(changedCheck);

    // Seed an open (pending) payment for the same vendor.
    const { error: pErr } = await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendorId,
      amount: "100000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    });
    expect(pErr, pErr?.message).toBeNull();

    // Same detected change, now alert-worthy.
    const afterPayment = await scoreChangeForVendor(admin, {
      vendorId,
      isChange: changedCheck!.is_change,
    });
    expect(afterPayment).toEqual({ alertWorthy: true, reason: "open_payment" });

    // Still exactly the same verification_checks row — scoring never wrote,
    // deleted, or otherwise touched it.
    expect(await latestCheck(vendorId)).toEqual(changedCheck);
  });

  it("is alert-worthy via an unfavorable LEI check even with no open pending payment — the literal Chunk 3.1 TODO, now real", async () => {
    const { data: leiVendor, error: vErr } = await admin
      .from("vendors")
      .insert({ organization_id: orgId, name: "LEI Scorer Vendor", source: "excel" })
      .select("id")
      .single();
    expect(vErr, vErr?.message).toBeNull();
    const leiVendorId = leiVendor!.id;

    // A qualifying payment (RTGS, >= LEI_THRESHOLD) — no `pending`-status
    // payment is seeded at all, so the open-payment path alone would say
    // "not alert-worthy".
    const { data: payment, error: pErr } = await admin
      .from("payments")
      .insert({
        organization_id: orgId,
        vendor_id: leiVendorId,
        amount: "600000000",
        due_date: "2030-01-01",
        payment_method: "rtgs",
        status: "paid", // deliberately NOT pending — proves this isn't the open-payment path
      })
      .select("id")
      .single();
    expect(pErr, pErr?.message).toBeNull();

    const { error: lErr } = await admin.from("lei_checks").insert({
      organization_id: orgId,
      vendor_id: leiVendorId,
      payment_id: payment!.id,
      lei_number: "5493003UOETFYRONLG31",
      status: "lapsed",
    });
    expect(lErr, lErr?.message).toBeNull();

    const result = await scoreChangeForVendor(admin, { vendorId: leiVendorId, isChange: true });
    expect(result).toEqual({ alertWorthy: true, reason: "lei_unfavorable" });
  });
});
