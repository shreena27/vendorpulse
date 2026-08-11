import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 4.2 acceptance: the Clause 22 / Form 3CD export, end to end.
 *
 * 1. CSV — full content assertion: the downloaded file contains the
 *    expected vendor/GSTIN/due date/amount/MSME status.
 * 2. PDF — download succeeds with the correct filename/content-type only
 *    (no PDF text-content parsing; no such library is added).
 * 3. Role gate — a non-privileged role gets 403 from the API.
 * 4. An empty range still downloads a valid (header-only) CSV.
 *
 * Prerequisite: migrations 0001-0010 applied and Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.export.${tag}.${stamp}.${rand}@gmail.com`;
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

/** Seed a vendor, one msme_udyam evidence_log check, and one payment due in
 * range — the minimal fixture the export needs. Returns everything a test
 * might assert on. */
async function seedExportFixture(email: string) {
  const admin = adminClient();
  const { data: userRow, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !userRow) {
    throw new Error(`[seed] user lookup failed: ${error?.message} (email ${email})`);
  }
  const orgId = userRow.organization_id;

  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({
      organization_id: orgId,
      name: "Evidence Export Vendor",
      gstin: "27ABCDE1234F1Z5",
      udyam_number: "UDYAM-MH-01-2000001",
      source: "excel",
    })
    .select("id")
    .single();
  if (vErr || !vendor) throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);
  const vendorId = vendor.id;

  const { error: evErr } = await admin.from("evidence_log").insert({
    organization_id: orgId,
    vendor_id: vendorId,
    event_type: "verification_check",
    entity_type: "verification_checks",
    entity_id: vendorId, // no FK on entity_id, so any uuid is valid here
    payload: { checkType: "msme_udyam", statusValue: "REGISTERED", provider: "mock", isChange: false },
    created_at: "2026-05-01T00:00:00.000Z",
  });
  if (evErr) throw new Error(`[seed] evidence_log insert failed: ${evErr.message}`);

  const { error: pErr } = await admin.from("payments").insert({
    organization_id: orgId,
    vendor_id: vendorId,
    amount: "45000",
    due_date: "2026-06-15",
    payment_method: "neft",
    status: "pending",
  });
  if (pErr) throw new Error(`[seed] payment insert failed: ${pErr.message}`);

  return { admin, orgId, vendorId };
}

async function fillRange(page: Page, from: string, to: string) {
  // exact: true avoids a substring collision with Next.js's dev-mode
  // toolbar, which renders a button labeled "Open Next.js Dev Tools" —
  // "To" is a substring of "...Dev Tools", so a non-exact getByLabel("To")
  // matches both elements and throws a strict-mode violation.
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
}

test("CSV export contains the expected vendor, due date, amount, and MSME status", async ({ page }) => {
  const email = await signUp(page, "csv");
  await seedExportFixture(email);

  await page.goto("/evidence/export");
  await fillRange(page, "2026-06-01", "2026-06-30");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = readFileSync(path!, "utf8");

  expect(text).toContain("Evidence Export Vendor");
  expect(text).toContain("27ABCDE1234F1Z5");
  expect(text).toContain("2026-06-15");
  expect(text).toContain("45000.00");
  expect(text).toContain("Registered");
});

test("PDF export downloads with the correct filename", async ({ page }) => {
  const email = await signUp(page, "pdf");
  await seedExportFixture(email);

  await page.goto("/evidence/export");
  await fillRange(page, "2026-06-01", "2026-06-30");
  await page.getByLabel("PDF").check();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("evidence-export-2026-06-01-to-2026-06-30.pdf");
});

test("a non-privileged role is rejected with 403", async ({ page }) => {
  const email = await signUp(page, "gate");
  const { admin } = await seedExportFixture(email);

  const { error } = await admin.from("users").update({ role: "ops_lead" }).eq("email", email);
  expect(error, error?.message).toBeNull();

  const res = await page.request.get(
    "/api/evidence/export?from=2026-06-01&to=2026-06-30&format=csv",
  );
  expect(res.status()).toBe(403);
});

test("an empty range still downloads a valid, header-only CSV", async ({ page }) => {
  const email = await signUp(page, "empty");
  await seedExportFixture(email);

  await page.goto("/evidence/export");
  // A range with no payments due in it — the fixture's payment is due 2026-06-15.
  await fillRange(page, "2020-01-01", "2020-01-31");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = readFileSync(path!, "utf8");
  expect(text).toContain("Payment ID");
  expect(text).not.toContain("Evidence Export Vendor");
});
