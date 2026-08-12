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

**Chunk 2.1 — Bank account verification (Eko) + mock: DONE (mock only; live adapter stubbed).**
- `supabase/migrations/0004_bank_verifications.sql` creates `bank_verifications` (ERD §3.2, same
  RLS + grants pattern as every prior table: `authenticated` SELECT-only, all writes through a
  SECURITY DEFINER RPC) and widens `vendors.current_bank_status`'s CHECK constraint to add
  `manual_review` (looked up via `pg_constraint` rather than a guessed constraint name, since 0002
  already shipped). The new `record_bank_verification()` RPC inserts one row and updates the
  vendor's `current_bank_status` in one transaction, validating the vendor belongs to the caller's
  org first (mirrors `import_vendors`).
- `lib/providers/bank/` mirrors `lib/providers/msme/`: a common `BankProviderAdapter` interface
  (`types.ts`), a `mockAdapter.ts`, an `ekoAdapter.ts` **stub** (no Eko sandbox credentials exist
  yet; `verifyAccount()` throws a clear "not configured" error — same lesson as the Deepvue stub in
  Chunk 1.3, do not guess field names), and `index.ts` (`getBankAdapter()`, `BANK_PROVIDER=mock|eko`,
  unset → mock). `nameMatch.ts` holds the pure name-matching classifier (`exact`/`partial`/`none`)
  and `mask.ts` the pure `"****" + last4` masker, both unit-tested standalone. **Safety guarantee is
  type-level:** `BankCheckResult` has no field for the raw account number at all — only
  `accountNumberMasked` — so nothing downstream can carry the full number even by accident.
- **The raw account number's only entry point is the CSV import.** `lib/import/validateVendorRow.ts`
  gained two optional columns, `bank_account_number` and `bank_ifsc` (validated like Udyam: malformed
  → soft warning, vendor still imported, bank check skipped for that row). The raw values live only
  in the import route's in-memory row list — never added to `VendorImportInput`, so they never reach
  the `vendors` table. `import_vendors` (0002) is untouched; after it returns `import_id`, the route
  re-selects the inserted vendors and calls the new pure `lib/vendors/correlateImport.ts` to pair each
  bank-detail row back to its vendor id (by GSTIN when present, else exact name — a same-name,
  GSTIN-less collision within one import is a documented edge case, same spirit as 0002's existing
  no-unique-GSTIN note).
