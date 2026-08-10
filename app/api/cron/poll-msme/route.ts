import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMsmeAdapter } from "@/lib/providers/msme";
import { isAuthorizedCron } from "@/lib/verification/cronAuth";
import { runPoll } from "@/lib/verification/pollRunner";
import { mapMsmeStatusToVendor } from "@/lib/verification/changeDetector";

// Vercel Cron triggers this daily via GET with `Authorization: Bearer
// $CRON_SECRET` (see vercel.json). POST is accepted too for manual runs. Node
// runtime (service role + provider adapter). Until Deepvue is wired, the MSME
// adapter is the mock (MSME_PROVIDER default).
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const adapter = getMsmeAdapter();

  try {
    const summary = await runPoll({
      supabase,
      checkType: "msme_udyam",
      vendorField: "udyam_number",
      statusColumn: "current_msme_status",
      providerName: adapter.name,
      runCheck: (udyam) => adapter.checkUdyam(udyam),
      mapStatus: mapMsmeStatusToVendor,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "poll failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
