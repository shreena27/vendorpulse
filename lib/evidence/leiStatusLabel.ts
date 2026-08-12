/**
 * LEI as-of status -> human label. Pure, shared by the CSV and PDF
 * formatters so wording never drifts between the two output formats — same
 * rationale as lib/evidence/msmeStatusLabel.ts / lib/alerts/nudgeCopy.ts.
 *
 * `not_applicable` means this payment doesn't qualify for an LEI check at
 * all (below the ₹50cr RTGS/NEFT threshold) — distinct from `no_record`,
 * which means the payment DOES qualify but evidence_log has nothing as of
 * the due date. `no_record` should only ever appear if a write was
 * genuinely missed (the same bug class lib/lei/runLeiCheck.ts's evidence
 * write and the MSME column's readability fix both exist to prevent).
 */

import type { LeiAsOfStatus } from "./buildExport";

const STATUS_VALUE_LABELS: Record<string, string> = {
  issued: "Valid",
  lapsed: "Lapsed",
  retired: "Retired",
  not_on_record: "No LEI on record",
};

export function formatLeiStatusLabel(status: LeiAsOfStatus): string {
  switch (status.kind) {
    case "not_applicable":
      return "Not applicable";
    case "no_record":
      return "No verification record";
    case "checked":
      // An unrecognized statusValue surfaces as-is rather than being
      // silently masked — this is an audit document, it must never hide
      // an unexpected value behind a generic label.
      return STATUS_VALUE_LABELS[status.statusValue] ?? status.statusValue;
  }
}
