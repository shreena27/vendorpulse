/**
 * Clause 22 / Form 3CD export logic (Chunk 4.2, extended for LEI in a
 * later bugfix). SERVER-ONLY.
 *
 * One row per payment due in the requested range, each carrying the
 * vendor's MSME registration status AND LEI status reconstructed AS OF
 * that specific payment's own due date — never `vendors.current_msme_status`
 * / a live LEI lookup (mutable values that cannot answer "what was true
 * back then"). Sourced entirely from `evidence_log`'s `verification_check`
 * events (payload `checkType: "msme_udyam"` / `"lei"`).
 *
 * `buildExportRows` is the hermetically-testable core (DI, same pattern as
 * `lib/alerts/impactScorer.ts`'s `scoreChange(input, deps)` vs.
 * `scoreChangeForVendor(supabase, input)`) — plain injected async functions,
 * no Supabase type in sight. This query is 5 chained links deep
 * (.select().eq().eq().in().lte().order()), deeper than any interface this
 * codebase has safely hand-rolled before (lib/evidence/logEvent.ts's own
 * comment warns deep chained-builder interfaces are what risks TS2589) —
 * so the real fetch functions are written directly against
 * `SupabaseClient<Database>` instead, matching every function in
 * lib/vendors/queries.ts / lib/alerts/queries.ts.
 *
 * PAN is never read (DPDP exclusion, same rule CLAUDE.md states for
 * evidence_log snapshots, extended here). Alert events are out of scope —
 * only `verification_check` events matter for either column. LEI's
 * "not_applicable" is gated by `qualifiesForLeiCheck` (the same ₹50cr /
 * RTGS-NEFT threshold `lib/lei/runLeiCheck.ts` gates on) rather than a
 * vendor-level flag — LEI status is a per-payment question, MSME status is
 * a per-vendor one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PaymentMethod, PaymentStatus } from "@/lib/supabase/types";
import { qualifiesForLeiCheck } from "@/lib/lei/qualifiesForLeiCheck";

type Client = SupabaseClient<Database>;

/** "YYYY-MM-DD" (an India calendar date) -> end of that day in IST
 * (UTC+5:30, no DST), expressed as a UTC ISO timestamp. This is the first
 * timezone-aware logic in this codebase (everything else is UTC), but
 * `payments.due_date` is inherently an India-calendar date and this export
 * is a compliance document — the boundary matters. */
export function endOfDayIstIso(dateOnly: string): string {
  return `${dateOnly}T18:29:59.999Z`;
}

export type MsmeAsOfStatus =
  | { kind: "not_applicable" } // vendor has no udyam_number — never MSME-checkable
  | { kind: "no_record" } // has udyam_number, but nothing checked as of that date
  | { kind: "checked"; statusValue: string; checkedAt: string }; // statusValue may itself be "UNKNOWN"

export type LeiAsOfStatus =
  | { kind: "not_applicable" } // this payment doesn't qualify for an LEI check (below ₹50cr / not RTGS-NEFT)
  | { kind: "no_record" } // qualifies, but nothing checked as of that date
  | { kind: "checked"; statusValue: string; checkedAt: string }; // statusValue: issued/lapsed/retired/not_on_record

export interface EvidenceExportRow {
  paymentId: string;
  dueDate: string; // "YYYY-MM-DD"
  vendorId: string;
  vendorName: string;
  gstin: string | null;
  amount: number; // Number()'d — PostgREST returns numeric as string
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  msmeStatus: MsmeAsOfStatus;
  leiStatus: LeiAsOfStatus; // pan is never read (DPDP)
}

export interface BuildExportRange {
  from: string; // "YYYY-MM-DD", validated by the caller (route)
  to: string;
}

export interface MsmeEvidenceEntry {
  vendorId: string;
  createdAt: string;
  statusValue: string;
}

/** Pure "as of" reduction for ONE payment's own due_date. `vendorEvidenceAscending`
 * must already be sorted ascending by createdAt (the fetch's own `order()` does this).
 *
 * Confirmed (integration test, not assumed): PostgREST returns `created_at` in
 * Postgres's own textual form (e.g. "2024-01-01T00:00:00+00:00", no trailing
 * zero fractional seconds), not the "...Z" form this module's own
 * `endOfDayIstIso` produces. Plain string `<=` comparison between the two
 * forms is still correct: both use the same zero-padded YYYY-MM-DDTHH:MM:SS
 * prefix, and at the point they diverge ('+' vs '.' vs digit vs 'Z') ASCII
 * ordering happens to match chronological ordering ('+' < '.' < '0'-'9' <
 * 'Z'), so a whole-second value (no fraction, "+00:00" suffix) always sorts
 * before any positive-fraction value at the same whole second, and any
 * differing minute/second digit dominates the comparison regardless of
 * suffix format. */
