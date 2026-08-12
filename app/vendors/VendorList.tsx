"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { VendorSummary } from "@/lib/vendors/queries";
import { isAttentionTone } from "@/lib/vendors/statusBadge";
import { StatusBadge, ChangedPill } from "./StatusBadge";

type Chip = "all" | "attention" | "pending";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "pending", label: "Pending" },
];

function needsAttention(v: VendorSummary): boolean {
  return (
    v.changed || [v.gst, v.msme, v.bank].some((b) => isAttentionTone(b.tone))
  );
}

function isPending(v: VendorSummary): boolean {
  return [v.gst, v.msme].some((b) => b.label === "Pending");
}

export function VendorList({ vendors }: { vendors: VendorSummary[] }) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<Chip>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => {
      if (chip === "attention" && !needsAttention(v)) return false;
      if (chip === "pending" && !isPending(v)) return false;
      if (q && !`${v.name} ${v.gstin ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [vendors, query, chip]);

  if (vendors.length === 0) {
    return (
      <div className="ambient-shadow rounded-xl border border-surface-container bg-surface-container-lowest p-gutter text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">
          No vendors yet.{" "}
          <Link
            href="/vendors/import"
            className="font-semibold text-primary underline underline-offset-4"
          >
            Import your vendor list
          </Link>{" "}
          to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-stack-md">
      {/* Controls */}
      <div className="flex flex-col items-start justify-between gap-stack-md md:flex-row md:items-center">
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Vendor Directory
        </h2>
        <div className="flex w-full flex-col gap-stack-sm md:w-auto md:flex-row md:items-center">
          <div className="relative w-full md:w-64">
            <span
              aria-hidden
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant"
            >
              search
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or GSTIN"
              aria-label="Search vendors"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 font-body-sm text-body-sm text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <Link
            href="/vendors/import"
            className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-surface-container-lowest px-4 py-2 font-label-md text-label-md text-primary transition-colors hover:bg-surface-container-low"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">
              upload_file
            </span>
            Import vendors
          </Link>

          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Filter vendors"
          >
            {CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setChip(c.key)}
                aria-pressed={chip === c.key}
                className={`rounded-full px-4 py-1.5 font-label-md text-label-md transition-colors ${
                  chip === c.key
                    ? "bg-primary text-on-primary"
                    : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="font-body-sm text-body-sm text-on-surface-variant">
        Showing {filtered.length} of {vendors.length}{" "}
        {vendors.length === 1 ? "vendor" : "vendors"}
      </p>

      {filtered.length === 0 ? (
        <div className="ambient-shadow rounded-xl border border-surface-container bg-surface-container-lowest p-gutter text-center">
          <p className="font-body-md text-body-md text-on-surface-variant">
            No vendors match this filter.
          </p>
        </div>
      ) : (
        <div className="ambient-shadow flex flex-1 flex-col overflow-hidden rounded-xl border border-surface-container bg-surface-container-lowest">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-surface-container bg-surface-container-lowest">
                  {["Vendor Name", "GST Status", "MSME Status", "Bank Verification", ""].map(
                    (h, i) => (
                      <th
                        key={i}
                        className="whitespace-nowrap p-4 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface">
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    className="zebra-row table-row-h border-b border-surface-container/50 transition-colors hover:bg-surface-container-low/50"
                  >
                    <td className="p-4 font-semibold">
                      <Link
                        href={`/vendors/${v.id}`}
                        className="text-on-surface underline-offset-4 hover:underline"
                      >
                        {v.name}
                      </Link>
                      {v.gstin && (
                        <span className="ml-2 font-mono text-xs font-normal text-on-surface-variant">
                          {v.gstin}
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <StatusBadge badge={v.gst} />
                    </td>
                    <td className="p-4">
                      <StatusBadge badge={v.msme} />
                    </td>
                    <td className="p-4">
                      <StatusBadge badge={v.bank} />
                    </td>
                    <td className="p-4">{v.changed && <ChangedPill />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
