-- Chunk 3.1 — Impact scorer
-- Table: payments (ERD §3.2). Brought forward from Phase 4 because the
-- impact scorer (lib/alerts/impactScorer.ts) needs it now: an alert only
-- fires when a detected change hits a vendor with an OPEN payment. "Open"
-- means status = 'pending' — the ERD's own phrase for this table's purpose
-- is "Open POs / pending payments".
--
-- No user-facing payments API exists yet (this chunk is scoring logic only,
-- not wired into the poller pipeline — that's Chunk 3.2), so there is no
-- INSERT policy for `authenticated` and no write RPC: only the service role
-- writes, same as verification_checks (0003) before any write path existed
-- for it either.

-- 1. payments -----------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id       uuid not null references public.vendors (id) on delete cascade,
  amount          numeric not null,
  due_date        date not null,
  payment_method  text not null check (payment_method in ('rtgs', 'neft', 'other')),
  status          text not null default 'pending'
                    check (status in ('pending', 'paid', 'cancelled')),
  created_at      timestamptz not null default now()
);

create index if not exists payments_vendor_id_idx on public.payments (vendor_id);
-- The impact scorer's actual query shape: "does this vendor have a pending payment?"
create index if not exists payments_vendor_id_status_idx
  on public.payments (vendor_id, status);

-- 2. Row Level Security ------------------------------------------------------
alter table public.payments enable row level security;

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated` yet: there is no
-- payments-entry UI/API in this chunk. Tests and any future seeding use the
-- service role, which bypasses RLS by design.

-- 3. Table privileges --------------------------------------------------------
grant select on public.payments to authenticated;
grant all    on public.payments to service_role;
