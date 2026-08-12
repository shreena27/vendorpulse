"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "../(auth)/actions";

type Tab = "vendors" | "alerts" | "evidence" | null;

const TABS: { key: Exclude<Tab, null>; label: string; href: string }[] = [
  { key: "vendors", label: "Vendors", href: "/vendors" },
  { key: "alerts", label: "Alerts", href: "/alerts" },
  { key: "evidence", label: "Evidence", href: "/evidence/export" },
];

/** This app has one real page per Stitch nav concept — no separate
 * "Dashboard" page distinct from "Vendors" — so the nav has 3 tabs, not
 * Stitch's 4 (docs/superpowers/plans/2026-08-12-visual-polish-stitch-designs.md). */
function activeTabFor(pathname: string): Tab {
  if (pathname.startsWith("/vendors")) return "vendors";
  if (pathname.startsWith("/alerts")) return "alerts";
  if (pathname.startsWith("/evidence")) return "evidence";
  return null;
}

/** Shared top nav (Stitch: every screen except login). Bell and settings are
 * decorative — this app has no notifications or settings feature, and
 * /dashboard (their old destination) no longer has any content of its own,
 * it just redirects to /vendors. The avatar is the one real action: signing
 * out, via the same server action /dashboard's old "Log out" button used. */
export function AppNav() {
  const pathname = usePathname();
  const active = activeTabFor(pathname);

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between bg-primary px-margin-x-mobile text-on-primary font-body-md text-body-md md:px-margin-x-desktop">
      <div className="flex items-center gap-4">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-container text-on-primary-container">
          <span className="material-symbols-outlined text-[20px]">shield_lock</span>
        </div>
        <span className="font-headline-md text-headline-md tracking-tight text-on-primary">
          VendorPulse
        </span>
      </div>

      <nav className="hidden items-center gap-2 md:flex">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              active === tab.key
                ? "flex items-center justify-center rounded-full bg-primary-container px-4 py-1.5 font-bold text-on-primary-container"
                : "flex items-center justify-center rounded-full px-4 py-1.5 text-on-primary/80 transition-colors hover:bg-primary-container/20 hover:text-on-primary"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="rounded-full p-2 text-on-primary/70"
          title="Notifications (not available yet)"
        >
          <span className="material-symbols-outlined">notifications</span>
        </span>
        <span
          aria-hidden
          className="rounded-full p-2 text-on-primary/70"
          title="Settings (not available yet)"
        >
          <span className="material-symbols-outlined">settings</span>
        </span>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Log out"
            title="Log out"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-variant text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]">account_circle</span>
          </button>
        </form>
      </div>
    </header>
  );
}
