-- Chunk 4.1 — Evidence log wiring
-- Table: evidence_log (ERD "Persistent data rules": append-only record of
-- every check, change, and decision). Points back to its source row via
-- entity_type + entity_id — no FK, same polymorphic pattern alerts.trigger_type
-- / source_check_id already uses (Chunk 3.2) and that CLAUDE.md described for
-- this table before it existed.
--
-- Deliberate departure from every prior table: service_role does NOT get ALL.
-- It gets SELECT + INSERT only. UPDATE and DELETE are granted to nobody, not
-- even service_role. This is what makes the table physically append-only — a
-- bug in the app's own privileged code path cannot alter or erase history,
-- not just "the app chooses not to." service_role is a normal Postgres role
-- here (not the table owner, not a superuser), so REVOKE on it is fully
-- honored — verified by the permissions integration test, not assumed from
-- the GRANT statements alone.

-- 1. evidence_log -------------------------------------------------------
create table if not exists public.evidence_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id       uuid not null references public.vendors (id) on delete cascade,
  event_type      text not null check (event_type in (
                     'verification_check',
                     'status_change',
                     'alert_created',
                     'alert_updated',
                     'alert_resolved'
                   )),
  -- Polymorphic reference, no FK: entity_type names the table
  -- ('verification_checks' | 'alerts'), entity_id is that row's id.
  entity_type     text not null,
  entity_id       uuid not null,
  payload         jsonb not null default '{}'::jsonb,
  -- 'system' for cron/pipeline-driven events; a user id (text) for a
  -- human-triggered event (alert resolution).
  actor           text not null default 'system',
  created_at      timestamptz not null default now()
);

create index if not exists evidence_log_organization_id_idx on public.evidence_log (organization_id);
create index if not exists evidence_log_vendor_id_idx on public.evidence_log (vendor_id);
-- The "reconstructable back to source row" lookup shape.
create index if not exists evidence_log_entity_idx on public.evidence_log (entity_type, entity_id);

-- 2. Row Level Security ------------------------------------------------------
alter table public.evidence_log enable row level security;

drop policy if exists evidence_log_select_own on public.evidence_log;
create policy evidence_log_select_own
  on public.evidence_log for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`: every write comes from
-- the service role (cron pipeline, alert-resolution route), same situation
-- verification_checks was in before an RPC existed for it. There will never
-- be an RPC for this table's writes, by design — see the grants below.

-- 3. Table privileges ---------------------------------------------------
grant select         on public.evidence_log to authenticated;
grant select, insert on public.evidence_log to service_role;

-- Belt-and-suspenders: explicitly revoke UPDATE/DELETE from every role that
-- could otherwise touch this table, including service_role. This statement,
-- not just the absence of a grant above, is the literal thing the "attempt
-- an UPDATE as service_role and confirm it errors" acceptance test proves.
revoke update, delete on public.evidence_log from public;
revoke update, delete on public.evidence_log from authenticated;
revoke update, delete on public.evidence_log from service_role;
