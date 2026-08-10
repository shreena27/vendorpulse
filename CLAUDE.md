# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the dev server at http://localhost:3000 (hot reload).
- `npm run build` — production build.
- `npm start` — serve the production build (run `build` first).
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`).

No test runner is configured yet. `npm test` does not exist; add a framework (e.g. Vitest or Jest) before writing tests.

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

**Testing.**
- Playwright e2e lives in `e2e/`. Run `npm run test:e2e`.
- `e2e/auth.spec.ts` covers sign-up, log out, log in, the protected-route redirect, and the wrong-password inline error.
- `e2e/rls.spec.ts` covers auto-provisioning and cross-tenant isolation (API level and UI level).
- `e2e/vendor-import.spec.ts` covers Chunk 1.1: a good file imports and lists every vendor; a
  duplicate GSTIN is skipped and reported by row number (not merged or double-counted); an empty
  file shows a clear error, not a blank success.
- The tests need `.env.local` and a reachable Supabase project. `playwright.config.ts` loads `.env.local` into the test process.

### Operational notes

- **Migrations run by hand.** Apply each `supabase/migrations/*.sql` in the Supabase SQL Editor (or `supabase db push`). The Vercel deploy does NOT run migrations. There is no CI migration step yet.
- **Every new table needs GRANTs.** PostgREST checks SQL grants BEFORE RLS. A table with policies but no grant returns `permission denied` (42501). Grant `select`/`insert`/`update`/`delete` to `authenticated` as the policy needs, and `all` to `service_role`. See section 6 of `0001_core.sql`.
- **Secrets.** `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. It is gitignored. Never use the service-role key in client code.
- **Deprecation.** Next.js 16.3 prints a warning that `middleware.ts` is deprecated in favor of `proxy.ts`. The file still works. A migration codemod exists.

### Next chunk

Chunk 1.2 — GST provider adapter (Sandbox by Quicko) + mock, behind the common `ProviderAdapter`
interface. Ship against the mock when no live credential exists. Unit tests only (no UI yet): the
same case matrix (active / cancelled / invalid GSTIN / provider timeout) must pass against both the
live and mock adapters and return the same shape.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
