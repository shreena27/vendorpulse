import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 1.5 acceptance (dashboard): after seeded poller output, the list shows
 * each vendor's current status at a glance, a changed vendor is visibly
 * distinct, and a vendor with zero checks shows a clear "pending" state (not a
 * blank page). The detail view shows the full history in chronological order.
 *
 * Prerequisite: migrations applied and Supabase "Confirm email" off.
 * The "poller run" is seeded directly via the service-role client (deterministic
 * test hook), so no external provider is called.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "test-password-123";

const hasEnv = Boolean(SUPABASE_URL && SERVICE);

function uniqueEmail() {
  return `vendorpulse.dash.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}@gmail.com`;
}

function randomUdyam() {
  const n = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  return `UDYAM-MH-01-${n}`;
}

test.describe.serial("vendor status dashboard", () => {
  let context: BrowserContext;
  let page: Page;
  let admin: SupabaseClient<Database>;
  let userId: string;
  let orgId: string;
  const ids: Record<string, string> = {};

  test.skip(!hasEnv, "requires Supabase env in .env.local");

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // Sign up through the UI → creates the org + a browser session.
    const email = uniqueEmail();
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    admin = createClient<Database>(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRow, error: userErr } = await admin
      .from("users")
      .select("id, organization_id")
      .eq("email", email)
      .single();
    if (userErr || !userRow) {
      throw new Error(`[seed] user lookup failed: ${userErr?.message} (email ${email})`);
    }
    userId = userRow.id;
    orgId = userRow.organization_id;

    // Seed three vendors with distinct situations.
    const { data: vendors, error: vendorErr } = await admin
      .from("vendors")
      // Uniform key set across all rows: a heterogeneous PostgREST bulk insert
      // sends NULL for keys some rows omit, bypassing column DEFAULTs.
      .insert([
        {
          organization_id: orgId,
          name: "Alpha Traders",
          gstin: null,
          udyam_number: randomUdyam(),
          current_gst_status: "not_applicable",
          current_msme_status: "registered",
          source: "excel",
        },
        {
          organization_id: orgId,
          name: "Bravo Traders",
          gstin: null,
          udyam_number: randomUdyam(),
          current_gst_status: "not_applicable",
          current_msme_status: "lapsed",
          source: "excel",
        },
        {
          organization_id: orgId,
          name: "Cosmo Traders",
          gstin: "27ABCDE0001F1Z5",
          udyam_number: null,
          current_gst_status: "unknown",
          current_msme_status: "unknown",
          source: "excel",
        },
      ])
      .select("id, name");
    if (vendorErr) throw new Error(`[seed] vendor insert failed: ${vendorErr.message}`);
    if (!vendors || vendors.length !== 3) {
      throw new Error(`[seed] expected 3 vendors, got ${vendors?.length ?? 0}`);
    }
    for (const v of vendors) ids[v.name] = v.id;

    const t1 = new Date(Date.now() - 60_000).toISOString();
    const t2 = new Date().toISOString();
    const { error: checksErr } = await admin.from("verification_checks").insert([
      // Alpha: one REGISTERED check, no change.
      {
        organization_id: orgId,
        vendor_id: ids["Alpha Traders"],
        check_type: "msme_udyam",
        status_value: "REGISTERED",
        provider: "mock",
        is_change: false,
        checked_at: t2,
      },
      // Bravo: REGISTERED then LAPSED — the second is a change.
      {
        organization_id: orgId,
        vendor_id: ids["Bravo Traders"],
        check_type: "msme_udyam",
        status_value: "REGISTERED",
        provider: "mock",
        is_change: false,
        checked_at: t1,
      },
      {
        organization_id: orgId,
        vendor_id: ids["Bravo Traders"],
        check_type: "msme_udyam",
        status_value: "LAPSED",
        provider: "mock",
        is_change: true,
        checked_at: t2,
      },
      // Cosmo: no checks at all (pending).
    ]);
    if (checksErr) throw new Error(`[seed] checks insert failed: ${checksErr.message}`);

    // Boundary check: confirm the rows are actually visible for this org via the
    // service-role client before the browser (RLS) tries to read them.
    const { count } = await admin
      .from("vendors")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (count !== 3) {
      throw new Error(`[seed] admin sees ${count} vendors for org ${orgId}, expected 3`);
    }
  });

  test.afterAll(async () => {
    if (admin && orgId) {
      await admin.from("vendors").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
    await context?.close();
  });

  test("list shows current status badges and flags the changed vendor", async () => {
    await page.goto("/vendors");

    const alpha = page.getByRole("row", { name: /Alpha Traders/ });
    await expect(alpha.getByText("Registered")).toBeVisible();

    const bravo = page.getByRole("row", { name: /Bravo Traders/ });
    await expect(bravo.getByText("Lapsed")).toBeVisible();
    await expect(bravo.getByText("Changed")).toBeVisible();

    const cosmo = page.getByRole("row", { name: /Cosmo Traders/ });
    await expect(cosmo.getByText("Pending")).toBeVisible();
  });

  test("'Needs attention' filters to the changed/bad vendor only", async () => {
    await page.goto("/vendors");
    await page.getByRole("button", { name: "Needs attention" }).click();
    await expect(page.getByText("Bravo Traders")).toBeVisible();
    await expect(page.getByText("Alpha Traders")).toHaveCount(0);
    await expect(page.getByText("Cosmo Traders")).toHaveCount(0);
  });

  test("'Pending' filters to the vendor with no checks yet", async () => {
    await page.goto("/vendors");
    await page.getByRole("button", { name: "Pending" }).click();
    await expect(page.getByText("Cosmo Traders")).toBeVisible();
    await expect(page.getByText("Alpha Traders")).toHaveCount(0);
    await expect(page.getByText("Bravo Traders")).toHaveCount(0);
  });

  test("detail shows the full history in chronological order", async () => {
    await page.goto(`/vendors/${ids["Bravo Traders"]}`);
    await expect(
      page.getByRole("heading", { name: "Bravo Traders" }),
    ).toBeVisible();

    const entries = page.getByRole("listitem");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("REGISTERED"); // earlier
    await expect(entries.nth(1)).toContainText("LAPSED"); // later
    await expect(entries.nth(1).getByText("Changed")).toBeVisible();
  });

  test("a vendor with zero checks shows the pending state, not a blank", async () => {
    await page.goto(`/vendors/${ids["Cosmo Traders"]}`);
    await expect(
      page.getByRole("heading", { name: "Cosmo Traders" }),
    ).toBeVisible();
    await expect(page.getByText(/No checks yet/i)).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);
  });
});
