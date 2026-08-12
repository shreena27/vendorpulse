import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/types";

/**
 * PRD §8 story 6 — Alert decision logged. When a finance head resolves an
 * alert, that decision is written to the tamper-proof evidence log, not
 * just reflected in the UI. Resolving the same alert twice must be
 * rejected (409), and the second attempt must never produce a second
 * evidence_log entry.
 *
 * Prerequisite: migrations 0001-0009 applied, Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow6.${tag}.${stamp}.${rand}@gmail.com`;
}

async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vendors$/);
  return email;
}

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedAlert(email: string, vendorName: string) {
  const admin = adminClient();
  const { data: userRow, error: uErr } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (uErr || !userRow) throw new Error(`[seed] user lookup failed: ${uErr?.message} (email ${email})`);
  const orgId = userRow.organization_id;

  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({ organization_id: orgId, name: vendorName, source: "excel" })
    .select("id")
    .single();
  if (vErr || !vendor) throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);

  const { data: check, error: cErr } = await admin
    .from("verification_checks")
    .insert({
      organization_id: orgId,
      vendor_id: vendor.id,
      check_type: "gst",
      status_value: "INACTIVE",
      provider: "mock",
      is_change: true,
    })
    .select("id")
    .single();
  if (cErr || !check) throw new Error(`[seed] check insert failed: ${cErr?.message}`);

  const { data: alert, error: aErr } = await admin
    .from("alerts")
    .insert({
      organization_id: orgId,
      vendor_id: vendor.id,
      trigger_type: "gst_change",
      source_check_id: check.id,
      payment_impact_amount: "0",
      status: "open",
    })
    .select("id")
    .single();
  if (aErr || !alert) throw new Error(`[seed] alert insert failed: ${aErr?.message}`);

  return { admin, alertId: alert.id };
}

test("resolving an alert writes a matching evidence_log entry", async ({ page }) => {
  const email = await signUp(page, "logged");
  const { admin, alertId } = await seedAlert(email, "Flow Six Logged Vendor");

  await page.goto("/alerts");
  const card = page.getByRole("listitem").filter({ hasText: "Flow Six Logged Vendor" });
  await card.getByRole("button", { name: "Hold" }).click();
  await expect(card.getByText(/You held these payments/)).toBeVisible();

  const { data: events, error } = await admin
    .from("evidence_log")
    .select("event_type, entity_id, payload")
    .eq("entity_type", "alerts")
    .eq("entity_id", alertId)
    .eq("event_type", "alert_resolved");
  expect(error).toBeNull();
  expect(events).toHaveLength(1);
  expect((events![0].payload as { action: string }).action).toBe("hold");
});

test("acting on an already-resolved alert is rejected with 409, and no second evidence_log entry appears", async ({ page }) => {
  const email = await signUp(page, "double");
  const { admin, alertId } = await seedAlert(email, "Flow Six Double Action Vendor");

  const first = await page.request.post(`/api/alerts/${alertId}/action`, {
    data: { action: "hold" },
  });
  expect(first.ok()).toBe(true);

  const second = await page.request.post(`/api/alerts/${alertId}/action`, {
    data: { action: "reviewed" },
  });
  expect(second.status()).toBe(409);
  const body = await second.json();
  expect(body.error).toMatch(/already been resolved/i);

  const { count } = await admin
    .from("evidence_log")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "alerts")
    .eq("entity_id", alertId)
    .eq("event_type", "alert_resolved");
  expect(count).toBe(1);
});
