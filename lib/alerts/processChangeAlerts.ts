/**
 * Turns the poller's changed checks into alerts (Chunk 3.2). SERVER-ONLY.
 *
 * `processChangeAlerts` is the hermetically-testable core — injected
 * dependencies, same DI pattern as `scoreChange` (lib/alerts/impactScorer.ts).
 * `processChangeAlertsForPipeline` wires the real scorer + alert writer
 * together and is what the cron routes actually call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckType, Database } from "@/lib/supabase/types";
import {
  scoreChangeForVendor,
  getOpenPaymentAmount,
  type PaymentsClient,
  type ScoreResult,
} from "./impactScorer";
import {
  createOrUpdateAlert,
  type AlertsClient,
  type AlertResult,
  type CreateOrUpdateAlertInput,
  type TriggerType,
} from "./createOrUpdateAlert";
import { getAlertNudgeById } from "./queries";
import { logEvent } from "@/lib/evidence/logEvent";
import { sendAlertEmail } from "@/lib/email/sendAlertEmail";
import { getResendClient } from "@/lib/email/resendClient";
import { track } from "@/lib/analytics/track";

export interface ChangedCheck {
  id: string;
  vendorId: string;
  organizationId: string;
  checkType: CheckType;
}

export interface ProcessChangeAlertsSummary {
  scored: number;
  alertsCreated: number;
  alertsUpdated: number;
  notAlertWorthy: number;
  emailsSent: number;
  emailsFailed: number;
}

export interface ProcessChangeAlertsDeps {
  scoreChangeForVendor: (input: { vendorId: string; isChange: boolean }) => Promise<ScoreResult>;
  getOpenPaymentAmount: (vendorId: string) => Promise<number>;
  createOrUpdateAlert: (input: CreateOrUpdateAlertInput) => Promise<AlertResult>;
  /** Called only for a newly-created alert, never a dedupe update — "a new
   * alert triggers an email," not a repeat detection. A rejection here is
   * caught and counted, never thrown (one failure never aborts the batch,
   * same rule as pollRunner/bank verification). */
  notifyAlertCreated: (alertId: string, check: ChangedCheck) => Promise<void>;
  /** Writes an evidence_log row for this alert result (created or updated) —
   * called for every alert-worthy change that reaches createOrUpdateAlert,
   * regardless of which branch it took. Unlike notifyAlertCreated, a failure
   * here is NOT caught: an alert must never exist without a matching
   * evidence row (ERD "Persistent data rules", Chunk 4.1). */
  logAlertEvent: (
    result: AlertResult,
    check: ChangedCheck,
    triggerType: TriggerType,
    paymentImpactAmount: number,
  ) => Promise<void>;
  /** Chunk 5.1: fires a product_events row for the Section 11 metrics
   * pipeline. Only called on a newly-created alert — a dedupe update isn't
   * new value delivered, same "only on creation" rule notifyAlertCreated
   * already follows. Errors are caught here (not left to the real
   * implementation), same defensive shape as notifyAlertCreated's own
   * try/catch just below. */
  trackAlertCreated: (alertId: string, check: ChangedCheck, triggerType: TriggerType) => Promise<void>;
}

const TRIGGER_TYPE_BY_CHECK_TYPE: Record<CheckType, TriggerType> = {
  gst: "gst_change",
  msme_udyam: "msme_change",
};

const CONCURRENCY = 8;

export async function processChangeAlerts(
  changedChecks: ChangedCheck[],
  deps: ProcessChangeAlertsDeps,
): Promise<ProcessChangeAlertsSummary> {
  const summary: ProcessChangeAlertsSummary = {
    scored: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    notAlertWorthy: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };

  let cursor = 0;
  async function worker(): Promise<void> {
    for (let i = cursor++; i < changedChecks.length; i = cursor++) {
      const check = changedChecks[i];
      const score = await deps.scoreChangeForVendor({ vendorId: check.vendorId, isChange: true });
      summary.scored++;
      if (!score.alertWorthy) {
        summary.notAlertWorthy++;
        continue;
      }

      const paymentImpactAmount = await deps.getOpenPaymentAmount(check.vendorId);
      const triggerType = TRIGGER_TYPE_BY_CHECK_TYPE[check.checkType];
      const result = await deps.createOrUpdateAlert({
        organizationId: check.organizationId,
        vendorId: check.vendorId,
        triggerType,
        sourceCheckId: check.id,
        paymentImpactAmount,
      });
      await deps.logAlertEvent(result, check, triggerType, paymentImpactAmount);
      if (result.action === "created") {
        summary.alertsCreated++;
        try {
          await deps.notifyAlertCreated(result.alertId, check);
          summary.emailsSent++;
        } catch {
          summary.emailsFailed++;
        }
        try {
          await deps.trackAlertCreated(result.alertId, check, triggerType);
        } catch {
          // Best-effort analytics — never break the alert pipeline (Chunk 5.1).
        }
      } else {
        summary.alertsUpdated++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, changedChecks.length) }, worker),
  );

  return summary;
}

