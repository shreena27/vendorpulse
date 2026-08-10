/**
 * Bank-verification adapter selector. SERVER-ONLY.
 *
 * Picks the live Eko adapter or the mock, controlled by `BANK_PROVIDER`:
 *   - "eko"  -> the live adapter (currently a stub that throws on use)
 *   - unset  -> the mock (Eko is not wired yet; ship-against-mock, ERD §12)
 *
 * When Eko is implemented, the unset default should gain a keys-present
 * check like the GST selector (lib/providers/gst/index.ts). The chosen
 * adapter is memoized.
 */

import { createEkoAdapter } from "./ekoAdapter";
import { createMockAdapter } from "./mockAdapter";
import type { BankProviderAdapter } from "./types";

let cached: BankProviderAdapter | null = null;

function selectProvider(): "eko" | "mock" {
  const explicit = process.env.BANK_PROVIDER?.trim().toLowerCase();
  if (explicit === "eko") return "eko";
  // Default to the mock until Eko credentials + a live implementation exist.
  return "mock";
}

export function getBankAdapter(): BankProviderAdapter {
  if (cached) return cached;
  cached = selectProvider() === "eko" ? createEkoAdapter() : createMockAdapter();
  return cached;
}

/** Test hook: drop the memoized adapter so the next call re-selects. */
export function resetBankAdapter(): void {
  cached = null;
}

export type { BankProviderAdapter, BankCheckInput, BankCheckResult, BankStatus } from "./types";
