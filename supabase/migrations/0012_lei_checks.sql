-- Chunk 4.3 — LEI pre-payment check
-- Table: lei_checks (ERD §3.2). One row per LEI check performed ahead of a
-- qualifying (>= 50cr, RTGS/NEFT) payment. Always written, whatever the
-- outcome — a not_on_record result is still an audit-worthy answer, same
-- "every check writes a row" rule verification_checks/bank_verifications
-- already follow.
--
-- Same RLS/grant situation verification_checks was in before Chunk 3.3-style
-- RPCs existed elsewhere: authenticated gets SELECT-own only, no write
-- policy, no RPC. The only writer is app/api/payments/[id]/lei-check/route.ts,
-- which validates the payment belongs to the caller's org via the caller's
-- own RLS-scoped session client FIRST, then does the actual insert with the
-- admin (service-role) client — the same privilege-escalation shape
-- app/api/alerts/[id]/action/route.ts already uses for its evidence_log write.

create table if not exists public.lei_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id       uuid not null references public.vendors (id) on delete cascade,
  payment_id      uuid not null references public.payments (id) on delete cascade,
  -- The LEI actually checked, or null if the vendor had none on file. Not a
  -- foreign key into vendors.lei_number — vendors.lei_number can change
  -- later; this column freezes what was checked at the time.
  lei_number      text,
  status          text not null
                    check (status in ('issued', 'lapsed', 'retired', 'not_on_record')),
  provider        text not null default 'gleif' check (provider in ('gleif')),
  raw_response    jsonb,
  checked_at      timestamptz not null default now()
);

create index if not exists lei_checks_vendor_id_idx       on public.lei_checks (vendor_id);
create index if not exists lei_checks_payment_id_idx      on public.lei_checks (payment_id);
create index if not exists lei_checks_organization_id_idx on public.lei_checks (organization_id);

alter table public.lei_checks enable row level security;

drop policy if exists lei_checks_select_own on public.lei_checks;
create policy lei_checks_select_own
  on public.lei_checks for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`, no RPC — only the
-- service role writes, via the route described above.

grant select on public.lei_checks to authenticated;
grant all    on public.lei_checks to service_role;
