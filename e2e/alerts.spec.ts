import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 3.3 acceptance: the alert inbox shows the exact PRD §4.5 nudge copy,
 * and clicking "Hold" is a one-tap action that updates the card in place —
 * the system never claims to have held anything itself; it only records the
 * human's decision once they click.
 *
 * Prerequisite: migrations 0003, 0006, 0007, 0008 applied, Supabase
 * "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.alerts.${tag}.${stamp}.${rand}@gmail.com`;
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

/** Seeds a vendor + a GST check + two pending payments (totaling ₹4.1L, the
 * PRD's own example amount) + the alert itself, directly via the service
 * role — deterministic, same style as e2e/vendor-dashboard.spec.ts. */
async function seedAlert(email: string) {
  const admin = adminClient();
  const { data: userRow, error: uErr } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (uErr || !userRow) {
    throw new Error(`[seed] user lookup failed: ${uErr?.message} (email ${email})`);
  }
  const orgId = userRow.organization_id;

  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({ organization_id: orgId, name: "Nudge Test Vendor", source: "excel" })
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

  const { error: pErr } = await admin.from("payments").insert([
    {
      organization_id: orgId,
      vendor_id: vendor.id,
      amount: "250000",
      due_date: "2030-01-01",
      payment_method: "neft",
      status: "pending",
    },
    {
      organization_id: orgId,
      vendor_id: vendor.id,
      amount: "160000",
      due_date: "2030-02-01",
      payment_method: "rtgs",
      status: "pending",
    },
  ]);
  if (pErr) throw new Error(`[seed] payments insert failed: ${pErr.message}`);

  const { error: aErr } = await admin.from("alerts").insert({
    organization_id: orgId,
    vendor_id: vendor.id,
    trigger_type: "gst_change",
    source_check_id: check.id,
    payment_impact_amount: "410000",
    status: "open",
  });
  if (aErr) throw new Error(`[seed] alert insert failed: ${aErr.message}`);
}

test("the inbox shows the exact nudge copy, and clicking Hold updates the card in place", async ({
  page,
}) => {
  const email = await signUp(page, "hold");
  await seedAlert(email);

  await page.goto("/alerts");

  const card = page.getByRole("listitem").filter({ hasText: "Nudge Test Vendor" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Nudge Test Vendor's GST registration just went inactive."),
  ).toBeVisible();
  await expect(card.getByText("2 pending payments total ₹4.1L.")).toBeVisible();
  await expect(card.getByText("Hold them?", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Hold" }).click();

  // Resolved in place — no reload, no page navigation — and phrased as
  // something the person did, not something the system did automatically.
  await expect(card.getByText(/You held these payments/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Hold" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Escalate" })).toHaveCount(0);
});
