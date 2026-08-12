/**
 * One-off demo seed script. NOT part of the app — run by hand, once, before
 * a demo. Seeds 6 realistic vendors into the organization of whichever
 * signed-up account you pass by email, using the same approach the
 * integration tests use: a service-role client doing direct inserts that
 * match the real schema (vendors, verification_checks with is_change,
 * payments, bank_verifications), then calling the REAL alert-creation
 * pipeline for each of the three alert trigger types this app has —
 * lib/alerts/processChangeAlerts.ts's processChangeAlertsForPipeline for
 * GST/MSME changes, lib/lei/runLeiCheck.ts's runLeiCheckForPayment for LEI —
 * so every resulting alert is produced by the actual business logic, never
 * inserted directly into `alerts`.
 *
 * Every `verification_checks` insert is immediately followed by the same
 * evidence_log write the real cron routes perform after runPoll() (Chunk
 * 4.1's buildCheckEvidenceEvents() + logEvents()) — found missing here as a
 * real bug (2026-08-12): a directly-inserted check with no matching
 * evidence_log row is invisible to the Clause 22 / Form 3CD export
 * (lib/evidence/buildExport.ts reads evidence_log exclusively, never
 * verification_checks), so Vishwakarma Tooling Industries' genuine MSME
 * Lapsed status showed as "No record" for every payment due date. Every
 * check this script inserts now produces the same evidence trail a real
 * poll would.
 *
 * Bank status varies across all three real statuses so the demo isn't
 * uniformly "Unverified": Saraswati Engineering Works is verified,
 * Himalayan Herbal Products Pvt Ltd is manual_review, and every other
 * vendor stays at the default unverified.
 *
 * Three vendors demonstrate the three real alert trigger types, one each:
 * Rajputana Steel Fabricators (gst_change), Vishwakarma Tooling Industries
 * (msme_change), Meenakshi Infrastructure Projects Ltd (lei_check, via the
 * real free GLEIF API against the same known-lapsed fixture LEI
 * lib/lei/runLeiCheck.integration.test.ts uses).
 *
 * Idempotent: re-running it first deletes any previously-seeded vendors
 * with these exact demo names in the target org (vendor_id FKs cascade, so
 * their checks/payments/alerts/bank_verifications/lei_checks/evidence_log/
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
import { runLeiCheckForPayment } from "../lib/lei/runLeiCheck";
import { buildCheckEvidenceEvents } from "../lib/verification/changeDetector";
import { logEvents } from "../lib/evidence/logEvent";

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
  "Vishwakarma Tooling Industries",
  "Meenakshi Infrastructure Projects Ltd",
] as const;

// Same known-lapsed fixture LEI used by lib/lei/runLeiCheck.integration.test.ts
// and e2e/lei-check.spec.ts — confirmed live against the real GLEIF API
// during Chunk 4.3 planning, not guessed.
const KNOWN_LAPSED_LEI = "335800CO2E555Q1ZEY28";

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

  const { data: healthyChecks, error: healthyChecksErr } = await admin
    .from("verification_checks")
    .insert([
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
    ])
    .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change");
  if (healthyChecksErr || !healthyChecks) {
    throw new Error(`healthy checks insert failed: ${healthyChecksErr?.message}`);
  }
  await logEvents(admin, buildCheckEvidenceEvents(healthyChecks));
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
  const { data: baselineCheck, error: baselineErr } = await admin
    .from("verification_checks")
    .insert({
      organization_id: orgId,
      vendor_id: alertVendorId,
      check_type: "gst",
      status_value: "ACTIVE",
      provider: "mock",
      is_change: false,
      checked_at: baselineCheckedAt,
    })
    .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change")
    .single();
  if (baselineErr || !baselineCheck) {
    throw new Error(`baseline check insert failed: ${baselineErr?.message}`);
  }
  await logEvents(admin, buildCheckEvidenceEvents([baselineCheck]));

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
    .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change")
    .single();
  if (changeErr || !changeCheck) throw new Error(`change check insert failed: ${changeErr?.message}`);
  await logEvents(admin, buildCheckEvidenceEvents([changeCheck]));

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
      `✓ Real alert created (gst_change) — id=${alertRow.id}, trigger=${alertRow.trigger_type}, ` +
        `impact=₹${alertRow.payment_impact_amount}, status=${alertRow.status}`,
    );
  } else {
    console.error(
      "✗ No alert row was created. Check the pipeline summary above — " +
        "notAlertWorthy should be 0 and alertsCreated should be 1.",
    );
    process.exit(1);
  }

  // --- 1 vendor with an MSME change + a pending payment tied to it -----
  // Same pattern as Rajputana above, but for the msme_change trigger type —
  // proves the impact scorer's rule works identically for either check_type.
  const { data: msmeAlertVendor, error: msmeAlertVendorErr } = await admin
    .from("vendors")
    .insert({
      organization_id: orgId,
      name: "Vishwakarma Tooling Industries",
      gstin: "24VTIPL7788Q1Z6",
      udyam_number: "UDYAM-GJ-02-0056142",
      current_msme_status: "registered", // baseline, updated below after the "change"
      source: "excel",
    })
    .select("id")
    .single();
  if (msmeAlertVendorErr || !msmeAlertVendor) {
    throw new Error(`MSME alert vendor insert failed: ${msmeAlertVendorErr?.message}`);
  }
  const msmeAlertVendorId = msmeAlertVendor.id;

  const msmeBaselineCheckedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
  const { data: msmeBaselineCheck, error: msmeBaselineErr } = await admin
    .from("verification_checks")
    .insert({
      organization_id: orgId,
      vendor_id: msmeAlertVendorId,
      check_type: "msme_udyam",
      status_value: "REGISTERED",
      provider: "mock",
      is_change: false,
      checked_at: msmeBaselineCheckedAt,
    })
    .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change")
    .single();
  if (msmeBaselineErr || !msmeBaselineCheck) {
    throw new Error(`MSME baseline check insert failed: ${msmeBaselineErr?.message}`);
  }
  await logEvents(admin, buildCheckEvidenceEvents([msmeBaselineCheck]));

  // The "detected today" change — this is the row the real pipeline scores.
  const { data: msmeChangeCheck, error: msmeChangeErr } = await admin
    .from("verification_checks")
    .insert({
      organization_id: orgId,
      vendor_id: msmeAlertVendorId,
      check_type: "msme_udyam",
      status_value: "LAPSED",
      provider: "mock",
      is_change: true,
    })
    .select("id, organization_id, vendor_id, check_type, status_value, provider, is_change")
    .single();
  if (msmeChangeErr || !msmeChangeCheck) {
    throw new Error(`MSME change check insert failed: ${msmeChangeErr?.message}`);
  }
  await logEvents(admin, buildCheckEvidenceEvents([msmeChangeCheck]));

  const { error: msmeStatusUpdateErr } = await admin
    .from("vendors")
    .update({ current_msme_status: "lapsed" })
    .eq("id", msmeAlertVendorId);
  if (msmeStatusUpdateErr) throw new Error(`MSME vendor status update failed: ${msmeStatusUpdateErr.message}`);

  const { error: msmePaymentErr } = await admin.from("payments").insert({
    organization_id: orgId,
    vendor_id: msmeAlertVendorId,
    amount: "925000", // ₹9.25L
    due_date: todayPlusDays(25),
    payment_method: "neft",
    status: "pending",
  });
  if (msmePaymentErr) throw new Error(`MSME payment insert failed: ${msmePaymentErr.message}`);
  console.log("Seeded Vishwakarma Tooling Industries: MSME REGISTERED → LAPSED, one ₹9.25L pending payment");

  const msmeSummary = await processChangeAlertsForPipeline(admin, [
    {
      id: msmeChangeCheck.id,
      vendorId: msmeAlertVendorId,
      organizationId: orgId,
      checkType: "msme_udyam",
    },
  ]);
  console.log("Alert pipeline result:", msmeSummary);

  const { data: msmeAlertRow } = await admin
    .from("alerts")
    .select("id, status, payment_impact_amount, trigger_type")
    .eq("vendor_id", msmeAlertVendorId)
    .maybeSingle();

  if (msmeAlertRow) {
    console.log(
      `✓ Real alert created (msme_change) — id=${msmeAlertRow.id}, trigger=${msmeAlertRow.trigger_type}, ` +
        `impact=₹${msmeAlertRow.payment_impact_amount}, status=${msmeAlertRow.status}`,
    );
  } else {
    console.error(
      "✗ No MSME alert row was created. Check the pipeline summary above — " +
        "notAlertWorthy should be 0 and alertsCreated should be 1.",
    );
    process.exit(1);
  }

  // --- 1 vendor with a lapsed LEI + a qualifying (>=₹50cr RTGS/NEFT) ------
  // payment — the third and last real alert trigger type. Uses the real
  // LEI check orchestrator (not processChangeAlertsForPipeline — LEI checks
  // run on-demand against a payment, not from a poller-detected change),
  // which hits the real, free GLEIF API against KNOWN_LAPSED_LEI, same
  // fixture e2e/lei-check.spec.ts and the integration test use.
  const { data: leiAlertVendor, error: leiAlertVendorErr } = await admin
    .from("vendors")
    .insert({
      organization_id: orgId,
      name: "Meenakshi Infrastructure Projects Ltd",
      gstin: "27MIPLT4567P1Z3",
      lei_number: KNOWN_LAPSED_LEI,
      source: "excel",
    })
    .select("id")
    .single();
  if (leiAlertVendorErr || !leiAlertVendor) {
    throw new Error(`LEI alert vendor insert failed: ${leiAlertVendorErr?.message}`);
  }
  const leiAlertVendorId = leiAlertVendor.id;

  const { data: leiPayment, error: leiPaymentErr } = await admin
    .from("payments")
    .insert({
      organization_id: orgId,
      vendor_id: leiAlertVendorId,
      amount: "620000000", // ₹62cr — qualifies (>= ₹50cr threshold, RTGS)
      due_date: todayPlusDays(20),
      payment_method: "rtgs",
      status: "pending",
    })
    .select("id")
    .single();
  if (leiPaymentErr || !leiPayment) throw new Error(`LEI payment insert failed: ${leiPaymentErr?.message}`);
  console.log(
    "Seeded Meenakshi Infrastructure Projects Ltd: lapsed LEI on file, one ₹62Cr qualifying RTGS payment",
  );

  const leiResult = await runLeiCheckForPayment(admin, {
    paymentId: leiPayment.id,
    organizationId: orgId,
    vendorId: leiAlertVendorId,
    vendorLeiNumber: KNOWN_LAPSED_LEI,
    amount: 620000000,
    paymentMethod: "rtgs",
  });
  console.log("LEI check result:", leiResult);

  if (leiResult.ok && leiResult.alertAction !== "none") {
    const { data: leiAlertRow } = await admin
      .from("alerts")
      .select("id, status, payment_impact_amount, trigger_type")
      .eq("vendor_id", leiAlertVendorId)
      .maybeSingle();
    console.log(
      `✓ Real alert created (lei_check) — id=${leiAlertRow?.id}, trigger=${leiAlertRow?.trigger_type}, ` +
        `status=${leiResult.status}, alertAction=${leiResult.alertAction}`,
    );
  } else {
    console.error(
      "✗ No LEI alert was created. Check leiResult above — ok should be true and status should be " +
        "lapsed/retired/not_on_record.",
    );
    process.exit(1);
  }

  console.log(
    "\nDone. Sign in as",
    email,
    "and open /vendors and /alerts — you should see all three alert types " +
      "(gst_change, msme_change, lei_check) together.",
  );
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
 *    6 vendors (3 healthy, 3 with real open alerts — one per trigger type)
 *    and three alert cards: Rajputana Steel Fabricators (gst_change, ₹18.5L
 *    impact), Vishwakarma Tooling Industries (msme_change, ₹9.25L impact),
 *    and Meenakshi Infrastructure Projects Ltd (lei_check, lapsed LEI on a
 *    ₹62Cr payment) — plus a Bank column on /vendors showing Verified /
 *    Manual review / Unverified, not one status repeated.
 *
 * Safe to re-run before the demo — it deletes and recreates only the 6
 * vendors it seeds (matched by name), nothing else in your org.
 */
