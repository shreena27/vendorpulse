import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/types";
import { processChangeAlertsForPipeline } from "../../lib/alerts/processChangeAlerts";

/**
 * PRD §8 story 2 — Same-day GST alert. A GST status change detected today,
 * against a vendor with a payment in flight, reaches the finance head's
 * inbox the same day. The identical change against a vendor with nothing
 * pending must produce NO alert — the system doesn't cry wolf.
 *
 * Unlike e2e/alerts.spec.ts (which pre-seeds a finished `alerts` row to test
 * the inbox UI/resolution flow), this file calls the real alert-creation
 * pipeline (lib/alerts/processChangeAlerts.ts) against seeded
 * verification_checks rows — the one place in the e2e suite that proves the
 * alert-worthy decision itself, not just that the inbox renders a row that
 * already exists.
 *
 * Prerequisite: migrations 0001-0009 applied, Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow2.${tag}.${stamp}.${rand}@gmail.com`;
}

async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function orgIdFor(admin: SupabaseClient<Database>, email: string) {
  const { data, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !data) throw new Error(`[seed] user lookup failed: ${error?.message} (email ${email})`);
  return data.organization_id;
}

/** Seeds a vendor plus one same-day GST change (is_change: true) — the
 * deterministic "a poll just detected this" test hook, same rationale
 * e2e/vendor-dashboard.spec.ts's own comment documents. Optionally seeds
 * one pending payment. */
async function seedDetectedChange(
  admin: SupabaseClient<Database>,
  orgId: string,
  vendorName: string,
  withPayment: boolean,
) {
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

  if (withPayment) {
    const { error: pErr } = await admin.from("payments").insert({
      organization_id: orgId,
      vendor_id: vendor.id,
      amount: "500000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    });
    if (pErr) throw new Error(`[seed] payment insert failed: ${pErr.message}`);
  }

  return { vendorId: vendor.id, checkId: check.id };
}

test("a same-day GST change against a vendor with a pending payment creates an alert the finance head sees", async ({ page }) => {
  const email = await signUp(page, "haspayment");
  const admin = adminClient();
  const orgId = await orgIdFor(admin, email);
  const { vendorId, checkId } = await seedDetectedChange(admin, orgId, "Flow Two Payable Vendor", true);

  const summary = await processChangeAlertsForPipeline(admin, [
    { id: checkId, vendorId, organizationId: orgId, checkType: "gst" },
  ]);
  expect(summary.alertsCreated).toBe(1);
  expect(summary.notAlertWorthy).toBe(0);

  await page.goto("/alerts");
  const card = page.getByRole("listitem").filter({ hasText: "Flow Two Payable Vendor" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Flow Two Payable Vendor's GST registration just went inactive."),
  ).toBeVisible();
  await expect(card.getByText("1 pending payment totals ₹5.0L.")).toBeVisible();
});

test("the identical change against a vendor with no pending payment produces no alert", async ({ page }) => {
  const email = await signUp(page, "nopayment");
  const admin = adminClient();
  const orgId = await orgIdFor(admin, email);
  const { vendorId, checkId } = await seedDetectedChange(admin, orgId, "Flow Two Unpayable Vendor", false);

  const summary = await processChangeAlertsForPipeline(admin, [
    { id: checkId, vendorId, organizationId: orgId, checkType: "gst" },
  ]);
  expect(summary.alertsCreated).toBe(0);
  expect(summary.notAlertWorthy).toBe(1);

  const { count } = await admin
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId);
  expect(count).toBe(0);

  await page.goto("/alerts");
  await expect(page.getByText("Flow Two Unpayable Vendor")).toHaveCount(0);
});
