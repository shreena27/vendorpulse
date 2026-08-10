/**
 * Change detection for GST/MSME polling (ERD §5.1).
 *
 * Pure functions, no I/O — the poller (pollRunner.ts) supplies the prior status
 * and the fresh check result. The Change Detector compares a new check against
 * the vendor's immediately-prior check of the same type; a difference flags
 * `is_change = true`, which later feeds the Impact Scorer (Chunk 3).
 */

import type { CheckType, CheckProvider } from "@/lib/supabase/types";

/**
 * True when the new status differs from the prior one. A vendor's FIRST check
 * has no prior (`previous === null`) → false: the baseline is not a change.
 */
export function detectChange(previous: string | null, next: string): boolean {
  return previous !== null && previous !== next;
}

// The mappers take a plain string (status_value is free text from the DB /
// provider) and fall back to "unknown" for anything unrecognized.

/** Normalized GST status (uppercase) → the vendors.current_gst_status enum. */
export function mapGstStatusToVendor(
  status: string,
): "active" | "inactive" | "cancelled" | "unknown" {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "CANCELLED":
      return "cancelled";
    case "SUSPENDED":
    case "INACTIVE":
      return "inactive";
    default:
      return "unknown";
  }
}

/** Normalized MSME status (uppercase) → the vendors.current_msme_status enum. */
export function mapMsmeStatusToVendor(
  status: string,
): "registered" | "lapsed" | "not_msme" | "unknown" {
  switch (status) {
    case "REGISTERED":
      return "registered";
    case "LAPSED":
      return "lapsed";
    case "NOT_MSME":
      return "not_msme";
    default:
      return "unknown";
  }
}

/** The minimum a poll result needs to become a verification_checks row. */
export interface CheckOutcome {
  status: string; // uppercase status_value (ACTIVE / REGISTERED / UNKNOWN / ...)
  provider: CheckProvider;
  raw: unknown;
}

export interface VendorRef {
  id: string;
  organization_id: string;
}

export interface BuiltCheck {
  organization_id: string;
  vendor_id: string;
  check_type: CheckType;
  status_value: string;
  provider: CheckProvider;
  raw_response: unknown;
  is_change: boolean;
  checked_at: string;
}

/** Assemble one verification_checks row, computing is_change against the prior. */
export function buildCheck(
  vendor: VendorRef,
  checkType: CheckType,
  outcome: CheckOutcome,
  priorStatus: string | null,
  checkedAt: string,
): BuiltCheck {
  return {
    organization_id: vendor.organization_id,
    vendor_id: vendor.id,
    check_type: checkType,
    status_value: outcome.status,
    provider: outcome.provider,
    raw_response: outcome.raw,
    is_change: detectChange(priorStatus, outcome.status),
    checked_at: checkedAt,
  };
}
