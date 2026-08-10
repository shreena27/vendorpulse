-- Chunk 1.4 — Cron polling + change detection
-- Table: verification_checks (ERD §3.2). Append-only log of every GST/MSME
-- check: one row per poll, per vendor, per check type. The Change Detector
-- compares each new row against the vendor's prior check of the same type
-- (ERD §5.1). Only the service-role cron writes it; authenticated users read
-- their own org's rows.

-- 1. verification_checks -----------------------------------------------------
create table if not exists public.verification_checks (
  id              uuid primary key default gen_random_uuid(),
  -- organization_id is denormalized from the vendor so RLS can reuse the same
  -- org-scoped policy as vendors/vendor_imports (the ERD scopes this table by
  -- vendor_id only; the extra column keeps the policy and indexes simple).
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id       uuid not null references public.vendors (id) on delete cascade,
  check_type      text not null check (check_type in ('gst', 'msme_udyam')),
  status_value    text not null,        -- e.g. ACTIVE, CANCELLED, REGISTERED, LAPSED, UNKNOWN
  -- Providers actually built/planned: Sandbox by Quicko (GST), Deepvue (MSME),
  -- and mock. The ERD also names masters_india as an alternative GST provider,
  -- but nothing writes it; add it here only if that provider is built.
  provider        text not null
                    check (provider in ('sandbox_quicko', 'deepvue', 'mock')),
  raw_response    jsonb,                -- full provider payload, for audit
  is_change       boolean not null default false,
  checked_at      timestamptz not null default now()
);

-- The prior-status lookup: latest check per vendor per type.
create index if not exists verification_checks_vendor_type_idx
  on public.verification_checks (vendor_id, check_type, checked_at desc);
create index if not exists verification_checks_organization_id_idx
  on public.verification_checks (organization_id);

-- 2. Row Level Security ------------------------------------------------------
alter table public.verification_checks enable row level security;

-- A user reads only their own organization's checks.
drop policy if exists verification_checks_select_own on public.verification_checks;
create policy verification_checks_select_own
  on public.verification_checks for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`: this table is append-only
-- and only the service-role cron (poll-gst / poll-msme) writes it. The service
-- role bypasses RLS by design (ERD §6.1).

-- 3. Table privileges --------------------------------------------------------
-- PostgREST checks GRANTs before RLS (the recurring 42501 lesson). `authenticated`
-- gets SELECT only; the cron writes as service_role.
grant select on public.verification_checks to authenticated;
grant all    on public.verification_checks to service_role;
