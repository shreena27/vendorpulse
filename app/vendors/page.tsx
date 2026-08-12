import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVendorsWithStatus } from "@/lib/vendors/queries";
import { isAttentionTone } from "@/lib/vendors/statusBadge";
import { AppNav } from "@/app/components/AppNav";
import { VendorList } from "./VendorList";

// Vendor list: current GST/MSME/bank status at a glance, with a quick filter.
// The first read UI over the rows Chunks 1.1–1.4 produce (PRD §4.4 recall flow).
export default async function VendorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const vendors = await listVendorsWithStatus(supabase);

  // Honest, already-fetched-data-only KPI counts (no new query — see
  // docs/superpowers/plans/2026-08-12-visual-polish-stitch-designs.md). The
  // Stitch reference's "Open Alerts"/"Issues Caught This Month"/"Time to
  // First Value" cards would need alerts/metrics queries this page doesn't
  // have, so they're omitted rather than faked. These two mirror the exact
  // same rules VendorList.tsx's own "Needs attention" / "Pending" chips use.
  const needsAttentionCount = vendors.filter(
    (v) =>
      v.changed || [v.gst, v.msme, v.bank].some((b) => isAttentionTone(b.tone)),
  ).length;
  const pendingCount = vendors.filter((v) =>
    [v.gst, v.msme].some((b) => b.label === "Pending"),
  ).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-stack-lg px-margin-x-mobile py-stack-lg md:px-margin-x-desktop">
        <div className="flex flex-col gap-base">
          <h1 className="font-headline-xl text-headline-lg-mobile text-on-surface md:text-headline-xl">
            Vendors
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Continuous GST and MSME status for your vendors.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-gutter md:grid-cols-3">
          <div className="ambient-shadow flex flex-col gap-stack-sm rounded-xl border border-surface-container bg-surface-container-lowest p-gutter">
            <div className="flex items-start justify-between">
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Vendors Connected
              </span>
              <span className="material-symbols-outlined text-outline">
                hub
              </span>
            </div>
            <div className="font-headline-lg text-headline-lg text-on-surface">
              {vendors.length}
            </div>
          </div>

          <div className="ambient-shadow relative flex flex-col gap-stack-sm overflow-hidden rounded-xl border border-error/20 bg-surface-container-lowest p-gutter">
            <div className="absolute left-0 top-0 h-full w-1 bg-error" />
            <div className="flex items-start justify-between">
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Needs Attention
              </span>
              <span className="material-symbols-outlined text-error">
                warning
              </span>
            </div>
            <div className="font-headline-lg text-headline-lg text-on-surface">
              {needsAttentionCount}
            </div>
          </div>

          <div className="ambient-shadow flex flex-col gap-stack-sm rounded-xl border border-surface-container bg-surface-container-lowest p-gutter">
            <div className="flex items-start justify-between">
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Pending Checks
              </span>
              <span className="material-symbols-outlined text-outline">
                schedule
              </span>
            </div>
            <div className="font-headline-lg text-headline-lg text-on-surface">
              {pendingCount}
            </div>
          </div>
        </div>

        <VendorList vendors={vendors} />
      </main>
    </div>
  );
}
