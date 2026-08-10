-- Chunk 3.2 — Alert generation + dedupe
-- Table: alerts (ERD §3.2, §5.3). A surfaced change worth a decision — only
-- created when the impact scorer (lib/alerts/impactScorer.ts) says a
-- detected change is alert-worthy. Dedupe: an existing alert for the same
-- (vendor_id, trigger_type) that hasn't reached cleared/escalated gets its
-- payment_impact_amount updated instead of a new row.
--
-- No user-facing alerts API/UI exists yet (Chunk 3.3), so there is no INSERT
-- policy for `authenticated` and no write RPC: only the service role writes,
-- called exclusively from the poll-gst/poll-msme cron pipeline — the same
-- situation verification_checks was in before this chunk.

-- 1. alerts -----------------------------------------------------------------
create table if not exists public.alerts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  vendor_id              uuid not null references public.vendors (id) on delete cascade,
  trigger_type           text not null check (trigger_type in ('gst_change', 'msme_change', 'lei_check')),
  -- No FK: points into verification_checks (or, later, lei_checks) depending
  -- on trigger_type — same polymorphic "no FK, write never fails" pattern
  -- CLAUDE.md documents for evidence_log.
  source_check_id        uuid not null,
  payment_impact_amount  numeric not null default 0,
  -- Full lifecycle the ERD's own API contract implies (POST /api/alerts/:id
  -- /action takes hold|reviewed|escalate), even though only 'open' is ever
  -- written by this chunk — Chunk 3.3 wires the rest.
  status                 text not null default 'open'
                            check (status in ('open', 'hold', 'reviewed', 'cleared', 'escalated')),
  resolved_by            uuid references public.users (id),
  resolved_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists alerts_vendor_id_idx on public.alerts (vendor_id);
-- The dedupe lookup's actual query shape: "is there an open alert for this
-- vendor + trigger_type?"
create index if not exists alerts_vendor_trigger_status_idx
  on public.alerts (vendor_id, trigger_type, status);
create index if not exists alerts_organization_id_idx on public.alerts (organization_id);

-- 2. Row Level Security ------------------------------------------------------
alter table public.alerts enable row level security;

drop policy if exists alerts_select_own on public.alerts;
create policy alerts_select_own
  on public.alerts for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated` yet: there is no
-- alerts UI/API in this chunk. Tests and the cron pipeline write via the
-- service role, which bypasses RLS by design.

-- 3. Table privileges --------------------------------------------------------
grant select on public.alerts to authenticated;
grant all    on public.alerts to service_role;
