import type { Badge, BadgeTone } from "@/lib/vendors/statusBadge";

// A small status pill. Plain component (no client hooks) so it renders in both
// server and client components. Always shows a text label, so status is legible
// without relying on color (accessibility + the "visibly distinguishable" rule).
const TONE_CLASSES: Record<BadgeTone, string> = {
  green:
    "bg-green-500/15 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  red: "bg-red-500/15 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  amber:
    "bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  blue: "bg-blue-500/15 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  gray: "bg-zinc-500/15 text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-400",
  neutral:
    "bg-black/[.05] text-zinc-500 dark:bg-white/[.08] dark:text-zinc-500",
};

export function StatusBadge({ badge }: { badge: Badge }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

/** The "this vendor just changed" marker. */
export function ChangedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Changed
    </span>
  );
}