export function resolveMsmeStatusAsOf(
  udyamNumber: string | null,
  vendorEvidenceAscending: MsmeEvidenceEntry[],
  dueDate: string,
): MsmeAsOfStatus {
  if (!udyamNumber) return { kind: "not_applicable" };

  const cutoff = endOfDayIstIso(dueDate);
  let latest: MsmeEvidenceEntry | null = null;
  for (const e of vendorEvidenceAscending) {
    if (e.createdAt <= cutoff) {
      latest = e; // ascending order: the last one that qualifies is the latest.
    }
  }
  if (!latest) return { kind: "no_record" };
  return { kind: "checked", statusValue: latest.statusValue, checkedAt: latest.createdAt };
}

export interface LeiEvidenceEntry {
  vendorId: string;
  createdAt: string;
  statusValue: string;
}

/** Pure "as of" reduction for ONE payment's own due_date — same shape as
 * resolveMsmeStatusAsOf, but gated by `qualifies` (this payment's own
 * amount/method against the ₹50cr RTGS-NEFT threshold) rather than a
 * vendor-level identifier: LEI status is a per-payment question, not a
 * per-vendor one, since the same vendor's other payments may not qualify. */
export function resolveLeiStatusAsOf(
  qualifies: boolean,
  vendorEvidenceAscending: LeiEvidenceEntry[],
  dueDate: string,
): LeiAsOfStatus {
  if (!qualifies) return { kind: "not_applicable" };

  const cutoff = endOfDayIstIso(dueDate);
  let latest: LeiEvidenceEntry | null = null;
  for (const e of vendorEvidenceAscending) {
    if (e.createdAt <= cutoff) {
      latest = e;
    }
  }
  if (!latest) return { kind: "no_record" };
  return { kind: "checked", statusValue: latest.statusValue, checkedAt: latest.createdAt };
}

export interface PaymentInRange {
  id: string;
  vendorId: string;
  amount: number;
  dueDate: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
}

export interface VendorRef {
  id: string;
  name: string;
  gstin: string | null;
  udyamNumber: string | null;
}

export interface BuildExportDeps {
  fetchPaymentsInRange: (from: string, to: string) => Promise<PaymentInRange[]>;
  fetchVendorsByIds: (ids: string[]) => Promise<VendorRef[]>;
  fetchMsmeEvidence: (vendorIds: string[], cutoffIso: string) => Promise<MsmeEvidenceEntry[]>;
  fetchLeiEvidence: (vendorIds: string[], cutoffIso: string) => Promise<LeiEvidenceEntry[]>;
}

function groupByVendor<T extends { vendorId: string }>(entries: T[]): Map<string, T[]> {
  const byVendor = new Map<string, T[]>();
  for (const e of entries) {
    const list = byVendor.get(e.vendorId) ?? [];
    list.push(e);
    byVendor.set(e.vendorId, list);
  }
  return byVendor;
}

