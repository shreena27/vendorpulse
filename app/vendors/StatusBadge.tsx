import type { Badge, BadgeTone } from "@/lib/vendors/statusBadge";

// A small status pill. Plain component (no client hooks) so it renders in both
// server and client components. Always shows a text label, so status is legible
// without relying on color (accessibility + the "visibly distinguishable" rule).
//
// Colors follow the Stitch design system's traffic-light convention
// (docs/superpowers/plans/2026-08-12-visual-polish-stitch-designs.md):
// green/red reuse the exact `bg-primary/10 text-primary` / `bg-error/10
// text-error` pairs every Stitch reference uses for Active/Verified and
// Inactive; amber reuses Stitch's own literal pending-pill colors
// (#FFF3CD/#856404); blue (our "identifier present, no check yet" Pending
// tone — a different concept than Stitch's example) reuses the palette's
// secondary-container, which is itself a light blue; gray/neutral reuse
// surface-variant.
const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-primary/10 text-primary",
  red: "bg-error/10 text-error",
  amber: "bg-[#FFF3CD] text-[#856404]",
  blue: "bg-secondary-container text-on-secondary-container",
  gray: "bg-surface-variant text-on-surface-variant",
  neutral: "bg-surface-variant text-on-surface-variant",
};

export function StatusBadge({ badge }: { badge: Badge }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-label-sm text-[10px] tracking-wide uppercase ${TONE_CLASSES[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

/** The "this vendor just changed" marker. */
export function ChangedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3CD] px-2 py-0.5 font-label-sm text-[10px] tracking-wide uppercase text-[#856404]">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#856404]" />
      Changed
    </span>
  );
}
