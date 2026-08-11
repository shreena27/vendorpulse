import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listAlertsForOrg } from "@/lib/alerts/queries";
import type { AlertStatus, AlertTriggerType } from "@/lib/supabase/types";

const VALID_STATUSES: AlertStatus[] = ["open", "hold", "reviewed", "cleared", "escalated"];
const VALID_TRIGGER_TYPES: AlertTriggerType[] = ["gst_change", "msme_change", "lei_check"];

// GET /api/alerts — list alerts for the caller's org, filterable by status,
// vendor, or trigger type (ERD §4). Any org user.
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const vendorId = url.searchParams.get("vendorId") ?? undefined;
  const triggerTypeParam = url.searchParams.get("triggerType");

  if (statusParam && !VALID_STATUSES.includes(statusParam as AlertStatus)) {
    return NextResponse.json({ error: `Invalid status: ${statusParam}` }, { status: 400 });
  }
  if (triggerTypeParam && !VALID_TRIGGER_TYPES.includes(triggerTypeParam as AlertTriggerType)) {
    return NextResponse.json(
      { error: `Invalid triggerType: ${triggerTypeParam}` },
      { status: 400 },
    );
  }

  const alerts = await listAlertsForOrg(supabase, {
    status: (statusParam as AlertStatus) ?? undefined,
    vendorId,
    triggerType: (triggerTypeParam as AlertTriggerType) ?? undefined,
  });

  return NextResponse.json({ alerts });
}
