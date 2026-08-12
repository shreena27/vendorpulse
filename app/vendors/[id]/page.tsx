import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCallerContext,
  getVendorDetail,
  type CheckHistoryEntry,
} from "@/lib/vendors/queries";
import { StatusBadge, ChangedPill } from "../StatusBadge";
import { AppNav } from "@/app/components/AppNav";

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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 gap-gutter px-margin-x-mobile py-stack-lg md:grid-cols-12 md:px-margin-x-desktop">
        {/* Header (full width) */}
        <header className="flex flex-col gap-4 md:col-span-12 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <Link
              href="/vendors"
              className="flex w-fit items-center gap-1 font-label-md text-label-md text-secondary transition-colors hover:text-primary"
            >
              ← All vendors
            </Link>
            <h1 className="font-headline-xl text-headline-lg-mobile text-on-background md:text-headline-xl">
              {vendor.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant">
                GST
              </span>
              <StatusBadge badge={vendor.gst} />
              <span className="ml-2 font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant">
                MSME
              </span>
              <StatusBadge badge={vendor.msme} />
              <span className="ml-2 font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant">
                Bank
              </span>
              <StatusBadge badge={vendor.bank} />
            </div>
          </div>
        </header>

        {/* Details card (full width) */}
        <section className="ambient-shadow card-border flex flex-col gap-stack-sm rounded-xl bg-surface-container-lowest p-6 md:col-span-12">
          <h2 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Details
          </h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 font-body-md text-body-md">
            <dt className="text-secondary">GSTIN</dt>
            <dd className="font-mono text-on-surface">
              {vendor.gstin ?? "—"}
            </dd>
            <dt className="text-secondary">Udyam</dt>
            <dd className="font-mono text-on-surface">
              {vendor.udyam_number ?? "—"}
            </dd>
            <dt className="text-secondary">PAN</dt>
            <dd className="font-mono text-on-surface">
              {vendor.canSeePii ? (
                (vendor.pan ?? "—")
              ) : (
                <span className="font-body-md text-on-surface-variant">
                  Restricted to finance
                </span>
              )}
            </dd>
          </dl>
        </section>

        {/* Left column: Status History */}
        <section className="flex flex-col gap-stack-md md:col-span-7">
          <div className="ambient-shadow card-border flex h-full flex-col rounded-xl bg-surface-container-lowest p-6">
            <h2 className="mb-6 flex items-center gap-2 border-b border-surface-container pb-4 font-headline-md text-headline-md text-on-surface">
              <span
                aria-hidden
                className="material-symbols-outlined text-primary-container"
              >
                history
              </span>
              Status History
            </h2>

            {history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant p-4 font-body-md text-body-md text-on-surface-variant">
                No checks yet — pending the first poll. Status will appear here
                once the daily GST/MSME poller runs.
              </div>
            ) : (
              <ul className="relative flex flex-col gap-stack-lg border-l-2 border-surface-container-high pl-6">
                {history.map((h) => (
                  <li key={h.id} className="relative">
                    <span
                      aria-hidden
                      className={
                        h.is_change
                          ? "absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-primary-container shadow-[0_0_0_4px_rgba(31,92,87,0.2)]"
                          : "absolute -left-[29px] top-1 h-3 w-3 rounded-full border-2 border-primary-container bg-surface-container-high"
                      }
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="w-12 shrink-0 font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant">
                          {TYPE_LABEL[h.check_type]}
                        </span>
                        <span className="font-label-md text-label-md text-on-surface">
                          {h.status_value}
                        </span>
                        {h.is_change && <ChangedPill />}
                      </div>
                      <div className="flex items-center gap-3 font-body-sm text-body-sm text-secondary">
                        <span>{h.provider}</span>
                        <span>{fmt(h.checked_at)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Right column: Evidence & Certificates */}
        <section className="flex flex-col gap-stack-md md:col-span-5">
          <div className="ambient-shadow card-border flex h-full flex-col gap-stack-md rounded-xl bg-surface-container-lowest p-6">
            <h2 className="flex items-center gap-2 border-b border-surface-container pb-4 font-headline-md text-headline-md text-on-surface">
              <span
                aria-hidden
                className="material-symbols-outlined text-primary-container"
              >
                description
              </span>
              Evidence &amp; Certificates
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Insurance, safety and onboarding documents for this vendor live on
              a dedicated page.
            </p>
            <Link
              href={`/vendors/${id}/certificates`}
              className="mt-auto flex w-fit items-center gap-2 rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md text-on-primary-container transition-colors hover:bg-primary-container/80"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                folder_open
              </span>
              Certificates →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
