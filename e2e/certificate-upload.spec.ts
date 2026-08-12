import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 2.2 acceptance: certificate upload at onboarding.
 *
 * 1. A future expiry date shows "Valid" immediately.
 * 2. A past expiry date shows "Expired" immediately — no scheduled recheck.
 * 3. A disallowed file type (.exe) is rejected with a clear error, and no
 *    object is left behind in Storage.
 *
 * Prerequisite: migration 0005 applied and Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.cert.${tag}.${stamp}.${rand}@gmail.com`;
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

/** Seed a vendor directly via the service-role client (deterministic test hook). */
async function seedVendor(email: string, name: string) {
  const admin = adminClient();
  const { data: userRow, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !userRow) {
    throw new Error(`[seed] user lookup failed: ${error?.message} (email ${email})`);
  }
  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({ organization_id: userRow.organization_id, name, source: "excel" })
    .select("id")
    .single();
  if (vErr || !vendor) {
    throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);
  }
  return { vendorId: vendor.id, orgId: userRow.organization_id, admin };
}

function pdfFile(name: string) {
  return { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e test", "utf8") };
}

function exeFile(name: string) {
  return { name, mimeType: "application/x-msdownload", buffer: Buffer.from("MZ fake exe", "utf8") };
}

test("a certificate with a future expiry date shows Valid immediately", async ({ page }) => {
  const email = await signUp(page, "valid");
  const { vendorId } = await seedVendor(email, "Valid Cert Vendor");

  await page.goto(`/vendors/${vendorId}/certificates`);
  await page.getByLabel("File").setInputFiles(pdfFile("insurance.pdf"));
  await page.getByLabel("Certificate type").fill("Insurance");
  await page.getByLabel("Expiry date").fill("2030-01-01");
  await page.getByRole("button", { name: "Upload certificate" }).click();

  await expect(page.getByText(/^Uploaded Insurance/)).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "Insurance" });
  await expect(row.getByText("Valid", { exact: true })).toBeVisible();
});

test("a certificate with a past expiry date shows Expired immediately, without any scheduled check", async ({
  page,
}) => {
  const email = await signUp(page, "expired");
  const { vendorId } = await seedVendor(email, "Expired Cert Vendor");

  await page.goto(`/vendors/${vendorId}/certificates`);
  await page.getByLabel("File").setInputFiles(pdfFile("safety.pdf"));
  await page.getByLabel("Certificate type").fill("Safety Certificate");
  await page.getByLabel("Expiry date").fill("2020-01-01");
  await page.getByRole("button", { name: "Upload certificate" }).click();

  const row = page.getByRole("listitem").filter({ hasText: "Safety Certificate" });
  await expect(row.getByText("Expired", { exact: true })).toBeVisible();
});

test("a disallowed file type is rejected cleanly, with no orphaned file left in Storage", async ({
  page,
}) => {
  const email = await signUp(page, "rejected");
  const { vendorId, orgId, admin } = await seedVendor(email, "Rejected Cert Vendor");

  await page.goto(`/vendors/${vendorId}/certificates`);
  await page.getByLabel("File").setInputFiles(exeFile("virus.exe"));
  await page.getByLabel("Certificate type").fill("Insurance");
  await page.getByLabel("Expiry date").fill("2030-01-01");
  await page.getByRole("button", { name: "Upload certificate" }).click();

  await expect(page.getByText(/pdf|image|not allowed/i)).toBeVisible();
  await expect(page.getByText(/^Uploaded Insurance/)).toHaveCount(0);
  await expect(page.getByText(/No certificates uploaded yet/i)).toBeVisible();

  // The literal "no orphaned file" check: nothing was ever written to Storage.
  const { data: listing, error } = await admin.storage
    .from("certificates")
    .list(`${orgId}/${vendorId}`);
  expect(error, error?.message).toBeNull();
  expect(listing ?? []).toHaveLength(0);
});
