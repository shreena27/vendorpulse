/**
 * Section 11 pilot metrics (Chunk 5.1). SERVER-ONLY, internal/founder-facing
 * — no user-facing API wraps this module.
 *
 * Each `compute*` function is a PURE reducer over already-fetched rows —
 * the same hermetic-core / real-wiring split every orchestrator in this
 * codebase uses (lib/alerts/impactScorer.ts, lib/evidence/buildExport.ts),
 * except here there's no DI deps bag: each function is a single
 * self-contained query, so the "real wiring" half just fetches rows and
 * calls the pure reducer, one per metric, rather than composing several
 * injected steps.
 *
 * Most metrics are org-scoped (a single pilot customer's own numbers).
 * Three (time-to-first-value's KILL signal, pilot-to-paid intent, and the
 * PMF score) are inherently PORTFOLIO-wide per the PRD's own wording
 * ("most customers", "% of pilot customers/users") — a single org can only
 * contribute one data point to a cross-customer percentage, so those live
 * as separate `*Portfolio*` / cohort-wide functions using the admin client
 * across every organization.
 *
 * Two proxies are documented here, not hidden: (1) "alert precision" has no
 * explicit false-positive UI (out of scope for this chunk) — hold/escalate
 * count as "confirmed genuine", reviewed alone does not. (2) The North
 * Star's "held or rerouted" maps to this app's hold/escalate actions;
 * escalate = rerouted to someone else's decision.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface MetricResult {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "percent" | "minutes" | "currency" | "ratio_per_100";
  target: number;
  killSignal: number;
  targetMet: boolean;
  killSignalTriggered: boolean;
  sampleSize: number;
  windowDays: number | null;
  notes?: string;
}

const DEFAULT_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// North Star / Lagging metric #6 — payments held or rerouted
// ---------------------------------------------------------------------------

export function computeNorthStar(
  actionedAlerts: { action: string }[],
  windowDays = DEFAULT_WINDOW_DAYS,
): MetricResult {
  const heldOrRerouted = actionedAlerts.filter((a) => a.action === "hold" || a.action === "escalate").length;
  const totalActioned = actionedAlerts.length;
  return {
    key: "northStar",
    label: "Payments held or rerouted, by the finance head's own choice",
    value: heldOrRerouted,
    unit: "count",
    target: 1,
    killSignal: 0,
    targetMet: heldOrRerouted >= 1,
    // "Alerts get acknowledged but the payment goes out anyway, EVERY time"
    // — only a real kill signal if alerts WERE actioned and NONE were held/escalated.
    killSignalTriggered: totalActioned > 0 && heldOrRerouted === 0,
    sampleSize: totalActioned,
    windowDays,
  };
}

export async function getNorthStarMetric(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<MetricResult> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("product_events")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("event_type", "alert_actioned")
    .gte("created_at", since);
  if (error) throw new Error(`load north star events failed: ${error.message}`);
  const actioned = (data ?? []).map((r) => ({ action: (r.payload as { action?: string })?.action ?? "" }));
  return computeNorthStar(actioned, windowDays);
}

// ---------------------------------------------------------------------------
// Leading metric #1 — vendors connected without IT
// ---------------------------------------------------------------------------

export function computeVendorsConnectedWithoutIt(input: {
  vendorCreatedAts: string[];
  orgCreatedAt: string;
  now: Date;
}): MetricResult {
  const orgCreated = new Date(input.orgCreatedAt).getTime();
  const threeDaysMs = 3 * 86_400_000;
  const daysSinceSignup = (input.now.getTime() - orgCreated) / 86_400_000;

  const total = input.vendorCreatedAts.length;
  const connectedWithin3Days = input.vendorCreatedAts.filter(
    (d) => new Date(d).getTime() - orgCreated <= threeDaysMs,
  ).length;
  const value = total === 0 ? 0 : (connectedWithin3Days / total) * 100;

  const twoWeeksElapsed = daysSinceSignup >= 14;
  return {
    key: "vendorsConnectedWithoutIt",
    label: "Vendors connected without IT, within 3 days of signup",
    value,
    unit: "percent",
    target: 90,
    killSignal: 50,
    targetMet: value >= 90,
    // The kill signal is only evaluable once 2 weeks have actually passed —
    // an org 3 days into its pilot hasn't failed yet, it just hasn't had
    // time to succeed. "or IT has to get involved" has no data signal in
    // this app and is not evaluated here — flagged in notes.
    killSignalTriggered: twoWeeksElapsed && value < 50,
    sampleSize: total,
    windowDays: null,
    notes: twoWeeksElapsed
      ? "Kill signal also includes 'or IT has to get involved' — not machine-derivable from current data; judge manually."
      : "Fewer than 2 weeks since signup — kill-signal verdict withheld as insufficient data.",
  };
}

export async function getVendorsConnectedWithoutIt(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MetricResult> {
  const [{ data: vendors, error: vErr }, { data: org, error: oErr }] = await Promise.all([
    supabase.from("vendors").select("created_at").eq("organization_id", organizationId),
    supabase.from("organizations").select("created_at").eq("id", organizationId).single(),
  ]);
  if (vErr) throw new Error(`load vendors for metric failed: ${vErr.message}`);
  if (oErr || !org) throw new Error(`load organization for metric failed: ${oErr?.message}`);
  return computeVendorsConnectedWithoutIt({
    vendorCreatedAts: (vendors ?? []).map((v) => v.created_at),
    orgCreatedAt: org.created_at,
    now: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Leading metric #2 — time to first value (org-scoped target; portfolio kill signal)
// ---------------------------------------------------------------------------

export function computeTimeToFirstValue(input: {
  /** [vendorCreatedAt, firstCheckedAt | null] pairs. */
  pairs: [string, string | null][];
}): MetricResult {
  const minutes = input.pairs
    .filter((p): p is [string, string] => p[1] !== null)
    .map(([created, checked]) => (new Date(checked).getTime() - new Date(created).getTime()) / 60_000)
    .filter((m) => m >= 0);
  const sorted = [...minutes].sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];

  return {
    key: "timeToFirstValue",
    label: "Time from connecting a vendor to its first real risk status",
    value: median,
    unit: "minutes",
    target: 15,
    // This org's own value against the 1-day (1440 min) ceiling is a
    // reasonable per-org early-warning proxy; the PRD's literal kill
    // signal ("most customers") is portfolio-wide — see
    // getTimeToFirstValuePortfolioKillSignal below.
    killSignal: 1440,
    targetMet: median !== null && median <= 15,
    killSignalTriggered: median !== null && median > 1440,
    sampleSize: minutes.length,
    windowDays: null,
    notes: "The PRD's kill signal ('most customers') is portfolio-wide — see getTimeToFirstValuePortfolioKillSignal.",
  };
}

