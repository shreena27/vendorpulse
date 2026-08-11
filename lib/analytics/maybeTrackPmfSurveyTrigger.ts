/**
 * PMF survey eligibility (Chunk 5.1). SERVER-ONLY.
 *
 * The PRD (Section 11, metric 10) defines what to measure once the Sean
 * Ellis "very disappointed" survey is shown — it does NOT define when to
 * show it. This threshold (3rd actioned alert, no earlier than 14 days
 * after signup) is a first-cut product decision, not a PRD number —
 * tune PMF_SURVEY_ALERT_THRESHOLD / PMF_SURVEY_MIN_DAYS freely.
 *
 * `shouldTriggerPmfSurvey` fires exactly once, at the crossing point
 * (actionedAlertCount === threshold), not "true forever after" — the real
 * wiring below only calls this right after inserting a new alert_actioned
 * event, so the count naturally crosses the threshold exactly once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { track } from "./track";

export const PMF_SURVEY_ALERT_THRESHOLD = 3;
export const PMF_SURVEY_MIN_DAYS = 14;

export function shouldTriggerPmfSurvey(input: {
  actionedAlertCount: number;
  daysSinceSignup: number;
}): boolean {
  return (
    input.actionedAlertCount === PMF_SURVEY_ALERT_THRESHOLD &&
    input.daysSinceSignup >= PMF_SURVEY_MIN_DAYS
  );
}

/** Counts this org's alert_actioned events and org age, and tracks
 * pmf_survey_triggered if this is the crossing point. Called right after
 * app/api/alerts/[id]/action/route.ts records its own alert_actioned event. */
export async function maybeTrackPmfSurveyTrigger(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const [{ count }, { data: org }] = await Promise.all([
    supabase
      .from("product_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("event_type", "alert_actioned"),
    supabase.from("organizations").select("created_at").eq("id", organizationId).single(),
  ]);

  if (!org) return;
  const daysSinceSignup = (Date.now() - new Date(org.created_at).getTime()) / 86_400_000;

  if (shouldTriggerPmfSurvey({ actionedAlertCount: count ?? 0, daysSinceSignup })) {
    await track(supabase, {
      organizationId,
      eventType: "pmf_survey_triggered",
      payload: { reason: "alert_actioned_threshold", threshold: PMF_SURVEY_ALERT_THRESHOLD },
    });
  }
}
