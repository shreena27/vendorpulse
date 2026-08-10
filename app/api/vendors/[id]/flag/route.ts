import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_NUMBER_REGEX, IFSC_REGEX } from "@/lib/import/validateVendorRow";
import { getBankAdapter } from "@/lib/providers/bank";
import { verifyVendorBank } from "@/lib/bank/verifyVendorBank";

// POST /api/vendors/:id/flag — manual flag, any org user (ERD §4). Chunk 2.1
// wires the bank-verification side only; certificate re-verification (2.2)
// is not implemented yet, so this route re-runs the bank check only. Raw
// account details are supplied fresh in the body every time — none is kept
// from onboarding to re-verify against, by design (never persisted).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { accountNumber?: unknown; ifsc?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accountNumber =
    typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
  const ifsc =
    typeof body.ifsc === "string" ? body.ifsc.trim().toUpperCase() : "";
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  if (!ACCOUNT_NUMBER_REGEX.test(accountNumber)) {
    return NextResponse.json(
      { error: "Invalid or missing bank account number." },
      { status: 400 },
    );
  }
  if (!IFSC_REGEX.test(ifsc)) {
    return NextResponse.json({ error: "Invalid or missing IFSC." }, { status: 400 });
  }

  // RLS-scoped: a vendor in another org reads as not found, same as GET /api/vendors/:id.
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  try {
    const summary = await verifyVendorBank(supabase, getBankAdapter(), {
      vendorId: vendor.id,
      vendorName: vendor.name,
      accountNumber,
      ifsc,
      reason,
    });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bank verification failed." },
      { status: 500 },
    );
  }
}
