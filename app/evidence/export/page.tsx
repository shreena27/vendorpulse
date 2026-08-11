"use client";

import { useState } from "react";
import Link from "next/link";

type ExportFormat = "csv" | "pdf";

export default function EvidenceExportPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rangeInvalid = !!from && !!to && from > to;
  const canSubmit = !!from && !!to && !rangeInvalid && !submitting;

  async function handleSubmit() {
    if (!from || !to || rangeInvalid) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(
        `/api/evidence/export?from=${from}&to=${to}&format=${format}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-export-${from}-to-${to}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setSubmitError("Export failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
          ← Vendors
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Export evidence
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Clause 22 / Form 3CD: one row per payment due in the selected
            range, with each vendor&apos;s MSME status as it was on that
            payment&apos;s own due date — not today&apos;s status.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor="export-from"
                className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                From
              </label>
              <input
                id="export-from"
                name="from"
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.16]"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor="export-to"
                className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                To
              </label>
              <input
                id="export-to"
                name="to"
                type="date"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.16]"
              />
            </div>
          </div>
          {rangeInvalid && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              &quot;From&quot; must not be after &quot;To&quot;.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Format
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={format === "csv"}
                  onChange={() => setFormat("csv")}
                />
                CSV
              </label>
              <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                <input
                  type="radio"
                  name="format"
                  value="pdf"
                  checked={format === "pdf"}
                  onChange={() => setFormat("pdf")}
                />
                PDF
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/80"
          >
            {submitting ? "Exporting…" : "Export"}
          </button>
          {submitError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
