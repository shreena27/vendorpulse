/**
 * One-off demo seed script. NOT part of the app — run by hand, once, before
 * a demo. Seeds 4 realistic vendors into the organization of whichever
 * signed-up account you pass by email, using the same approach the
 * integration tests use: a service-role client doing direct inserts that
 * match the real schema (vendors, verification_checks with is_change,
 * payments, bank_verifications), then calling the REAL alert-creation
 * pipeline (lib/alerts/processChangeAlerts.ts's
 * processChangeAlertsForPipeline) so the resulting alert is produced by the
 * actual business logic — never inserted directly into `alerts`.
 *
 * Bank status varies across all three real statuses so the demo isn't
 * uniformly "Unverified": Saraswati Engineering Works is verified,
 * Himalayan Herbal Products Pvt Ltd is manual_review, and Konkan Coast
 * Seafood Exports / Rajputana Steel Fabricators stay at the default
 * unverified.
 *
 * Idempotent: re-running it first deletes any previously-seeded vendors
 * with these exact demo names in the target org (vendor_id FKs cascade, so
 * their checks/payments/alerts/bank_verifications/evidence_log/
 * product_events rows go with them), so you can safely re-run it while
 * rehearsing.
 *
 * Run: see the block comment at the bottom of this file, or the chat
 * message this script was delivered with.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";
import { processChangeAlertsForPipeline } from "../lib/alerts/processChangeAlerts";

// Load .env.local into process.env — this script runs as a separate Node
// process (via tsx), same pattern lib/**/*.integration.test.ts already uses.
try {
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  // No .env.local — the env checks below will fail loudly with a clear message.
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEMO_VENDOR_NAMES = [
  "Saraswati Engineering Works",
  "Konkan Coast Seafood Exports",
  "Himalayan Herbal Products Pvt Ltd",
  "Rajputana Steel Fabricators",
] as const;

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run seed:demo -- <your-login-email>");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — check .env.local.",
    );
    process.exit(1);
  }

  const admin: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("organization_id")
    .eq("email", email)
    .maybeSingle();
  if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);
  if (!userRow) {
    console.error(
      `No signed-up user found with email "${email}". Sign up in the app first, then re-run with that exact email.`,
    );
    process.exit(1);
  }
  const orgId = userRow.organization_id;
  console.log(`Seeding into organization ${orgId} (account: ${email})`);

  // Idempotent: clear out any previous run's demo vendors first (cascades
  // to their checks/payments/alerts/evidence_log/product_events).
  const { error: cleanupErr } = await admin
    .from("vendors")
    .delete()
    .eq("organization_id", orgId)
    .in("name", DEMO_VENDOR_NAMES as unknown as string[]);
  if (cleanupErr) throw new Error(`cleanup of previous demo vendors failed: ${cleanupErr.message}`);

  // --- 3 healthy / verified vendors -----------------------------------
  const { data: healthyVendors, error: healthyErr } = await admin
    .from("vendors")
    .insert([
      {
        organization_id: orgId,
        name: "Saraswati Engineering Works",
        gstin: "27SEWPL5821K1Z4",
        udyam_number: "UDYAM-MH-03-0028471",
        current_gst_status: "active",
        current_msme_status: "registered",
        source: "excel",
      },
      {
        organization_id: orgId,
        name: "Konkan Coast Seafood Exports",
        gstin: "30KCSFE7734L1Z9",
        udyam_number: null, // not every real vendor is MSME-registered
        current_gst_status: "active",
        current_msme_status: "unknown",
        source: "excel",
      },
      {
        organization_id: orgId,
        name: "Himalayan Herbal Products Pvt Ltd",
        gstin: "05HHPPL2246M1Z2",
        udyam_number: "UDYAM-UK-01-0019283",
        current_gst_status: "active",
        current_msme_status: "registered",
        source: "excel",
      },
    ])
    .select("id, name");
  if (healthyErr || !healthyVendors || healthyVendors.length !== 3) {
    throw new Error(`healthy vendor insert failed: ${healthyErr?.message}`);
  }
  const byName = new Map(healthyVendors.map((v) => [v.name, v.id]));
  const saraswatiId = byName.get("Saraswati Engineering Works")!;
  const konkanId = byName.get("Konkan Coast Seafood Exports")!;
  const himalayanId = byName.get("Himalayan Herbal Products Pvt Ltd")!;

  const { error: healthyChecksErr } = await admin.from("verification_checks").insert([
    {
      organization_id: orgId,
      vendor_id: saraswatiId,
      check_type: "gst",
      status_value: "ACTIVE",
      provider: "mock",
      is_change: false,
    },
    {
      organization_id: orgId,
      vendor_id: saraswatiId,
      check_type: "msme_udyam",
      status_value: "REGISTERED",
      provider: "mock",
      is_change: false,
    },
    {
      organization_id: orgId,
      vendor_id: konkanId,
      check_type: "gst",
      status_value: "ACTIVE",
      provider: "mock",
      is_change: false,
    },
    {
      organization_id: orgId,
      vendor_id: himalayanId,
      check_type: "gst",
      status_value: "ACTIVE",
      provider: "mock",
      is_change: false,
    },
    {
      organization_id: orgId,
      vendor_id: himalayanId,
      check_type: "msme_udyam",
      status_value: "REGISTERED",
      provider: "mock",
      is_change: false,
    },
  ]);
  if (healthyChecksErr) throw new Error(`healthy checks insert failed: ${healthyChecksErr.message}`);
  console.log(`Seeded 3 healthy vendors: ${DEMO_VENDOR_NAMES.slice(0, 3).join(", ")}`);

  // --- Bank verification variety ----------------------------------------
  // Bypasses the record_bank_verification() RPC (that's for a caller's own
  // session client) and inserts directly, same as everywhere else in this
  // script — service_role has an unrestricted grant on bank_verifications
  // (migration 0004). Konkan and Rajputana are left at the table's default
  // 'unverified', so the demo shows all three status types at a glance.
  const { error: bankErr } = await admin.from("bank_verifications").insert([
    {
      organization_id: orgId,
      vendor_id: saraswatiId,
      account_number_masked: "****4821",
      ifsc: "HDFC0001234",
      name_match_result: "exact",
      status: "verified",
      provider: "mock",
    },
    {
      organization_id: orgId,
      vendor_id: himalayanId,
      account_number_masked: "****7735",
      ifsc: "SBIN0005678",
      name_match_result: "partial",
      status: "manual_review",
      provider: "mock",
    },
  ]);
  if (bankErr) throw new Error(`bank verification insert failed: ${bankErr.message}`);

  // record_bank_verification() normally updates the vendor's
  // current_bank_status in the same transaction as the insert above — do
  // that explicitly here since this script writes bank_verifications directly.
  const { error: bankStatusErr } = await admin
    .from("vendors")
    .update({ current_bank_status: "verified" })
    .eq("id", saraswatiId);
  if (bankStatusErr) throw new Error(`Saraswati bank status update failed: ${bankStatusErr.message}`);
  const { error: himalayanBankStatusErr } = await admin
    .from("vendors")
    .update({ current_bank_status: "manual_review" })
    .eq("id", himalayanId);
  if (himalayanBankStatusErr) {
    throw new Error(`Himalayan bank status update failed: ${himalayanBankStatusErr.message}`);
  }
  console.log(
    "Seeded bank verifications: Saraswati Engineering Works=verified, " +
      "Himalayan Herbal Products Pvt Ltd=manual_review " +
      "(Konkan Coast Seafood Exports and Rajputana Steel Fabricators stay unverified)",
  );

  // --- 1 vendor with a GST change + a pending payment tied to it -------
  // This is the one vendor that should trigger a real alert: the impact
  // scorer only fires when the SAME vendor has both is_change=true and an
  // open pending payment (lib/alerts/impactScorer.ts).
  const { data: alertVendor, error: alertVendorErr } = await admin
    .from("vendors")
    .insert({
      organization_id: orgId,
      name: "Rajputana Steel Fabricators",
      gstin: "08RSFPL9012N1Z7",
      udyam_number: null,
      current_gst_status: "active", // baseline, updated below after the "change"
      source: "excel",
    })
    .select("id")
    .single();
  if (alertVendorErr || !alertVendor) {
    throw new Error(`alert vendor insert failed: ${alertVendorErr?.message}`);
  }
  const alertVendorId = alertVendor.id;

  const baselineCheckedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
  const { error: baselineErr } = await admin.from("verification_checks").insert({
    organization_id: orgId,
    vendor_id: alertVendorId,
    check_type: "gst",
    status_value: "ACTIVE",
    provider: "mock",
    is_change: false,
    checked_at: baselineCheckedAt,
  });
  if (baselineErr) throw new Error(`baseline check insert failed: ${baselineErr.message}`);

  // The "detected today" change — this is the row the real pipeline scores.
  const { data: changeCheck, error: changeErr } = await admin
    .from("verification_checks")
    .insert({
      organization_id: orgId,
      vendor_id: alertVendorId,
      check_type: "gst",
      status_value: "CANCELLED",
      provider: "mock",
      is_change: true,
    })
    .select("id")
    .single();
  if (changeErr || !changeCheck) throw new Error(`change check insert failed: ${changeErr?.message}`);

  const { error: statusUpdateErr } = await admin
    .from("vendors")
    .update({ current_gst_status: "cancelled" })
    .eq("id", alertVendorId);
  if (statusUpdateErr) throw new Error(`vendor status update failed: ${statusUpdateErr.message}`);

  const { error: paymentErr } = await admin.from("payments").insert({
    organization_id: orgId,
    vendor_id: alertVendorId,
    amount: "1850000", // ₹18.5L
    due_date: todayPlusDays(30),
    payment_method: "neft",
    status: "pending",
  });
  if (paymentErr) throw new Error(`payment insert failed: ${paymentErr.message}`);
  console.log("Seeded Rajputana Steel Fabricators: GST ACTIVE → CANCELLED, one ₹18.5L pending payment");

  // --- Run the REAL alert pipeline against the seeded change -----------
  // Same function the poll-gst cron route calls in production
  // (app/api/cron/poll-gst/route.ts) — nothing about the resulting alert
  // is faked.
  const summary = await processChangeAlertsForPipeline(admin, [
    {
      id: changeCheck.id,
      vendorId: alertVendorId,
      organizationId: orgId,
      checkType: "gst",
    },
  ]);
  console.log("Alert pipeline result:", summary);

  const { data: alertRow } = await admin
    .from("alerts")
    .select("id, status, payment_impact_amount, trigger_type")
    .eq("vendor_id", alertVendorId)
    .maybeSingle();

  if (alertRow) {
    console.log(
      `✓ Real alert created — id=${alertRow.id}, trigger=${alertRow.trigger_type}, ` +
        `impact=₹${alertRow.payment_impact_amount}, status=${alertRow.status}`,
    );
  } else {
    console.error(
      "✗ No alert row was created. Check the pipeline summary above — " +
        "notAlertWorthy should be 0 and alertsCreated should be 1.",
    );
    process.exit(1);
  }

  console.log("\nDone. Sign in as", email, "and open /vendors and /alerts to see the demo data.");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});

/**
 * HOW TO RUN
 * ==========
 * 1. One-time setup (already done if you've run this before):
 *      npm install -D tsx
 *
 * 2. Make sure you're signed up in the app already (the script seeds into
 *    an EXISTING account's organization — it doesn't create the account).
 *
 * 3. Run, passing the exact email you log in with:
 *      npm run seed:demo -- your-login-email@example.com
 *
 *    (or directly: npx tsx scripts/seed-demo-data.ts your-login-email@example.com)
 *
 * 4. Log in as that account and open /vendors and /alerts — you should see
 *    4 vendors (3 healthy, 1 with a cancelled-GST alert), one open alert
 *    for Rajputana Steel Fabricators with a real ₹18.5L payment-impact
 *    line, and a Bank column showing Verified / Manual review / Unverified
 *    across the four vendors, not one status repeated.
 *
 * Safe to re-run before the demo — it deletes and recreates only the 4
 * vendors it seeds (matched by name), nothing else in your org.
 */
