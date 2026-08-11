-- Chunk 5.1 — Metrics instrumentation
-- Table: product_events. Lightweight, org-scoped event log feeding every
-- Section 11 pilot metric (ERD/PRD §11). Deliberately NOT hardened
-- append-only like evidence_log (migration 0009) — this is analytics, not
-- an audit trail; a bad row here can be corrected. Standard RLS + GRANT
-- pattern, same as every table in this codebase except evidence_log.

create table if not exists public.product_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: several events are org-level, not tied to one vendor
  -- (evidence exports, self-reported survey signals, the PMF trigger).
  vendor_id       uuid references public.vendors (id) on delete cascade,
  event_type      text not null check (event_type in (
                     'vendor_import_completed',
                     'status_change_detected',
                     'alert_created_tracked',
                     'alert_actioned',
                     'bank_cert_issue_caught',
                     'evidence_export_completed',
                     'audit_time_saved_reported',
                     'pilot_to_paid_intent_signal',
                     'pmf_survey_triggered',
                     'pmf_survey_response'
                   )),
  payload         jsonb not null default '{}'::jsonb,
  -- 'system' for pipeline-driven events (imports, polls, alert creation);
  -- a user id for a human-triggered event (alert action, self-reports).
  actor           text not null default 'system',
  created_at      timestamptz not null default now()
);

create index if not exists product_events_org_type_created_idx
  on public.product_events (organization_id, event_type, created_at desc);
create index if not exists product_events_vendor_id_idx
  on public.product_events (vendor_id);

alter table public.product_events enable row level security;

drop policy if exists product_events_select_own on public.product_events;
create policy product_events_select_own
  on public.product_events for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`: only the service role
-- writes (every call site in this chunk uses the admin client, same as
-- verification_checks before an RPC existed for it). No RPC needed — this
-- table never needs org-of-the-caller enforcement beyond what the writer's
-- own privileged code already establishes.

grant select on public.product_events to authenticated;
grant all    on public.product_events to service_role;
