import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAlert } from "@/lib/alerts/resolveAlert";
import { logEvent } from "@/lib/evidence/logEvent";
import { track } from "@/lib/analytics/track";
import { maybeTrackPmfSurveyTrigger } from "@/lib/analytics/maybeTrackPmfSurveyTrigger";

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
    // evidence_log and product_events both grant INSERT to service_role
    // only — the caller's own session client can't write either, so both
    // writes use the admin client, same reasoning the cron pipeline relies on.
    const admin = createAdminClient();
    await logEvent(admin, {
      organizationId: result.alert.organization_id,
      vendorId: result.alert.vendor_id,
      eventType: "alert_resolved",
      entityType: "alerts",
      entityId: result.alert.id,
      payload: { action, status: result.alert.status },
      actor: user.id,
    });

    // Chunk 5.1: Section 11 metrics #4 (alerts actioned within 24h), #5
    // (alert precision), and the North Star / #6 (payments held) are all
    // derived from this one event's payload.
    const hoursSinceCreated =
      (Date.now() - new Date(result.alert.created_at).getTime()) / 3_600_000;
    await track(admin, {
      organizationId: result.alert.organization_id,
      vendorId: result.alert.vendor_id,
      eventType: "alert_actioned",
      payload: {
        alertId: result.alert.id,
        action,
        triggerType: result.alert.trigger_type,
        paymentImpactAmount: Number(result.alert.payment_impact_amount),
        hoursSinceCreated,
        actionedWithin24h: hoursSinceCreated <= 24,
        actionedWithin48h: hoursSinceCreated <= 48,
      },
      actor: user.id,
    });
    await maybeTrackPmfSurveyTrigger(admin, result.alert.organization_id);

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