/**
 * Wires the real dependencies together. This is what the cron routes call,
 * passing the real admin `SupabaseClient<Database>` directly.
 *
 * The cast below is deliberate and confined to this one spot: TypeScript's
 * structural-assignability check between the full, deeply-generic
 * `SupabaseClient<Database>` and the narrow hand-written `PaymentsClient`/
 * `AlertsClient` interfaces hits its recursion limit (TS2589) if attempted
 * directly at a call site (this codebase's chained-query-builder interfaces
 * are deep enough to trigger it — the flat single-method `RpcClient` used
 * in lib/bank/verifyVendorBank.ts never does). Casting once here, rather
 * than at every call site, keeps that cast in exactly one place.
 */
export async function processChangeAlertsForPipeline(
  supabase: SupabaseClient<Database>,
  changedChecks: ChangedCheck[],
): Promise<ProcessChangeAlertsSummary> {
  const client = supabase as unknown as PaymentsClient & AlertsClient;
  return processChangeAlerts(changedChecks, {
    scoreChangeForVendor: (input) => scoreChangeForVendor(supabase, input),
    getOpenPaymentAmount: (vendorId) => getOpenPaymentAmount(client, vendorId),
    createOrUpdateAlert: (input) => createOrUpdateAlert(client, input),
    notifyAlertCreated: (alertId, check) => notifyAlertCreated(supabase, alertId, check.organizationId),
    trackAlertCreated: (alertId, check, triggerType) =>
      track(supabase, {
        organizationId: check.organizationId,
        vendorId: check.vendorId,
        eventType: "alert_created_tracked",
        payload: { alertId, triggerType, checkId: check.id },
      }),
    logAlertEvent: (result, check, triggerType, paymentImpactAmount) =>
      logEvent(supabase, {
        organizationId: check.organizationId,
        vendorId: check.vendorId,
        eventType: result.action === "created" ? "alert_created" : "alert_updated",
        entityType: "alerts",
        entityId: result.alertId,
        payload: { triggerType, sourceCheckId: check.id, paymentImpactAmount },
      }),
  });
}

/** Builds the nudge, finds the org's finance_head/admin recipients, and
 * sends via Resend. Exported so both the GST/MSME pipeline below AND the
 * LEI check orchestrator (lib/lei/runLeiCheck.ts) can reuse the exact same
 * "a new alert triggers an email" behavior — wording never drifts between
 * alert types. Thrown errors are caught by the caller, not here; non-fatal
 * handling is the caller's job. */
export async function notifyAlertCreated(
  supabase: SupabaseClient<Database>,
  alertId: string,
  organizationId: string,
): Promise<void> {
  const alert = await getAlertNudgeById(supabase, alertId);
  if (!alert) {
    throw new Error(`alert ${alertId} not found for notification`);
  }

  const { data: recipients, error } = await supabase
    .from("users")
    .select("email")
    .eq("organization_id", organizationId)
    .in("role", ["finance_head", "admin"]);
  if (error) {
    throw new Error(`load alert recipients failed: ${error.message}`);
  }

  const to = (recipients ?? [])
    .map((r) => r.email)
    .filter((email): email is string => Boolean(email));
  if (to.length === 0) return; // Nobody to notify; not an error.

  await sendAlertEmail(getResendClient(), {
    to,
    vendorName: alert.vendorName,
    changeLine: alert.nudge.changeLine,
    impactLine: alert.nudge.impactLine,
    question: alert.nudge.question,
  });
}
