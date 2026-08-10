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
    .select("role")
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

  return NextResponse.json({
    importId,
    total: parsed.rows.length,
    inserted: validVendors.length,
    errorCount: errors.length,
    errors,
    warnings,
  });
}
