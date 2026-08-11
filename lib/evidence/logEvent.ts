/**
 * Evidence log writer (Chunk 4.1). SERVER-ONLY.
 *
 * The one write path for `evidence_log` (ERD "Persistent data rules": an
 * append-only record of every check, change, and decision). There is no RPC
 * and never will be — the table itself grants only SELECT + INSERT to
 * service_role and nothing to authenticated (supabase/migrations/0009_evidence_log.sql),
 * so this function's caller must always be running as the service role (an
 * admin client, or an equally privileged real Supabase client).
 *
 * `EvidenceClient` is deliberately a single flat method (`from().insert()`),
 * the same shape as the RpcClient pattern in lib/bank/verifyVendorBank.ts —
 * shallow enough that a real `SupabaseClient<Database>` satisfies it
 * structurally at every call site, no cast needed (the deep chained-builder
 * interfaces elsewhere in this codebase are what triggers TS2589, not this).
 */

import type { EvidenceEventType } from "@/lib/supabase/types";

export interface EvidenceEventInput {
  organizationId: string;
  vendorId: string;
  eventType: EvidenceEventType;
  /** The source table this event points into: "verification_checks" | "alerts". */
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  /** "system" for cron/pipeline events (the default); a user id for a
   * human-triggered event like an alert resolution. */
  actor?: string;
}

interface EvidenceLogInsertRow {
  organization_id: string;
  vendor_id: string;
  event_type: EvidenceEventType;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  actor: string;
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface EvidenceClient {
  from(table: "evidence_log"): {
    insert(
      values: EvidenceLogInsertRow[],
    ): PromiseLike<{ error: { message: string } | null }>;
  };
}

function toRow(event: EvidenceEventInput): EvidenceLogInsertRow {
  return {
    organization_id: event.organizationId,
    vendor_id: event.vendorId,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    payload: event.payload,
    actor: event.actor ?? "system",
  };
}

export async function logEvent(
  supabase: EvidenceClient,
  event: EvidenceEventInput,
): Promise<void> {
  await logEvents(supabase, [event]);
}

/** No-ops on an empty array — no insert call at all, not an insert of zero rows. */
export async function logEvents(
  supabase: EvidenceClient,
  events: EvidenceEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  const { error } = await supabase.from("evidence_log").insert(events.map(toRow));
  if (error) {
    throw new Error(`evidence log write failed: ${error.message}`);
  }
}
