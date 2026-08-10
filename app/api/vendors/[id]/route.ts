import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCallerContext, getVendorDetail } from "@/lib/vendors/queries";

// GET /api/vendors/:id — one vendor's current status + full check history
// (ERD §4). PAN is returned only to finance_head / admin (ERD §6.3). A vendor
// in another org is invisible via RLS, so it reads as 404.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const caller = await getCallerContext(supabase);
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const detail = await getVendorDetail(supabase, id, caller.canSeePii);
  if (!detail) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}
