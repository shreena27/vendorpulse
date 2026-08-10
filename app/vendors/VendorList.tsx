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
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No vendors yet.{" "}
        <Link href="/vendors/import" className="underline underline-offset-4">
          Import your vendor list
        </Link>{" "}
        to get started.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or GSTIN"
          aria-label="Search vendors"
          className="w-64 rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-black/[.3] dark:border-white/[.16] dark:focus:border-white/[.4]"
        />
        <div className="flex gap-1" role="group" aria-label="Filter vendors">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              aria-pressed={chip === c.key}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                chip === c.key
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "border border-black/[.12] hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Showing {filtered.length} of {vendors.length}{" "}
        {vendors.length === 1 ? "vendor" : "vendors"}
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No vendors match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-zinc-500 dark:text-zinc-400">
                {["Name", "GST", "MSME", "Bank", ""].map((h, i) => (
                  <th
                    key={i}
                    className="border-b border-black/[.08] px-3 py-2 font-medium dark:border-white/[.12]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-black/[.02] dark:hover:bg-white/[.03]">
                  <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                    <Link
                      href={`/vendors/${v.id}`}
                      className="font-medium text-black underline-offset-4 hover:underline dark:text-zinc-50"
                    >
                      {v.name}
                    </Link>
                    {v.gstin && (
                      <span className="ml-2 font-mono text-xs text-zinc-400">
                        {v.gstin}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                    <StatusBadge badge={v.gst} />
                  </td>
                  <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                    <StatusBadge badge={v.msme} />
                  </td>
                  <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                    <StatusBadge badge={v.bank} />
                  </td>
                  <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                    {v.changed && <ChangedPill />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
