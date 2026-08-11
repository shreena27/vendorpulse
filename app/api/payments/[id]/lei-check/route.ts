import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCallerContext } from "@/lib/vendors/queries";
import { runLeiCheckForPayment } from "@/lib/lei/runLeiCheck";

// POST /api/payments/:id/lei-check — pre-payment LEI check (ERD §4).
// finance_head/admin only. Runs only for RTGS/NEFT >= LEI_THRESHOLD; a
// below-threshold payment gets 400, not a silent no-op. Never blocks or
// holds the payment itself — only ever creates/updates an alert.
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

  const caller = await getCallerContext(supabase);
  if (!caller?.canSeePii) {
    return NextResponse.json(
      { error: "Only a finance head or admin may run an LEI check." },
      { status: 403 },
    );
  }

  // RLS-scoped: null means either the payment doesn't exist or it belongs
  // to a different org — both are 404, never distinguished to the caller.
  const { data: payment } = await supabase
    .from("payments")
    .select("id, organization_id, vendor_id, amount, payment_method")
    .eq("id", id)
    .maybeSingle();
  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("lei_number")
    .eq("id", payment.vendor_id)
    .maybeSingle();

  const admin = createAdminClient();
  const result = await runLeiCheckForPayment(admin, {
    paymentId: payment.id,
    organizationId: payment.organization_id,
    vendorId: payment.vendor_id,
    vendorLeiNumber: vendor?.lei_number ?? null,
    amount: Number(payment.amount),
    paymentMethod: payment.payment_method,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "This payment does not meet the LEI check threshold (>= ₹50cr, RTGS or NEFT only)." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    leiCheckId: result.leiCheckId,
    status: result.status,
    alertAction: result.alertAction,
  });
}
