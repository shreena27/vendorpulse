import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listAlertsForOrg } from "@/lib/alerts/queries";
import { AlertInbox } from "./AlertInbox";

// Alert inbox (PRD §4.5): a plain-language question per surfaced change —
// "Hold them?" — the finance head answers with one tap. The system never
// claims to have taken the action itself.
export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const alerts = await listAlertsForOrg(supabase);

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

      <main className="flex flex-1 flex-col gap-6 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Alerts
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Changes that hit a vendor with a payment in flight. You decide what
            happens next — nothing here happens on its own.
          </p>
        </section>

        <AlertInbox alerts={alerts} />
      </main>
    </div>
  );
}
