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

type ImportResult = {
  importId: string;
  total: number;
  inserted: number;
  errorCount: number;
  errors: RowIssue[];
  warnings: RowIssue[];
};

const FIELD_LABELS: Record<SchemaField, string> = {
  name: "Vendor name",
  gstin: "GSTIN",
  udyam_number: "Udyam number",
  pan: "PAN",
};

const REQUIRED_FIELDS: SchemaField[] = ["name"];

// Guess which source column feeds each schema field, by header keyword.
const GUESS_PATTERNS: Record<SchemaField, RegExp> = {
  name: /name|vendor|party|supplier/i,
  gstin: /gst/i,
  udyam_number: /udyam|msme/i,
  pan: /pan/i,
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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          VendorPulse
        </span>
        <Link
          href="/vendors"
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          View vendors
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Import vendors
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Upload a CSV or XLSX export from Tally, Excel, or your ERP. Map its
            columns, then import.
          </p>
        </section>

        {/* Step 1 — file */}
        <section className="flex flex-col gap-3">
          <label
            htmlFor="vendor-file"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            1. Choose a file
          </label>
          <input
            id="vendor-file"
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFile}
            className="block text-sm text-zinc-700 file:mr-4 file:rounded-full file:border file:border-black/[.12] file:bg-transparent file:px-4 file:py-1.5 file:text-sm file:font-medium hover:file:bg-black/[.04] dark:text-zinc-300 dark:file:border-white/[.16] dark:hover:file:bg-white/[.06]"
          />
          {fileName && !parseError && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {fileName} — {previewRows.length > 0 ? "ready to map" : "reading…"}
            </p>
          )}
          {parseError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {parseError}
            </p>
          )}
        </section>

        {/* Step 2 — mapping */}
        {headers.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              2. Map columns
            </h2>
            <div className="flex flex-col gap-3">
              {SCHEMA_FIELDS.map((field) => (
                <div
                  key={field}
                  className="flex items-center justify-between gap-4 rounded-md border border-black/[.08] px-4 py-2 dark:border-white/[.12]"
                >
                  <span className="text-sm text-black dark:text-zinc-50">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && (
                      <span className="text-red-600 dark:text-red-400"> *</span>
                    )}
                  </span>
                  <select
                    aria-label={`Column for ${FIELD_LABELS[field]}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) => setFieldColumn(field, e.target.value)}
                    className="rounded-md border border-black/[.12] bg-transparent px-2 py-1 text-sm dark:border-white/[.16]"
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {previewRows.length > 0 && (
              <details className="text-sm text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">Preview first rows</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full border-collapse text-left">
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th
                            key={h}
                            className="border-b border-black/[.08] px-2 py-1 font-medium dark:border-white/[.12]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i}>
                          {headers.map((h) => (
                            <td
                              key={h}
                              className="border-b border-black/[.04] px-2 py-1 dark:border-white/[.08]"
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
          <section className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              {submitting ? "Importing…" : "Import vendors"}
            </button>
            {submitError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {submitError}
              </p>
            )}
          </section>
        )}

        {/* Result report */}
        {result && (
          <section className="flex flex-col gap-3 rounded-md border border-black/[.08] p-4 dark:border-white/[.12]">
            <h2 className="text-base font-semibold text-black dark:text-zinc-50">
              Imported {result.inserted} of {result.total} vendors
            </h2>
            {result.errorCount > 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {result.errorCount}{" "}
                {result.errorCount === 1 ? "row was" : "rows were"} skipped.
              </p>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Every row imported cleanly.
              </p>
            )}

            {result.errors.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Skipped rows
                </h3>
                <ul className="flex flex-col gap-1">
                  {result.errors.map((e, i) => (
                    <li
                      key={i}
                      className="text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      Row {e.row} — {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  Warnings
                </h3>
                <ul className="flex flex-col gap-1">
                  {result.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      Row {w.row} — {w.field}: {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href="/vendors"
              className="w-fit text-sm font-medium text-black underline underline-offset-4 dark:text-zinc-50"
            >
              View all vendors →
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
