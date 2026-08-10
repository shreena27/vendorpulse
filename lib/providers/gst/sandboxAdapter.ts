/**
 * Live GST provider adapter — Sandbox by Quicko.
 *
 * SERVER-ONLY. It reads SANDBOX_API_KEY / SANDBOX_API_SECRET and must never be
 * imported into a client component.
 *
 * Sandbox auth is two-step: POST the key + secret to /authenticate for a ~24h
 * access token, then send that token (no "Bearer" prefix) on API calls. This
 * adapter fetches and caches the token itself, retries a failed check once
 * (ERD §7), and normalizes the GST status.
 *
 * Confirmed contract (verified against the live test API):
 *   POST /authenticate            -> { data: { access_token } }        (x-api-version 1.0.0)
 *   POST /gst/compliance/public/gstin/search  body { gstin }           (x-api-version 1.0)
 *     200 { data: { data: { sts: "Active" | "Cancelled" | ... } } }    (registered)
 *     200 { data: { message: "No records found", error_cd } }          (not on record)
 *     400 { message: "Invalid GSTIN pattern" }                         (bad pattern/checksum)
 */

import { GSTIN_REGEX } from "@/lib/import/validateVendorRow";
import type { GstCheckResult, GstProviderAdapter, GstStatus } from "./types";

const DEFAULT_BASE_URL = "https://api.sandbox.co.in";
const AUTH_API_VERSION = "1.0.0";
const GST_API_VERSION = "1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // fallback if the JWT has no exp
const TOKEN_SKEW_MS = 60_000; // refresh a minute early

export interface SandboxAdapterConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tokenTtlMs?: number;
}

/** Read the `exp` claim (ms) from a JWT, or null if it can't be parsed. */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function mapGstStatus(raw: string | null | undefined): GstStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "active":
      return "ACTIVE";
    case "cancelled":
    case "canceled":
      return "CANCELLED";
    case "suspended":
      return "SUSPENDED";
    case "inactive":
      return "INACTIVE";
    default:
      return "UNKNOWN";
  }
}

export function createSandboxAdapter(
  config: SandboxAdapterConfig = {},
): GstProviderAdapter {
  const apiKey = config.apiKey ?? process.env.SANDBOX_API_KEY ?? "";
  const apiSecret = config.apiSecret ?? process.env.SANDBOX_API_SECRET ?? "";
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokenTtlMs = config.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;

  // Token cache lives in this closure; it persists for the life of the adapter
  // instance (a warm serverless process). `inflight` dedupes concurrent auths.
  let cachedToken: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<string> | null = null;

  async function withTimeout<T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function authenticate(): Promise<string> {
    const res = await withTimeout((signal) =>
      doFetch(`${baseUrl}/authenticate`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "x-api-secret": apiSecret,
          "x-api-version": AUTH_API_VERSION,
          "Content-Type": "application/json",
        },
        signal,
      }),
    );
    if (!res.ok) {
      throw new Error(`authenticate failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    const token: string | undefined =
      json?.data?.access_token ?? json?.access_token;
    if (!token) {
      throw new Error("authenticate returned no access_token");
    }
    const jwtExp = jwtExpiryMs(token);
    expiresAt = jwtExp ?? Date.now() + tokenTtlMs;
    cachedToken = token;
    return token;
  }

  async function getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cachedToken && Date.now() < expiresAt - TOKEN_SKEW_MS) {
      return cachedToken;
    }
    if (forceRefresh) {
      cachedToken = null;
    }
    if (!inflight) {
      inflight = authenticate().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function searchRequest(token: string, gstin: string): Promise<Response> {
    return withTimeout((signal) =>
      doFetch(`${baseUrl}/gst/compliance/public/gstin/search`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          authorization: token,
          "x-api-version": GST_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gstin }),
        signal,
      }),
    );
  }

  function fail(gstin: string, error: string, raw: unknown = null): GstCheckResult {
    return {
      gstin,
      status: "UNKNOWN",
      rawStatus: null,
      provider: "sandbox_quicko",
      checkedAt: new Date().toISOString(),
      raw,
      error,
    };
  }

  async function checkGstin(input: string): Promise<GstCheckResult> {
    const gstin = input.trim().toUpperCase();

    // Reject a malformed GSTIN before spending a provider call (ERD §7).
    if (!GSTIN_REGEX.test(gstin)) {
      return fail(gstin, "invalid_gstin");
    }

    // Up to two attempts: the second covers a one-off timeout / 5xx / 401
    // (retry-once, ERD §7). A 401 forces a fresh token.
    let forceToken = false;
    let lastError = "timeout";

    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        const token = await getToken(forceToken);
        res = await searchRequest(token, gstin);
      } catch (err) {
        // Auth failure vs. network/abort. Both are retryable once.
        lastError =
          err instanceof Error && err.message.startsWith("authenticate")
            ? "auth_failed"
            : "timeout";
        continue;
      }

      if (res.status === 401) {
        forceToken = true;
        lastError = "auth_failed";
        continue;
      }
      if (res.status >= 500) {
        lastError = "provider_error";
        continue;
      }

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        // Non-JSON body — fall through to the status checks below.
      }

      // Sandbox rejects a bad pattern/checksum with 400.
      if (res.status === 400) {
        return fail(gstin, "invalid_gstin", json);
      }
      if (!res.ok) {
        return fail(gstin, "provider_error", json);
      }

      const sts: string | null =
        (json as { data?: { data?: { sts?: string } } })?.data?.data?.sts ??
        null;
      return {
        gstin,
        status: mapGstStatus(sts),
        rawStatus: sts,
        provider: "sandbox_quicko",
        checkedAt: new Date().toISOString(),
        raw: json,
      };
    }

    return fail(gstin, lastError);
  }

  return { name: "sandbox_quicko", checkGstin };
}
