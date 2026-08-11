import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseVendorFile } from "@/lib/import/parseVendorFile";
import {
  applyMapping,
  validateVendorRow,
  type ColumnMapping,
  type RowIssue,
} from "@/lib/import/validateVendorRow";
import type { VendorImportInput } from "@/lib/supabase/types";
import { correlateImportedVendors } from "@/lib/vendors/correlateImport";
import { getBankAdapter } from "@/lib/providers/bank";
import { verifyVendorBank } from "@/lib/bank/verifyVendorBank";
import { createAdminClient } from "@/lib/supabase/admin";
import { track } from "@/lib/analytics/track";

// Bounded concurrency for the post-import bank-verification loop, same shape
// as the poller's worker pool (lib/verification/pollRunner.ts) — kept inline
// since it's ~15 lines with only two call sites (here and the flag route).
const BANK_CHECK_CONCURRENCY = 8;

interface BankRow {
  name: string;
  gstin: string | null;
  accountNumber: string;
  ifsc: string;
}

interface BankVerificationSummary {
  verified: number;
  manualReview: number;
  mismatch: number;
  skipped: number;
}

async function runBankVerifications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  importId: string,
  bankRows: BankRow[],
): Promise<BankVerificationSummary> {
  const summary: BankVerificationSummary = {
    verified: 0,
    manualReview: 0,
    mismatch: 0,
    skipped: 0,
  };

  const { data: insertedVendors } = await supabase
    .from("vendors")
    .select("id, name, gstin")
    .eq("import_id", importId);

  const correlated = correlateImportedVendors(bankRows, insertedVendors ?? []);
  const matched = correlated.filter(
    (r): r is typeof r & { vendorId: string } => r.vendorId !== null,
  );
  summary.skipped += correlated.length - matched.length;

  const adapter = getBankAdapter();
  let cursor = 0;
  async function worker() {
    for (let i = cursor++; i < matched.length; i = cursor++) {
      const row = matched[i];
      try {
        const result = await verifyVendorBank(supabase, adapter, {
          vendorId: row.vendorId,
          vendorName: row.name,
          accountNumber: row.accountNumber,
          ifsc: row.ifsc,
        });
        if (result.status === "verified") {
          summary.verified++;
        } else {
          if (result.status === "manual_review") summary.manualReview++;
          else summary.mismatch++;
          await track(createAdminClient(), {
            organizationId,
            vendorId: row.vendorId,
            eventType: "bank_cert_issue_caught",
            payload: { kind: "bank", status: result.status },
          });
        }
      } catch {
        // One vendor's bank check failing never aborts the batch or the
        // import response — same resilience rule as the GST/MSME poller.
        summary.skipped++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BANK_CHECK_CONCURRENCY, matched.length) }, worker),
  );

  return summary;
}

// Runs on the default Node.js runtime (SheetJS needs Node APIs). Do NOT set
// `runtime = 'edge'`. Route Handlers have no Next body-size cap; the practical
// limit is the deploy platform (~4.5 MB on Vercel), far above a 220-row file.

// Only these roles may import vendors (ERD API contract).
const ALLOWED_ROLES = new Set(["admin", "finance_head"]);

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Role gate. The list of members is RLS-scoped; select this caller's own row.
  const { data: profile } = await supabase
    .from("users")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return NextResponse.json(
      { error: "Only a finance head or admin may import vendors." },
      { status: 403 },
    );
  }

  // Read the multipart body.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "No file was uploaded." },
      { status: 400 },
    );
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse((form.get("mapping") as string) ?? "{}");
  } catch {
    return NextResponse.json(
      { error: "Invalid column mapping." },
      { status: 400 },
    );
  }
  if (!mapping.name) {
    return NextResponse.json(
      { error: "Map a column to the vendor name before importing." },
      { status: 400 },
    );
  }

  // Parse the file server-side — the authoritative pass. Client rows are never
  // trusted.
  let parsed;
  try {
    parsed = await parseVendorFile(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "Could not read the file. Upload a valid CSV or XLSX." },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "The file has no rows to import." },
      { status: 400 },
    );
  }

  // Validate and dedupe entirely in memory, before any DB write. The status
  // enum has no 'failed' state, so nothing partial is ever persisted.
  const validVendors: VendorImportInput[] = [];
  const bankRows: BankRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seenGstins = new Set<string>();

  parsed.rows.forEach((sourceRow, index) => {
    // File line number: line 1 is the header, so data row `index` is line
    // `index + 2`. This is what the user sees when they open the file.
    const rowNumber = index + 2;
    const result = validateVendorRow(applyMapping(sourceRow, mapping), rowNumber);

    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }

    // Dedupe by GSTIN within this upload only. The second occurrence is skipped
    // and reported — never silently merged (ERD §7).
    if (result.vendor.gstin) {
      if (seenGstins.has(result.vendor.gstin)) {
        errors.push({
          row: rowNumber,
          field: "gstin",
          message: `Duplicate GSTIN ${result.vendor.gstin} in this upload; row skipped.`,
        });
        return;
      }
      seenGstins.add(result.vendor.gstin);
    }

    warnings.push(...result.warnings);
    validVendors.push(result.vendor);
    if (result.bankDetails) {
      bankRows.push({
        name: result.vendor.name,
        gstin: result.vendor.gstin,
        accountNumber: result.bankDetails.accountNumber,
        ifsc: result.bankDetails.ifsc,
      });
    }
  });

  // One atomic call: inserts the vendor_imports batch row and every vendor row
  // in a single transaction, org-scoped inside the SECURITY DEFINER function.
  const { data: importId, error: rpcError } = await supabase.rpc(
    "import_vendors",
    {
      p_source: "excel",
      p_row_count: parsed.rows.length,
      p_error_count: errors.length,
      p_vendors: validVendors,
    },
  );

  if (rpcError) {
    return NextResponse.json(
      { error: `Import failed: ${rpcError.message}` },
      { status: 500 },
    );
  }

  // Chunk 2.1: run the one-time bank check for every row that carried valid
  // bank details. Vendors are already imported at this point, so a bank-side
  // problem is reported in the summary, never as an import failure.
  const bankVerifications =
    bankRows.length > 0
      ? await runBankVerifications(supabase, profile.organization_id, importId, bankRows)
      : undefined;

  await track(createAdminClient(), {
    organizationId: profile.organization_id,
    eventType: "vendor_import_completed",
    payload: {
      source: "excel",
      importId,
      rowCount: parsed.rows.length,
      insertedCount: validVendors.length,
      errorCount: errors.length,
    },
    actor: user.id,
  });

  return NextResponse.json({
    importId,
    total: parsed.rows.length,
    inserted: validVendors.length,
    errorCount: errors.length,
    errors,
    warnings,
    ...(bankVerifications ? { bankVerifications } : {}),
  });
}
