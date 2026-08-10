/**
 * Live MSME/Udyam provider adapter — Deepvue.
 *
 * SERVER-ONLY. NOT IMPLEMENTED YET — this is a deliberate stub.
 *
 * Deepvue signup needs a work email we do not have, and its docs are gated
 * behind login, so we do not yet know its auth flow, endpoint, request body, or
 * response shape. Following the Chunk 1.2 lesson (the live Sandbox contract
 * differed from its public docs), we do NOT guess. The interface is implemented
 * so the selector and types compile, but `checkUdyam` throws a clear, explicit
 * error rather than returning a fabricated result. Until then, run against the
 * mock (MSME_PROVIDER=mock, the default).
 *
 * TODO(chunk-1.3-live): Implement the real Deepvue Udyam check once credentials
 * and docs are available. Verify against the live API first (as done for Sandbox
 * in lib/providers/gst/sandboxAdapter.ts): confirm the two-step vs single-key
 * auth, the endpoint, the request field name for the Udyam number, and exactly
 * where the status label and registration date live in the response. Reuse
 * UDYAM_REGEX for the pre-call format check, retry once on timeout/5xx (ERD §7),
 * and map the provider's status to MsmeStatus. Do not guess field names.
 */

import type { MsmeProviderAdapter, MsmeCheckResult } from "./types";

export function createDeepvueAdapter(): MsmeProviderAdapter {
  // The Udyam-number argument is intentionally omitted: this stub throws before
  // it would ever use it. The real implementation will take it (see the TODO).
  async function checkUdyam(): Promise<MsmeCheckResult> {
    throw new Error(
      "Deepvue MSME adapter is not configured. Provide Deepvue credentials and " +
        "implement the live adapter, or set MSME_PROVIDER=mock.",
    );
  }

  return { name: "deepvue", checkUdyam };
}
