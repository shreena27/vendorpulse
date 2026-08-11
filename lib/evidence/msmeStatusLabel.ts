/**
 * MSME as-of status -> human label (Chunk 4.2). Pure, shared by the CSV and
 * PDF formatters so wording never drifts between the two output formats —
 * same rationale as lib/alerts/nudgeCopy.ts / lib/vendors/statusBadge.ts.
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
      return "Not applicable";
    case "no_record":
      return "No record";
    case "checked":
      // An unrecognized statusValue surfaces as-is rather than being
      // silently masked — this is an audit document, it must never hide
      // an unexpected value behind a generic label.
      return STATUS_VALUE_LABELS[status.statusValue] ?? status.statusValue;
  }
}
