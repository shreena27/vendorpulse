/**
 * LEI pre-payment check orchestrator (Chunk 4.3). SERVER-ONLY.
 *
 * `runLeiCheck` is the hermetically-testable core (DI, same pattern as
 * lib/alerts/impactScorer.ts / lib/verification/pollRunner.ts).
 * `runLeiCheckForPayment` wires the real GLEIF adapter, the real
 * lei_checks insert, and the real alert pipeline together — called by
 * app/api/payments/[id]/lei-check/route.ts.
 *
 * This only ever creates or updates an alert. It never blocks, holds, or
 * otherwise touches the payment itself — same as every other alert trigger
 * in this system.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PaymentMethod, LeiCheckStatus } from "@/lib/supabase/types";
import { qualifiesForLeiCheck } from "./qualifiesForLeiCheck";
import { createGleifAdapter } from "@/lib/providers/lei/gleifAdapter";
import type { LeiCheckResult } from "@/lib/providers/lei/types";
import {
  createOrUpdateAlert,
  type AlertsClient,
  type AlertResult,
  type CreateOrUpdateAlertInput,
} from "@/lib/alerts/createOrUpdateAlert";
import { notifyAlertCreated } from "@/lib/alerts/processChangeAlerts";
import { track } from "@/lib/analytics/track";

export interface RunLeiCheckInput {
  paymentId: string;
  organizationId: string;
  vendorId: string;
  vendorLeiNumber: string | null;
  amount: number;
  paymentMethod: PaymentMethod;
}

export interface RecordLeiCheckInput {
  organizationId: string;
  vendorId: string;
  paymentId: string;
  leiNumber: string | null;
  status: LeiCheckStatus;
  rawResponse: unknown;
}

export interface RunLeiCheckDeps {
  checkLei: (leiNumber: string) => Promise<LeiCheckResult>;
  recordLeiCheck: (input: RecordLeiCheckInput) => Promise<{ id: string }>;
  createOrUpdateAlert: (input: CreateOrUpdateAlertInput) => Promise<AlertResult>;
  notifyAlertCreated: (alertId: string, organizationId: string) => Promise<void>;
  /** Chunk 5.1: same "only on creation, best-effort" contract as
   * processChangeAlerts.ts's identically-named dependency. */
  trackAlertCreated: (alertId: string, organizationId: string) => Promise<void>;
}

export type RunLeiCheckResult =
  | { ok: false; reason: "below_threshold" }
  | { ok: true; leiCheckId: string; status: LeiCheckStatus; alertAction: "created" | "updated" | "none" };

const UNFAVORABLE: LeiCheckStatus[] = ["lapsed", "retired", "not_on_record"];

export async function runLeiCheck(
  input: RunLeiCheckInput,
  deps: RunLeiCheckDeps,
): Promise<RunLeiCheckResult> {
  if (!qualifiesForLeiCheck(input.amount, input.paymentMethod)) {
    return { ok: false, reason: "below_threshold" };
  }

  const outcome: LeiCheckResult = input.vendorLeiNumber
    ? await deps.checkLei(input.vendorLeiNumber)
    : {
        leiNumber: "",
        status: "not_on_record",
        rawStatus: null,
        provider: "gleif",
        checkedAt: new Date().toISOString(),
        raw: null,
      };

  const { id: leiCheckId } = await deps.recordLeiCheck({
    organizationId: input.organizationId,
    vendorId: input.vendorId,
    paymentId: input.paymentId,
    leiNumber: input.vendorLeiNumber,
    status: outcome.status,
    rawResponse: outcome.raw,
  });

  if (!UNFAVORABLE.includes(outcome.status)) {
    return { ok: true, leiCheckId, status: outcome.status, alertAction: "none" };
  }

  const alertResult = await deps.createOrUpdateAlert({
    organizationId: input.organizationId,
    vendorId: input.vendorId,
    triggerType: "lei_check",
    sourceCheckId: leiCheckId,
    paymentImpactAmount: input.amount,
  });

  if (alertResult.action === "created") {
    try {
      await deps.notifyAlertCreated(alertResult.alertId, input.organizationId);
    } catch {
      // Non-fatal — same "one failure never aborts" rule as every other
      // alert-email step in this pipeline.
    }
    try {
      await deps.trackAlertCreated(alertResult.alertId, input.organizationId);
    } catch {
      // Best-effort analytics — never break the LEI check pipeline (Chunk 5.1).
    }
  }

  return { ok: true, leiCheckId, status: outcome.status, alertAction: alertResult.action };
}

async function recordLeiCheck(
  supabase: SupabaseClient<Database>,
  input: RecordLeiCheckInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("lei_checks")
    .insert({
      organization_id: input.organizationId,
      vendor_id: input.vendorId,
      payment_id: input.paymentId,
      lei_number: input.leiNumber,
      status: input.status,
      raw_response: input.rawResponse,
    })
    .select("id")
    .single();
  if (error) throw new Error(`record lei check failed: ${error.message}`);
  return { id: data!.id };
}

/** Real wiring, called by the route. */
export async function runLeiCheckForPayment(
  supabase: SupabaseClient<Database>,
  input: RunLeiCheckInput,
): Promise<RunLeiCheckResult> {
  const adapter = createGleifAdapter();
  const alertsClient = supabase as unknown as AlertsClient;
  return runLeiCheck(input, {
    checkLei: (lei) => adapter.checkLei(lei),
    recordLeiCheck: (recordInput) => recordLeiCheck(supabase, recordInput),
    createOrUpdateAlert: (alertInput) => createOrUpdateAlert(alertsClient, alertInput),
    notifyAlertCreated: (alertId, organizationId) => notifyAlertCreated(supabase, alertId, organizationId),
    trackAlertCreated: (alertId, organizationId) =>
      track(supabase, {
        organizationId,
        eventType: "alert_created_tracked",
        payload: { alertId, triggerType: "lei_check" },
      }),
  });
}
