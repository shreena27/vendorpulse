/**
 * Product-event writer (Chunk 5.1). SERVER-ONLY.
 *
 * Every Section 11 pilot metric (lib/analytics/metrics.ts) is computed from
 * rows this file writes. `product_events` grants INSERT to service_role
 * only (migration 0013), so every real call site passes an admin client.
 *
 * Deliberately the OPPOSITE failure contract from lib/evidence/logEvent.ts:
 * evidence_log writes must never silently fail (they're the audit trail);
 * product_events writes must never break a real business flow (a lost
 * metric is a shrug, a lost payment-hold is not). track()/trackBatch()
 * catch and log their own errors and never throw — every call site is a
 * plain `await track(...)`, no try/catch needed.
 *
 * `AnalyticsClient` is a single flat `from().insert()` method, the same
 * shape as `EvidenceClient` — shallow enough that a real
 * `SupabaseClient<Database>` satisfies it structurally, no cast needed.
 */

import type { ProductEventType } from "@/lib/supabase/types";

export interface TrackEventInput {
  organizationId: string;
  vendorId?: string | null;
  eventType: ProductEventType;
  payload?: Record<string, unknown>;
  actor?: string;
}

interface ProductEventInsertRow {
  organization_id: string;
  vendor_id: string | null;
  event_type: ProductEventType;
  payload: Record<string, unknown>;
  actor: string;
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface AnalyticsClient {
  from(table: "product_events"): {
    insert(values: ProductEventInsertRow[]): PromiseLike<{ error: { message: string } | null }>;
  };
}

function toRow(event: TrackEventInput): ProductEventInsertRow {
  return {
    organization_id: event.organizationId,
    vendor_id: event.vendorId ?? null,
    event_type: event.eventType,
    payload: event.payload ?? {},
    actor: event.actor ?? "system",
  };
}

export async function track(supabase: AnalyticsClient, event: TrackEventInput): Promise<void> {
  await trackBatch(supabase, [event]);
}

/** No-ops on an empty array — no insert call at all. Never throws: a
 * tracking failure is logged and swallowed, not propagated. */
export async function trackBatch(supabase: AnalyticsClient, events: TrackEventInput[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const { error } = await supabase.from("product_events").insert(events.map(toRow));
    if (error) {
      console.error(`product event tracking failed: ${error.message}`);
    }
  } catch (err) {
    console.error(`product event tracking failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