export async function getTimeToFirstValue(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MetricResult> {
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, created_at")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`load vendors for metric failed: ${error.message}`);
  if (!vendors || vendors.length === 0) return computeTimeToFirstValue({ pairs: [] });

  const { data: checks, error: cErr } = await supabase
    .from("verification_checks")
    .select("vendor_id, checked_at")
    .in("vendor_id", vendors.map((v) => v.id))
    .order("checked_at", { ascending: true });
  if (cErr) throw new Error(`load checks for metric failed: ${cErr.message}`);

  const firstCheckedAtByVendor = new Map<string, string>();
  for (const c of checks ?? []) {
    if (!firstCheckedAtByVendor.has(c.vendor_id)) firstCheckedAtByVendor.set(c.vendor_id, c.checked_at);
  }

  return computeTimeToFirstValue({
    pairs: vendors.map((v) => [v.created_at, firstCheckedAtByVendor.get(v.id) ?? null]),
  });
}

/** Portfolio-wide (all orgs): the PRD's literal kill signal — "takes longer
 * than a day for MOST customers to see any value". Admin-scoped. */
export async function getTimeToFirstValuePortfolioKillSignal(
  supabase: SupabaseClient<Database>,
): Promise<{ pctOverOneDay: number | null; orgCount: number; killSignalTriggered: boolean }> {
  const { data: orgs, error } = await supabase.from("organizations").select("id");
  if (error) throw new Error(`load organizations for metric failed: ${error.message}`);
  const orgIds = (orgs ?? []).map((o) => o.id);
  if (orgIds.length === 0) return { pctOverOneDay: null, orgCount: 0, killSignalTriggered: false };

  const results = await Promise.all(orgIds.map((id) => getTimeToFirstValue(supabase, id)));
  const withData = results.filter((r) => r.value !== null);
  if (withData.length === 0) return { pctOverOneDay: null, orgCount: orgIds.length, killSignalTriggered: false };

  const overOneDay = withData.filter((r) => (r.value as number) > 1440).length;
  const pctOverOneDay = (overOneDay / withData.length) * 100;
  return { pctOverOneDay, orgCount: orgIds.length, killSignalTriggered: pctOverOneDay > 50 };
}

// ---------------------------------------------------------------------------
// Leading metric #3 — status changes detected
// ---------------------------------------------------------------------------

export function computeStatusChangesDetected(input: {
  changeCount: number;
  vendorCount: number;
  windowDays?: number;
}): MetricResult {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const ratePer100 = input.vendorCount === 0 ? 0 : (input.changeCount / input.vendorCount) * 100;
  return {
    key: "statusChangesDetected",
    label: "Real GST/MSME status changes detected",
    value: ratePer100,
    unit: "ratio_per_100",
    target: 1,
    killSignal: 0,
    targetMet: ratePer100 >= 1,
    killSignalTriggered: input.vendorCount > 0 && input.changeCount === 0,
    sampleSize: input.changeCount,
    windowDays,
  };
}

export async function getStatusChangesDetected(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<MetricResult> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const [{ count: changeCount, error: cErr }, { count: vendorCount, error: vErr }] = await Promise.all([
    supabase
      .from("product_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("event_type", "status_change_detected")
      .gte("created_at", since),
    supabase.from("vendors").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  if (cErr) throw new Error(`load change events failed: ${cErr.message}`);
  if (vErr) throw new Error(`load vendor count failed: ${vErr.message}`);
  return computeStatusChangesDetected({ changeCount: changeCount ?? 0, vendorCount: vendorCount ?? 0, windowDays });
}

// ---------------------------------------------------------------------------
// Leading metric #4 — alerts actioned within 24h
// ---------------------------------------------------------------------------

export function computeAlertsActionedWithin24h(
  actioned: { actionedWithin24h: boolean; actionedWithin48h: boolean }[],
  windowDays = DEFAULT_WINDOW_DAYS,
): MetricResult {
  const total = actioned.length;
  const within24h = actioned.filter((a) => a.actionedWithin24h).length;
  const within48h = actioned.filter((a) => a.actionedWithin48h).length;
  const pct24h = total === 0 ? 0 : (within24h / total) * 100;
  const pct48h = total === 0 ? 0 : (within48h / total) * 100;
  return {
    key: "alertsActionedWithin24h",
    label: "Alerts actioned within 24 hours",
    value: pct24h,
    unit: "percent",
    target: 80,
    killSignal: 30,
    targetMet: pct24h >= 80,
    killSignalTriggered: total > 0 && pct48h < 30,
    sampleSize: total,
    windowDays,
  };
}

export async function getAlertsActionedWithin24h(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<MetricResult> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("product_events")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("event_type", "alert_actioned")
    .gte("created_at", since);
  if (error) throw new Error(`load alert_actioned events failed: ${error.message}`);
  const rows = (data ?? []).map((r) => {
    const p = r.payload as { actionedWithin24h?: boolean; actionedWithin48h?: boolean };
    return { actionedWithin24h: Boolean(p?.actionedWithin24h), actionedWithin48h: Boolean(p?.actionedWithin48h) };
  });
  return computeAlertsActionedWithin24h(rows, windowDays);
}

// ---------------------------------------------------------------------------
// Leading metric #5 — alert precision
// ---------------------------------------------------------------------------

export function computeAlertPrecision(actions: string[], windowDays = DEFAULT_WINDOW_DAYS): MetricResult {
  const total = actions.length;
  // Proxy, documented at the top of this file: hold/escalate = confirmed
  // genuine; reviewed alone does not count. No false-positive UI exists yet.
  const confirmedGenuine = actions.filter((a) => a === "hold" || a === "escalate").length;
  const value = total === 0 ? 0 : (confirmedGenuine / total) * 100;
  return {
    key: "alertPrecision",
    label: "Alert precision (real issue, not noise)",
    value,
    unit: "percent",
    target: 90,
    killSignal: 60,
    targetMet: value >= 90,
    killSignalTriggered: total > 0 && value < 60,
    sampleSize: total,
    windowDays,
    notes: "Proxy: hold/escalate count as confirmed genuine; reviewed alone does not (no false-positive UI yet).",
  };
}

export async function getAlertPrecision(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<MetricResult> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("product_events")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("event_type", "alert_actioned")
    .gte("created_at", since);
  if (error) throw new Error(`load alert_actioned events failed: ${error.message}`);
  const actions = (data ?? []).map((r) => (r.payload as { action?: string })?.action ?? "");
  return computeAlertPrecision(actions, windowDays);
}

// ---------------------------------------------------------------------------
// Lagging metric #7 — bank/cert issues caught at onboarding
// ---------------------------------------------------------------------------

export function computeBankCertIssuesCaught(issueCount: number): MetricResult {
  return {
    key: "bankCertIssuesCaught",
    label: "Bank or certificate issues caught at onboarding",
    value: issueCount,
    unit: "count",
    target: 1,
    killSignal: 0,
    targetMet: issueCount >= 1,
    killSignalTriggered: false, // Only evaluable across ALL pilots — see notes.
    sampleSize: issueCount,
    windowDays: null,
    notes: "Kill signal ('zero across ALL pilots') is portfolio-wide, not meaningful for a single org.",
  };
}

export async function getBankCertIssuesCaught(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MetricResult> {
  const { count, error } = await supabase
    .from("product_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("event_type", "bank_cert_issue_caught");
  if (error) throw new Error(`load bank/cert issue events failed: ${error.message}`);
  return computeBankCertIssuesCaught(count ?? 0);
}

// ---------------------------------------------------------------------------
// Lagging metric #8 — audit prep time saved (self-reported)
// ---------------------------------------------------------------------------

export function computeAuditTimeSaved(percentReductions: number[], windowDays = DEFAULT_WINDOW_DAYS): MetricResult {
  const sampleSize = percentReductions.length;
  const value = sampleSize === 0 ? null : percentReductions.reduce((a, b) => a + b, 0) / sampleSize;
  return {
    key: "auditTimeSaved",
    label: "Audit prep time saved (self-reported)",
    value,
    unit: "percent",
    target: 30,
    killSignal: 0,
    targetMet: value !== null && value >= 30,
    killSignalTriggered: value !== null && value <= 0,
    sampleSize,
    windowDays,
    notes: "Self-reported — no automatic app trigger exists yet; a report is submitted via track() directly (no survey UI in this chunk).",
  };
}

export async function getAuditTimeSaved(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<MetricResult> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("product_events")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("event_type", "audit_time_saved_reported")
    .gte("created_at", since);
  if (error) throw new Error(`load audit_time_saved_reported events failed: ${error.message}`);
  const values = (data ?? [])
    .map((r) => (r.payload as { percentReduction?: number })?.percentReduction)
    .filter((v): v is number => typeof v === "number");
  return computeAuditTimeSaved(values, windowDays);
}

// ---------------------------------------------------------------------------
// Lagging metric #9 — pilot-to-paid intent (portfolio-wide, self-reported)
// ---------------------------------------------------------------------------

export async function getPilotToPaidIntent(
  supabase: SupabaseClient<Database>,
): Promise<MetricResult> {
  const { data, error } = await supabase.from("product_events").select("payload").eq("event_type", "pilot_to_paid_intent_signal");
  if (error) throw new Error(`load pilot_to_paid_intent_signal events failed: ${error.message}`);
  const intents = (data ?? []).map((r) => (r.payload as { intent?: string })?.intent ?? "");
  const total = intents.length;
  const yes = intents.filter((i) => i === "yes").length;
  const anyIntent = intents.filter((i) => i === "yes" || i === "maybe").length;
  const pctYes = total === 0 ? 0 : (yes / total) * 100;
  const pctAnyIntent = total === 0 ? 0 : (anyIntent / total) * 100;
  return {
    key: "pilotToPaidIntent",
    label: "Pilot-to-paid intent",
    value: pctYes,
    unit: "percent",
    target: 50,
    killSignal: 20,
    targetMet: pctYes >= 50,
    killSignalTriggered: total > 0 && pctAnyIntent < 20,
    sampleSize: total,
    windowDays: null,
    notes: "Portfolio-wide (% of ALL pilot customers) — self-reported, no automatic app trigger exists yet.",
  };
}

// ---------------------------------------------------------------------------
// Lagging metric #10 — Sean Ellis PMF score (portfolio-wide, self-reported)
// ---------------------------------------------------------------------------

export async function getPmfSurveyScore(
  supabase: SupabaseClient<Database>,
): Promise<MetricResult> {
  const { data, error } = await supabase.from("product_events").select("payload").eq("event_type", "pmf_survey_response");
  if (error) throw new Error(`load pmf_survey_response events failed: ${error.message}`);
  const responses = (data ?? []).map((r) => (r.payload as { sentiment?: string })?.sentiment ?? "");
  const total = responses.length;
  const veryDisappointed = responses.filter((s) => s === "very_disappointed").length;
  const value = total === 0 ? 0 : (veryDisappointed / total) * 100;
  return {
    key: "pmfSurveyScore",
    label: "Would be 'very disappointed' without it (Sean Ellis PMF test)",
    value,
    unit: "percent",
    target: 40,
    killSignal: 20,
    targetMet: value >= 40,
    killSignalTriggered: total > 0 && value < 20,
    sampleSize: total,
    windowDays: null,
    notes: "Portfolio-wide (% of ALL pilot users) — self-reported, no automatic app trigger exists yet.",
  };
}

// ---------------------------------------------------------------------------
// Convenience aggregate — every org-scoped metric in one call
// ---------------------------------------------------------------------------

export async function getSection11Metrics(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<{
  northStar: MetricResult;
  vendorsConnectedWithoutIt: MetricResult;
  timeToFirstValue: MetricResult;
  statusChangesDetected: MetricResult;
  alertsActionedWithin24h: MetricResult;
  alertPrecision: MetricResult;
  bankCertIssuesCaught: MetricResult;
  auditTimeSaved: MetricResult;
}> {
  const [
    northStar,
    vendorsConnectedWithoutIt,
    timeToFirstValue,
    statusChangesDetected,
    alertsActionedWithin24h,
    alertPrecision,
    bankCertIssuesCaught,
    auditTimeSaved,
  ] = await Promise.all([
    getNorthStarMetric(supabase, organizationId, windowDays),
    getVendorsConnectedWithoutIt(supabase, organizationId),
    getTimeToFirstValue(supabase, organizationId),
    getStatusChangesDetected(supabase, organizationId, windowDays),
    getAlertsActionedWithin24h(supabase, organizationId, windowDays),
    getAlertPrecision(supabase, organizationId, windowDays),
    getBankCertIssuesCaught(supabase, organizationId),
    getAuditTimeSaved(supabase, organizationId, windowDays),
  ]);
  return {
    northStar,
    vendorsConnectedWithoutIt,
    timeToFirstValue,
    statusChangesDetected,
    alertsActionedWithin24h,
    alertPrecision,
    bankCertIssuesCaught,
    auditTimeSaved,
  };
}
