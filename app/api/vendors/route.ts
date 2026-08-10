import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVendorsWithStatus } from "@/lib/vendors/queries";

// GET /api/vendors — list the caller's org vendors with current status badges
// (ERD §4). RLS scopes the rows to the caller's organization. PAN is never
// included in the list. Filtering is done client-side, so there are no params.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const vendors = await listVendorsWithStatus(supabase);
  return NextResponse.json({ vendors });
}