- `lib/bank/verifyVendorBank.ts` is the one orchestrator both call sites use: the import route (looped,
  bounded concurrency, same worker-pool shape as `pollRunner.ts`) and the new
  `POST /api/vendors/:id/flag` (`app/api/vendors/[id]/flag/route.ts`, any org user, body
  `{ accountNumber, ifsc, reason? }` — bank only for now, no `target` field since certificates (2.2)
  don't exist yet). It calls the adapter, then `record_bank_verification`, and never handles the raw
  number itself.
- Status model: `name_match_result` (`exact|partial|none`) drives `status`
  (`verified|manual_review|mismatch`) on both `bank_verifications.status` and
  `vendors.current_bank_status`; an adapter failure also maps to `manual_review` — a failed check is
  never treated as compliant (ERD §7, same rule as GST/MSME). `lib/vendors/statusBadge.ts` gained a
  `manual_review` → amber "Manual review" entry.
- `app/vendors/import/page.tsx`'s column-mapping UI needed no new logic — it already maps over
  `SCHEMA_FIELDS` generically — just two new `FIELD_LABELS`/`GUESS_PATTERNS` entries, plus a
  `bankVerifications` summary line in the result panel.
- **No new secret needed.** Eko has no sandbox credentials yet, so there's nothing to add to
  `.env.local`/Vercel; `BANK_PROVIDER` is unset (mock is the default, same as `MSME_PROVIDER`).

**Chunk 2.2 — Certificate upload: DONE.**
- `supabase/migrations/0005_certificates.sql` creates `certificates` (ERD §3.2, same RLS + grants
  pattern as every prior table) and the `create_certificate()` SECURITY DEFINER RPC (validates the
  vendor belongs to the caller's org first, mirrors `record_bank_verification`). `certificate_type`
  is plain `text` — the ERD defines no closed enum, so none was invented (same "no speculative ERD
  surface" call as dropping `masters_india` in 0003). Status (`valid`/`expired`) is computed once,
  server-side, at upload time only — there is no ongoing/scheduled certificate recheck in v1 (PRD).
- **The private Storage bucket has its own, separate RLS layer.** The migration also creates the
  `certificates` Storage bucket (`public = false`, `allowed_mime_types` restricted to
  PDF/JPEG/PNG as defense-in-depth) and three `storage.objects` policies (INSERT/SELECT/DELETE)
  scoped by `(storage.foldername(name))[1] = current_org_id()::text` — objects live at
  `{organization_id}/{vendor_id}/{timestamp}_{filename}`, so the first path segment IS the
  enforcement boundary. This is independent of the Postgres RLS on the `certificates` table itself;
  the integration test (below) proves a different org's client is blocked by Storage even when given
  a path pointing at another org's folder, not just by the app's own vendor-ownership check.
- **Both the upload and the signed-URL call must run on the caller's authenticated client**, never
  the admin/service-role client — using admin would silently bypass the storage RLS above.
  `lib/storage/certificateUrl.ts`'s `getCertificateSignedUrl()` generates a 60-second signed URL;
  nothing is ever exposed via a public URL.
- `lib/certificates/validateCertificateFile.ts` checks both the declared extension and MIME type
  (and requires them to agree on the same file kind) before any Storage write — a `.exe`, a spoofed
  extension, or a spoofed `Content-Type` are all rejected before touching Storage.
  `lib/certificates/certificateStatus.ts` holds the pure valid/expired derivation.
- `lib/storage/uploadCertificate.ts` is the one orchestrator: validate → upload → derive status →
  `create_certificate()` RPC → **on RPC failure, delete the just-uploaded object** before re-throwing,
  so a same-request DB failure never leaves an orphan either (the acceptance criteria only required
  this for the rejected-file-type case, which is trivially satisfied since validation runs first;
  this extends the same guarantee to the DB-failure path).
- `app/api/vendors/[id]/certificates/route.ts` exports `POST` (upload, any org user) and `GET` (list
  with fresh signed URLs — added beyond the ERD's literal contract since the new page needs a way to
  read back what's uploaded). `lib/certificates/queries.ts` holds `listVendorCertificates` +
  `listVendorCertificatesWithUrls`, shared by the route and the page so they never drift (same
  pattern as `lib/vendors/queries.ts`).
- `app/vendors/[id]/certificates/page.tsx` (server shell) + `CertificateUploadForm.tsx` (client,
  mirrors the `vendors/import` page's `FormData` submit pattern) is a new, self-contained page — the
  existing vendor detail page and `lib/vendors/queries.ts` were not touched beyond one "Certificates →"
  nav link.

**Chunk 3.1 — Impact scorer: DONE.**
- `supabase/migrations/0006_payments.sql` creates `payments` (ERD §3.2, same RLS + grants pattern
  as every prior table), brought forward from Phase 4 because scoring needs it now. `status` is a
  minimal closed enum — `pending | paid | cancelled` — unlike `certificate_type` in 2.2 this one
  *is* load-bearing for the scorer's query, so it wasn't left speculative-free-text. **No INSERT
  policy for `authenticated` yet**: there is no payments-entry UI/API in this chunk (same "write
  path doesn't exist yet" gap `verification_checks` had before 1.4); only the service role writes,
  and tests seed directly through it.
- `lib/alerts/impactScorer.ts`'s `scoreChange(input, deps)` is the decision logic, and it takes
  **injected dependencies** rather than a raw Supabase client — mirrors `pollRunner.ts`'s
  `runCheck` injection, the established way to keep DB-touching orchestration hermetically
  unit-testable in this codebase. `isChange: false` short-circuits to non-alert-worthy without
  calling either dependency; otherwise it's `hasOpenPendingPayment` OR `hasUnfavorableLeiCheck`
  (payment checked first, so its reason wins if both are true).
- `hasUnfavorableLeiCheck` is a **deliberate stub** — always resolves `false`, `TODO(chunk-4.3)`
  states exactly what to build once `lei_checks` exists (payments ≥ ₹50cr RTGS/NEFT with an
  unfavorable status) — do not guess the table shape now, same lesson as the Eko/Deepvue adapter
  stubs. `hasOpenPendingPayment` is the real `payments` query (`vendor_id` + `status = 'pending'`).
  `scoreChangeForVendor(supabase, input)` wires the real dependencies together — **nothing calls it
  yet**; Chunk 3.2 (alert generation) will, from the actual pipeline. This chunk is scoring logic
  only: no new API route, no changes to `pollRunner.ts` or the cron routes.
- **Scoring is fully decoupled from the audit trail by construction** — `impactScorer.ts` never
  reads or writes `verification_checks`; it only takes that row's `is_change` value as input. The
  integration test proves this isn't just an assumption: it runs the real Chunk 1.4 `runPoll` to
  produce a genuine `is_change = true` row, scores it once with no payment (not alert-worthy) and
  once after seeding a `pending` payment (alert-worthy), and re-queries `verification_checks`
  directly both times to confirm the row is identical either way.

**Chunk 3.2 — Alert generation + dedupe: DONE.**
- `supabase/migrations/0007_alerts.sql` creates `alerts` (ERD §3.2/§5.3, same RLS + grants pattern
  as every prior table — `authenticated` select-own only, service role writes, no RPC needed since
  every write comes from the cron pipeline which already runs as the service role, same reasoning
  `verification_checks` itself relies on). `trigger_type` + `source_check_id` is a polymorphic
  reference — same pattern CLAUDE.md already documents for `evidence_log` ("points to source rows
  by entity_type + entity_id... no foreign key, so a write never fails"): `trigger_type`
  (`gst_change | msme_change | lei_check`) says which table, `source_check_id` is an un-FK'd uuid,
  since a GST/MSME alert points into `verification_checks` but a future LEI alert (Chunk 4.3) will
  point into `lei_checks` instead. `status`'s full lifecycle (`open|hold|reviewed|cleared|escalated`)
  is defined now even though only `open` is ever written here — the ERD's own `POST /api/alerts/:id
  /action` contract already names the other states.
- **`lib/verification/pollRunner.ts` now returns `changedChecks`** (id/vendorId/organizationId/
  checkType for every `is_change = true` row), via `.insert(checks).select(...)` instead of a bare
  `.insert(checks)` — the one change to already-shipped Chunk 1.4 code, needed so
  `alerts.source_check_id` has a real row id to point at. Purely additive: existing callers/tests
  that ignore the return value are unaffected (`pollRunner.integration.test.ts` still passes
  unchanged).
- `lib/alerts/createOrUpdateAlert.ts` is ERD §5.3's dedupe: an existing alert for the same
  `(vendor_id, trigger_type)` with `status in (open, hold, reviewed)` gets only its
  `payment_impact_amount` updated (never `source_check_id` — that stays pointed at whichever check
  *first* opened the alert); otherwise a new row is inserted with `status = 'open'`.
- `lib/alerts/processChangeAlerts.ts` is the loop: for each changed check, `scoreChangeForVendor` →
  skip if not alert-worthy → `getOpenPaymentAmount` (new export on `impactScorer.ts`, sums all
  `pending` payments for the vendor) → `createOrUpdateAlert`. Same two-tier DI pattern as Chunk 3.1
  (`processChangeAlerts(changedChecks, deps)` is hermetically tested with injected fakes;
  `processChangeAlertsForPipeline(supabase, changedChecks)` wires the real functions and is what the
  cron routes call).
- **This is where the impact scorer actually gets called from, for the first time** — confirmed as
  the right place: `changeDetector.ts`'s own Chunk 1.4 docstring already said a status difference
  "feeds the Impact Scorer (Chunk 3)." Both `poll-gst`/`poll-msme` cron routes now call
  `processChangeAlertsForPipeline` right after `runPoll`, identically. No new API route, no UI —
  matches Chunk 3.1's "not user-facing yet" framing; the alerts UI is Chunk 3.3.
- **A recurring TypeScript issue, now with a fix worth remembering:** passing a real
  `SupabaseClient<Database>` anywhere a hand-written narrow interface (`PaymentsClient`,
  `AlertsClient`) is expected can hit `TS2589` ("type instantiation is excessively deep") — the
  chained `.from().select().eq().eq()...` builder interfaces are deep enough to trigger it; the
  flatter single-method `RpcClient` pattern from Chunk 2.1 never did. Fix: cast once
  (`supabase as unknown as PaymentsClient & AlertsClient`) inside the one function that bridges real
  code to the narrow interface (`processChangeAlertsForPipeline`), never at every call site.

**Chunk 3.3 — Alert inbox UI + one-tap actions + email: DONE.**
- `supabase/migrations/0008_resolve_alert.sql` adds one RPC, no new table: `resolve_alert(
  p_alert_id, p_action)`. This is the first `authenticated`-write capability on `alerts`, and — same
  as every prior user-triggered write (`import_vendors`, `record_bank_verification`,
  `create_certificate`) — it's a SECURITY DEFINER RPC, not a direct `UPDATE` RLS policy, because the
  409-on-already-resolved requirement needs one atomic conditional `update ... returning *`; a
  select-then-update from application code would race. `action` → `status`: `hold→hold`,
  `reviewed→reviewed`, `escalate→escalated` (verb vs. noun, mapped literally). "Already resolved" for
  the 409 check is `status in (reviewed, cleared)` (see the `0014` bugfix below) — independent of
  Chunk 3.2's dedupe "open" check (`status in (open,hold,reviewed)`), which still governs whether a
  *new poll-detected change* updates vs. creates a row; that logic is untouched.
- **Bugfix (2026-08-12), `supabase/migrations/0014_resolve_alert_terminal_status.sql`:** the RPC
  originally guarded its atomic UPDATE with `resolved_at is null`, and set `resolved_at` on every
  action (hold, reviewed, escalate) alike. The inbox UI treated `resolvedAt !== null` as "done," so
  escalating (and holding) a payment incorrectly closed the alert into the Resolved tab and hid the
  action buttons — even though escalating only hands the decision to someone else, and holding a
  payment doesn't fix the underlying vendor issue. The guard now checks `status not in (reviewed,
  cleared)` instead: `hold` and `escalated` are non-terminal and stay in "Needs action," and an
  alert can still transition `hold → reviewed` or `escalated → reviewed` later. Only `reviewed` (or,
  later, an explicit `cleared`/"Resolve") is terminal. `resolved_by`/`resolved_at` keep their
  existing meaning ("who/when the current status was last set") — still updated on every action, no
  longer read as the terminal signal. `lib/alerts/alertStatus.ts`'s `isTerminalAlertStatus()` is the
  one place this terminal/non-terminal split is defined for the UI (`app/alerts/AlertInbox.tsx`),
  mirroring the RPC's own guard so the two can't drift. A still-open but already-actioned alert
  (`hold`/`escalated`) now shows a small "{name} held these payments on {date}." /
  "{name} escalated this alert on {date}." line *alongside* the still-live action buttons, not in
  place of them; the original nudge question ("Hold them?") stops showing once any action has been
  taken, whether or not the alert is terminal yet.
- **Nudge copy is one pure module, `lib/alerts/nudgeCopy.ts`, shared by the UI and the email** — the
  PRD §4.5 pattern exactly: `"Vendor X's GST registration just went inactive."` /
  `"2 pending payments total ₹4.1L."` / `"Hold them?"`. Payment count/amount are computed **live**
  from `payments` at read time (`lib/alerts/queries.ts`), not read off `alerts.payment_impact_amount`
  (a stale snapshot from creation/dedupe time) — a finance head deciding *right now* should see the
  current picture. `formatIndianCurrency` does L/Cr notation; `describeStatusChange` is a small
  per-`(trigger_type, status_value)` phrase lookup.
- **The wording constraint is a test, not just a comment.** `nudgeCopy.test.ts` asserts every
  generated question ends in `?` and that no generated text (or the email body) contains
  system-agency phrases ("automatically", "has been held", "system held"). The UI's post-resolution
  text attributes the decision to a specific person — `lib/alerts/queries.ts` batch-fetches the
  resolver's `full_name`/`email` so the inbox can say "Priya held these payments," not a vague "you"
  that might misattribute a teammate's click.
- `lib/email/sendAlertEmail.ts` (new `resend` dependency) reuses the exact same three nudge lines —
  UI and email can never say different things. `lib/alerts/processChangeAlerts.ts` (Chunk 3.2) gained
  one capability: `notifyAlertCreated`, called **only** on `action: "created"`, never a dedupe
  `"updated"` — "a new alert triggers an email" only means something inside that one function, the
  same polling cycle the ERD's acceptance criteria refers to. A failed send is caught and counted
  (`emailsFailed`), never thrown — same "one failure never aborts the batch" rule as everywhere else
  in this pipeline; confirmed against the real Resend sandbox in
  `processChangeAlerts.integration.test.ts`, which asserts `emailsFailed: 1` because the test's
  throwaway signup email isn't the developer's verified sandbox address.
- `app/api/alerts/route.ts` (`GET`, optional `?status=&vendorId=&triggerType=`) and
  `app/api/alerts/[id]/action/route.ts` (`POST`, body `{ action }`) are thin HTTP-status mappers over
  `lib/alerts/queries.ts` / `lib/alerts/resolveAlert.ts` — same route/lib split as every other write
  path (`verifyVendorBank.ts`, `uploadCertificate.ts`).
- `app/alerts/page.tsx` + `AlertInbox.tsx`: filter chips default to **"All"**, not "Needs action" —
  found via the e2e test failing first: with "Needs action" as the default, a just-resolved card
  vanishes from view the instant its `resolvedAt` is set, since it no longer matches that filter,
  so the person who just clicked "Hold" never sees the confirmation. Matches `VendorList.tsx`'s own
  default ("all") anyway. One "Alerts" nav link added to `app/vendors/page.tsx`'s header.
- **No secret needed beyond `RESEND_API_KEY`** (`.env.local`, mirror into Vercel before this runs in
  production). Resend's sandbox sender (`onboarding@resend.dev`) only actually delivers to the
  account's verified signup address until a custom domain is verified — expected, not a bug; the
  `processChangeAlerts.integration.test.ts` failure mode above is a direct consequence of this.

**Chunk 4.1 — Evidence log wiring: DONE.**
- `supabase/migrations/0009_evidence_log.sql` creates `evidence_log`. It is a
  deliberate departure from every prior table's grant pattern: `service_role`
  gets `SELECT, INSERT` only — never `ALL` — and `UPDATE`/`DELETE` are
  explicitly revoked from `public`, `authenticated`, and `service_role`. This
  makes the table physically append-only: even a bug in the app's own
  privileged code path cannot alter or erase history. `authenticated` keeps
  its usual org-scoped `SELECT` policy; there is no INSERT policy and never
  will be — there's no RPC either, same "only the service role writes"
  reasoning `verification_checks` used before Chunk 3.3-style RPCs existed
  elsewhere. Same polymorphic `entity_type`/`entity_id` (no FK) pattern
  `alerts.trigger_type`/`source_check_id` already used.
- `lib/evidence/logEvent.ts` (`logEvent`/`logEvents`) is the one write path.
  `EvidenceClient` is a deliberately flat single-method interface
  (`from().insert()`) — the same shape as the `RpcClient` pattern from Chunk
  2.1 that never hit the Chunk 3.2 TS2589 issue — so every real call site
  passes the real `SupabaseClient<Database>` directly, no cast needed.
- Five event types: `verification_check` (one per poll'd vendor, every run,
  changed or not — `lib/verification/changeDetector.ts`'s new
  `buildCheckEvidenceEvents`, called from both cron routes after `runPoll`);
  `status_change` (one additional event for the `is_change = true` subset,
  same call); `alert_created`/`alert_updated` (one per `createOrUpdateAlert`
  result, via a new `logAlertEvent` dependency on
  `lib/alerts/processChangeAlerts.ts`, wired in `processChangeAlertsForPipeline`);
  `alert_resolved` (from `app/api/alerts/[id]/action/route.ts`, using the
  admin client since `evidence_log` grants INSERT to `service_role` only —
  the caller's own session client can't write it).
- `lib/verification/pollRunner.ts`'s `PollSummary` gained `allChecks` (every
  inserted row this run, with its DB id) alongside the existing
  `changedChecks` (the `is_change` subset) — needed so the cron routes can
  log one `verification_check` event per check, not just per change.
- **Evidence-log writes are NOT covered by the "one failure never aborts the
  batch" rule** (ERD §7) that applies to provider adapters and Resend email
  elsewhere in this pipeline — that rule is for external calls; a silently
  missing evidence row would defeat this chunk's purpose, so `logEvent`/
  `logEvents` throw on error and every caller lets that throw propagate.

**Chunk 4.2 — Clause 22 / Form 3CD export: DONE.**
- `supabase/migrations/0010_evidence_export_indexes.sql` adds
  `evidence_log(vendor_id, event_type, created_at)` and
  `payments(due_date)` — indexes only, no table/RLS/grant changes. Neither
  was indexed before this chunk introduced the first range-scan query
  against either column.
- `lib/evidence/buildExport.ts` is the core: one row per `payments` row due
  in `[from, to]`, each with the vendor's MSME status reconstructed
  independently **as of that specific payment's own `due_date`** — never
  `vendors.current_msme_status` (a live value that can't answer "what was
  true back then"). A vendor with payments on different dates can show
  different statuses per row. Same DI split as `lib/alerts/impactScorer.ts`
  (`buildExportRows(range, deps)` hermetically tested with injected plain
  functions; `buildExport(supabase, range)` wires the real
  `SupabaseClient<Database>` fetches directly — no hand-rolled interface,
  since this query chains 5 links deep, past the point `lib/evidence/
  logEvent.ts`'s own comment warns risks `TS2589`).
- **The "as of" reduction (`resolveMsmeStatusAsOf`)**: the latest
  `evidence_log` row with `event_type = 'verification_check'` and
  `payload->>'checkType' = 'msme_udyam'` for that vendor, `created_at` no
  later than end-of-day (IST) of the payment's `due_date` — confirmed via
  `.eq("payload->>checkType", "msme_udyam")` type-checking against
  `evidence_log.payload: unknown` with no cast (postgrest-js's `.eq<ColumnName>`
  has an explicit branch for `` `${string}->${string}` `` column paths).
  Three distinct outcomes: `checked` (a real `statusValue`, which may itself
  be `"UNKNOWN"`), `no_record` (has `udyam_number`, nothing checked yet as
  of that date), `not_applicable` (no `udyam_number` — never MSME-checkable).
- **Timezone: IST end-of-day, not UTC** — the first timezone-aware logic in
  this codebase (everything else is plain UTC ISO). `payments.due_date` is
  inherently an India-calendar date and this is a compliance export, so the
  cutoff is `${due_date}T18:29:59.999Z` (= 23:59:59.999 IST, UTC+5:30, no
  DST), not `${due_date}T23:59:59.999Z`.
- **Confirmed, not assumed (integration test caught this):** PostgREST
  returns `evidence_log.created_at` in Postgres's own textual form
  (`"...+00:00"`, no trailing zero fractional seconds) rather than the
  `"...Z"` form `buildExport.ts` itself produces for its cutoff. Plain
  string `<=` comparison between the two forms is still correct — both use
  the same zero-padded date/time prefix, and at the point they diverge
  ASCII ordering (`'+' < '.' < '0'-'9' < 'Z'`) happens to match chronological
  ordering — but it's now a documented fact, not a coincidence relied on
  silently. See the comment on `resolveMsmeStatusAsOf`.
- `lib/evidence/msmeStatusLabel.ts` is the pure status→label formatter
  shared by the CSV and PDF output, same "wording never drifts across
  surfaces" rationale as `lib/alerts/nudgeCopy.ts`. `lib/evidence/formatCsv.ts`
  emits RFC4180 CSV with a leading UTF-8 BOM (the target user opens this in
  Excel on Windows). `lib/evidence/formatPdf.ts` renders via `pdfkit`,
  wrapping its `Readable`-stream `PDFDocument` in a `Promise` so the route
  can just `await` a `Buffer`.
- **PAN is never read** in `buildExport.ts`'s vendor fetch — same DPDP
  exclusion CLAUDE.md already states for `evidence_log` snapshots, extended
  here on purpose. Alert events (`alert_created`/`alert_updated`/
  `alert_resolved`/`status_change`) are out of scope — only
  `verification_check` events matter for Clause 22.
- `GET /api/evidence/export?from=&to=&format=csv|pdf` (`app/api/evidence
  /export/route.ts`) is `finance_head`/`admin` only, gated via
  `getCallerContext` (`lib/vendors/queries.ts`) — reused, not reinvented;
  role-gating-with-403 already had a precedent (`app/api/vendors/import
  /route.ts`'s inline `ALLOWED_ROLES` check). This is the first route in
  the codebase returning a non-JSON body — `Content-Disposition`/binary
  headers designed fresh, no prior route to copy. `format` defaults to
  `"csv"`. Buffer doesn't structurally satisfy `NextResponse`'s `BodyInit`
  type in this TS setup (Node's `Buffer<ArrayBufferLike>` vs. the DOM lib's
  `ArrayBufferView` expectations) — the PDF branch wraps it in
  `new Uint8Array(pdf)`, a zero-copy view, not a cast.
- **`next.config.ts` gained `serverExternalPackages: ["pdfkit"]`.**
  `pdfkit` reads its bundled `.afm` font-metric files from disk at runtime
  via `__dirname`-relative paths; Turbopack/webpack bundling for Route
  Handlers rewrites those paths and breaks the lookup — confirmed via a
  real `ENOENT` under `next dev` (resolving to a bogus `"C:\ROOT\..."`
  path), not just a theoretical Vercel-only risk. `pdfkit` isn't on
  Next.js's short list of auto-externalized packages (`@react-pdf/renderer`
  — the alternative not chosen for this chunk — is, interestingly).
  `serverExternalPackages` is the documented fix: it opts a dependency out
  of Server Component/Route Handler bundling entirely, `require()`'d
  natively instead. Fixed the Playwright PDF test locally; still worth a
  one-time `curl` against the Vercel preview before calling PDF fully done
  in production, since serverless packaging isn't identical to `next dev`.
- `app/evidence/export/page.tsx` is the first page in this codebase doing a
  `res.blob()` + `URL.createObjectURL` + synthetic `<a download>` click —
  every prior submit handler assumed `res.json()`. Two `<input type="date">`
  fields (`from`/`to`) — the only prior precedent was a single such field
  in `CertificateUploadForm.tsx`. "Export evidence" nav links added to
  `app/vendors/page.tsx` and `app/alerts/page.tsx`'s header `<Link>`
  clusters, matching their existing pattern.
- **Bugfix (2026-08-12), `lib/evidence/findMsmeEvidenceGaps.ts`:**
  `scripts/seed-demo-data.ts` (an ad-hoc demo seeder, not part of a chunk)
  inserted `verification_checks` rows directly and never called Chunk 4.1's
  `buildCheckEvidenceEvents()`/`logEvents()` — so Vishwakarma Tooling
  Industries' genuine `REGISTERED → LAPSED` change never reached
  `evidence_log`, and `buildExport.ts` (which reads `evidence_log`
  exclusively, by design) reported "No record" for every one of its
  payments regardless of what actually happened. Root cause fixed at the
  source: the seed script now calls `buildCheckEvidenceEvents()` +
  `logEvents()` after every `verification_checks` insert, exactly like the
  cron routes do after `runPoll()`. `findMsmeEvidenceGapsForOrg()` is the
  lasting regression check: any vendor with a non-null `udyam_number` and
  at least one `msme_udyam` check but zero matching `evidence_log` rows is
  exactly this bug and gets flagged — `lib/evidence
  /findMsmeEvidenceGaps.integration.test.ts` reproduces the bug scenario
  directly (an un-logged insert) and asserts the checker catches it, and
  that it does not false-positive on the correct evidence-logged path or on
  a vendor with no `udyam_number` / never checked yet (the legitimate
  `no_record` case `buildExport.ts` already models).

**Chunk 4.3 — LEI pre-payment check (GLEIF): DONE.**
- **Confirmed integration point (asked before building, per the user's own
  flag):** payments have no creation UI/API yet (Chunk 3.1 scoped them
  service-role-write-only), so "on payment creation" can't hook into a real
  app flow. `POST /api/payments/:id/lei-check` is a standalone,
  callable-on-demand trigger against any existing (service-role-seeded)
  payment — not a fabricated payment-creation flow.
- `supabase/migrations/0011_vendors_lei_number.sql` adds `vendors.lei_number`
  (nullable, mirrors `gstin`/`udyam_number`). `0012_lei_checks.sql` creates
  `lei_checks` — same RLS/grant situation `verification_checks` was in
  before Chunk 3.3-style RPCs existed elsewhere (`authenticated` SELECT-own
  only, no RPC; the route itself does the privileged write via the admin
  client after validating ownership through the caller's own session
  client first — same shape `app/api/alerts/[id]/action/route.ts` already
  uses for its evidence_log write).
- **LEI identification is exact, never fuzzy.** GLEIF's name-search API
  proved unreliable during planning — a "Reliance" query returned three
  unrelated companies with different LEIs and different statuses — so the
  check does an exact `GET /lei-records/{lei}` against `vendors.lei_number`
  instead. A null `lei_number` resolves to `not_on_record` without ever
  calling GLEIF — literally "no LEI on file."
- **GLEIF's `registration.status` has 11 possible values** (its own
  LEI-CDF spec — confirmed live, not guessed, the Chunk 1.2 lesson);
  `lei_checks.status` only has 4. `lib/providers/lei/gleifAdapter.ts` maps
  `ISSUED`→`issued`, `LAPSED`→`lapsed`, `RETIRED`/`MERGED`/`ANNULLED`/
  `CANCELLED`→`retired` (no longer an operative registration), everything
  else (`PENDING_VALIDATION`, `DUPLICATE`, `TRANSFERRED`,
  `PENDING_TRANSFER`, `PENDING_ARCHIVAL`, a 404, or an unrecoverable
  provider error) →`not_on_record` — never silently `issued` for an
  ambiguous state (ERD §7). No mock adapter/selector exists for this
  provider (unlike GST/MSME/Bank) — GLEIF needs no credentials, so there's
  no "ship against mock" reason.
- `lib/lei/qualifiesForLeiCheck.ts` is the one place the ₹50cr/RTGS/NEFT
  threshold is defined (`LEI_THRESHOLD`) — both `lib/lei/runLeiCheck.ts`
  (the gate before calling GLEIF at all) and `lib/alerts/impactScorer.ts`
  (the qualifying-payments lookup for the secondary LEI-as-risk-signal
  path) import it, so the number is never duplicated.
- `lib/lei/runLeiCheck.ts` is the orchestrator: gate → check (or skip
  straight to `not_on_record` if no LEI on file) → record the `lei_checks`
  row (always, whatever the outcome) → `createOrUpdateAlert` with
  `triggerType: "lei_check"` for an unfavorable result. Same DI split as
  every other orchestrator in this codebase (`runLeiCheck(input, deps)`
  hermetic; `runLeiCheckForPayment(supabase, input)` real wiring). This
  only ever creates or updates an alert — it never touches the payment.
- **The Chunk 3.1 stub is retired.** `hasUnfavorableLeiCheck` (always
  `false`) is now `hasUnfavorableLeiCheckForVendor(supabase, vendorId)`,
  written directly against the concrete client (no narrow interface — no
  hermetic-testing need strong enough to justify one, same call Chunk 4.2's
  `buildExport.ts` made; covered by `impactScorer.integration.test.ts`
  instead). `scoreChangeForVendor` now takes `SupabaseClient<Database>`
  directly (was `PaymentsClient`) — the one `as unknown as PaymentsClient`
  cast it needs lives inside this function now, so callers (e.g.
  `processChangeAlertsForPipeline`) just pass the real client straight
  through, no pre-casting needed on their end.
- **A real gap in already-shipped Chunk 3.3 code, found and fixed:**
  `lib/alerts/queries.ts`'s `attachNudge()` unconditionally read
  `verification_checks` for `source_check_id`'s status value — for a
  `lei_check` alert, `source_check_id` points into `lei_checks` instead
  (same polymorphic, no-FK pattern `alerts.trigger_type`/`source_check_id`
  already used). Before this fix, any LEI alert would have silently shown
  "status became unclear" in the inbox. `attachNudge()` now splits
  `source_check_id`s by `trigger_type` and queries both tables.
  `lib/alerts/nudgeCopy.ts` gained `LEI_PHRASES` (`lapsed`→"lapsed",
  `retired`→"was retired", `not_on_record`→"has no LEI on record" —
  distinct text, the literal "distinguishable in the UI" acceptance
  criterion) and a third `describeStatusChange` branch.
- `lib/alerts/processChangeAlerts.ts`'s `notifyAlertCreated` is now
  exported and takes `organizationId: string` directly instead of a
  `ChangedCheck` (it only ever used that one field) — reused as-is by the
  LEI path, so "a new alert triggers an email" behaves identically for
  every trigger type, wording included.
- `app/api/payments/[id]/lei-check/route.ts` is `finance_head`/`admin`
  only (`getCallerContext`, reused from `lib/vendors/queries.ts`) — the
  ERD's "system / finance_head" auth; a future automated trigger would
  call `runLeiCheckForPayment` directly with the service role, the same
  way the cron routes bypass session-based routes entirely. A
  below-threshold payment gets `400`, not a silent no-op.

**Chunk 5.1 — Metrics instrumentation: DONE.**
- `supabase/migrations/0013_product_events.sql` creates `product_events`
  (event log feeding every PRD Section 11 pilot metric). Deliberately the
  **standard** RLS/GRANT pattern every table uses **except**
  `evidence_log` — `authenticated` gets org-scoped SELECT only,
  `service_role` gets `ALL` (not the SELECT+INSERT-only,
  UPDATE/DELETE-revoked shape `evidence_log` uses). This is analytics, not
  an audit trail — a bad row here can be corrected, so it isn't hardened
  append-only.
- `lib/analytics/track.ts` (`track`/`trackBatch`) mirrors
  `lib/evidence/logEvent.ts`'s shape (a single flat `from().insert()`
  `AnalyticsClient`, a plural batch function that no-ops on an empty
  array) but has the **opposite failure contract**: evidence-log writes
  must never silently fail (they're the audit trail); product-event
  writes must never break a real business flow (a lost metric is a
  shrug, a lost payment-hold is not). `track()`/`trackBatch()` catch and
  log their own errors and never throw — every call site is a plain
  `await track(...)`, no try/catch needed.
- **Six existing flows each gained one or two `track()` calls at their
  existing success points — no new orchestration, no new user-facing
  API:** vendor import (`vendor_import_completed`, both poll cron routes
  (`status_change_detected`, once per changed check), the GST/MSME and
  LEI alert pipelines (`alert_created_tracked`, only on a newly-created
  alert — mirrors `notifyAlertCreated`'s own "only on creation" rule and
  is likewise best-effort/non-fatal), alert resolution
  (`alert_actioned`, with `hoursSinceCreated`/`actionedWithin24h`/
  `actionedWithin48h` computed once and reused by three different
  metrics), bank verification and certificate upload
  (`bank_cert_issue_caught`, only on a non-`verified`/expired result),
  and evidence export (`evidence_export_completed`). Every route that
  only had a session client (`vendors/import`, `vendors/:id/flag`,
  `evidence/export`) needed a `createAdminClient()` instance for its
  `track()` call, same pattern `alerts/:id/action` already used for its
  `evidence_log` write — `product_events` INSERT is `service_role`-only.
- `lib/analytics/maybeTrackPmfSurveyTrigger.ts` is a small, separate
  piece: `shouldTriggerPmfSurvey` (pure, fires exactly once at the
  crossing point) and `maybeTrackPmfSurveyTrigger` (real wiring — counts
  an org's `alert_actioned` events, checks org age), called right after
  the alert-action route records its own `alert_actioned` event. **The
  trigger threshold (3rd actioned alert, no earlier than 14 days after
  signup) is a first-cut product decision, not a PRD number** — the PRD
  defines what to measure once the Sean Ellis survey is shown, not when
  to show it.
- `lib/analytics/metrics.ts` has one function per Section 11 metric,
  using the real PRD targets/kill signals below. Most are **org-scoped**
  (`getNorthStarMetric`, `getVendorsConnectedWithoutIt`,
  `getTimeToFirstValue`, `getStatusChangesDetected`,
  `getAlertsActionedWithin24h`, `getAlertPrecision`,
  `getBankCertIssuesCaught`, `getAuditTimeSaved` — bundled by
  `getSection11Metrics(supabase, organizationId)`). **Three are
  inherently portfolio-wide** per the PRD's own wording ("most
  customers", "% of pilot customers/users") — a single org can only
  contribute one data point to a cross-customer percentage:
  `getTimeToFirstValuePortfolioKillSignal` (admin client, scans every
  org), `getPilotToPaidIntent`, `getPmfSurveyScore`. The North Star gets
  its own explicitly-named `getNorthStarMetric()` rather than being
  folded anonymously into the metric bundle, since it's the single most
  important signal (payments the finance head holds herself, prompted by
  an alert — the system never holds a payment itself).
  | # | Metric | Target | Kill signal |
  |---|---|---|---|
  | ★ | North Star / #6 — payments held or rerouted | ≥1 per customer / 30 days, by her own choice | Alerts acknowledged but the payment goes out anyway, every time |
  | 1 | Vendors connected without IT | 90%+ within 3 days of signup | <50% within 2 weeks, or IT has to get involved |
  | 2 | Time to first value | First vendor-risk view within 15 minutes | Longer than a day for most customers |
  | 3 | Status changes detected | ≥1 per 100 vendors / 30 days | Zero across all pilot vendors |
  | 4 | Alerts actioned within 24h | 80%+ within 24h | <30% within 48h |
  | 5 | Alert precision | 90%+ confirmed genuine | <60% |
  | 7 | Bank/cert issues caught at onboarding | ≥1 per customer before first payment | Zero across all pilots |
  | 8 | Audit prep time saved (self-reported) | 30%+ drop vs. prior year | No measurable reduction |
  | 9 | Pilot-to-paid intent | 50%+ ask to move to paid by day 30 | <20% show any intent |
  | 10 | "Very disappointed" without it (Sean Ellis PMF) | 40%+ | <20% |
- **Two proxies, documented in `metrics.ts`'s own doc comment, not
  hidden:** alert precision has no false-positive UI yet (out of scope —
  "no new user-facing API"), so `hold`/`escalate` count as "confirmed
  genuine" and `reviewed` alone does not. The North Star's "held or
  rerouted" maps `escalate` to "rerouted" (routing the decision to
  someone else) and `hold` to "held"; `reviewed` alone counts as neither.
- **A real clock-skew bug, found by actually running the live-DB test,
  not assumed:** `verification_checks.checked_at` is stamped from the
  poller's own client clock (`lib/verification/pollRunner.ts`), while
  `vendors.created_at` is Postgres's server-side `now()` — a check landing
  a few hundred ms before the vendor's own creation timestamp is common
  under real clock drift between the two, even though a check can never
  actually reference a vendor that doesn't exist yet. `computeTimeToFirstValue`
  clamps a small negative duration to `0` instead of dropping the sample
  (a fast check shouldn't be undercounted just because two clocks
  disagree by milliseconds); a wildly negative duration (minutes, not
  milliseconds) still drops, since that would indicate an actual data
  problem, not skew.
- Metrics 2's kill signal, 9, and 10 needed no new event type beyond
  what's already listed above; "time to first value" itself is computed
  directly from `vendor_import_completed`'s timestamp and
  `verification_checks` — no separate "risk view shown" UI event exists,
  since building one was out of scope for this chunk.

**Chunk 5.3 — End-to-end flow verification suite: DONE.**
- `e2e/flows/*.spec.ts` — one file per PRD §8 user story, each covering its
  happy path plus at least one failure/edge case (Implementation Plan's own
  acceptance criteria): connect vendor list (+ a corrupt file, rejected
  cleanly); same-day GST alert (+ the no-open-payment case, which creates
  no alert); vendor status recall (+ a vendor with zero checks); LEI alert
  before a large payment (+ below-threshold non-trigger, + a vendor with no
  LEI on file resolving `not_on_record`); Clause 22 export (+ the "time
  travel" case — a payment's own due date resolves its MSME status as of
  THAT date, even after a later status change); alert decision logged (+
  the double-action 409 case, asserted to never double-write
  `evidence_log`).
- `e2e/flows/02-same-day-gst-alert.spec.ts` is the one file that goes
  beyond every other e2e spec's "seed the finished state, check the UI"
  pattern: it imports and calls the real `processChangeAlertsForPipeline`
  (Chunk 3.2) directly against seeded `verification_checks` rows, so it
  proves the alert-worthy decision itself — not just that the inbox
  correctly renders a row that was pre-faked into existence. Confirmed
  importable from a Playwright spec the same way
  `e2e/bank-verification.spec.ts` already imports
  `lib/providers/bank/mockAdapter.ts` (which itself imports via the `@/*`
  alias) — the test runner already resolves that alias transitively.
- No schema or application code changes — this chunk is pure verification
  over Phases 0–5.1.

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
- `lib/providers/bank/*.test.ts` (Vitest) cover Chunk 2.1: `nameMatch`/`mask` as standalone pure
  functions; the mock's four fixtures (exact/partial/mismatch/timeout, all name-agnostic — derived
  from whatever vendor name they're given, not hardcoded) plus malformed-input-spends-no-call; the
  Eko stub rejects with a clear "not configured" error even for valid input; the selector's
  `BANK_PROVIDER` default/override/memoization.
- `lib/import/validateVendorRow.test.ts` and `lib/vendors/correlateImport.test.ts` (Vitest) cover the
  new bank columns' soft-warning validation and the GSTIN/name correlation (including the documented
  same-name-collision edge case).
- `lib/bank/verifyVendorBank.test.ts` (Vitest, hermetic, stub adapter + stub Supabase client) asserts
  the RPC is called with only masked/derived fields — never the raw account number.
- `lib/bank/verifyVendorBank.integration.test.ts` is a **live-DB** integration test (needs migration
  0004 applied): seeds a vendor, runs a real check with a literal raw test account number, then
  asserts exactly one `bank_verifications` row exists, its `account_number_masked` is the expected
  `****last4`, and — the literal acceptance check — `JSON.stringify()` of the full row does not
  contain the raw test account number anywhere. Also asserts the exact/partial fixtures map to
  `verified`/`manual_review` on `vendors.current_bank_status`.
- `e2e/bank-verification.spec.ts` imports two vendors via CSV (bank columns mapped to the mock's
  exact- and partial-match fixtures) and asserts the list shows "Verified" for one and "Manual
  review" — never "Verified" — for the other.
- `lib/certificates/certificateStatus.test.ts` and `validateCertificateFile.test.ts` (Vitest) cover
  Chunk 2.2's pure logic: boundary dates (today counts as still valid), and PDF/JPEG/PNG accepted
  vs. `.exe`/spoofed-extension/spoofed-MIME all rejected.
- `lib/storage/uploadCertificate.test.ts` (Vitest, hermetic, stub Storage + stub RPC) asserts the
  upload path shape, the derived status reaching the RPC, and — critically — that a failed RPC call
  triggers `storage.remove()` on the exact path just uploaded.
- `lib/storage/uploadCertificate.integration.test.ts` is a **live-DB + Storage** integration test
  (needs migration 0005 applied): uploads a real file and asserts the row + object both exist and a
  signed URL is fetchable; asserts an RPC failure (bogus vendor id) leaves the Storage folder empty;
  and — the requirement this test exists to prove — asserts a **second org's** signed-in client
  cannot read the first org's signed URL, and cannot write into the first org's folder even when
  the app-supplied `organizationId` is deliberately wrong, because the `storage.objects` RLS policy
  itself blocks it independent of anything the app checked.
- `e2e/certificate-upload.spec.ts` covers the three acceptance cases end-to-end: a future-dated
  upload shows "Valid," a past-dated upload shows "Expired" immediately, and a `.exe` upload is
  rejected with an inline error while the admin client's `storage.list()` on that vendor's folder
  confirms nothing was left behind.
- `lib/alerts/impactScorer.test.ts` (Vitest, hermetic, injected fake dependencies) covers Chunk
  3.1's decision logic: all four payment/LEI combinations, the `isChange: false` short-circuit
  (asserting neither dependency is even called), and that `hasUnfavorableLeiCheck` always resolves
  `false`.
- `lib/alerts/impactScorer.integration.test.ts` is a **live-DB** integration test (needs migrations
  0003 and 0006 applied): runs the real `runPoll` to produce a genuine `is_change = true` row,
  scores it before and after seeding a `pending` payment, and re-queries `verification_checks`
  directly both times to prove scoring never touches that table — the literal "the audit trail
  isn't suppressed" acceptance check.
- `lib/alerts/createOrUpdateAlert.test.ts` and `processChangeAlerts.test.ts` (Vitest, hermetic,
  injected fakes) cover Chunk 3.2: create-vs-update dedupe branching, `check_type → trigger_type`
  mapping, and that only alert-worthy changes ever reach `createOrUpdateAlert`.
  `impactScorer.test.ts` gained cases for `getOpenPaymentAmount` (sums multiple pending rows, 0 when
  none).
- `lib/alerts/processChangeAlerts.integration.test.ts` is a **live-DB** integration test (needs
  migrations 0003, 0006, 0007 applied): runs the real `runPoll` twice to get a genuine changed
  vendor, seeds an open payment, and asserts one alert is created with the right
  `trigger_type`/`source_check_id`/`payment_impact_amount`; triggers a second real change on the
  same vendor and a second payment, and asserts the *same* alert row is updated (new summed amount,
  `source_check_id` unchanged) rather than a duplicate appearing; and asserts a changed vendor with
  no payment produces zero alert rows. Since Chunk 3.3 it also exercises the real Resend send and
  asserts `emailsFailed: 1` (expected — see the Chunk 3.3 sandbox note above).
- `lib/alerts/nudgeCopy.test.ts` (Vitest, hermetic) covers Chunk 3.3's pure copy generation:
  currency boundaries (plain / L / Cr), singular vs. plural payment phrasing, the zero-payment edge
  case, per-status phrase lookups, and the wording-constraint assertions (question always ends `?`,
  never a system-agency phrase). `sendAlertEmail.test.ts` (stub Resend client) asserts the
  vendor/amount/recipient payload — the literal "mocked in CI" requirement.
- `lib/alerts/resolveAlert.integration.test.ts` is a **live-DB** integration test (needs migrations
  0008 and 0014 applied): `hold` and `escalate` both succeed and set `status`/`resolved_by`/
  `resolved_at`, but — per the 0014 bugfix — neither is terminal, so a later `reviewed` action on
  the same alert still succeeds (`hold → reviewed`, `escalated → reviewed`). Only `reviewed` itself
  is terminal: a further action on an already-`reviewed` alert returns `already_resolved` and the
  DB row's resolution fields are byte-for-byte unchanged from the first call — the literal
  acceptance case. Also covers a different org's alert (RLS-scoped `not_found`) and an unknown
  alert id.
- `e2e/alerts.spec.ts` seeds a vendor + a GST check + two pending payments (₹2.5L + ₹1.6L = the
  PRD's own ₹4.1L example) + the alert row directly, visits `/alerts`, asserts the exact three-line
  nudge copy renders, clicks "Hold," and asserts the card updates in place — no reload — to show
  "You held these payments" *alongside* all three action buttons (still visible — holding doesn't
  close the alert), and that it's visible under "Needs action" but absent from "Resolved." A second
  test (added with the 0014 bugfix) escalates an alert and asserts it stays under "Needs action"
  (absent from "Resolved") with every action still available, then marks it reviewed and asserts it
  now appears under "Resolved" and every action button is gone — the literal "escalate must not
  auto-resolve, only Mark reviewed does" acceptance case from the bug report.
- `lib/evidence/logEvent.test.ts` (Vitest, hermetic) covers Chunk 4.1's
  writer: default actor "system" vs. an explicit actor, batching multiple
  events into one insert call, a no-op (no insert call at all) on an empty
  batch, and that an insert error throws.
- `lib/verification/changeDetector.test.ts` gained cases for
  `buildCheckEvidenceEvents`: one event for an unchanged check, two
  (verification_check + status_change) for a changed one, and the right
  count across a mixed batch.
- `lib/alerts/processChangeAlerts.test.ts` gained cases for the new
  `logAlertEvent` dependency: called once per alert-worthy result (both
  created and updated branches) with the right arguments, never called for a
  non-alert-worthy change, and a rejection from it propagates instead of
  being swallowed (unlike `notifyAlertCreated`).
- `lib/evidence/evidenceLog.integration.test.ts` is a **live-DB** integration
  test (needs migrations 0003, 0006, 0007, 0008, 0009 applied): runs a real
  two-poll cycle (baseline, then a genuine change), seeds a payment, creates
  a real alert via `processChangeAlertsForPipeline`, resolves it via
  `resolveAlert`, and asserts the resulting `evidence_log` rows match
  exactly — 2 `verification_check`, 1 `status_change`, 1 `alert_created`, 0
  `alert_updated`, 1 `alert_resolved` — with each event's `entity_id`
  matching its real source row. Because the poller and `evidence_log` are
  both global (all orgs), the changed-check assertion is scoped to this
  test's own seeded vendor id, same pattern
  `processChangeAlerts.integration.test.ts` already established — found the
  hard way when the unscoped assertion picked up changed checks from every
  other vendor in the shared test database. A second test is the literal
  permissions acceptance check: it inserts one row via the admin
  (service-role) client, then attempts an `UPDATE` and a `DELETE` on it with
  that same client and asserts both return a `permission denied` error —
  proven by actually attempting it, not assumed from the migration's GRANT
  statements.
- `lib/evidence/buildExport.test.ts` (Vitest, hermetic) covers Chunk 4.2's
  pure "as of" reduction: no-udyam → `not_applicable`, empty/all-after-cutoff
  evidence → `no_record`, the inclusive `<=` boundary at the exact cutoff,
  `"UNKNOWN"` preserved distinct from `no_record`, picking the *last*
  qualifying entry (not the first, not one after cutoff), and
  `buildExportRows`'s empty-payments short-circuit (asserting the other two
  deps are never called), multi-payment/multi-date/multi-vendor
  independence, and `amount` returned as a `number`.
- `lib/evidence/buildExport.integration.test.ts` is a **live-DB** integration
  test (needs migrations 0001-0010 applied) — the chunk's core acceptance
  test: seeds a vendor with a `REGISTERED` evidence row dated in January,
  a payment due in January, then a *newer* `LAPSED` evidence row dated in
  February, and asserts the January export still shows `REGISTERED` (the
  literal "time travel" acceptance check), while a payment due in February
  correctly resolves `LAPSED` — proving genuine per-payment reconstruction,
  not "latest always wins." Also covers `no_record`, `not_applicable`, and
  that calling `buildExport` with the caller's own session client (not
  admin) scopes to that org via RLS alone, with no manual filter in
  `buildExport.ts` itself.
- `lib/evidence/findMsmeEvidenceGaps.test.ts` (Vitest, hermetic) and
  `.integration.test.ts` (**live-DB**, needs migrations 0001-0009 applied)
  cover the 2026-08-12 regression check: a vendor with a udyam number and a
  directly-inserted (un-logged) `msme_udyam` check is flagged; the same
  vendor going through `buildCheckEvidenceEvents()`/`logEvents()` is not; a
  vendor with no udyam number, or one never checked at all, is never
  flagged (both are legitimate `no_record`, not this bug).
- `lib/evidence/msmeStatusLabel.test.ts`, `lib/evidence/formatCsv.test.ts`
  (Vitest, hermetic) cover the label lookup (including the
  unrecognized-value fallback) and CSV rendering (RFC4180 quoting/escaping,
  null-identifier handling, the BOM, two-decimal amounts).
  `lib/evidence/formatPdf.test.ts` is a structural smoke test only (no
  PDF-parsing library is added): asserts a valid `%PDF-` buffer for both an
  empty rows array and a batch covering all three `MsmeAsOfStatus` kinds,
  without throwing.
- `e2e/evidence-export.spec.ts` covers Chunk 4.2 end to end: a CSV download
  is read off disk and asserted to contain the seeded vendor/GSTIN/due
  date/amount/MSME status label; a PDF download's filename is asserted
  (first spec in this codebase reading a downloaded file's content —
  `page.waitForEvent("download")` + `readFileSync`); a downgraded-role
  caller gets `403` from the API directly; an empty range still downloads a
  valid header-only CSV. **Found via this suite, not assumed:** Next.js's
  dev-mode toolbar renders a button labeled "Open Next.js Dev Tools," and
  Playwright's `getByLabel` substring-matches by default — `getByLabel("To")`
  matched both the real field and that button (`"To"` is a substring of
  `"...Tools"`), so the date-field locators need `{ exact: true }`.
- `lib/providers/lei/gleifAdapter.test.ts` (Vitest, hermetic) covers Chunk
  4.3's status mapping: `ISSUED`→`issued`, `LAPSED`→`lapsed`, all four
  `RETIRED`/`MERGED`/`ANNULLED`/`CANCELLED`→`retired`, all five ambiguous
  statuses→`not_on_record` (never `issued`), a malformed LEI rejected
  before any call, a 404→`not_on_record` with no error, retry-once on a
  5xx, and a final fallback to `not_on_record` with an error after two
  failed attempts.
- `lib/lei/qualifiesForLeiCheck.test.ts` (Vitest, hermetic) covers the
  acceptance-mandated threshold boundary (₹49.99cr/₹50.00cr/₹50.01cr) and
  both qualifying payment methods (`rtgs`, `neft`) plus `other` never
  qualifying however large the amount.
- `lib/lei/runLeiCheck.test.ts` (Vitest, hermetic, DI) covers the
  orchestrator: below-threshold and `other`-method short-circuits (neither
  GLEIF nor the DB is touched), the no-LEI-on-file path skipping GLEIF
  entirely, an `issued` result recording the check but creating no alert,
  a dedupe `"updated"` result never triggering a notification, and a
  failed notification not aborting the result (same non-fatal rule as the
  GST/MSME email step).
- `lib/lei/runLeiCheck.integration.test.ts` is a **live-DB + live-GLEIF**
  integration test (needs migrations 0001-0012 applied) — the chunk's core
  acceptance scenarios: a ₹60cr RTGS payment to a vendor with a real,
  confirmed-lapsed LEI (`335800CO2E555Q1ZEY28`, Reliance Plastic
  Industries) creates a `lei_checks` row and an `alerts` row with
  `trigger_type: "lei_check"`; a ₹10cr payment creates **zero**
  `lei_checks` rows for that payment (queried directly, not just asserted
  on the return value) — the literal "triggers no LEI check at all"
  wording; a vendor with no LEI on file gets `not_on_record` with
  `lei_number: null` and still gets an alert; `not_on_record` and `lapsed`
  produce different DB values and different `describeStatusChange` text;
  an `other`-method payment never qualifies regardless of amount.
- `lib/alerts/impactScorer.test.ts` and `.integration.test.ts` gained
  cases for the real `hasUnfavorableLeiCheckForVendor` wiring: alert-worthy
  via the LEI path with no open payment at all (both hermetically, via a
  stub client that distinguishes the `hasOpenPendingPayment` query chain
  from the qualifying-payments-for-LEI chain by which final method is
  called — `.limit()` vs. `.gte()` — since both read `payments`; and for
  real, seeding a genuine `lapsed` `lei_checks` row on a `paid`-status
  payment so the scenario can't be mistaken for the open-payment path).
- `e2e/lei-check.spec.ts` seeds a vendor with the same known-lapsed LEI
  fixture plus one qualifying pending payment, calls the route directly,
  and asserts the resulting alert card in `/alerts` shows the correct
  `lei_check`-specific nudge text ("...'s LEI just lapsed.", "1 pending
  payment totals ₹60.0Cr."). The full pre-existing e2e suite (including
  `alerts.spec.ts`) was re-run alongside it to confirm the `attachNudge()`
  polymorphic-source change introduced no regression in the GST/MSME path.
- `lib/analytics/track.test.ts` (Vitest, hermetic) covers Chunk 5.1's
  writer: row shaping, actor/vendorId/payload defaults, the empty-batch
  no-op, multi-event batching, and — the literal "never throws" contract
  — both an insert-returns-an-error case and an insert-call-rejects case
  resolving cleanly instead of throwing.
- `lib/analytics/maybeTrackPmfSurveyTrigger.test.ts` (Vitest, hermetic)
  covers the pure threshold: before the 3rd actioned alert, at the 3rd
  with the 14-day minimum met, at the 3rd without the minimum met, and
  past the 3rd (fires only once, at the crossing point).
  `lib/alerts/processChangeAlerts.test.ts` and `lib/lei/runLeiCheck.test.ts`
  each gained cases for the new `trackAlertCreated` dependency: called
  once per newly-created alert (never on a dedupe update), and a failed
  call never aborts the batch/result.
- `lib/analytics/metrics.test.ts` (Vitest, hermetic) covers every
  `compute*` pure reducer: the North Star's hold/escalate-as-"held or
  rerouted" counting and its "acknowledged but never held" kill signal;
  vendors-connected-without-IT's 3-day/2-week boundaries and the
  insufficient-data withholding before 2 weeks; time-to-first-value's
  target/kill-signal boundaries, the clock-skew clamp-to-zero case (a
  small negative duration counts as a fast, ~instant sample) versus a
  wildly-negative one (dropped as a real data problem), and the
  no-check-yet case; status-changes-detected's per-100 rate and
  zero-changes kill signal; alerts-actioned-within-24h's 24h/48h
  boundaries; alert-precision's hold/escalate-vs-reviewed-alone proxy;
  bank/cert-issues-caught's zero-vs-one boundary; and audit-time-saved's
  average-reduction target, no-measurable-reduction kill signal, and
  empty-reports case.
- `lib/analytics/section11.integration.test.ts` is the chunk's core
  **live-DB** acceptance test (needs migrations 0001-0013 applied) — the
  literal "scripted end-to-end run, one assertion per metric" acceptance
  criterion: runs a real import (via the signed-up user's own session
  client — `import_vendors()` is `SECURITY DEFINER` reading
  `current_org_id()` from the *caller's* `auth.uid()`, so it cannot run
  on the admin client, which carries no user JWT at all; the same
  constraint applies to `resolve_alert()` later in the same test), two
  real polls to produce a genuine GST status change, a real
  `processChangeAlertsForPipeline` run to create a real alert, a real
  `resolveAlert(..., "hold")` to actually hold it, a real
  `buildExport()` call, and three directly-`track()`ed self-reported
  signals (audit time saved, pilot-to-paid intent, PMF response) since
  no survey/CRM UI triggers those yet — then asserts all 8 org-scoped
  Section 11 metrics plus the 2 portfolio-wide self-reported ones and the
  portfolio kill-signal helper are all non-trivially queryable off the
  real data this run produced. This test is what caught the clock-skew
  bug documented above — found by actually running it live, not assumed.

### Operational notes

- **Migrations run by hand.** Apply each `supabase/migrations/*.sql` in the Supabase SQL Editor (or `supabase db push`). The Vercel deploy does NOT run migrations. There is no CI migration step yet.
- **Every new table needs GRANTs.** PostgREST checks SQL grants BEFORE RLS. A table with policies but no grant returns `permission denied` (42501). Grant `select`/`insert`/`update`/`delete` to `authenticated` as the policy needs, and `all` to `service_role`. See section 6 of `0001_core.sql`.
- **Secrets.** `.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SANDBOX_API_KEY`/`SANDBOX_API_SECRET` (GST provider), `CRON_SECRET` (cron auth), and `RESEND_API_KEY` (alert emails, Chunk 3.3). Never use the service-role key in client code. All of these are server-only (no `NEXT_PUBLIC_` prefix). Mirror `SANDBOX_*`, `CRON_SECRET`, and `RESEND_API_KEY` into Vercel before the cron runs in production. Raw secret values go directly into `.env.local`, never through chat/commit history — every secret in this project has been handled that way.
- **Middleware guards pages, not APIs.** `lib/supabase/middleware.ts` redirects signed-out users to
  `/login`, but **exempts `/api/*`** — API routes enforce their own auth and return JSON status codes
  (401/404), never an HTML redirect. Without this exemption the cron routes 307-redirect to `/login`
  before their `CRON_SECRET` check runs (found via a production curl).
- **Deprecation.** Next.js 16.3 prints a warning that `middleware.ts` is deprecated in favor of `proxy.ts`. The file still works. A migration codemod exists.

### Next chunk

Phase 1, Phase 2 (onboarding-only verification: bank + certificates), Phase 3 (alerting: impact
scorer → alert generation/dedupe → inbox UI + one-tap actions + email), Phase 4 (evidence log
wiring, Clause 22 / Form 3CD export, LEI pre-payment check), Chunk 5.1 (metrics instrumentation),
and Chunk 5.3 (end-to-end flow verification suite) are complete. A detected change with a payment in flight now reaches a real person's inbox, by email
and in-app, they can resolve it with one click, every step of that cycle has a matching, physically
tamper-proof `evidence_log` row, a finance head can export exactly what was true on any past date for
every payment due to an MSME vendor, a large RTGS/NEFT payment gets a pre-payment LEI check that
alerts — never blocks — on a lapsed, retired, or missing LEI, and every one of those flows now also
writes a lightweight `product_events` row so all 10 PRD Section 11 pilot metrics (plus the North Star)
are queryable against their real 30-day targets and kill signals. `lib/alerts/impactScorer.ts`'s
`hasUnfavorableLeiCheck` stub (always `false` since Chunk 3.1) and `createOrUpdateAlert.ts`'s
`lei_check` trigger type (defined in the CHECK constraint since Chunk 3.2, never produced until now)
are both real. Phase 5 continues:

- **Revisit `POST /api/vendors/:id/flag`** (`app/api/vendors/[id]/flag/route.ts`) once certificate
  re-verification is needed — it currently handles bank re-verification only.
- **Live adapters still stubbed, lowest priority:** `lib/providers/bank/ekoAdapter.ts`
  (`TODO(chunk-2.1-live)`) and `lib/providers/msme/deepvueAdapter.ts` — implement once sandbox
  credentials exist, verifying the live API first rather than guessing field names.
- **No survey/CRM UI yet for the three self-reported Section 11 metrics** (audit time saved,
  pilot-to-paid intent, PMF response) — `lib/analytics/metrics.ts` and `product_events` are ready to
  receive them via `track()`, but nothing in the app UI calls it yet. Wire a real form/flow when the
  pilot needs it; until then these are submitted by hand (support conversation → a script that calls
  `track()` directly), same as `section11.integration.test.ts` simulates.
- **Chunk 5.2 (pilot hardening + provider rate limiting)** — not started.

### Backlog (not scheduled)

Ideas noted for later, deliberately not part of the phase build order above. Revisit only if asked.

- **Notify other org members when an alert is resolved.** Chunk 3.3's `notifyAlertCreated` only
  fires on alert *creation* (`lib/alerts/processChangeAlerts.ts`) — nothing emails when someone
  clicks hold/reviewed/escalate (`app/api/alerts/[id]/action/route.ts`). For a single-finance-head
  pilot this doesn't matter; it would if a second `finance_head`/`admin` in the same org wants to
  know a colleague already acted. Out of scope for the pilot — noted so it isn't rediscovered as a
  surprise gap later.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
