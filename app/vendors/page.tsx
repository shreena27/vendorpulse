import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVendorsWithStatus } from "@/lib/vendors/queries";
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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          VendorPulse
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/alerts"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Alerts
          </Link>
          <Link
            href="/evidence/export"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Export evidence
          </Link>
          <Link
            href="/vendors/import"
            className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
          >
            Import vendors
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Vendors
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Continuous GST and MSME status for your vendors.
          </p>
        </section>

        <VendorList vendors={vendors} />
      </main>
    </div>
  );
}
