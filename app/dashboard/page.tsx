import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth. Middleware already guards this route.
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          VendorPulse
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {user.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-2 p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          You are signed in. Vendor monitoring will appear here.
        </p>
      </main>
    </div>
  );
}
