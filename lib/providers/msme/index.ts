/**
 * MSME/Udyam adapter selector. SERVER-ONLY.
 *
 * Picks the live Deepvue adapter or the mock, controlled by `MSME_PROVIDER`:
 *   - "mock"    -> always the mock
 *   - "deepvue" -> the live adapter (currently a stub that throws on use)
 *   - unset     -> the mock (Deepvue is not wired yet; ship-against-mock, ERD §12)
 *
 * When Deepvue is implemented, the unset default should gain a keys-present
 * check like the GST selector (lib/providers/gst/index.ts). The chosen adapter
 * is memoized.
 */

import { createDeepvueAdapter } from "./deepvueAdapter";
import { createMockAdapter } from "./mockAdapter";
import type { MsmeProviderAdapter } from "./types";

let cached: MsmeProviderAdapter | null = null;

function selectProvider(): "deepvue" | "mock" {
  const explicit = process.env.MSME_PROVIDER?.trim().toLowerCase();
  if (explicit === "deepvue") return "deepvue";
  // Default to the mock until Deepvue credentials + a live implementation exist.
  return "mock";
}

export function getMsmeAdapter(): MsmeProviderAdapter {
  if (cached) return cached;
  cached =
    selectProvider() === "deepvue"
      ? createDeepvueAdapter()
      : createMockAdapter();
  return cached;
}

/** Test hook: drop the memoized adapter so the next call re-selects. */
export function resetMsmeAdapter(): void {
  cached = null;
}

export type { MsmeProviderAdapter, MsmeCheckResult, MsmeStatus } from "./types";
