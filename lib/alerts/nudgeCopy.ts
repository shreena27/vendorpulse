/**
 * Pure nudge-copy generation (Chunk 3.3, PRD §4.5). One source of truth for
 * the alert inbox UI and the alert email — both render the exact same three
 * lines, so wording never drifts between surfaces.
 *
 * Critical wording constraint: the system never claims to have taken the
 * action itself. It asks a question ("Hold them?"); the finance head
 * decides by clicking. Nothing here may read as a completed system action —
 * enforced by nudgeCopy.test.ts, not just this comment.
 */

import type { TriggerType } from "./createOrUpdateAlert";

const LAKH = 100_000;
const CRORE = 10_000_000;

/** ₹45,000 under 1L; ₹4.1L from 1L; ₹1.2Cr from 1Cr. */
export function formatIndianCurrency(amount: number): string {
  if (amount >= CRORE) return `₹${(amount / CRORE).toFixed(1)}Cr`;
  if (amount >= LAKH) return `₹${(amount / LAKH).toFixed(1)}L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

const GST_PHRASES: Record<string, string> = {
  ACTIVE: "became active",
  CANCELLED: "was cancelled",
  INACTIVE: "went inactive",
  SUSPENDED: "was suspended",
  UNKNOWN: "status became unclear",
};

const MSME_PHRASES: Record<string, string> = {
  REGISTERED: "became registered",
  LAPSED: "lapsed",
  NOT_MSME: "is no longer classified as MSME",
  UNKNOWN: "status became unclear",
};

const LEI_PHRASES: Record<string, string> = {
  lapsed: "lapsed",
  retired: "was retired",
  not_on_record: "has no LEI on record",
};

const REGISTRATION_LABEL: Record<TriggerType, string> = {
  gst_change: "GST registration",
  msme_change: "MSME registration",
  lei_check: "LEI",
};

/** A natural verb phrase for the raw status value — verification_checks.status_value
 * for gst_change/msme_change, lei_checks.status for lei_check. */
export function describeStatusChange(triggerType: TriggerType, statusValue: string): string {
  const table =
    triggerType === "msme_change" ? MSME_PHRASES : triggerType === "lei_check" ? LEI_PHRASES : GST_PHRASES;
  return table[statusValue] ?? `changed to ${statusValue}`;
}

export interface BuildNudgeMessageInput {
  vendorName: string;
  triggerType: TriggerType;
  statusValue: string;
  paymentCount: number;
  paymentAmount: number;
}

export interface NudgeMessage {
  changeLine: string;
  impactLine: string;
  question: string;
}

export function buildNudgeMessage(input: BuildNudgeMessageInput): NudgeMessage {
  const { vendorName, triggerType, statusValue, paymentCount, paymentAmount } = input;

  const changeLine = `${vendorName}'s ${REGISTRATION_LABEL[triggerType]} just ${describeStatusChange(triggerType, statusValue)}.`;

  if (paymentCount === 0) {
    return {
      changeLine,
      impactLine: "No pending payments remain for this vendor.",
      question: "Review?",
    };
  }

  const formattedAmount = formatIndianCurrency(paymentAmount);
  if (paymentCount === 1) {
    return {
      changeLine,
      impactLine: `1 pending payment totals ${formattedAmount}.`,
      question: "Hold it?",
    };
  }

  return {
    changeLine,
    impactLine: `${paymentCount} pending payments total ${formattedAmount}.`,
    question: "Hold them?",
  };
}
