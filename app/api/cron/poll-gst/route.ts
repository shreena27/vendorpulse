import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGstAdapter } from "@/lib/providers/gst";
import { isAuthorizedCron } from "@/lib/verification/cronAuth";
import { runPoll } from "@/lib/verification/pollRunner";
import { mapGstStatusToVendor, buildCheckEvidenceEvents } from "@/lib/verification/changeDetector";
import { processChangeAlertsForPipeline } from "@/lib/alerts/processChangeAlerts";
import { logEvents } from "@/lib/evidence/logEvent";
import { trackBatch } from "@/lib/analytics/track";

// Vercel Cron triggers this daily via GET with `Authorization: Bearer
// $CRON_SECRET` (see vercel.json). POST is accepted too for manual runs. Node
// runtime (service role + provider adapter); allow headroom for a live batch.
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const adapter = getGstAdapter();

  try {
    const summary = await runPoll({
      supabase,
      checkType: "gst",
      vendorField: "gstin",
      statusColumn: "current_gst_status",
      providerName: adapter.name,
      runCheck: (gstin) => adapter.checkGstin(gstin),
      mapStatus: mapGstStatusToVendor,
    });
    const { changedChecks, allChecks, ...counts } = summary;
    await logEvents(supabase, buildCheckEvidenceEvents(allChecks));
    await trackBatch(
      supabase,
      changedChecks.map((c) => ({
        organizationId: c.organizationId,
        vendorId: c.vendorId,
        eventType: "status_change_detected" as const,
        payload: { checkType: c.checkType, checkId: c.id },
      })),
    );
    const alerts = await processChangeAlertsForPipeline(supabase, changedChecks);
    return NextResponse.json({ ok: true, ...counts, alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "poll failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
