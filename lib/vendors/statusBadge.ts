/**
 * Pure status-badge derivation for the vendor dashboard (Chunk 1.5).
 *
 * Turns a vendor's stored status plus "has this been checked yet?" into a
 * label + tone the UI renders as a colored pill. Kept pure so the tricky cases
 * — Pending (identifier present, poller hasn't run) vs. Unknown (checked, but
 * the provider couldn't say) vs. N/A (no identifier to check) — are unit-tested.
 */

export type BadgeTone = "green" | "red" | "amber" | "gray" | "blue" | "neutral";

export interface Badge {
  label: string;
  tone: BadgeTone;
}

export type BadgeKind = "gst" | "msme" | "bank";

/** Human labels + tones for the stored status enums. */
const GST_MAP: Record<string, Badge> = {
  active: { label: "Active", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
  inactive: { label: "Inactive", tone: "amber" },
  not_applicable: { label: "N/A", tone: "neutral" },
  unknown: { label: "Unknown", tone: "gray" },
};

const MSME_MAP: Record<string, Badge> = {
  registered: { label: "Registered", tone: "green" },
  lapsed: { label: "Lapsed", tone: "amber" },
  not_msme: { label: "Not MSME", tone: "neutral" },
  unknown: { label: "Unknown", tone: "gray" },
};

const BANK_MAP: Record<string, Badge> = {
  verified: { label: "Verified", tone: "green" },
  mismatch: { label: "Mismatch", tone: "red" },
  unverified: { label: "Unverified", tone: "gray" },
};

const PENDING: Badge = { label: "Pending", tone: "blue" };
const NA: Badge = { label: "N/A", tone: "neutral" };
const UNKNOWN: Badge = { label: "Unknown", tone: "gray" };

export interface DeriveInput {
  kind: BadgeKind;
  /** Does the vendor have the identifier this check needs (gstin / udyam)? */
  hasIdentifier: boolean;
  /** Has at least one check of this type been recorded? */
  hasCheck: boolean;
  /** The vendor's stored current_*_status. */
  currentStatus: string;
}

/**
 * Derive the badge for one status column.
 *
 * - Bank has no identifier/poller concept yet (Chunk 2.1), so it always reads
 *   its stored status.
 * - For GST/MSME: no identifier → N/A; identifier but no check → Pending;
 *   otherwise map the stored status.
 */
export function deriveStatusBadge(input: DeriveInput): Badge {
  const { kind, hasIdentifier, hasCheck, currentStatus } = input;

  if (kind === "bank") {
    return BANK_MAP[currentStatus] ?? UNKNOWN;
  }

  if (!hasIdentifier) return NA;
  if (!hasCheck) return PENDING;

  const map = kind === "gst" ? GST_MAP : MSME_MAP;
  return map[currentStatus] ?? UNKNOWN;
}

/** Tones that mean "look at this vendor" — drives the Needs-attention filter. */
export function isAttentionTone(tone: BadgeTone): boolean {
  return tone === "red" || tone === "amber";
}
