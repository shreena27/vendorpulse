import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/types";

/**
 * PRD §8 story 3 — Vendor status recall. A finance head opens the app and
 * sees each vendor's current status at a glance, plus the full check
 * history for one vendor. A vendor that hasn't been checked yet must show a
 * clear "Pending" state, never a blank page.
 *
 * Prerequisite: migrations applied, Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow3.${tag}.${stamp}.${rand}@gmail.com`;
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

test("the vendor list recalls current status at a glance, and the detail view shows full history", async ({ page }) => {
  const email = await signUp(page, "recall");
  const admin = adminClient();
  const { data: userRow, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !userRow) throw new Error(`[seed] user lookup failed: ${error?.message}`);
  const orgId = userRow.organization_id;

  const { data: vendors, error: vErr } = await admin
    .from("vendors")
    .insert([
      {
        organization_id: orgId,
        name: "Flow Three Checked Vendor",
        gstin: "27ABCDE9001F1Z5",
        udyam_number: null,
        current_gst_status: "unknown",
        current_msme_status: "unknown",
        source: "excel",
      },
      {
        organization_id: orgId,
        name: "Flow Three Unchecked Vendor",
        gstin: "27ABCDE9002F1Z5",
        udyam_number: null,
        current_gst_status: "unknown",
        current_msme_status: "unknown",
        source: "excel",
      },
    ])
    .select("id, name");
  if (vErr || !vendors || vendors.length !== 2) {
    throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);
  }
  const checkedId = vendors.find((v) => v.name === "Flow Three Checked Vendor")!.id;
  const uncheckedId = vendors.find((v) => v.name === "Flow Three Unchecked Vendor")!.id;

  const t1 = new Date(Date.now() - 60_000).toISOString();
  const t2 = new Date().toISOString();
  const { error: checksErr } = await admin.from("verification_checks").insert([
    {
      organization_id: orgId,
      vendor_id: checkedId,
      check_type: "gst",
      status_value: "ACTIVE",
      provider: "mock",
      is_change: false,
      checked_at: t1,
    },
    {
      organization_id: orgId,
      vendor_id: checkedId,
      check_type: "gst",
      status_value: "CANCELLED",
      provider: "mock",
      is_change: true,
      checked_at: t2,
    },
  ]);
  if (checksErr) throw new Error(`[seed] checks insert failed: ${checksErr.message}`);
  await admin.from("vendors").update({ current_gst_status: "cancelled" }).eq("id", checkedId);

  await page.goto("/vendors");
  const checkedRow = page.getByRole("row", { name: /Flow Three Checked Vendor/ });
  await expect(checkedRow.getByText("Cancelled")).toBeVisible();
  await expect(checkedRow.getByText("Changed")).toBeVisible();

  const uncheckedRow = page.getByRole("row", { name: /Flow Three Unchecked Vendor/ });
  await expect(uncheckedRow.getByText("Pending")).toBeVisible();

  await page.goto(`/vendors/${checkedId}`);
  const entries = page.getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("ACTIVE"); // earlier
  await expect(entries.nth(1)).toContainText("CANCELLED"); // later
  await expect(entries.nth(1).getByText("Changed")).toBeVisible();

  await page.goto(`/vendors/${uncheckedId}`);
  await expect(page.getByText(/No checks yet/i)).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});
