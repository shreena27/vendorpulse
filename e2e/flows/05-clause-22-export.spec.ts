import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/types";

/**
 * PRD §8 story 5 — Clause 22 / Form 3CD export. A finance head exports what
 * was true, on any past date, for every payment due to an MSME vendor — not
 * today's live status. This is the "time travel" acceptance case: a
 * vendor's MSME status changes AFTER a payment's due date, and an export
 * for that earlier due date must still show the status as of THAT date, not
 * the later, current one. (e2e/evidence-export.spec.ts already covers the
 * plain CSV/PDF/role-gate/empty-range cases; this file adds the one
 * "as-of" scenario none of those exercise.)
 *
 * Prerequisite: migrations 0001-0010 applied, Supabase "Confirm email" off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow5.${tag}.${stamp}.${rand}@gmail.com`;
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

async function fillRange(page: Page, from: string, to: string) {
  // exact: true avoids the Next.js dev-toolbar "Open Next.js Dev Tools"
  // button substring-matching a non-exact getByLabel("To") — same fix
  // e2e/evidence-export.spec.ts already applies.
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
}

test("a January export shows the vendor's MSME status as of January, even though it later lapsed in February", async ({ page }) => {
  const email = await signUp(page, "timetravel");
  const admin = adminClient();
  const { data: userRow, error } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .single();
  if (error || !userRow) throw new Error(`[seed] user lookup failed: ${error?.message}`);
  const orgId = userRow.organization_id;

  const { data: vendor, error: vErr } = await admin
    .from("vendors")
    .insert({
      organization_id: orgId,
      name: "Flow Five Time Travel Vendor",
      gstin: "27ABCDE9101F1Z5",
      udyam_number: "UDYAM-MH-01-2100001",
      source: "excel",
    })
    .select("id")
    .single();
  if (vErr || !vendor) throw new Error(`[seed] vendor insert failed: ${vErr?.message}`);
  const vendorId = vendor.id;

  // Registered as of January; a later evidence row shows it lapsing in
  // February — AFTER the January payment's own due date.
  const { error: evErr } = await admin.from("evidence_log").insert([
    {
      organization_id: orgId,
      vendor_id: vendorId,
      event_type: "verification_check",
      entity_type: "verification_checks",
      entity_id: vendorId, // no FK on entity_id — any uuid is valid here
      payload: { checkType: "msme_udyam", statusValue: "REGISTERED", provider: "mock", isChange: false },
      created_at: "2026-01-05T00:00:00.000Z",
    },
    {
      organization_id: orgId,
      vendor_id: vendorId,
      event_type: "verification_check",
      entity_type: "verification_checks",
      entity_id: vendorId,
      payload: { checkType: "msme_udyam", statusValue: "LAPSED", provider: "mock", isChange: true },
      created_at: "2026-02-10T00:00:00.000Z",
    },
  ]);
  if (evErr) throw new Error(`[seed] evidence_log insert failed: ${evErr.message}`);

  const { error: pErr } = await admin.from("payments").insert([
    {
      organization_id: orgId,
      vendor_id: vendorId,
      amount: "75000",
      due_date: "2026-01-15",
      payment_method: "neft",
      status: "pending",
    },
    {
      organization_id: orgId,
      vendor_id: vendorId,
      amount: "82000",
      due_date: "2026-02-15",
      payment_method: "neft",
      status: "pending",
    },
  ]);
  if (pErr) throw new Error(`[seed] payments insert failed: ${pErr.message}`);

  await page.goto("/evidence/export");
  await fillRange(page, "2026-01-01", "2026-01-31");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = readFileSync(path!, "utf8");

  // The January payment shows REGISTERED — the status as of ITS due date —
  // never the later LAPSED value.
  expect(text).toContain("2026-01-15");
  expect(text).toContain("75000.00");
  expect(text).toContain("Registered");
  expect(text).not.toContain("Lapsed");

  // The February payment (and its own due date/amount) is out of range.
  expect(text).not.toContain("2026-02-15");
  expect(text).not.toContain("82000.00");
});
