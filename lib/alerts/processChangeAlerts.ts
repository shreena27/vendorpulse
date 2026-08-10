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
}

export interface ProcessChangeAlertsDeps {
  scoreChangeForVendor: (input: { vendorId: string; isChange: boolean }) => Promise<ScoreResult>;
  getOpenPaymentAmount: (vendorId: string) => Promise<number>;
  createOrUpdateAlert: (input: CreateOrUpdateAlertInput) => Promise<AlertResult>;
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
      const result = await deps.createOrUpdateAlert({
        organizationId: check.organizationId,
        vendorId: check.vendorId,
        triggerType: TRIGGER_TYPE_BY_CHECK_TYPE[check.checkType],
        sourceCheckId: check.id,
        paymentImpactAmount,
      });
      if (result.action === "created") summary.alertsCreated++;
      else summary.alertsUpdated++;
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
    scoreChangeForVendor: (input) => scoreChangeForVendor(client, input),
    getOpenPaymentAmount: (vendorId) => getOpenPaymentAmount(client, vendorId),
    createOrUpdateAlert: (input) => createOrUpdateAlert(client, input),
  });
}
