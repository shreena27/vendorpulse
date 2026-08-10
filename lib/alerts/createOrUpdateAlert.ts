/**
 * Alert creation + dedupe (Chunk 3.2, ERD §5.3). SERVER-ONLY.
 *
 * Called exclusively from the cron pipeline (already running as the service
 * role), so this writes directly via the admin client — no SECURITY DEFINER
 * RPC needed, same reasoning as verification_checks's own writes.
 *
 * Dedupe: an existing alert for the same (vendor_id, trigger_type) that
 * hasn't reached cleared/escalated gets its payment_impact_amount updated
 * instead of a duplicate row. source_check_id is never overwritten on an
 * update — it stays pointed at whichever check first opened the alert.
 */

export type TriggerType = "gst_change" | "msme_change" | "lei_check";

// "Open" for dedupe purposes: anything short of a terminal resolution.
const OPEN_STATUSES = ["open", "hold", "reviewed"] as const;

export interface CreateOrUpdateAlertInput {
  organizationId: string;
  vendorId: string;
  triggerType: TriggerType;
  /** The verification_checks (or, later, lei_checks) row that triggered this. */
  sourceCheckId: string;
  paymentImpactAmount: number;
}

export interface AlertResult {
  alertId: string;
  action: "created" | "updated";
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface AlertsClient {
  from(table: "alerts"): {
    select(columns: "id"): {
      eq(
        column: "vendor_id",
        value: string,
      ): {
        eq(
          column2: "trigger_type",
          value2: string,
        ): {
          in(
            column3: "status",
            values: readonly string[],
          ): {
            limit(
              n: number,
            ): {
              maybeSingle(): PromiseLike<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
    update(values: { payment_impact_amount: number }): {
      eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }>;
    };
    insert(values: {
      organization_id: string;
      vendor_id: string;
      trigger_type: string;
      source_check_id: string;
      payment_impact_amount: number;
      status: "open";
    }): {
      select(columns: "id"): {
        single(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export async function createOrUpdateAlert(
  supabase: AlertsClient,
  input: CreateOrUpdateAlertInput,
): Promise<AlertResult> {
  const { data: existing } = await supabase
    .from("alerts")
    .select("id")
    .eq("vendor_id", input.vendorId)
    .eq("trigger_type", input.triggerType)
    .in("status", OPEN_STATUSES)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("alerts")
      .update({ payment_impact_amount: input.paymentImpactAmount })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`update alert failed: ${error.message}`);
    }
    return { alertId: existing.id, action: "updated" };
  }

  const { data: created, error } = await supabase
    .from("alerts")
    .insert({
      organization_id: input.organizationId,
      vendor_id: input.vendorId,
      trigger_type: input.triggerType,
      source_check_id: input.sourceCheckId,
      payment_impact_amount: input.paymentImpactAmount,
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`create alert failed: ${error.message}`);
  }

  return { alertId: created!.id, action: "created" };
}
