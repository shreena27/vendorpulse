import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/types";

/**
 * PRD §8 story 4 — LEI alert before a large payment. A qualifying (>=₹50cr,
 * RTGS/NEFT) payment against a vendor with a lapsed LEI produces an alert
 * before the payment goes out — but the check never blocks the payment.
 * Below the ₹50cr threshold, no check runs at all. A vendor with no LEI on
 * file is treated as a real risk signal (not_on_record), not silently
 * skipped.
 *
 * Prerequisite: migrations 0001-0012 applied, Supabase "Confirm email" off.
 * The lapsed-LEI case hits the real, free GLEIF API against the same
 * known-lapsed fixture LEI lib/lei/runLeiCheck.integration.test.ts uses.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";
const KNOWN_LAPSED_LEI = "335800CO2E555Q1ZEY28";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow4.${tag}.${stamp}.${rand}@gmail.com`;
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

async function seedPayment(
  email: string,
  vendorName: string,
  leiNumber: string | null,
  amount: string,
  paymentMethod: "rtgs" | "neft",
) {
  const admin = adminClient();
  const { data: userRow, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !userRow) throw new Error(`[seed] user lookup failed: ${error?.message} (email ${email})`);
  const orgId = userRow.organization_id;

  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({ organization_id: orgId, name: vendorName, lei_number: leiNumber, source: "excel" })
    .select("id")
    .single();
  if (vErr || !vendor) throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      organization_id: orgId,
      vendor_id: vendor.id,
      amount,
      due_date: "2030-01-01",
      payment_method: paymentMethod,
      status: "pending",
    })
    .select("id")
    .single();
  if (pErr || !payment) throw new Error(`[seed] payment insert failed: ${pErr?.message}`);

  return { admin, vendorId: vendor.id, paymentId: payment.id };
}

test("a qualifying payment against a lapsed-LEI vendor creates an alert without blocking the payment", async ({ page }) => {
  const email = await signUp(page, "lapsed");
  const { paymentId } = await seedPayment(
    email,
    "Flow Four Lapsed Vendor",
    KNOWN_LAPSED_LEI,
    "600000000", // ₹60cr — qualifies
    "rtgs",
  );

  const res = await page.request.post(`/api/payments/${paymentId}/lei-check`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe("lapsed");
  expect(body.alertAction).toBe("created");

  await page.goto("/alerts");
  const card = page.getByRole("listitem").filter({ hasText: "Flow Four Lapsed Vendor" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Flow Four Lapsed Vendor's LEI just lapsed."),
  ).toBeVisible();
});

test("a below-threshold payment never triggers a check at all", async ({ page }) => {
  const email = await signUp(page, "below");
  const { admin, paymentId } = await seedPayment(
    email,
    "Flow Four Below Threshold Vendor",
    KNOWN_LAPSED_LEI,
    "100000000", // ₹10cr — below the ₹50cr threshold
    "rtgs",
  );

  const res = await page.request.post(`/api/payments/${paymentId}/lei-check`);
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/does not meet the LEI check threshold/i);

  const { count } = await admin
    .from("lei_checks")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);
  expect(count).toBe(0);
});

test("a vendor with no LEI on file is flagged not_on_record, not silently skipped", async ({ page }) => {
  const email = await signUp(page, "missing");
  const { paymentId } = await seedPayment(
    email,
    "Flow Four No LEI Vendor",
    null,
    "550000000", // ₹55cr — qualifies
    "neft",
  );

  const res = await page.request.post(`/api/payments/${paymentId}/lei-check`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe("not_on_record");
  expect(body.alertAction).toBe("created");

  await page.goto("/alerts");
  const card = page.getByRole("listitem").filter({ hasText: "Flow Four No LEI Vendor" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Flow Four No LEI Vendor's LEI just has no LEI on record."),
  ).toBeVisible();
});
