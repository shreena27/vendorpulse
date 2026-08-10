/**
 * Per-row validation for a vendor bulk import (ERD §7).
 *
 * Pure functions, no I/O — safe to unit test and to run inside the route
 * handler. The route maps each source row onto the schema fields, then calls
 * `validateVendorRow`. Hard errors reject a single row (the rest of the import
 * still proceeds); a soft warning keeps the vendor but records the issue.
 */

import type { VendorImportInput } from "@/lib/supabase/types";

/** Schema fields a source column can map to. `name` is required. */
export const SCHEMA_FIELDS = [
  "name",
  "gstin",
  "udyam_number",
  "pan",
  "bank_account_number",
  "bank_ifsc",
] as const;
export type SchemaField = (typeof SCHEMA_FIELDS)[number];

/** Maps each schema field to the source column header it should read from. */
export type ColumnMapping = Partial<Record<SchemaField, string>>;

/** A row after its source columns have been mapped onto schema fields. */
export type MappedRow = Partial<Record<SchemaField, string>>;

/** One validation problem, tied to the row number the user sees (1-based). */
export type RowIssue = { row: number; field: string; message: string };

export type RowResult =
  | {
      ok: true;
      vendor: VendorImportInput;
      warnings: RowIssue[];
      bankDetails: BankDetails | null;
    }
  | { ok: false; errors: RowIssue[] };

// 15-char GSTIN: 2 state digits, 5 PAN letters, 4 digits, 1 letter, 1 entity
// char, literal 'Z', 1 checksum char.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// Udyam registration number, e.g. UDYAM-MH-01-0000001.
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
// Indian bank account number: 9-18 digits (no fixed standard length).
export const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;
// IFSC: 4 bank-code letters, literal '0', 6 branch-code alphanumerics.
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Raw bank details for a row, used once (Chunk 2.1) then discarded — never
 * part of VendorImportInput, so they never reach the vendors table. */
export type BankDetails = { accountNumber: string; ifsc: string };

/** Read a mapped field, trimmed; returns "" when unmapped or blank. */
function value(row: MappedRow, field: SchemaField): string {
  return (row[field] ?? "").trim();
}

/** Build a mapped row from a raw source row and the user's column mapping. */
export function applyMapping(
  sourceRow: Record<string, string>,
  mapping: ColumnMapping,
): MappedRow {
  const mapped: MappedRow = {};
  for (const field of SCHEMA_FIELDS) {
    const header = mapping[field];
    if (header && header in sourceRow) {
      mapped[field] = sourceRow[header];
    }
  }
  return mapped;
}

/**
 * Validate one mapped row.
 *
 * - Missing `name` -> hard error (row rejected).
 * - GSTIN present but malformed -> hard error (row rejected).
 * - No GSTIN at all -> allowed; current_gst_status = 'not_applicable'.
 * - Udyam present but malformed -> soft warning: keep the vendor, drop the
 *   udyam value, current_msme_status = 'unknown'.
 * - PAN -> stored as-is (personal data; not validated here).
 */
export function validateVendorRow(row: MappedRow, rowNumber: number): RowResult {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  const name = value(row, "name");
  const gstin = value(row, "gstin");
  const udyam = value(row, "udyam_number");
  const pan = value(row, "pan");
  const bankAccountNumber = value(row, "bank_account_number");
  const bankIfsc = value(row, "bank_ifsc");

  if (!name) {
    errors.push({ row: rowNumber, field: "name", message: "Name is required." });
  }

  let gstinValue: string | null = null;
  if (gstin) {
    const normalized = gstin.toUpperCase();
    if (GSTIN_REGEX.test(normalized)) {
      gstinValue = normalized;
    } else {
      errors.push({
        row: rowNumber,
        field: "gstin",
        message: `Invalid GSTIN format: "${gstin}".`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Soft: a malformed Udyam does not reject the row. Drop the value and leave
  // MSME status unknown until it is corrected.
  let udyamValue: string | null = null;
  if (udyam) {
    const normalized = udyam.toUpperCase();
    if (UDYAM_REGEX.test(normalized)) {
      udyamValue = normalized;
    } else {
      warnings.push({
        row: rowNumber,
        field: "udyam_number",
        message: `Invalid Udyam format: "${udyam}". Vendor saved; MSME status left unknown.`,
      });
    }
  }

  const vendor: VendorImportInput = {
    name,
    gstin: gstinValue,
    udyam_number: udyamValue,
    pan: pan || null,
    // No GSTIN means GST monitoring does not apply; a present GSTIN stays
    // 'unknown' until the first poll (Chunk 1.4).
    current_gst_status: gstinValue ? "unknown" : "not_applicable",
    current_msme_status: "unknown",
    current_bank_status: "unverified",
    source: "excel",
  };

  // Soft: bad or incomplete bank details never reject the row. The vendor is
  // saved without a bank check (stays 'unverified') until corrected or
  // supplied via a manual flag. Raw values live only in this function's
  // return value — they never enter `vendor` / VendorImportInput.
  let bankDetails: BankDetails | null = null;
  if (bankAccountNumber && bankIfsc) {
    if (!ACCOUNT_NUMBER_REGEX.test(bankAccountNumber)) {
      warnings.push({
        row: rowNumber,
        field: "bank_account_number",
        message: `Invalid bank account number: "${bankAccountNumber}". Vendor saved; bank verification skipped.`,
      });
    } else if (!IFSC_REGEX.test(bankIfsc.toUpperCase())) {
      warnings.push({
        row: rowNumber,
        field: "bank_ifsc",
        message: `Invalid IFSC: "${bankIfsc}". Vendor saved; bank verification skipped.`,
      });
    } else {
      bankDetails = { accountNumber: bankAccountNumber, ifsc: bankIfsc.toUpperCase() };
    }
  } else if (bankAccountNumber || bankIfsc) {
    warnings.push({
      row: rowNumber,
      field: bankAccountNumber ? "bank_ifsc" : "bank_account_number",
      message:
        "Bank account number and IFSC must both be provided to verify. Vendor saved; bank verification skipped.",
    });
  }

  return { ok: true, vendor, warnings, bankDetails };
}
