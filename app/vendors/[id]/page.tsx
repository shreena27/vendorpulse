import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCallerContext,
  getVendorDetail,
  type CheckHistoryEntry,
} from "@/lib/vendors/queries";
import { StatusBadge, ChangedPill } from "../StatusBadge";

/** Deterministic UTC timestamp, e.g. "2026-08-10 02:00 UTC". */
function fmt(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const TYPE_LABEL: Record<CheckHistoryEntry["check_type"], string> = {
  gst: "GST",
  msme_udyam: "MSME",
};

export default async function VendorDetailPage(
  props: PageProps<"/vendors/[id]">,
) {
  const { id } = await props.params;
  const supabase = await createClient();

  const caller = await getCallerContext(supabase);
  if (!caller) redirect("/login");

  const detail = await getVendorDetail(supabase, id, caller.canSeePii);
  if (!detail) notFound();

  const { vendor, history } = detail;

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
          ← All vendors
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {vendor.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">GST</span>
            <StatusBadge badge={vendor.gst} />
            <span className="ml-2 text-xs text-zinc-500">MSME</span>
            <StatusBadge badge={vendor.msme} />
            <span className="ml-2 text-xs text-zinc-500">Bank</span>
            <StatusBadge badge={vendor.bank} />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Details
          </h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-zinc-500">GSTIN</dt>
            <dd className="font-mono text-black dark:text-zinc-50">
              {vendor.gstin ?? "—"}
            </dd>
            <dt className="text-zinc-500">Udyam</dt>
            <dd className="font-mono text-black dark:text-zinc-50">
              {vendor.udyam_number ?? "—"}
            </dd>
            <dt className="text-zinc-500">PAN</dt>
            <dd className="font-mono text-black dark:text-zinc-50">
              {vendor.canSeePii ? (
                (vendor.pan ?? "—")
              ) : (
                <span className="font-sans text-zinc-400">
                  Restricted to finance
                </span>
              )}
            </dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Verification history
          </h2>

          {history.length === 0 ? (
            <div className="rounded-md border border-dashed border-black/[.15] p-4 text-sm text-zinc-500 dark:border-white/[.18] dark:text-zinc-400">
              No checks yet — pending the first poll. Status will appear here once
              the daily GST/MSME poller runs.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/[.08] px-4 py-2 text-sm dark:border-white/[.12]"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-12 text-xs font-semibold text-zinc-500">
                      {TYPE_LABEL[h.check_type]}
                    </span>
                    <span className="font-medium text-black dark:text-zinc-50">
                      {h.status_value}
                    </span>
                    {h.is_change && <ChangedPill />}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span>{h.provider}</span>
                    <span>{fmt(h.checked_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
