"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

/** Shared top nav (Stitch: every screen except login). Bell is decorative —
 * this app has no notifications feature. Settings and the avatar both link
 * to /dashboard, the app's one existing account/org page (where "Log out"
 * already lives) — not a new feature, just where an existing one is reachable. */
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
        <Link
          href="/dashboard"
          className="rounded-full p-2 text-on-primary transition-colors hover:bg-primary-container/20"
          title="Organization settings"
        >
          <span className="material-symbols-outlined">settings</span>
        </Link>
        <Link
          href="/dashboard"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-variant text-on-surface-variant"
          title="Your account"
        >
          <span className="material-symbols-outlined text-[20px]">account_circle</span>
        </Link>
      </div>
    </header>
  );
}
