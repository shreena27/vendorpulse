import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Minimal vendor list. The full status dashboard (badges, detail view, filters)
// lands in Chunk 1.5; this exists so an imported list is visible and gives the
// e2e "see all vendors listed" check a stable target. RLS scopes the query to
// the caller's own organization.
export default async function VendorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, gstin, current_gst_status, current_msme_status")
    .order("created_at", { ascending: true });

  const rows = vendors ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          VendorPulse
        </span>
        <Link
          href="/vendors/import"
          className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
        >
          Import vendors
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Vendors
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            {rows.length} {rows.length === 1 ? "vendor" : "vendors"} on record.
          </p>
        </section>

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No vendors yet.{" "}
            <Link
              href="/vendors/import"
              className="underline underline-offset-4"
            >
              Import your vendor list
            </Link>{" "}
            to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400">
                  <th className="border-b border-black/[.08] px-3 py-2 font-medium dark:border-white/[.12]">
                    Name
                  </th>
                  <th className="border-b border-black/[.08] px-3 py-2 font-medium dark:border-white/[.12]">
                    GSTIN
                  </th>
                  <th className="border-b border-black/[.08] px-3 py-2 font-medium dark:border-white/[.12]">
                    GST status
                  </th>
                  <th className="border-b border-black/[.08] px-3 py-2 font-medium dark:border-white/[.12]">
                    MSME status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="text-black dark:text-zinc-50">
                    <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                      {v.name}
                    </td>
                    <td className="border-b border-black/[.04] px-3 py-2 font-mono text-xs dark:border-white/[.08]">
                      {v.gstin ?? "—"}
                    </td>
                    <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                      {v.current_gst_status}
                    </td>
                    <td className="border-b border-black/[.04] px-3 py-2 dark:border-white/[.08]">
                      {v.current_msme_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
