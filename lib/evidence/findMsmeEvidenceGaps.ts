/**
 * Regression check for the "verification_checks written without a matching
 * evidence_log entry" bug class (found 2026-08-12: Vishwakarma Tooling
 * Industries' genuine MSME Lapsed status showed as "No record" in the
 * Clause 22 / Form 3CD export, because its checks were seeded directly into
 * `verification_checks` and never went through Chunk 4.1's
 * buildCheckEvidenceEvents()/logEvents() — the only path buildExport.ts
 * (Chunk 4.2) reads).
 *
 * Any vendor with a non-null `udyam_number` that has at least one
 * `msme_udyam` `verification_checks` row but zero matching `evidence_log`
 * rows has hit this exact bug: buildExport.ts can never see that vendor's
 * real status for any due date, no matter what actually happened, and will
 * always report "No record". A vendor that has simply never been checked
 * yet (no verification_checks row at all) is NOT a gap — that's the
 * legitimate "no_record" case buildExport.ts already models.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export interface VendorForGapCheck {
  id: string;
  name: string;
  udyamNumber: string | null;
}

export interface MsmeEvidenceGap {
  vendorId: string;
  vendorName: string;
}

export interface FindMsmeEvidenceGapsInput {
  vendors: VendorForGapCheck[];
  /** Vendor ids with >=1 verification_checks row where check_type = 'msme_udyam'. */
  vendorIdsWithMsmeChecks: ReadonlySet<string>;
  /** Vendor ids with >=1 evidence_log row where event_type = 'verification_check'
   * and payload.checkType = 'msme_udyam'. */
  vendorIdsWithMsmeEvidence: ReadonlySet<string>;
}

/** Pure — hermetically testable, same DI split as lib/alerts/impactScorer.ts. */
export function findMsmeEvidenceGaps(input: FindMsmeEvidenceGapsInput): MsmeEvidenceGap[] {
  const gaps: MsmeEvidenceGap[] = [];
  for (const vendor of input.vendors) {
    if (!vendor.udyamNumber) continue; // never MSME-checkable — not a gap
    if (!input.vendorIdsWithMsmeChecks.has(vendor.id)) continue; // never checked yet — legitimate no_record
    if (input.vendorIdsWithMsmeEvidence.has(vendor.id)) continue; // has evidence — fine
    gaps.push({ vendorId: vendor.id, vendorName: vendor.name });
  }
  return gaps;
}

interface MsmeCheckTypePayload {
  checkType: string;
}

function isMsmeCheckTypePayload(payload: unknown): payload is MsmeCheckTypePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Record<string, unknown>).checkType === "msme_udyam"
  );
}

/** Real wiring — scoped to one org (RLS-scoped client or the admin client
 * plus an explicit organization_id filter, same pattern as every other
 * org-scoped query in this codebase). */
export async function findMsmeEvidenceGapsForOrg(
  supabase: Client,
  organizationId: string,
): Promise<MsmeEvidenceGap[]> {
  const [vendorsRes, checksRes, evidenceRes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, udyam_number")
      .eq("organization_id", organizationId)
      .not("udyam_number", "is", null),
    supabase
      .from("verification_checks")
      .select("vendor_id")
      .eq("organization_id", organizationId)
      .eq("check_type", "msme_udyam"),
    supabase
      .from("evidence_log")
      .select("vendor_id, payload")
      .eq("organization_id", organizationId)
      .eq("event_type", "verification_check"),
  ]);
  if (vendorsRes.error) throw new Error(`list vendors for gap check failed: ${vendorsRes.error.message}`);
  if (checksRes.error) throw new Error(`list checks for gap check failed: ${checksRes.error.message}`);
  if (evidenceRes.error) throw new Error(`list evidence for gap check failed: ${evidenceRes.error.message}`);

  const vendorIdsWithMsmeChecks = new Set((checksRes.data ?? []).map((c) => c.vendor_id));
  const vendorIdsWithMsmeEvidence = new Set(
    (evidenceRes.data ?? [])
      .filter((e) => isMsmeCheckTypePayload(e.payload))
      .map((e) => e.vendor_id),
  );

  return findMsmeEvidenceGaps({
    vendors: (vendorsRes.data ?? []).map((v) => ({ id: v.id, name: v.name, udyamNumber: v.udyam_number })),
    vendorIdsWithMsmeChecks,
    vendorIdsWithMsmeEvidence,
  });
}
