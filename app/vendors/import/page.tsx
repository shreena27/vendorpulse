"use client";

import { useState } from "react";
import Link from "next/link";
import { parseVendorFile } from "@/lib/import/parseVendorFile";
import {
  SCHEMA_FIELDS,
  type ColumnMapping,
  type SchemaField,
  type RowIssue,
} from "@/lib/import/validateVendorRow";
import { AppNav } from "@/app/components/AppNav";

type ImportResult = {
  importId: string;
  total: number;
  inserted: number;
  errorCount: number;
  errors: RowIssue[];
  warnings: RowIssue[];
  bankVerifications?: {
    verified: number;
    manualReview: number;
    mismatch: number;
    skipped: number;
  };
};

const FIELD_LABELS: Record<SchemaField, string> = {
  name: "Vendor name",
  gstin: "GSTIN",
  udyam_number: "Udyam number",
  pan: "PAN",
  bank_account_number: "Bank account number",
  bank_ifsc: "IFSC",
};

// Decorative only — each field's icon in the mapping row (Stitch's
// "Detected Header" column icon treatment). Doesn't affect mapping logic.
const FIELD_ICONS: Record<SchemaField, string> = {
  name: "match_case",
  gstin: "tag",
  udyam_number: "badge",
  pan: "fingerprint",
  bank_account_number: "account_balance",
  bank_ifsc: "pin",
};

const REQUIRED_FIELDS: SchemaField[] = ["name"];

// Guess which source column feeds each schema field, by header keyword.
const GUESS_PATTERNS: Record<SchemaField, RegExp> = {
  name: /name|vendor|party|supplier/i,
  gstin: /gst/i,
  udyam_number: /udyam|msme/i,
  pan: /pan/i,
  bank_account_number: /account|bank/i,
  bank_ifsc: /ifsc/i,
};

