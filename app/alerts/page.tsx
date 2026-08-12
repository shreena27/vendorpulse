import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listAlertsForOrg } from "@/lib/alerts/queries";
import { AppNav } from "@/app/components/AppNav";
import { AlertInbox } from "./AlertInbox";

// Alert inbox (PRD §4.5): a plain-language question per surfaced change —
// "Hold them?" — the finance head answers with one tap. The system never
// claims to have taken the action itself.
//
// AppNav already carries the Vendors/Alerts/Evidence links this page's own
// header used to duplicate (same drop as every other Stitch-restyled page —
// see app/vendors/page.tsx).
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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-stack-lg px-margin-x-mobile py-stack-lg md:px-margin-x-desktop">
        <div className="flex flex-col gap-base">
          <h1 className="font-headline-xl text-headline-lg-mobile text-on-surface md:text-headline-xl">
            Alert Inbox
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Changes that hit a vendor with a payment in flight. You decide what
            happens next — nothing here happens on its own.
          </p>
        </div>

        <AlertInbox alerts={alerts} />
      </main>
    </div>
  );
}
