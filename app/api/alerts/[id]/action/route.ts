import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAlert } from "@/lib/alerts/resolveAlert";
import { logEvent } from "@/lib/evidence/logEvent";

// POST /api/alerts/:id/action — one-tap resolution (ERD §4). Any org user.
// Body: { action: "hold" | "reviewed" | "escalate" }. The system never takes
// this action itself — this route only runs once a human has clicked.
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

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!action) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  const result = await resolveAlert(supabase, id, action);

  if (result.ok) {
    // evidence_log grants INSERT to service_role only (migration 0009) — the
    // caller's own session client can't write it, so this one write uses the
    // admin client, same reasoning the cron pipeline already relies on.
    await logEvent(createAdminClient(), {
      organizationId: result.alert.organization_id,
      vendorId: result.alert.vendor_id,
      eventType: "alert_resolved",
      entityType: "alerts",
      entityId: result.alert.id,
      payload: { action, status: result.alert.status },
      actor: user.id,
    });
    return NextResponse.json({ alert: result.alert });
  }

  switch (result.reason) {
    case "invalid_action":
      return NextResponse.json(
        { error: `Invalid action: ${action}. Use hold, reviewed, or escalate.` },
        { status: 400 },
      );
    case "not_found":
      return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    case "already_resolved":
      return NextResponse.json(
        { error: "This alert has already been resolved." },
        { status: 409 },
      );
    default:
      return NextResponse.json({ error: "Could not resolve the alert." }, { status: 500 });
  }
}