function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const field of SCHEMA_FIELDS) {
    const match = headers.find(
      (h) => !used.has(h) && GUESS_PATTERNS[field].test(h),
    );
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

export default function ImportVendorsPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setResult(null);
    setSubmitError(null);
    setParseError(null);
    setHeaders([]);
    setPreviewRows([]);
    setMapping({});
    setFile(picked);
    setFileName(picked?.name ?? null);
    if (!picked) return;

    try {
      const { headers: parsedHeaders, rows } = await parseVendorFile(picked);
      if (parsedHeaders.length === 0 || rows.length === 0) {
        setParseError("This file has no rows to import.");
        return;
      }
      setHeaders(parsedHeaders);
      setPreviewRows(rows.slice(0, 3));
      setMapping(guessMapping(parsedHeaders));
    } catch {
      setParseError("Could not read this file. Choose a valid CSV or XLSX.");
    }
  }

  function setFieldColumn(field: SchemaField, header: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (header) next[field] = header;
      else delete next[field];
      return next;
    });
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);

    const body = new FormData();
    body.set("file", file);
    body.set("mapping", JSON.stringify(mapping));

    try {
      const res = await fetch("/api/vendors/import", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Import failed.");
        return;
      }
      setResult(data as ImportResult);
    } catch {
      setSubmitError("Import failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !!file && headers.length > 0 && !!mapping.name && !submitting;

  // Decorative "Auto-mapped X/Y" chip — a real count off the already-guessed
  // mapping state, not a fabricated Stitch-style number.
  const mappedCount = SCHEMA_FIELDS.filter((f) => !!mapping[f]).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-stack-lg px-margin-x-mobile py-stack-lg md:px-margin-x-desktop">
        {/* Header + decorative step indicator */}
        <div className="flex flex-col gap-stack-md md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-base">
            <h1 className="font-headline-xl text-headline-lg-mobile text-on-surface md:text-headline-xl">
              Import vendors
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              Upload a CSV or XLSX export from Tally, Excel, or your ERP. Map
              its columns, then import.
            </p>
          </div>

          {/* Purely presentational — lit up from headers.length, no new logic. */}
          <div aria-hidden="true" className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  file
                    ? "bg-primary text-on-primary"
                    : "border-2 border-primary text-primary"
                }`}
              >
                {file ? (
                  <span className="material-symbols-outlined text-[18px]">
                    check
                  </span>
                ) : (
                  <span className="font-label-md text-label-md">1</span>
                )}
              </div>
              <span
                className={`font-label-md text-label-md ${
                  file ? "text-primary" : "text-on-surface"
                }`}
              >
                Choose file
              </span>
            </div>
            <div className="h-[2px] w-12 bg-outline-variant/50" />
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full font-label-md text-label-md ${
                  headers.length > 0
                    ? "bg-primary text-on-primary"
                    : "border-2 border-outline-variant text-outline"
                }`}
              >
                2
              </div>
              <span
                className={`font-label-md text-label-md ${
                  headers.length > 0
                    ? "text-primary"
                    : "text-on-surface-variant"
                }`}
              >
                Map columns
              </span>
            </div>
          </div>
        </div>

        {/* Step 1 — file */}
        <section className="ambient-shadow flex flex-col gap-stack-md rounded-xl border border-surface-container bg-surface-container-lowest p-gutter">
          <h2 className="font-headline-md text-headline-md text-on-surface">
            Source file
          </h2>
          <div className="flex flex-col gap-stack-sm">
            <label
              htmlFor="vendor-file"
              className="font-label-md text-label-md uppercase tracking-wide text-on-surface-variant"
            >
              1. Choose a file
            </label>
            <input
              id="vendor-file"
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFile}
              className="block font-body-sm text-body-sm text-on-surface-variant file:mr-4 file:rounded-full file:border file:border-primary file:bg-transparent file:px-4 file:py-1.5 file:font-label-md file:text-label-sm file:text-primary hover:file:bg-primary/5"
            />
            {fileName && !parseError && (
              <p className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">
                <span
                  aria-hidden
                  className="material-symbols-outlined text-[18px] text-primary"
                >
                  description
                </span>
                {fileName} —{" "}
                {previewRows.length > 0 ? "ready to map" : "reading…"}
              </p>
            )}
            {parseError && (
              <p role="alert" className="font-body-sm text-body-sm text-error">
                {parseError}
              </p>
            )}
          </div>
        </section>

        {/* Step 2 — mapping */}
        {headers.length > 0 && (
          <section className="ambient-shadow flex flex-col overflow-hidden rounded-xl border border-surface-container bg-surface-container-lowest">
            <div className="flex flex-col gap-stack-sm border-b border-surface-container bg-surface-bright p-gutter md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-headline-md text-headline-md text-on-surface">
                  2. Map columns
                </h2>
                <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                  Match your spreadsheet headers to VendorPulse system fields.
                </p>
              </div>
              <div className="flex w-fit items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  auto_awesome
                </span>
                <span className="font-label-sm text-label-sm text-on-surface">
                  Auto-mapped {mappedCount}/{SCHEMA_FIELDS.length}
                </span>
              </div>
            </div>

            <div className="flex flex-col divide-y divide-surface-container">
              {SCHEMA_FIELDS.map((field) => (
                <div
                  key={field}
                  className="flex flex-col gap-stack-sm px-gutter py-stack-md transition-colors hover:bg-surface-container-low/30 md:flex-row md:items-center md:justify-between"
                >
                  <span className="flex items-center gap-2 font-label-md text-label-md text-on-surface">
                    <span
                      aria-hidden
                      className="material-symbols-outlined text-[18px] text-outline"
                    >
                      {FIELD_ICONS[field]}
                    </span>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && (
                      <span className="text-error"> *</span>
                    )}
                  </span>
                  <div className="relative w-full md:w-64">
                    <select
                      aria-label={`Column for ${FIELD_LABELS[field]}`}
                      value={mapping[field] ?? ""}
                      onChange={(e) => setFieldColumn(field, e.target.value)}
                      className="w-full appearance-none rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 pr-8 font-body-md text-body-md text-on-surface transition-shadow focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus:ring-opacity-50"
                    >
                      <option value="">— not mapped —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span
                      aria-hidden
                      className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-outline"
                    >
                      expand_more
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {previewRows.length > 0 && (
              <details className="border-t border-surface-container px-gutter py-stack-md font-body-sm text-body-sm text-on-surface-variant">
                <summary className="cursor-pointer font-label-md text-label-md text-primary">
                  Preview first rows
                </summary>
                <div className="mt-2 overflow-x-auto rounded-lg border border-surface-container">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-surface-container-low">
                        {headers.map((h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap border-b border-surface-container px-3 py-2 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="zebra-row">
                          {headers.map((h) => (
                            <td
                              key={h}
                              className="border-b border-surface-container/50 px-3 py-2 font-mono text-body-sm text-on-surface"
                            >
                              {r[h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        )}

        {/* Step 3 — import */}
        {headers.length > 0 && (
          <section className="flex flex-col gap-stack-sm">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex w-fit items-center gap-2 rounded-lg bg-primary px-8 py-2.5 font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-primary"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                publish
              </span>
              {submitting ? "Importing…" : "Import vendors"}
            </button>
            {submitError && (
              <p role="alert" className="font-body-sm text-body-sm text-error">
                {submitError}
              </p>
            )}
          </section>
        )}

        {/* Result report */}
        {result && (
          <section className="ambient-shadow flex flex-col gap-stack-md rounded-xl border border-surface-container bg-surface-container-lowest p-gutter">
            <h2 className="font-headline-md text-headline-md text-on-surface">
              Imported {result.inserted} of {result.total} vendors
            </h2>
            {result.errorCount > 0 ? (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {result.errorCount}{" "}
                {result.errorCount === 1 ? "row was" : "rows were"} skipped.
              </p>
            ) : (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Every row imported cleanly.
              </p>
            )}

            {result.bankVerifications && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Bank check: {result.bankVerifications.verified} verified,{" "}
                {result.bankVerifications.manualReview} need manual review,{" "}
                {result.bankVerifications.mismatch} mismatched
                {result.bankVerifications.skipped > 0 &&
                  `, ${result.bankVerifications.skipped} skipped`}
                .
              </p>
            )}

            {result.errors.length > 0 && (
              <div className="flex flex-col gap-stack-sm">
                <h3 className="font-label-md text-label-md font-semibold text-error">
                  Skipped rows
                </h3>
                <ul className="flex flex-col gap-1">
                  {result.errors.map((e, i) => (
                    <li
                      key={i}
                      className="font-body-sm text-body-sm text-on-surface-variant"
                    >
                      Row {e.row} — {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="flex flex-col gap-stack-sm">
                <h3 className="font-label-md text-label-md font-semibold text-[#856404]">
                  Warnings
                </h3>
                <ul className="flex flex-col gap-1">
                  {result.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="font-body-sm text-body-sm text-on-surface-variant"
                    >
                      Row {w.row} — {w.field}: {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href="/vendors"
              className="w-fit font-label-md text-label-md text-primary underline underline-offset-4 hover:text-primary-container"
            >
              View all vendors →
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
