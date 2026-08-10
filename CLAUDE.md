# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the dev server at http://localhost:3000 (hot reload).
- `npm run build` — production build.
- `npm start` — serve the production build (run `build` first).
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`).
- `npm test` — run the hermetic Vitest unit tests once (`test:watch` for watch mode).
- `npm run test:integration` — run the live-DB Vitest integration tests (needs `.env.local` + applied migrations).
- `npm run test:e2e` — run the Playwright end-to-end tests.

Two test runners, kept apart: **Vitest** for server-side unit tests (`lib/**/*.test.ts`, config in
`vitest.config.mts`); **Playwright** for browser end-to-end tests (`e2e/`, config in
`playwright.config.ts`). The Vitest config excludes `e2e/` so the two never collide.

## Stack and versions

- **Next.js 16** with the **App Router** (`app/` directory). No `pages/` directory.
- **React 19** with React Server Components by default. Add `"use client"` at the top of a file only when it needs browser APIs, state, or effects.
- **Tailwind CSS v4** — configured entirely in CSS, not JS. There is **no `tailwind.config.js`**. Theme tokens, fonts, and colors live in `app/globals.css` under the `@theme inline { ... }` block, imported via `@import "tailwindcss"`. Add or change design tokens there.
- **TypeScript** in `strict` mode. Import alias `@/*` maps to the project root (see `tsconfig.json`), so `@/app/...` resolves from the repo root.

## Architecture notes

- `app/layout.tsx` is the root layout: it loads the Geist fonts, applies `globals.css`, and wraps all pages. Its signature uses `LayoutProps<"/">` — a **globally-available generated type** from Next.js 16's typed routes. These types (`LayoutProps`, `PageProps`, etc.) are generated into `.next/` during `dev`/`build`; if the editor cannot find them, run `npm run dev` or `npm run build` once to regenerate.
- `app/page.tsx` is the home route (`/`) and is currently the default scaffold page. Static assets live in `public/` and are referenced from the site root (e.g. `src="/next.svg"`).
- Dark mode is driven by `prefers-color-scheme` via the `dark:` Tailwind variant and the CSS custom properties in `globals.css`; there is no manual theme toggle.

## Project: VendorPulse — Continuous Vendor Trust Monitoring

> **This is the full target spec. The code builds it chunk by chunk.** See
> "Current state" below for what is built so far. The rest describes what to
> build next. The full source documents are in `docs/`:
> `ERD - Engineering Requirements Document.docx` (data model, API, logic),
> `Implementation Plan.docx` (build order), and `PRD Template [E2E].docx`
> (product context). Treat the ERD as the source of truth for schema and contracts.

### What the product is

- The product watches a vendor after approval. It alerts the user when an important status changes.
- Target stack: Next.js (TypeScript) + Supabase (Postgres, Auth, Storage) + Vercel. It is a web app. It is not a native mobile app.
- Primary user: a finance head (CFO) at a mid-market Indian company with 100–300 vendors.
- Core rule: poll GST and MSME status continuously. Verify bank account and certificates one time at onboarding. Check LEI only before a large payment.
- Architecture is polling, not event-driven. Government registries (GST, Udyam) do not push change notifications.

### Data model (Postgres, via Supabase migrations)

| Table | Purpose | Key columns |
|---|---|---|
| `organizations` | One row per buyer company (tenant). | `id`, `name` |
| `users` | Maps 1:1 to Supabase `auth.users`. Adds org and role. | `id`, `organization_id`, `role` (`admin`\|`finance_head`\|`ops_lead`) |
| `vendors` | The vendor master. One row per vendor per org. | `id`, `organization_id`, `gstin`, `udyam_number`, `pan`, `current_gst_status`, `current_msme_status`, `current_bank_status` |
| `vendor_imports` | One row per bulk upload or ERP sync batch. | `id`, `organization_id`, `source`, `row_count`, `error_count`, `status` |
| `verification_checks` | Append-only log of every GST/MSME check. One row per poll per vendor per type. | `id`, `vendor_id`, `check_type` (`gst`\|`msme_udyam`), `status_value`, `provider`, `raw_response` (jsonb), `is_change`, `checked_at` |
| `bank_verifications` | One-time onboarding bank check. Re-run only on manual flag. | `id`, `vendor_id`, `account_number_masked`, `ifsc`, `name_match_result`, `status`, `re_verified_reason` |
| `certificates` | Insurance/safety documents, uploaded at onboarding. | `id`, `vendor_id`, `certificate_type`, `file_path`, `expiry_date`, `status` |
| `payments` | Open POs / pending payments. Needed for the 45-day MSME window and the ₹50cr LEI threshold. | `id`, `organization_id`, `vendor_id`, `amount`, `due_date`, `payment_method` (`rtgs`\|`neft`\|`other`), `status` |
| `lei_checks` | Conditional pre-payment LEI check. Only for RTGS/NEFT ≥ ₹50cr. | `id`, `payment_id`, `vendor_id`, `lei_number`, `status` (`issued`\|`lapsed`\|`retired`\|`not_on_record`) |
| `alerts` | A surfaced change worth a decision. | `id`, `organization_id`, `vendor_id`, `trigger_type`, `source_check_id`, `payment_impact_amount`, `status`, `resolved_by`, `resolved_at` |
| `evidence_log` | Append-only record of every check, change, and decision. | `id`, `organization_id`, `vendor_id`, `event_type`, `entity_type`/`entity_id`, `payload` (jsonb), `actor`, `created_at` |

Persistent data rules:

- Every tenant table carries `organization_id`. Row Level Security enforces isolation at the database level. Policy: `organization_id = (select organization_id from users where id = auth.uid())`.
- `verification_checks` is one table for both GST and MSME. A `check_type` discriminator separates them. The Change Detector compares each new row against the vendor's prior check of the same type.
- `evidence_log` is append-only. The DB role has no UPDATE or DELETE grant on it, not even the service role.
- `evidence_log` points to source rows by `entity_type` + `entity_id`. It uses no foreign key, so a write never fails.
- Store bank account numbers masked (last 4 digits only). Never persist the full number. Pass it to the Eko API, then discard it.
- PAN and proprietor contact details are personal data under the DPDP Act. Show them to `finance_head` and `admin` only. Exclude them from the general vendor list and from `evidence_log` snapshots.
- Cron jobs and provider calls run under the Supabase service role. This bypasses RLS by design, server-side only.

### API contracts (Next.js `/api/**`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/vendors/import` | finance_head, admin | Upload CSV/XLSX or trigger ERP sync. Creates `vendor_imports` and `vendors` rows. |
| `GET /api/vendors` | any org user | List vendors with current status. |
| `GET /api/vendors/:id` | any org user | Vendor detail: status + check history + certificates + open alerts. |
| `POST /api/vendors/:id/flag` | any org user | Manual flag. Triggers re-verification of bank and/or certificates. |
| `POST /api/vendors/:id/certificates` | any org user | Upload a certificate to Supabase Storage. Writes a `certificates` row. |
| `GET /api/alerts` | any org user | List alerts. Filter by status, vendor, or trigger type. |
| `POST /api/alerts/:id/action` | any org user | Body `{ action: hold \| reviewed \| escalate }`. Returns 409 if already resolved. |
| `POST /api/payments/:id/lei-check` | system / finance_head | Runs only for RTGS/NEFT ≥ ₹50cr. Calls GLEIF. May create an alert. |
| `GET /api/evidence/export` | finance_head, admin | Clause 22 / Form 3CD CSV or PDF. Built from `evidence_log`, not live vendor state. |
| `POST /api/cron/poll-gst` | Cron (service role) | Vercel Cron. Batches all vendors with a `gstin`. |
| `POST /api/cron/poll-msme` | Cron (service role) | Vercel Cron. Batches all vendors with a `udyam_number`. |

Key business rules:

- An alert fires only when a change (`is_change = true`) hits a vendor that has a pending payment, OR a LEI check resolves to `lapsed`/`retired`/`not_on_record` for a payment in flight.
- A change with no open payment still writes to `verification_checks` and `evidence_log`. It does not create an alert.
- Alerts dedupe per `vendor_id` + `trigger_type`. A repeat detection updates `payment_impact_amount` on the open alert. A new alert row starts only after the prior one reaches `cleared` or `escalated`.
- Every external provider sits behind a common `ProviderAdapter` interface. Each adapter has a mock implementation, selected by an env var. Ship against the mock when no live credential exists yet.
- The LEI check does not block a payment. It alerts, so the finance head can hold the payment.

### Phase / chunk build order

Build in order. Do not start a later phase until the phase before it works end-to-end. Verify each chunk's failure and edge-case paths, not just the happy path.

- **Phase 0 — Foundation**
  - 0.1 Project scaffold + Supabase Auth + Vercel deploy pipeline.
  - 0.2 Core schema (`organizations`, `users`) + RLS baseline.
- **Phase 1 — Vendor connector + continuous GST/MSME (the core hypothesis)**
  - 1.1 Vendor bulk import (`vendors`, `vendor_imports`; `POST /api/vendors/import`).
  - 1.2 GST provider adapter (Sandbox by Quicko) + mock.
  - 1.3 MSME/Udyam provider adapter (Deepvue) + mock.
  - 1.4 Cron polling + change detection (`verification_checks`; `poll-gst`, `poll-msme`).
  - 1.5 Vendor status dashboard UI (`GET /api/vendors`, `GET /api/vendors/:id`).
- **Phase 2 — Onboarding-only verification**
  - 2.1 Bank account verification (Eko) (`bank_verifications`).
  - 2.2 Certificate upload (`certificates`; Supabase Storage).
- **Phase 3 — Alerting (runs in parallel with Phase 2)**
  - 3.1 Impact scorer (adds `payments`).
  - 3.2 Alert generation + dedupe (`alerts`).
  - 3.3 Alert UI + one-tap actions + Resend email.
- **Phase 4 — Evidence log + LEI**
  - 4.1 Evidence log wiring (`evidence_log`; revoke UPDATE/DELETE on it).
  - 4.2 Clause 22 / Form 3CD export.
  - 4.3 LEI pre-payment check (GLEIF) (`lei_checks`).
- **Phase 5 — Pilot rollout + metrics**
  - 5.1 Metrics instrumentation.
  - 5.2 Pilot hardening + provider rate limiting.
  - 5.3 End-to-end verification suite (one Playwright file per PRD §8 user story).

Build principle: run every external API on a free tier or trial first — GLEIF (free), Sandbox (self-serve pay-per-call), Eko (sandbox credentials), Deepvue (free trial). If a capability has no free path when its chunk starts, ship that chunk against a mock adapter. Do not wait on a sales contract.

### Current state (built so far)

**Chunk 0.1 — auth + deploy: DONE.**
- Supabase Auth with email and password. Sign-up needs "Confirm email" OFF in the Supabase dashboard, so a new user gets a session at once.
- `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server) create typed Supabase clients. `lib/supabase/middleware.ts` refreshes the session. Root `middleware.ts` guards protected routes and sends signed-out users to `/login`.
- Auth pages: `app/(auth)/login/page.tsx` and `app/(auth)/signup/page.tsx`, with server actions in `app/(auth)/actions.ts` (`login`, `signup`, `signOut`). Errors show inline. No redirect loop.
- `app/dashboard/page.tsx` is the protected shell. `app/page.tsx` redirects to `/dashboard`.
- The app deploys on Vercel. A push to `main` triggers a deploy.

**Chunk 0.2 — core schema + RLS: DONE.**
- `supabase/migrations/0001_core.sql` creates `organizations` and `users`.
- The `handle_new_user()` trigger runs on `auth.users` insert. It creates one organization and one `users` row with role `admin`. So each new sign-up owns a new organization.
- RLS isolates tenants. Policies use `public.current_org_id()`, a `SECURITY DEFINER` helper with `search_path = ''` (see [[supabase-security-definer-search-path]]). This avoids RLS recursion on `users`.
- `lib/supabase/types.ts` holds a hand-written `Database` type. Regenerate it with the Supabase CLI later.
- `app/dashboard/page.tsx` shows the caller's organization name and members (RLS-scoped).

**Chunk 1.1 — vendor bulk import: DONE.**
- `supabase/migrations/0002_vendors.sql` creates `vendors` and `vendor_imports`.
- `POST /api/vendors/import` (`app/api/vendors/import/route.ts`) reads a CSV/XLSX upload plus a
  column mapping, validates each row, dedupes by GSTIN within the upload, and calls the
  `import_vendors()` RPC.
- All writes go through `public.import_vendors(text, int, int, jsonb)`, a `SECURITY DEFINER` RPC
  (like `handle_new_user`) that inserts the batch row and every vendor row in one transaction and
  stamps `organization_id = current_org_id()`. `authenticated` has SELECT only on the two tables;
  there is no INSERT policy. Validation and dedupe finish in memory first, so the import's final
  `status`/`row_count`/`error_count` are known before any write (`processing` is never persisted).
- `lib/import/parseVendorFile.ts` parses CSV/XLSX with SheetJS (lazy `import("xlsx")`; pinned to the
  patched CDN tarball in `package.json`, not the npm-registry build). It forces every cell to a
  string (`raw: false`) so GSTIN/PAN/Udyam keep leading zeros. `lib/import/validateVendorRow.ts`
  holds the GSTIN/Udyam regexes and the per-row rules (bad GSTIN or missing name → hard reject; bad
  Udyam → soft warning, vendor saved with MSME status `unknown`).
- `app/vendors/import/page.tsx` is the upload + column-mapping UI. `app/vendors/page.tsx` is a
  minimal RLS-scoped list (the full status dashboard is Chunk 1.5).

**Chunk 1.2 — GST provider adapter (Sandbox by Quicko) + mock: DONE.**
- `lib/providers/gst/` holds a common `GstProviderAdapter` interface (`types.ts`), a live
  `sandboxAdapter.ts`, a deterministic `mockAdapter.ts`, and `index.ts` (`getGstAdapter()` selector).
  Every adapter returns the same `GstCheckResult` shape, so the poller (1.4) never knows which
  provider answered. Server-only — never import these into a client component (the secret must not
  reach the browser). No DB writes and no API route yet; 1.4 wires it to `verification_checks`.
- **Provider selection:** `GST_PROVIDER=sandbox|mock`. Unset → sandbox when both `SANDBOX_API_KEY`
  and `SANDBOX_API_SECRET` are set, else mock (ship-against-mock, ERD §12).
- **Sandbox auth is two-step and handled inside the adapter:** POST key+secret to `/authenticate`
  (`x-api-version 1.0.0`) for a ~24h token at `data.access_token`; the adapter caches it (JWT `exp`,
  with a fallback TTL) and sends it as the raw `authorization` header (no `Bearer`) on
  `/gst/compliance/public/gstin/search` (`x-api-version 1.0`, body `{ gstin }`).
- **Confirmed live-API quirks (verified, not assumed):** Sandbox validates the GSTIN **checksum** and
  returns `400 "Invalid GSTIN pattern"` for a bad one → mapped to `invalid_gstin`. The GST status is
  nested at **`data.data.sts`** (`"Active"`/`"Cancelled"`/…). A not-registered GSTIN returns `200`
  with `error_cd` and no `sts` → UNKNOWN. The adapter validates format first (reuses `GSTIN_REGEX`
  from `lib/import/validateVendorRow.ts`) so a malformed GSTIN spends no provider call, and retries
  once on timeout / 5xx / 401 before returning UNKNOWN — a failed check is never treated as compliant
  (ERD §7).
- **Secrets.** `.env.local` now also holds `SANDBOX_API_KEY` and `SANDBOX_API_SECRET` (server-only,
  gitignored). These still need adding to Vercel before the 1.4 poller runs in production.

**Chunk 1.3 — MSME/Udyam provider adapter (Deepvue) + mock: DONE (mock only; live adapter stubbed).**
- `lib/providers/msme/` mirrors `lib/providers/gst/`: a common `MsmeProviderAdapter` interface
  (`types.ts`), a `deepvueAdapter.ts`, a deterministic `mockAdapter.ts`, and `index.ts`
  (`getMsmeAdapter()` selector). `MsmeCheckResult` adds a `registrationDate` field (the one shape
  difference from GST). Statuses normalize to `REGISTERED | LAPSED | NOT_MSME | UNKNOWN`. Server-only.
- **`deepvueAdapter.ts` is a deliberate stub.** No Deepvue credentials exist yet (signup needs a work
  email) and its docs are login-gated, so — per the 1.2 lesson that a live contract can differ from
  published docs — the field names and response shape are NOT guessed. The interface compiles but
  `checkUdyam()` throws a clear "not configured" error; a `TODO(chunk-1.3-live)` marks exactly what to
  verify against the live API before wiring it. It fails loudly, never silently.
- **Provider selection:** `MSME_PROVIDER=mock|deepvue`. Unset → mock (Deepvue is a stub). When Deepvue
  is implemented, add a keys-present check to the default like the GST selector.
- The mock reuses `UDYAM_REGEX` from `lib/import/validateVendorRow.ts`, so a malformed Udyam number
  returns `invalid_udyam` before any call. No DB writes, no API route, no new dependency; 1.4 wires it
  to `verification_checks`.

**Chunk 1.4 — Cron polling + change detection: DONE.**
- `supabase/migrations/0003_verification_checks.sql` creates `verification_checks` (ERD §3.2). It
  carries a denormalized `organization_id` (set from the vendor) so RLS reuses the org-scoped pattern:
  **SELECT-only for `authenticated`**, no insert/update/delete policy — the table is append-only and
  only the service-role cron writes it. `provider` CHECK is `sandbox_quicko|deepvue|mock` (the ERD's
  `masters_india` is omitted — see [[no-speculative-erd-surface]]).
- `lib/supabase/admin.ts` is the first **service-role** client (`createAdminClient()`), used only by
  the cron. It bypasses RLS to work across all orgs — server-only, never import it client-side.
- `app/api/cron/poll-gst/route.ts` and `poll-msme/route.ts` export **both GET and POST** (Vercel Cron
  triggers via GET; POST is for manual runs). Each verifies `Authorization: Bearer $CRON_SECRET` via
  `lib/verification/cronAuth.ts` (**fails closed** when the secret is unset), then runs the poll.
  `vercel.json` schedules them daily (02:00 / 02:30 UTC).
- `lib/verification/pollRunner.ts` (`runPoll`, dependency-injected) loads every vendor with the
  relevant identifier across all orgs, checks each via the adapter with a small **concurrency pool**,
  writes one `verification_checks` row per vendor, and updates the vendor's `current_*_status`
  (grouped UPDATEs). A thrown adapter call becomes a `status_value = 'UNKNOWN'` row so **one failure
  never aborts the batch** (ERD §7). `lib/verification/changeDetector.ts` holds the pure logic:
  `detectChange` (first check = baseline, not a change), the status→vendor-enum mappers, and
  `buildCheck`.
- **Provider selection at deploy:** the GST cron uses `getGstAdapter()` → live Sandbox by default
  (`GST_PROVIDER` unset); the MSME cron uses the mock (Deepvue still stubbed). No alerts and no
  `evidence_log` yet (Chunks 3 / 4.1) — 1.4 only records checks and flips `is_change`.
- **Secrets / Vercel:** `.env.local` now also holds `CRON_SECRET`. Before the cron runs in production,
  add `CRON_SECRET` and `SANDBOX_API_KEY`/`SANDBOX_API_SECRET` to Vercel; leave `GST_PROVIDER` unset.
- **Deployed + verified in production.** Chunks 1.1–1.4 are live on Vercel; a production curl of the
  cron endpoints confirmed the auth gate (401 without the Bearer secret) and a successful live-Sandbox
  GST poll + mock MSME poll. That check also caught the middleware bug fixed below.

**Chunk 1.5 — Vendor status dashboard: DONE.**
- The recall flow (PRD §4.4) — the first read UI over the rows 1.1–1.4 produce. `app/vendors/page.tsx`
  (a server shell) lists vendors via `app/vendors/VendorList.tsx` (a client component: search on
  name/GSTIN + All / Needs attention / Pending chips). `app/vendors/[id]/page.tsx` is the detail view:
  current GST/MSME/bank badges, identifiers, and the full `verification_checks` history in
  chronological order. `app/vendors/StatusBadge.tsx` renders status pills that always carry a text
  label (legible without color) plus a "Changed" marker.
- `GET /api/vendors` and `GET /api/vendors/:id` (ERD §4) return the same data as JSON. Both the routes
  and the pages call **shared helpers in `lib/vendors/queries.ts`** (RLS-scoped reads), so they never
  drift. `lib/vendors/statusBadge.ts` holds the pure badge derivation, unit-tested for the tricky
  cases: **Pending** (identifier present, no check yet) vs **Unknown** (checked, no answer) vs **N/A**
  (no identifier).
- **DPDP (ERD §6.3):** PAN is never in the list; on the detail view it is returned only to
  `finance_head`/`admin` (gated in the query via the `role` column from Chunk 0.2), others see
  "Restricted to finance". Note: this is app-layer gating — there is no column-level DB privilege yet,
  so a determined org member could read `pan` via PostgREST directly. Harden with column privileges /
  a view if that becomes a requirement.
- Reads only — no new tables. Bank status stays `Unverified` for everyone until Chunk 2.1.

**Testing.**
- Playwright e2e lives in `e2e/`. Run `npm run test:e2e`.
- `e2e/auth.spec.ts` covers sign-up, log out, log in, the protected-route redirect, and the wrong-password inline error.
- `e2e/rls.spec.ts` covers auto-provisioning and cross-tenant isolation (API level and UI level).
- `e2e/vendor-import.spec.ts` covers Chunk 1.1: a good file imports and lists every vendor; a
  duplicate GSTIN is skipped and reported by row number (not merged or double-counted); an empty
  file shows a clear error, not a blank success.
- `lib/providers/gst/*.test.ts` (Vitest) cover Chunk 1.2: both adapters return the same shape;
  active→ACTIVE, cancelled→CANCELLED, a mock timeout, a malformed GSTIN spends no provider call, a
  provider 400, retry-once, 401 token refresh, and token caching. The Sandbox adapter test injects a
  fake `fetch`, so no network is touched.
- `lib/providers/msme/*.test.ts` (Vitest) cover Chunk 1.3: the mock returns REGISTERED with a
  registration date, plus lapsed / not_msme / timeout, and rejects a malformed Udyam number before any
  call; the Deepvue stub rejects with a clear "not configured" error even for a valid number.
- `lib/verification/*.test.ts` (Vitest, hermetic) cover Chunk 1.4's pure logic: `detectChange`, the
  status→vendor-enum mappers, `buildCheck`, and `isAuthorizedCron` (including fail-closed when
  `CRON_SECRET` is unset).
- `lib/verification/pollRunner.integration.test.ts` is a **live-DB** integration test, run separately
  via `npm run test:integration` (its own `vitest.integration.config.mts`, kept out of the default
  `npm test`). It seeds vendors, runs `runPoll` twice with a stub adapter, and asserts `is_change`
  fires on exactly the changed vendor and that one thrown check leaves the rest of the batch intact.
  Because the poller is global (all orgs), its assertions are scoped to the vendor ids it seeds, not
  global counts. Needs migration 0003 applied + `.env.local`; self-skips when the Supabase env is absent.
- `lib/vendors/statusBadge.test.ts` (Vitest) covers Chunk 1.5's pure badge derivation: Pending vs
  Unknown vs N/A, the status→tone mapping, and `isAttentionTone`.
- `e2e/vendor-dashboard.spec.ts` covers Chunk 1.5: seeds poller output via the service-role client,
  then asserts the list badges, the "Changed" flag, the Needs-attention/Pending filters, the detail
  history in chronological order, and the zero-checks "pending" panel. Note: a heterogeneous PostgREST
  bulk `insert([...])` sends NULL for keys some rows omit (bypassing column DEFAULTs) — seed rows must
  share a uniform key set.
- The e2e tests need `.env.local` and a reachable Supabase project. `playwright.config.ts` loads
  `.env.local` into the test process. The default Vitest unit tests need neither.

### Operational notes

- **Migrations run by hand.** Apply each `supabase/migrations/*.sql` in the Supabase SQL Editor (or `supabase db push`). The Vercel deploy does NOT run migrations. There is no CI migration step yet.
- **Every new table needs GRANTs.** PostgREST checks SQL grants BEFORE RLS. A table with policies but no grant returns `permission denied` (42501). Grant `select`/`insert`/`update`/`delete` to `authenticated` as the policy needs, and `all` to `service_role`. See section 6 of `0001_core.sql`.
- **Secrets.** `.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SANDBOX_API_KEY`/`SANDBOX_API_SECRET` (GST provider), and `CRON_SECRET` (cron auth). Never use the service-role key in client code. The service-role/Sandbox/cron secrets are all server-only (no `NEXT_PUBLIC_` prefix). Mirror `SANDBOX_*` and `CRON_SECRET` into Vercel before the cron runs in production.
- **Middleware guards pages, not APIs.** `lib/supabase/middleware.ts` redirects signed-out users to
  `/login`, but **exempts `/api/*`** — API routes enforce their own auth and return JSON status codes
  (401/404), never an HTML redirect. Without this exemption the cron routes 307-redirect to `/login`
  before their `CRON_SECRET` check runs (found via a production curl).
- **Deprecation.** Next.js 16.3 prints a warning that `middleware.ts` is deprecated in favor of `proxy.ts`. The file still works. A migration codemod exists.

### Next chunk

Phase 1 is complete (import → GST/MSME adapters → daily polling + change detection → status
dashboard). Phase 2 is onboarding-only verification:

- **Chunk 2.1 — Bank account verification (Eko).** `CREATE TABLE bank_verifications` (ERD §3.2); a
  one-time, per-vendor check triggered right after import (or on a manual re-flag via
  `POST /api/vendors/:id/flag`). Calls Eko's sandbox/live API, stores a **masked** result
  (last 4 digits only — never persist the full account number), and sets `current_bank_status`
  (`verified` on an exact name match, `mismatch`/`manual_review` on a partial match). Ship against a
  mock adapter until Eko sandbox credentials exist (same pattern as the GST/MSME adapters).
- **Chunk 2.2 — Certificate upload** (`certificates`; Supabase Storage) runs after 2.1.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
