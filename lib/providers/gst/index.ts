/**
 * GST adapter selector. SERVER-ONLY.
 *
 * Picks the live Sandbox adapter or the mock, controlled by `GST_PROVIDER`:
 *   - "mock"    -> always the mock
 *   - "sandbox" -> always the live adapter
 *   - unset     -> the live adapter when both Sandbox keys are present,
 *                  otherwise the mock (ship-against-mock fallback, ERD §12).
 *
 * The chosen adapter is memoized so the token cache in the Sandbox adapter is
 * shared across calls in the same process.
 */

import { createSandboxAdapter } from "./sandboxAdapter";
import { createMockAdapter } from "./mockAdapter";
import type { GstProviderAdapter } from "./types";

let cached: GstProviderAdapter | null = null;

function selectProvider(): "sandbox" | "mock" {
  const explicit = process.env.GST_PROVIDER?.trim().toLowerCase();
  if (explicit === "mock") return "mock";
  if (explicit === "sandbox") return "sandbox";
  return process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET
    ? "sandbox"
    : "mock";
}

export function getGstAdapter(): GstProviderAdapter {
  if (cached) return cached;
  cached =
    selectProvider() === "sandbox" ? createSandboxAdapter() : createMockAdapter();
  return cached;
}

/** Test hook: drop the memoized adapter so the next call re-selects. */
export function resetGstAdapter(): void {
  cached = null;
}

export type { GstProviderAdapter, GstCheckResult, GstStatus } from "./types";
