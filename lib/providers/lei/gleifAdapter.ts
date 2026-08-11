/**
 * Live LEI provider adapter — GLEIF. SERVER-ONLY.
 *
 * GLEIF's LEI-record API is free and needs no signup/credentials — confirmed
 * live during planning: GET /api/v1/lei-records/{lei} -> 200 with
 * data.attributes.registration.status, or 404 for an unknown LEI. No mock
 * adapter/selector exists for this provider (unlike GST/MSME/Bank) — there's
 * no "ship against mock" reason when nothing is gated behind credentials.
 *
 * registration.status has 11 possible values (GLEIF's own LEI-CDF spec);
 * lei_checks.status only has 4. ISSUED -> issued, LAPSED -> lapsed,
 * RETIRED/MERGED/ANNULLED/CANCELLED -> retired (no longer an operative
 * registration), everything else (PENDING_VALIDATION, DUPLICATE,
 * TRANSFERRED, PENDING_TRANSFER, PENDING_ARCHIVAL, or unrecognized) ->
 * not_on_record — never silently "issued" for an ambiguous state (ERD §7).
 */

import type { LeiCheckResult, LeiProviderAdapter, LeiCheckStatus } from "./types";

const DEFAULT_BASE_URL = "https://api.gleif.org/api/v1/lei-records";
const DEFAULT_TIMEOUT_MS = 10_000;
const LEI_REGEX = /^[0-9A-Z]{20}$/; // ISO 17442

export interface GleifAdapterConfig {
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function mapRegistrationStatus(raw: string | null | undefined): LeiCheckStatus {
  switch ((raw ?? "").trim().toUpperCase()) {
    case "ISSUED":
      return "issued";
    case "LAPSED":
      return "lapsed";
    case "RETIRED":
    case "MERGED":
    case "ANNULLED":
    case "CANCELLED":
      return "retired";
    default:
      // PENDING_VALIDATION, DUPLICATE, TRANSFERRED, PENDING_TRANSFER,
      // PENDING_ARCHIVAL, or anything unrecognized: ambiguous, never issued.
      return "not_on_record";
  }
}

export function createGleifAdapter(config: GleifAdapterConfig = {}): LeiProviderAdapter {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  function notOnRecord(leiNumber: string, error?: string, raw: unknown = null): LeiCheckResult {
    return {
      leiNumber,
      status: "not_on_record",
      rawStatus: null,
      provider: "gleif",
      checkedAt: new Date().toISOString(),
      raw,
      ...(error ? { error } : {}),
    };
  }

  async function checkLei(input: string): Promise<LeiCheckResult> {
    const leiNumber = input.trim().toUpperCase();

    if (!LEI_REGEX.test(leiNumber)) {
      return notOnRecord(leiNumber, "invalid_lei");
    }

    let lastError = "timeout";
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await withTimeout((signal) => doFetch(`${baseUrl}/${leiNumber}`, { signal }));
      } catch {
        lastError = "timeout";
        continue;
      }

      if (res.status === 404) {
        return notOnRecord(leiNumber); // a conclusive, non-error answer.
      }
      if (res.status >= 500) {
        lastError = "provider_error";
        continue;
      }
      if (!res.ok) {
        return notOnRecord(leiNumber, "provider_error");
      }

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        return notOnRecord(leiNumber, "provider_error");
      }

      const registrationStatus: string | null =
        (json as { data?: { attributes?: { registration?: { status?: string } } } })?.data?.attributes
          ?.registration?.status ?? null;

      return {
        leiNumber,
        status: mapRegistrationStatus(registrationStatus),
        rawStatus: registrationStatus,
        provider: "gleif",
        checkedAt: new Date().toISOString(),
        raw: json,
      };
    }

    return notOnRecord(leiNumber, lastError === "timeout" ? "provider_error" : lastError);
  }

  return { name: "gleif", checkLei };
}
