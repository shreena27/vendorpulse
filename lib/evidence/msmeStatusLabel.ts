/**
 * MSME as-of status -> human label (Chunk 4.2). Pure, shared by the CSV and
 * PDF formatters so wording never drifts between the two output formats —
 * same rationale as lib/alerts/nudgeCopy.ts / lib/vendors/statusBadge.ts.
 *
 * Bugfix (2026-08-12): the export table used to overload "Not applicable"
 * for both "this vendor has no Udyam number" and left an auditor to
 * cross-check the (sometimes blank-looking) Udyam Number column to tell
 * that apart from a real gap. Three distinct labels now read correctly off
 * this one column alone: "Not MSME-registered" (no Udyam number — the
 * vendor was never MSME-checkable), "No verification record" (has a Udyam
 * number, but evidence_log has nothing as of the due date — this should
 * only ever appear if a write was genuinely missed, per
 * lib/evidence/findMsmeEvidenceGaps.ts), and the real reconstructed status.
 */

import type { MsmeAsOfStatus } from "./buildExport";

const STATUS_VALUE_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  LAPSED: "Lapsed",
  NOT_MSME: "Not MSME",
  UNKNOWN: "Unknown",
};

export function formatMsmeStatusLabel(status: MsmeAsOfStatus): string {
  switch (status.kind) {
    case "not_applicable":
      return "Not MSME-registered";
    case "no_record":
      return "No verification record";
    case "checked":
      // An unrecognized statusValue surfaces as-is rather than being
      // silently masked — this is an audit document, it must never hide
      // an unexpected value behind a generic label.
      return STATUS_VALUE_LABELS[status.statusValue] ?? status.statusValue;
  }
}

/** The Udyam Number column must never be left blank — an auditor should
 * never have to infer "no Udyam number" from an empty cell. */
export function formatUdyamNumberField(udyamNumber: string | null): string {
  return udyamNumber ?? "Not registered";
}
