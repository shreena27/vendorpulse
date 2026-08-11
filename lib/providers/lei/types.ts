/**
 * Common LEI provider-adapter contract (Chunk 4.3). The twin of the
 * GST/MSME/Bank adapters — every LEI provider (today, only GLEIF) returns
 * this same shape.
 */

import type { LeiCheckStatus } from "@/lib/supabase/types";

export type { LeiCheckStatus };

export interface LeiCheckResult {
  leiNumber: string;
  status: LeiCheckStatus;
  /** The raw GLEIF registration.status string, or null when no record was
   * found (not_on_record from a 404, not from an unmapped status). */
  rawStatus: string | null;
  provider: "gleif";
  checkedAt: string;
  raw: unknown;
  /** Set only when the check could not get a conclusive answer (timeout,
   * malformed LEI, provider error). status is still populated — always
   * not_on_record in that case — a failed check is never treated as
   * compliant (ERD §7). */
  error?: string;
}

export interface LeiProviderAdapter {
  readonly name: "gleif";
  checkLei(leiNumber: string): Promise<LeiCheckResult>;
}
