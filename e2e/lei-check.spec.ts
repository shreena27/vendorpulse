import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 4.3 acceptance: creating a qualifying payment against a lapsed-LEI
 * fixture vendor and running the check produces an alert with the correct
 * trigger_type, visible in the existing alert inbox with LEI-specific nudge
 * copy — the system never blocks the payment, it only ever alerts.
 *
 * Prerequisite: migrations 0001-0012 applied, Supabase "Confirm email" off.
 * Hits the real, free GLEIF API (no mocking) — same known-LAPSED fixture LEI
 * confirmed live during planning as lib/lei/runLeiCheck.integration.test.ts.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const KNOWN_LAPSED_LEI = "335800CO2E555Q1ZEY28";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.lei.${tag}.${stamp}.${rand}@gmail.com`;
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

/** Seeds a vendor with a known-lapsed LEI on file, plus one qualifying
 * (>= ₹50cr, RTGS) pending payment — deterministic, service-role seeding. */
async function seedQualifyingPayment(email: string) {
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
    .insert({ organization_id: orgId, name: "Lapsed LEI Fixture Vendor", lei_number: KNOWN_LAPSED_LEI, source: "excel" })
    .select("id")
    .single();
  if (vErr || !vendor) throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      organization_id: orgId,
      vendor_id: vendor.id,
      amount: "600000000",
      due_date: "2030-01-01",
      payment_method: "rtgs",
      status: "pending",
    })
    .select("id")
    .single();
  if (pErr || !payment) throw new Error(`[seed] payment insert failed: ${pErr?.message}`);

  return { vendorId: vendor.id, paymentId: payment.id };
}

test("creating a qualifying payment against a lapsed-LEI vendor and running the check produces an alert with the correct trigger_type", async ({
  page,
}) => {
  const email = await signUp(page, "lapsed");
  const { paymentId } = await seedQualifyingPayment(email);

  const res = await page.request.post(`/api/payments/${paymentId}/lei-check`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe("lapsed");
  expect(body.alertAction).toBe("created");

  await page.goto("/alerts");

  const card = page.getByRole("listitem").filter({ hasText: "Lapsed LEI Fixture Vendor" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Lapsed LEI Fixture Vendor's LEI just lapsed."),
  ).toBeVisible();
  await expect(card.getByText("1 pending payment totals ₹60.0Cr.")).toBeVisible();
});
