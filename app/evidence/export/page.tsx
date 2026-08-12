"use client";

import { useState } from "react";
import { AppNav } from "@/app/components/AppNav";

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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-stack-lg px-margin-x-mobile py-stack-lg md:px-margin-x-desktop">
        <div className="flex flex-col gap-2">
          <h1 className="font-headline-xl text-headline-lg-mobile text-on-surface md:text-headline-xl">
            Export evidence
          </h1>
          <p className="max-w-2xl font-body-md text-body-md text-on-surface-variant">
            Clause 22 / Form 3CD: one row per payment due in the selected
            range, with each vendor&apos;s MSME status as it was on that
            payment&apos;s own due date — not today&apos;s status.
          </p>
        </div>

        {/* Report Configuration card — Stitch's reference also shows a live
            "Vendor Filters" panel and a merged range-picker input; this app
            has no vendor-filtering feature and the from/to fields are two
            real, independently-required inputs the e2e suite drives
            individually, so both stay out of scope here (see CLAUDE.md task
            note). Date Range alone is a complete, single-purpose card. */}
        <div className="ambient-shadow card-border max-w-2xl rounded-xl bg-surface-container-lowest p-gutter">
          <div className="mb-stack-md flex items-center gap-2 border-b border-surface-container pb-3">
            <span aria-hidden className="material-symbols-outlined text-primary">
              tune
            </span>
            <h3 className="font-headline-md text-headline-md text-on-surface">
              Report Configuration
            </h3>
          </div>

          <div className="flex flex-col gap-stack-lg">
            <div className="flex gap-gutter">
              <div className="flex flex-1 flex-col gap-2">
                <label
                  htmlFor="export-from"
                  className="font-label-sm text-label-sm uppercase text-on-surface-variant"
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
                  className="focus-glow w-full rounded-lg border border-outline-variant bg-surface p-2.5 font-body-md text-body-md text-on-surface outline-none transition-all"
                />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <label
                  htmlFor="export-to"
                  className="font-label-sm text-label-sm uppercase text-on-surface-variant"
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
                  className="focus-glow w-full rounded-lg border border-outline-variant bg-surface p-2.5 font-body-md text-body-md text-on-surface outline-none transition-all"
                />
              </div>
            </div>
            {rangeInvalid && (
              <p role="alert" className="font-body-sm text-body-sm text-error">
                &quot;From&quot; must not be after &quot;To&quot;.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">
                Format
              </span>
              <div className="flex gap-gutter">
                <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={format === "csv"}
                    onChange={() => setFormat("csv")}
                    className="h-4 w-4 border-outline-variant text-primary focus:ring-2 focus:ring-primary-container"
                  />
                  CSV
                </label>
                <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                  <input
                    type="radio"
                    name="format"
                    value="pdf"
                    checked={format === "pdf"}
                    onChange={() => setFormat("pdf")}
                    className="h-4 w-4 border-outline-variant text-primary focus:ring-2 focus:ring-primary-container"
                  />
                  PDF
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-stack-sm">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex w-fit items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  download
                </span>
                {submitting ? "Exporting…" : "Export"}
              </button>
              {submitError && (
                <p role="alert" className="font-body-sm text-body-sm text-error">
                  {submitError}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
