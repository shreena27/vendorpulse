/**
 * CSV rendering for the Clause 22 / Form 3CD export (Chunk 4.2, extended
 * for LEI in a later bugfix). Pure — takes buildExport's rows, no I/O.
 *
 * No Udyam Number column: MSME Status (as of due date) already conveys
 * registration status, so the raw Udyam number is redundant for this
 * report and was removed.
 */

import type { EvidenceExportRow } from "./buildExport";
import { formatMsmeStatusLabel } from "./msmeStatusLabel";
import { formatLeiStatusLabel } from "./leiStatusLabel";

const HEADER = [
  "Payment ID",
  "Due Date",
  "Vendor Name",
  "GSTIN",
  "Amount (INR)",
  "Payment Method",
  "Payment Status",
  "MSME Status (as of due date)",
  "MSME Status Checked At",
  "LEI Status (as of due date)",
  "LEI Status Checked At",
];

// RFC4180: wrap in quotes and double any embedded quote when a field
// contains a comma, quote, or newline.
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRowFields(row: EvidenceExportRow): string[] {
  const msmeCheckedAt = row.msmeStatus.kind === "checked" ? row.msmeStatus.checkedAt : "";
  const leiCheckedAt = row.leiStatus.kind === "checked" ? row.leiStatus.checkedAt : "";
  return [
    row.paymentId,
    row.dueDate,
    row.vendorName,
    row.gstin ?? "",
    row.amount.toFixed(2),
    row.paymentMethod,
    row.paymentStatus,
    formatMsmeStatusLabel(row.msmeStatus),
    msmeCheckedAt,
    formatLeiStatusLabel(row.leiStatus),
    leiCheckedAt,
  ];
}

export function formatExportCsv(rows: EvidenceExportRow[]): string {
  const lines = [HEADER, ...rows.map(toRowFields)].map((fields) => fields.map(csvField).join(","));
  // A leading UTF-8 BOM so Excel on Windows (the target user's likely
  // viewer) reliably detects UTF-8 instead of garbling non-ASCII names.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