/** Hermetically testable — no Supabase type in sight. */
export async function buildExportRows(
  range: BuildExportRange,
  deps: BuildExportDeps,
): Promise<EvidenceExportRow[]> {
  const payments = await deps.fetchPaymentsInRange(range.from, range.to);
  if (payments.length === 0) return [];

  const vendorIds = [...new Set(payments.map((p) => p.vendorId))];
  const cutoffIso = endOfDayIstIso(range.to);
  const [vendors, msmeEvidence, leiEvidence] = await Promise.all([
    deps.fetchVendorsByIds(vendorIds),
    deps.fetchMsmeEvidence(vendorIds, cutoffIso),
    deps.fetchLeiEvidence(vendorIds, cutoffIso),
  ]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const msmeEvidenceByVendor = groupByVendor(msmeEvidence);
  const leiEvidenceByVendor = groupByVendor(leiEvidence);

  return payments.map((p) => {
    const vendor = vendorById.get(p.vendorId);
    return {
      paymentId: p.id,
      dueDate: p.dueDate,
      vendorId: p.vendorId,
      vendorName: vendor?.name ?? "Unknown vendor",
      gstin: vendor?.gstin ?? null,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      paymentStatus: p.paymentStatus,
      msmeStatus: resolveMsmeStatusAsOf(
        vendor?.udyamNumber ?? null,
        msmeEvidenceByVendor.get(p.vendorId) ?? [],
        p.dueDate,
      ),
      leiStatus: resolveLeiStatusAsOf(
        qualifiesForLeiCheck(p.amount, p.paymentMethod),
        leiEvidenceByVendor.get(p.vendorId) ?? [],
        p.dueDate,
      ),
    };
  });
}

interface CheckedStatusPayload {
  statusValue: string;
}

/** Shared by MSME and LEI evidence fetches — both payloads carry the same
 * `statusValue` shape (see lib/verification/changeDetector.ts's
 * buildCheckEvidenceEvents() for GST/MSME, lib/lei/runLeiCheck.ts for LEI). */
function isCheckedStatusPayload(payload: unknown): payload is CheckedStatusPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).statusValue === "string"
  );
}

async function fetchPaymentsInRange(supabase: Client, from: string, to: string): Promise<PaymentInRange[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, vendor_id, amount, due_date, payment_method, status")
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date", { ascending: true });
  if (error) throw new Error(`list payments for export failed: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    vendorId: p.vendor_id,
    amount: Number(p.amount),
    dueDate: p.due_date,
    paymentMethod: p.payment_method,
    paymentStatus: p.status,
  }));
}

async function fetchVendorsByIds(supabase: Client, ids: string[]): Promise<VendorRef[]> {
  if (ids.length === 0) return [];
  // Never selects `pan` (DPDP — same exclusion CLAUDE.md states for evidence_log snapshots).
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, gstin, udyam_number")
    .in("id", ids);
  if (error) throw new Error(`list vendors for export failed: ${error.message}`);
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    gstin: v.gstin,
    udyamNumber: v.udyam_number,
  }));
}

async function fetchMsmeEvidence(
  supabase: Client,
  vendorIds: string[],
  cutoffIso: string,
): Promise<MsmeEvidenceEntry[]> {
  if (vendorIds.length === 0) return [];
  const { data, error } = await supabase
    .from("evidence_log")
    .select("vendor_id, payload, created_at")
    .eq("event_type", "verification_check")
    .eq("payload->>checkType", "msme_udyam")
    .in("vendor_id", vendorIds)
    .lte("created_at", cutoffIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list msme evidence for export failed: ${error.message}`);
  const entries: MsmeEvidenceEntry[] = [];
  for (const row of data ?? []) {
    if (!isCheckedStatusPayload(row.payload)) continue;
    entries.push({ vendorId: row.vendor_id, createdAt: row.created_at, statusValue: row.payload.statusValue });
  }
  return entries;
}

async function fetchLeiEvidence(
  supabase: Client,
  vendorIds: string[],
  cutoffIso: string,
): Promise<LeiEvidenceEntry[]> {
  if (vendorIds.length === 0) return [];
  const { data, error } = await supabase
    .from("evidence_log")
    .select("vendor_id, payload, created_at")
    .eq("event_type", "verification_check")
    .eq("payload->>checkType", "lei")
    .in("vendor_id", vendorIds)
    .lte("created_at", cutoffIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list lei evidence for export failed: ${error.message}`);
  const entries: LeiEvidenceEntry[] = [];
  for (const row of data ?? []) {
    if (!isCheckedStatusPayload(row.payload)) continue;
    entries.push({ vendorId: row.vendor_id, createdAt: row.created_at, statusValue: row.payload.statusValue });
  }
  return entries;
}

/** Real wiring, called by the route. */
export async function buildExport(supabase: Client, range: BuildExportRange): Promise<EvidenceExportRow[]> {
  return buildExportRows(range, {
    fetchPaymentsInRange: (from, to) => fetchPaymentsInRange(supabase, from, to),
    fetchVendorsByIds: (ids) => fetchVendorsByIds(supabase, ids),
    fetchMsmeEvidence: (vendorIds, cutoffIso) => fetchMsmeEvidence(supabase, vendorIds, cutoffIso),
    fetchLeiEvidence: (vendorIds, cutoffIso) => fetchLeiEvidence(supabase, vendorIds, cutoffIso),
  });
}
